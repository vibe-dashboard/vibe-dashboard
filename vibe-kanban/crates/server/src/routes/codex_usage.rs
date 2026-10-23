use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::Value;

#[derive(Clone, Debug, Serialize)]
pub(super) struct CodexUsageLimitEvent {
    thread_id: String,
    turn_id: String,
    code: &'static str,
}

fn usage_limit_event(value: &Value) -> Option<CodexUsageLimitEvent> {
    let params = value.get("params")?;
    let (thread, turn, code) = match value.get("method")?.as_str()? {
        "codex/event/error" if params.pointer("/msg/type")?.as_str()? == "error" => (
            params.get("conversationId")?,
            params.get("id")?,
            params.pointer("/msg/codex_error_info")?,
        ),
        "error" => (
            params.get("threadId")?,
            params.get("turnId")?,
            params.pointer("/error/codexErrorInfo")?,
        ),
        "turn/completed" if params.pointer("/turn/status")?.as_str()? == "failed" => (
            params.get("threadId")?,
            params.pointer("/turn/id")?,
            params.pointer("/turn/error/codexErrorInfo")?,
        ),
        _ => return None,
    };
    if !matches!(
        code.as_str()?,
        "usage_limit_exceeded" | "usageLimitExceeded"
    ) {
        return None;
    }
    let thread_id = thread.as_str()?.trim();
    let turn_id = turn.as_str()?.trim();
    if thread_id.is_empty() || turn_id.is_empty() {
        return None;
    }
    Some(CodexUsageLimitEvent {
        thread_id: thread_id.to_string(),
        turn_id: turn_id.to_string(),
        code: "usage_limit_exceeded",
    })
}

/// Decode only provider stdout, not normalized prose or JSON embedded in tool text.
/// Bound a single line while allowing subsequent events after oversized tool output.
#[derive(Default)]
pub(super) struct CodexUsageLimitCollector {
    pending: String,
    oversized: bool,
    events: BTreeMap<(String, String), CodexUsageLimitEvent>,
}

impl CodexUsageLimitCollector {
    pub(super) fn push(&mut self, chunk: &str) {
        for part in chunk.split_inclusive('\n') {
            if self.pending.len() + part.len() > 1024 * 1024 {
                self.oversized = true;
                self.pending.clear();
            }
            if !self.oversized {
                self.pending.push_str(part);
            }
            if part.ends_with('\n') {
                self.consume_line();
            }
        }
    }

    fn consume_line(&mut self) {
        if !self.oversized
            && let Ok(value) = serde_json::from_str::<Value>(&self.pending)
            && let Some(event) = usage_limit_event(&value)
        {
            self.events
                .insert((event.thread_id.clone(), event.turn_id.clone()), event);
        }
        self.pending.clear();
        self.oversized = false;
    }

    pub(super) fn finish(mut self) -> Vec<CodexUsageLimitEvent> {
        self.consume_line();
        self.events.into_values().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::CodexUsageLimitCollector;

    const EXHAUSTED: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../scripts/vibe-agent/testing/fixtures/codex-usage-limit.json"
    ));
    const DISCONNECTED: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../scripts/vibe-agent/testing/fixtures/codex-stream-disconnect.json"
    ));

    fn feed(collector: &mut CodexUsageLimitCollector, fixture: &str) {
        let fixture: serde_json::Value = serde_json::from_str(fixture).unwrap();
        for notification in fixture["notifications"].as_array().unwrap() {
            let line = format!("{}\n", serde_json::to_string(notification).unwrap());
            for chunk in line.as_bytes().chunks(7) {
                collector.push(std::str::from_utf8(chunk).unwrap());
            }
        }
    }

    #[test]
    fn verified_mirrored_and_terminal_errors_are_one_turn_event() {
        let mut collector = CodexUsageLimitCollector::default();
        feed(&mut collector, EXHAUSTED);
        let events = collector.finish();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].code, "usage_limit_exceeded");
        assert!(events[0].thread_id.ends_with("0001"));
        assert!(events[0].turn_id.ends_with("0002"));
    }

    #[test]
    fn transient_errors_and_quoted_or_percent_telemetry_are_not_exhaustion() {
        let mut collector = CodexUsageLimitCollector::default();
        feed(&mut collector, DISCONNECTED);
        collector.push("You've hit your usage limit\n");
        collector
            .push("{\"method\":\"account/rateLimits/updated\",\"params\":{\"usedPercent\":100}}\n");
        collector
            .push("{\"method\":\"item/completed\",\"params\":{\"text\":\"usageLimitExceeded\"}}\n");
        assert!(collector.finish().is_empty());
    }

    #[test]
    fn oversized_unrelated_output_does_not_hide_a_subsequent_error() {
        let mut collector = CodexUsageLimitCollector::default();
        collector.push(&"x".repeat(1024 * 1024 + 1));
        collector.push("\n");
        feed(&mut collector, EXHAUSTED);
        assert_eq!(collector.finish().len(), 1);
    }

    #[test]
    fn distinct_turns_remain_distinct_and_other_error_codes_do_not_match() {
        let mut collector = CodexUsageLimitCollector::default();
        let fixture: serde_json::Value = serde_json::from_str(EXHAUSTED).unwrap();
        let mut notification = fixture["notifications"][2].clone();
        for code in ["other", "unauthorized", "serverOverloaded"] {
            notification["params"]["error"]["codexErrorInfo"] = code.into();
            collector.push(&format!("{notification}\n"));
        }
        assert!(collector.finish().is_empty());
        let mut collector = CodexUsageLimitCollector::default();
        feed(&mut collector, EXHAUSTED);
        notification["params"]["error"]["codexErrorInfo"] = "usageLimitExceeded".into();
        notification["params"]["turnId"] = "different-turn".into();
        collector.push(&notification.to_string()); // Also accept a final line without a newline.
        assert_eq!(collector.finish().len(), 2);
    }
}
