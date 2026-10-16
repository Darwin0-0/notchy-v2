//! Existing guarded desktop preferences; one native profile and whitelist.
use crate::ApiError;
use serde_json::{json, Value};
use std::collections::BTreeMap;

pub const KEYS: [&str; 8] = [
    "notchy-minimal-appearance-v1",
    "notchy-minimal-modules-v1",
    "notchy-minimal-focus-v1",
    "notchy-minimal-welcome-v1",
    "notchy-language-v1",
    "notchy-scenarios-v1",
    "notchy-module-order-v1",
    "notchy-peer-favorites-v1",
];
pub fn valid_module_order(text: &str) -> bool {
    if text.len() > 512 {
        return false;
    }
    let Ok(order) = serde_json::from_str::<[String; 5]>(text) else {
        return false;
    };
    order.iter().enumerate().all(|(index, id)| {
        matches!(id.as_str(), "music" | "focus" | "weather" | "tasks" | "shelf")
            && !order[..index].contains(id)
    })
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PeerFavorite {
    identity: String,
    alias: String,
    device_type: String,
}

pub fn valid_peer_favorites(text: &str) -> bool {
    if text.len() > 20_000 {
        return false;
    }
    let Ok(favorites) = serde_json::from_str::<Vec<PeerFavorite>>(text) else {
        return false;
    };
    favorites.len() <= 32
        && favorites.iter().enumerate().all(|(index, favorite)| {
            favorite.identity.len() == 64
                && favorite.identity.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
                && !favorites[..index].iter().any(|other| other.identity == favorite.identity)
                && !favorite.alias.is_empty() && favorite.alias.chars().count() <= 120
                && !favorite.alias.chars().any(char::is_control)
                && matches!(favorite.device_type.as_str(), "desktop" | "mobile")
        })
}

pub fn restore_preferences(preferences: BTreeMap<String, String>) -> BTreeMap<String, String> {
    preferences.into_iter().filter(|(key, value)| {
        KEYS.contains(&key.as_str()) && value.len() <= 262144 && match key.as_str() {
            "notchy-language-v1" => valid_language(value),
            "notchy-scenarios-v1" => valid_scenarios(value),
            "notchy-module-order-v1" => valid_module_order(value),
            "notchy-peer-favorites-v1" => valid_peer_favorites(value),
            _ => true,
        }
    }).collect()
}

pub fn preference_input(value: &Value) -> Result<(&str, Option<&str>), ApiError> {
    let object = value.as_object().filter(|object| object.len() == 2)
        .ok_or_else(|| ApiError::new(400, "Préférence invalide."))?;
    let key = object.get("key").and_then(Value::as_str).filter(|key| KEYS.contains(key))
        .ok_or_else(|| ApiError::new(400, "Préférence inconnue."))?;
    let value = object.get("value").ok_or_else(|| ApiError::new(400, "Préférence invalide."))?;
    if value.is_null() {
        return Ok((key, None));
    }
    let text = value.as_str().filter(|text| text.len() <= 262144 && match key {
        "notchy-minimal-welcome-v1" => *text == "done",
        "notchy-language-v1" => valid_language(text),
        "notchy-scenarios-v1" => valid_scenarios(text),
        "notchy-module-order-v1" => valid_module_order(text),
        "notchy-peer-favorites-v1" => valid_peer_favorites(text),
        _ => serde_json::from_str::<Value>(text).is_ok(),
    }).ok_or_else(|| ApiError::new(400, "Préférence invalide."))?;
    Ok((key, Some(text)))
}

pub async fn persist_preferences(data: &std::path::Path, preferences: &BTreeMap<String, String>) -> Result<(), ApiError> {
    let destination = data.join(".desktop-profile/tauri-preferences.json");
    let temporary = destination.with_extension("tmp");
    tokio::fs::write(
        &temporary,
        serde_json::to_vec(preferences).map_err(|_| ApiError::new(500, "Préférence invalide."))?,
    ).await?;
    tokio::fs::rename(&temporary, &destination).await?;
    Ok(())
}

pub fn valid_scenarios(text: &str) -> bool {
    if text.len() > 4096 { return false; }
    let Ok(value) = serde_json::from_str::<Value>(text) else { return false; };
    let Some(object) = value.as_object().filter(|object| object.len() == 6) else { return false; };
    let scenario = |value: &Value| matches!(value.as_str(), Some("focus" | "ambience" | "day" | "complete" | "minimal"));
    if !matches!(value["mode"].as_str(), Some("auto" | "manual"))
        || !object.contains_key("selected")
        || !(value["selected"].is_null() || scenario(&value["selected"]))
        || !value["manualUntil"].as_u64().is_some_and(|time| time <= 9_007_199_254_740_991)
        || !object.contains_key("lastMorningDay")
        || !(value["lastMorningDay"].is_null() || value["lastMorningDay"].as_str().is_some_and(|day| day.len() == 10 && chrono::NaiveDate::parse_from_str(day, "%Y-%m-%d").is_ok()))
    { return false; }
    let Some(rules) = value["rules"].as_object().filter(|rules| rules.len() == 4) else { return false; };
    let Some(guards) = value["guards"].as_object().filter(|guards| guards.len() == 3) else { return false; };
    ["work", "break", "morning", "idle"].iter().all(|key| {
        rules.get(*key).and_then(Value::as_object).is_some_and(|rule| {
            rule.len() == 2 && rule.get("enabled").is_some_and(Value::is_boolean)
                && rule.get("scenario").is_some_and(&scenario)
        })
    }) && ["undo", "manualLock", "interacting"].iter().all(|key| guards.get(*key).is_some_and(Value::is_boolean))
}
pub fn valid_language(value: &str) -> bool {
    matches!(value, "fr" | "en")
}

pub fn snapshot(preferences: &BTreeMap<String, String>) -> Value {
    Value::Object(preferences.iter().filter(|(key, _)| KEYS.contains(&key.as_str())).map(|(key, text)| {
        let value = serde_json::from_str(text).unwrap_or_else(|_| Value::String(text.clone()));
        (key.clone(), value)
    }).collect())
}

/// Validate every entry before returning a shallow replacement; callers persist once under the existing mutex.
pub fn merge(preferences: &BTreeMap<String, String>, patch: &Value) -> Result<BTreeMap<String, String>, ApiError> {
    let object = patch.as_object().filter(|object| object.len() <= KEYS.len())
        .ok_or_else(|| ApiError::new(400, "Préférences invalides."))?;
    let mut next = preferences.clone();
    for (key, value) in object {
        let text = if value.is_null() { Value::Null } else {
            Value::String(value.as_str().map(str::to_owned).unwrap_or_else(|| value.to_string()))
        };
        let command = json!({"key":key,"value":text});
        let (_, text) = preference_input(&command)?;
        if let Some(text) = text { next.insert(key.clone(), text.to_owned()); } else { next.remove(key); }
    }
    Ok(next)
}

pub fn favorites_list(preferences: &BTreeMap<String, String>) -> Vec<Value> {
    preferences.get("notchy-peer-favorites-v1").filter(|text| valid_peer_favorites(text))
        .and_then(|text| serde_json::from_str(text).ok()).unwrap_or_default()
}

/// A favorite is metadata about a certificate identity, never an IP or proof of availability.
pub fn favorites_add(preferences: &BTreeMap<String, String>, favorite: &Value) -> Result<BTreeMap<String, String>, ApiError> {
    if !valid_peer_favorites(&json!([favorite]).to_string()) {
        return Err(ApiError::new(400, "Appareil favori invalide."));
    }
    let mut favorites = favorites_list(preferences);
    favorites.retain(|item| item["identity"] != favorite["identity"]);
    favorites.insert(0, favorite.clone()); favorites.truncate(32);
    merge(preferences, &json!({"notchy-peer-favorites-v1":favorites}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shallow_patch_preserves_other_settings_and_rejects_unknown_keys_atomically() {
        let original = BTreeMap::from([("notchy-language-v1".into(), "fr".into()),
            ("notchy-minimal-focus-v1".into(), r#"{"state":{"deadline":123}}"#.into())]);
        let next = merge(&original, &json!({"notchy-language-v1":"en"})).unwrap();
        assert_eq!(snapshot(&next)["notchy-language-v1"], "en");
        assert_eq!(next["notchy-minimal-focus-v1"], original["notchy-minimal-focus-v1"]);
        assert!(merge(&original, &json!({"notchy-language-v1":"en","unexpected":true})).is_err());
        assert_eq!(original["notchy-language-v1"], "fr");
        assert!(!merge(&next, &json!({"notchy-language-v1":null})).unwrap().contains_key("notchy-language-v1"));
    }
    #[test]
    fn favorites_deduplicate_by_certificate_and_never_store_an_address_or_session_id() {
        let first = json!({"identity":"a".repeat(64),"alias":"Phone","deviceType":"mobile"});
        let saved = favorites_add(&BTreeMap::new(), &first).unwrap();
        let mut renamed = first.clone(); renamed["alias"] = json!("Renamed");
        let updated = favorites_add(&saved, &renamed).unwrap();
        assert_eq!(favorites_list(&updated), vec![renamed]);
        let mut invalid = first; invalid["address"] = json!("192.168.1.2");
        assert!(favorites_add(&updated, &invalid).is_err());
    }
    #[tokio::test]
    async fn native_settings_use_the_existing_profile_file_and_round_trip_typed_values() {
        let root = tempfile::tempdir().unwrap(); tokio::fs::create_dir(root.path().join(".desktop-profile")).await.unwrap();
        let saved = merge(&BTreeMap::new(), &json!({"notchy-minimal-appearance-v1":{"motion":false},"notchy-language-v1":"en"})).unwrap();
        persist_preferences(root.path(), &saved).await.unwrap();
        let bytes = tokio::fs::read(root.path().join(".desktop-profile/tauri-preferences.json")).await.unwrap();
        let restored = restore_preferences(serde_json::from_slice(&bytes).unwrap());
        assert_eq!(snapshot(&restored)["notchy-minimal-appearance-v1"]["motion"], false);
        assert_eq!(restored, saved);
    }
}
