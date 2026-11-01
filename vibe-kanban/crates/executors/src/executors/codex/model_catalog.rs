use std::collections::HashSet;

use serde::Deserialize;

use crate::model_selector::{ModelInfo, ModelSelectorConfig, PermissionPolicy, ReasoningOption};

#[derive(Debug, Deserialize)]
struct CodexModelCatalog {
    #[serde(default)]
    models: Vec<CodexCatalogModel>,
}

#[derive(Debug, Deserialize)]
struct CodexCatalogModel {
    slug: Option<String>,
    display_name: Option<String>,
    #[serde(default)]
    visibility: Option<String>,
    #[serde(default)]
    priority: Option<i64>,
    #[serde(default)]
    default_reasoning_level: Option<String>,
    #[serde(default)]
    supported_reasoning_levels: Vec<CodexCatalogReasoningLevel>,
    #[serde(default)]
    additional_speed_tiers: Vec<String>,
    #[serde(default)]
    service_tiers: Vec<CodexCatalogServiceTier>,
}

#[derive(Debug, Deserialize)]
struct CodexCatalogReasoningLevel {
    effort: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CodexCatalogServiceTier {
    id: Option<String>,
}

pub(super) fn model_selector_from_catalog_slice(
    output: &[u8],
) -> Result<ModelSelectorConfig, String> {
    let catalog_json = std::str::from_utf8(output)
        .map_err(|error| format!("codex model catalog was not valid UTF-8: {error}"))?;
    model_selector_from_catalog_json(catalog_json)
}

pub(super) fn model_selector_from_catalog_json(
    catalog_json: &str,
) -> Result<ModelSelectorConfig, String> {
    let mut catalog: CodexModelCatalog = serde_json::from_str(catalog_json)
        .map_err(|error| format!("failed to parse codex model catalog JSON: {error}"))?;

    catalog.models.retain(|model| {
        model
            .visibility
            .as_deref()
            .is_some_and(|visibility| visibility.eq_ignore_ascii_case("list"))
    });

    catalog.models.sort_by(|a, b| {
        a.priority
            .unwrap_or(i64::MAX)
            .cmp(&b.priority.unwrap_or(i64::MAX))
            .then_with(|| display_name_or_slug(a).cmp(&display_name_or_slug(b)))
            .then_with(|| a.slug.cmp(&b.slug))
    });

    let mut seen_model_ids = HashSet::new();
    let mut models = Vec::new();
    let mut model_order = Vec::new();

    for catalog_model in catalog.models {
        let Some(slug) = non_empty(catalog_model.slug.clone()) else {
            continue;
        };
        if !seen_model_ids.insert(slug.to_lowercase()) {
            continue;
        }

        let name = non_empty(catalog_model.display_name.clone()).unwrap_or_else(|| slug.clone());
        let reasoning_options = map_reasoning_options(
            &catalog_model.supported_reasoning_levels,
            catalog_model.default_reasoning_level.as_deref(),
        );

        push_model(
            &mut models,
            &mut model_order,
            ModelInfo {
                id: slug.clone(),
                name: name.clone(),
                provider_id: None,
                reasoning_options: reasoning_options.clone(),
            },
        );

        if supports_fast_tier(&catalog_model) {
            push_model(
                &mut models,
                &mut model_order,
                ModelInfo {
                    id: format!("{slug}-fast"),
                    name: format!("{name} Fast"),
                    provider_id: None,
                    reasoning_options,
                },
            );
        }
    }

    if models.is_empty() {
        return Err("codex model catalog did not contain any list-visible models".to_string());
    }

    Ok(ModelSelectorConfig {
        models,
        model_order: Some(model_order),
        permissions: vec![
            PermissionPolicy::Auto,
            PermissionPolicy::Supervised,
            PermissionPolicy::Plan,
        ],
        ..Default::default()
    })
}

fn display_name_or_slug(model: &CodexCatalogModel) -> String {
    model
        .display_name
        .as_deref()
        .or(model.slug.as_deref())
        .unwrap_or_default()
        .to_lowercase()
}

fn non_empty(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn push_model(models: &mut Vec<ModelInfo>, model_order: &mut Vec<String>, model: ModelInfo) {
    model_order.push(model.id.clone());
    models.push(model);
}

fn supports_fast_tier(model: &CodexCatalogModel) -> bool {
    model
        .additional_speed_tiers
        .iter()
        .any(|tier| tier.eq_ignore_ascii_case("fast"))
        || model.service_tiers.iter().any(|tier| {
            tier.id
                .as_deref()
                .is_some_and(|id| id.eq_ignore_ascii_case("priority"))
        })
}

fn map_reasoning_options(
    levels: &[CodexCatalogReasoningLevel],
    default_level: Option<&str>,
) -> Vec<ReasoningOption> {
    let mut seen = HashSet::new();
    let level_ids: Vec<String> = levels
        .iter()
        .filter_map(|level| level.effort.as_deref())
        .map(str::trim)
        .filter(|level| !level.is_empty())
        .filter(|level| seen.insert(level.to_lowercase()))
        .map(ToString::to_string)
        .collect();

    let default_level = default_level
        .map(str::trim)
        .filter(|level| !level.is_empty());
    let default_level_matches = default_level
        .is_some_and(|default| level_ids.iter().any(|id| id.eq_ignore_ascii_case(default)));

    level_ids
        .iter()
        .enumerate()
        .map(|(index, id)| ReasoningOption {
            id: id.clone(),
            label: reasoning_label(id),
            is_default: if default_level_matches {
                default_level.is_some_and(|default| id.eq_ignore_ascii_case(default))
            } else {
                index == 0
            },
        })
        .collect()
}

fn reasoning_label(id: &str) -> String {
    match id.to_lowercase().as_str() {
        "xhigh" => "Extra High".to_string(),
        _ => id
            .split(['-', '_'])
            .filter(|part| !part.is_empty())
            .map(|part| {
                let mut chars = part.chars();
                match chars.next() {
                    Some(first) => {
                        first.to_uppercase().collect::<String>() + &chars.as_str().to_lowercase()
                    }
                    None => String::new(),
                }
            })
            .collect::<Vec<_>>()
            .join(" "),
    }
}

#[cfg(test)]
mod tests {
    use super::model_selector_from_catalog_json;

    const CATALOG_FIXTURE: &str =
        include_str!("../../../tests/fixtures/codex-model-catalog/bundled-0.147.0-minimal.json");

    #[test]
    fn parses_list_visible_models_in_priority_order_with_fast_variants() {
        let config = model_selector_from_catalog_json(CATALOG_FIXTURE).unwrap();

        let model_ids: Vec<_> = config
            .models
            .iter()
            .map(|model| model.id.as_str())
            .collect();
        assert_eq!(
            model_ids,
            [
                "gpt-5.6-sol",
                "gpt-5.6-sol-fast",
                "gpt-5.6-terra",
                "gpt-5.6-terra-fast",
                "gpt-5.6-luna",
                "gpt-5.6-luna-fast",
                "gpt-5.5",
                "gpt-5.5-fast",
                "gpt-5.2"
            ]
        );
        assert_eq!(
            config.model_order,
            Some(model_ids.iter().map(|id| id.to_string()).collect())
        );
        assert!(
            !config
                .models
                .iter()
                .any(|model| model.id == "gpt-5.4" || model.id == "codex-auto-review")
        );
    }

    #[test]
    fn maps_catalog_reasoning_levels_and_defaults() {
        let config = model_selector_from_catalog_json(CATALOG_FIXTURE).unwrap();
        let sol = config
            .models
            .iter()
            .find(|model| model.id == "gpt-5.6-sol")
            .unwrap();

        let reasoning_ids: Vec<_> = sol
            .reasoning_options
            .iter()
            .map(|option| (option.id.as_str(), option.label.as_str(), option.is_default))
            .collect();
        assert_eq!(
            reasoning_ids,
            [
                ("low", "Low", true),
                ("medium", "Medium", false),
                ("high", "High", false),
                ("xhigh", "Extra High", false),
                ("max", "Max", false),
                ("ultra", "Ultra", false)
            ]
        );
    }

    #[test]
    fn rejects_catalog_without_list_visible_models() {
        let error = model_selector_from_catalog_json(
            r#"{"models":[{"slug":"codex-auto-review","visibility":"hide"}]}"#,
        )
        .unwrap_err();

        assert!(error.contains("list-visible models"));
    }
}
