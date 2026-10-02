use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{
    executors::{BaseCodingAgent, SlashCommandDescription},
    model_selector::ModelSelectorConfig,
};

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ExecutorDiscoveredOptions {
    pub model_selector: ModelSelectorConfig,
    pub slash_commands: Vec<SlashCommandDescription>,
    pub loading_models: bool,
    pub loading_agents: bool,
    pub loading_slash_commands: bool,
    pub error: Option<String>,
}

impl Default for ExecutorDiscoveredOptions {
    fn default() -> Self {
        Self {
            model_selector: ModelSelectorConfig::default(),
            slash_commands: vec![vk_clear_command()],
            loading_models: false,
            loading_agents: false,
            loading_slash_commands: false,
            error: None,
        }
    }
}

impl ExecutorDiscoveredOptions {
    pub fn ensure_vk_session_commands(&mut self) {
        if !self
            .slash_commands
            .iter()
            .any(|command| command.name == "clear")
        {
            self.slash_commands.push(vk_clear_command());
        }
    }

    pub fn with_vk_session_commands(mut self) -> Self {
        self.ensure_vk_session_commands();
        self
    }

    pub fn with_loading(mut self, loading: bool) -> Self {
        self.loading_models = loading;
        self.loading_agents = loading;
        self.loading_slash_commands = loading;
        self.ensure_vk_session_commands();
        self
    }
}

fn vk_clear_command() -> SlashCommandDescription {
    SlashCommandDescription {
        name: "clear".to_string(),
        description: Some(
            "Clear VK's session context while keeping conversation history visible".to_string(),
        ),
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct ExecutorConfigCacheKey {
    pub path: Option<PathBuf>,
    pub cmd_key: String,
    pub base_executor: BaseCodingAgent,
}

impl ExecutorConfigCacheKey {
    pub fn new(path: Option<&PathBuf>, cmd_key: String, base_executor: BaseCodingAgent) -> Self {
        Self {
            path: path.cloned(),
            cmd_key,
            base_executor,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::ExecutorDiscoveredOptions;

    #[test]
    fn default_options_include_vk_clear_command() {
        let options = ExecutorDiscoveredOptions::default();

        assert_eq!(
            options
                .slash_commands
                .iter()
                .filter(|command| command.name == "clear")
                .count(),
            1
        );
    }

    #[test]
    fn ensure_vk_session_commands_adds_clear_once() {
        let mut options = ExecutorDiscoveredOptions::default();
        options.slash_commands.clear();

        options.ensure_vk_session_commands();
        options.ensure_vk_session_commands();

        assert_eq!(
            options
                .slash_commands
                .iter()
                .filter(|command| command.name == "clear")
                .count(),
            1
        );
    }
}
