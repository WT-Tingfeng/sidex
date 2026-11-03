//! Layered settings store: default < user < workspace.

use std::collections::HashMap;
use std::path::Path;

use anyhow::{Context, Result};
use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::defaults::builtin_defaults;
use crate::jsonc::parse_jsonc;

/// Callback type for change notifications.
type ChangeHandler = Box<dyn Fn(&Value) + Send + Sync>;

/// Layered settings store supporting default, user, and workspace layers.
///
/// Lookup order (highest priority first): workspace → user → default.
pub struct Settings {
    default_layer: Value,
    user_layer: Value,
    workspace_layer: Value,
    change_handlers: HashMap<String, Vec<ChangeHandler>>,
}

impl std::fmt::Debug for Settings {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Settings")
            .field("default_layer", &self.default_layer)
            .field("user_layer", &self.user_layer)
            .field("workspace_layer", &self.workspace_layer)
            .field(
                "change_handlers",
                &format!("{} keys", self.change_handlers.len()),
            )
            .finish()
    }
}

impl Default for Settings {
    fn default() -> Self {
        Self::new()
    }
}

impl Settings {
    /// Create a new settings store pre-populated with built-in defaults.
    pub fn new() -> Self {
        Self {
            default_layer: builtin_defaults(),
            user_layer: Value::Object(serde_json::Map::new()),
            workspace_layer: Value::Object(serde_json::Map::new()),
            change_handlers: HashMap::new(),
        }
    }

    /// Load user-level settings from a `settings.json` file (JSONC).
    pub fn load_user(&mut self, path: &Path) -> Result<()> {
        let contents =
            std::fs::read_to_string(path).context("failed to read user settings file")?;
        let parsed = parse_jsonc(&contents)?;
        let old_layer = std::mem::replace(&mut self.user_layer, parsed);
        self.fire_changes(&old_layer, &self.user_layer.clone());
        Ok(())
    }

    /// Load workspace-level settings from a `settings.json` file (JSONC).
    pub fn load_workspace(&mut self, path: &Path) -> Result<()> {
        let contents =
            std::fs::read_to_string(path).context("failed to read workspace settings file")?;
        let parsed = parse_jsonc(&contents)?;
        let old_layer = std::mem::replace(&mut self.workspace_layer, parsed);
        self.fire_changes(&old_layer, &self.workspace_layer.clone());
        Ok(())
    }

    /// Get a setting value, deserialised into `T`.
    ///
    /// Looks up workspace → user → default layers in order.
    pub fn get<T: DeserializeOwned>(&self, key: &str) -> Option<T> {
        let raw = self.get_raw(key)?;
        serde_json::from_value(raw.clone()).ok()
    }

    /// Get the raw `Value` for a key across all layers.
    pub fn get_raw(&self, key: &str) -> Option<&Value> {
        Self::lookup(&self.workspace_layer, key)
            .or_else(|| Self::lookup(&self.user_layer, key))
            .or_else(|| Self::lookup(&self.default_layer, key))
    }

    /// Get every setting stored under a dotted `prefix` as a JSON object.
    ///
    /// Keys are flat dotted strings (for example `sidex.cascade.background`),
    /// so a plain [`Self::get_raw`] lookup of a section name like
    /// `sidex.cascade` always misses. This collects all keys starting with
    /// `prefix.` across the layers using the same precedence as
    /// [`Self::get_raw`] (default < user < workspace) and strips `prefix.`
    /// from the resulting keys.
    ///
    /// Legacy nested objects (for example
    /// `{"sidex": {"cascade": {"background": false}}}`) are tolerated and
    /// merged at the same layer; within a layer a flat dotted key wins over a
    /// nested one with the same name.
    ///
    /// Returns [`Value::Null`] when no layer holds a matching key.
    pub fn get_section(&self, prefix: &str) -> Value {
        let prefix = prefix.trim_end_matches('.');
        if prefix.is_empty() {
            return Value::Null;
        }

        let mut merged = serde_json::Map::new();
        // Lowest precedence first; later layers overwrite earlier ones.
        for layer in [&self.default_layer, &self.user_layer, &self.workspace_layer] {
            collect_section(layer, prefix, &mut merged);
        }

        if merged.is_empty() {
            Value::Null
        } else {
            Value::Object(merged)
        }
    }

    /// Get the entire user layer as a JSON value.
    pub fn user_layer(&self) -> &Value {
        &self.user_layer
    }

    /// Get the entire workspace layer as a JSON value.
    pub fn workspace_layer(&self) -> &Value {
        &self.workspace_layer
    }

    /// Set a value in the **user** layer.
    pub fn set(&mut self, key: &str, value: Value) {
        let old = self.get_raw(key).cloned();
        set_in_layer(&mut self.user_layer, key, value);
        if let Some(new) = self.get_raw(key) {
            if old.as_ref() != Some(new) {
                self.fire_handlers(key, new);
            }
        }
    }

    /// Set a value in the **workspace** layer.
    pub fn set_workspace(&mut self, key: &str, value: Value) {
        let old = self.get_raw(key).cloned();
        set_in_layer(&mut self.workspace_layer, key, value);
        if let Some(new) = self.get_raw(key) {
            if old.as_ref() != Some(new) {
                self.fire_handlers(key, new);
            }
        }
    }

    /// Register a callback that fires when the effective value of `key`
    /// changes.
    pub fn on_change<F>(&mut self, key: &str, handler: F)
    where
        F: Fn(&Value) + Send + Sync + 'static,
    {
        self.change_handlers
            .entry(key.to_owned())
            .or_default()
            .push(Box::new(handler));
    }

    // ── Internal helpers ─────────────────────────────────────────────────

    fn lookup<'a>(layer: &'a Value, key: &str) -> Option<&'a Value> {
        layer.as_object()?.get(key)
    }

    fn fire_handlers(&self, key: &str, new_val: &Value) {
        if let Some(handlers) = self.change_handlers.get(key) {
            for h in handlers {
                h(new_val);
            }
        }
    }

    fn fire_changes(&self, old: &Value, new: &Value) {
        let empty = serde_json::Map::new();
        let old_map = old.as_object().unwrap_or(&empty);
        let new_map = new.as_object().unwrap_or(&empty);

        for (key, new_val) in new_map {
            if old_map.get(key) != Some(new_val) {
                if let Some(effective) = self.get_raw(key) {
                    self.fire_handlers(key, effective);
                }
            }
        }

        for key in old_map.keys() {
            if !new_map.contains_key(key) {
                if let Some(effective) = self.get_raw(key) {
                    self.fire_handlers(key, effective);
                }
            }
        }
    }
}

fn set_in_layer(layer: &mut Value, key: &str, value: Value) {
    if let Some(obj) = layer.as_object_mut() {
        obj.insert(key.to_owned(), value);
    }
}

/// Collect the settings under `prefix` from one layer into `out`.
///
/// Handles both the canonical flat form (`"sidex.cascade.background": false`)
/// and the legacy nested form (`{"sidex": {"cascade": {"background": false}}}`).
fn collect_section(layer: &Value, prefix: &str, out: &mut serde_json::Map<String, Value>) {
    // Legacy nested form; inserted first so that flat keys win within a layer.
    let mut nested = Some(layer);
    for segment in prefix.split('.') {
        nested = nested.and_then(Value::as_object).and_then(|obj| obj.get(segment));
    }
    if let Some(inner) = nested.and_then(Value::as_object) {
        for (key, value) in inner {
            out.insert(key.clone(), value.clone());
        }
    }

    // Canonical flat form.
    if let Some(obj) = layer.as_object() {
        let dotted = format!("{prefix}.");
        for (key, value) in obj {
            if let Some(rest) = key.strip_prefix(&dotted) {
                if !rest.is_empty() {
                    out.insert(rest.to_owned(), value.clone());
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::{Arc, Mutex};

    #[test]
    fn get_default_value() {
        let s = Settings::new();
        let size: i64 = s.get("editor.fontSize").unwrap();
        assert_eq!(size, 14);
    }

    #[test]
    fn user_overrides_default() {
        let mut s = Settings::new();
        s.set("editor.fontSize", json!(18));
        let size: i64 = s.get("editor.fontSize").unwrap();
        assert_eq!(size, 18);
    }

    #[test]
    fn workspace_overrides_user() {
        let mut s = Settings::new();
        s.set("editor.fontSize", json!(18));
        s.set_workspace("editor.fontSize", json!(22));
        let size: i64 = s.get("editor.fontSize").unwrap();
        assert_eq!(size, 22);
    }

    #[test]
    fn missing_key_returns_none() {
        let s = Settings::new();
        let val: Option<String> = s.get("nonexistent.key");
        assert!(val.is_none());
    }

    #[test]
    fn on_change_fires() {
        let mut s = Settings::new();
        let observed = Arc::new(Mutex::new(None));
        let obs_clone = Arc::clone(&observed);
        s.on_change("editor.fontSize", move |v| {
            *obs_clone.lock().unwrap() = Some(v.clone());
        });
        s.set("editor.fontSize", json!(20));
        let val = observed.lock().unwrap().clone().unwrap();
        assert_eq!(val, json!(20));
    }

    #[test]
    fn on_change_not_fired_for_same_value() {
        let mut s = Settings::new();
        s.set("editor.fontSize", json!(14));
        let count = Arc::new(Mutex::new(0));
        let count_clone = Arc::clone(&count);
        s.on_change("editor.fontSize", move |_| {
            *count_clone.lock().unwrap() += 1;
        });
        s.set("editor.fontSize", json!(14));
        assert_eq!(*count.lock().unwrap(), 0);
    }

    #[test]
    fn get_typed_bool() {
        let s = Settings::new();
        let minimap: bool = s.get("editor.minimap.enabled").unwrap();
        assert!(minimap);
    }

    #[test]
    fn get_typed_string() {
        let s = Settings::new();
        let theme: String = s.get("workbench.colorTheme").unwrap();
        assert_eq!(theme, "Default Dark+");
    }

    #[test]
    fn get_section_strips_prefix() {
        let mut s = Settings::new();
        s.set("sidex.cascade.background", json!(false));
        s.set("sidex.cascade.previews", json!(true));
        s.set("sidex.general.telemetry", json!(true));
        assert_eq!(
            s.get_section("sidex.cascade"),
            json!({"background": false, "previews": true})
        );
    }

    #[test]
    fn get_section_merges_layers_with_workspace_precedence() {
        let mut s = Settings::new();
        s.set("sidex.agents.maxTurns", json!(5));
        s.set("sidex.agents.enabled", json!(true));
        s.set_workspace("sidex.agents.maxTurns", json!(9));
        let section = s.get_section("sidex.agents");
        assert_eq!(section["maxTurns"], json!(9));
        assert_eq!(section["enabled"], json!(true));
    }

    #[test]
    fn get_section_missing_prefix_returns_null() {
        let s = Settings::new();
        assert_eq!(s.get_section("sidex.nonexistent"), Value::Null);
        assert_eq!(s.get_section(""), Value::Null);
    }

    #[test]
    fn get_section_tolerates_nested_legacy_objects() {
        let mut s = Settings::new();
        s.user_layer = json!({
            "sidex": {"cascade": {"background": false, "previews": true}}
        });
        assert_eq!(
            s.get_section("sidex.cascade"),
            json!({"background": false, "previews": true})
        );
    }

    #[test]
    fn get_section_flat_key_wins_over_nested() {
        let mut s = Settings::new();
        s.user_layer = json!({
            "sidex.general.telemetry": true,
            "sidex": {"general": {"telemetry": false}}
        });
        assert_eq!(s.get_section("sidex.general")["telemetry"], json!(true));
    }
}
