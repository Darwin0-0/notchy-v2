use notchy::{
    desktop::{self, Geometry, NotchState},
    server::{Server, Services},
    startup::Startup,
    ApiError,
};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use notchy::settings::{KEYS, restore_preferences, preference_input, persist_preferences};
#[cfg(test)]
use notchy::settings::{valid_module_order, valid_peer_favorites, valid_scenarios, valid_language};

fn tray_labels(language: &str) -> [&'static str; 3] {
    if language == "en" {
        ["Open Notchy V2", "Hide", "Quit"]
    } else {
        ["Ouvrir Notchy V2", "Masquer", "Quitter"]
    }
}
#[cfg(test)]
mod language_tests {
    use super::{tray_labels, valid_language, KEYS};
    #[test]
    fn tray_menu_uses_the_chosen_language_and_french_fallback() {
        assert_eq!(tray_labels("en"), ["Open Notchy V2", "Hide", "Quit"]);
        assert_eq!(tray_labels("fr"), ["Ouvrir Notchy V2", "Masquer", "Quitter"]);
        assert_eq!(tray_labels("invalid"), tray_labels("fr"));
    }
    #[test]
    fn language_preferences_accept_only_the_two_supported_values() {
        assert!(KEYS.contains(&"notchy-language-v1"));
        for value in ["fr", "en"] { assert!(valid_language(value)); }
        for value in ["", "FR", "en-US", "de", "null", "\"en\""] { assert!(!valid_language(value)); }
    }
    #[test]
    fn restoring_language_keeps_other_preferences_untouched() {
        let focus = "{\"deadline\":12345}";
        for language in ["fr", "en", "invalid"] {
            let preferences = std::collections::BTreeMap::from([
                ("notchy-language-v1", language), ("notchy-minimal-focus-v1", focus)
            ]);
            let restored = preferences.into_iter().filter(|(key, value)| *key != "notchy-language-v1" || valid_language(value)).collect::<std::collections::BTreeMap<_, _>>();
            assert_eq!(restored.get("notchy-minimal-focus-v1"), Some(&focus));
            assert_eq!(restored.get("notchy-language-v1").is_some(), language != "invalid");
        }
    }
}
#[cfg(test)]
mod scenario_preference_tests {
    use super::{valid_scenarios, KEYS};
    use serde_json::json;
    fn sample() -> serde_json::Value {
        json!({"mode":"auto","rules":{
            "work":{"enabled":true,"scenario":"focus"}, "break":{"enabled":true,"scenario":"ambience"},
            "morning":{"enabled":true,"scenario":"day"}, "idle":{"enabled":true,"scenario":"ambience"}},
            "guards":{"undo":true,"manualLock":true,"interacting":true},
            "selected":null,"manualUntil":0,"lastMorningDay":null})
    }
    #[test]
    fn scenario_preferences_accept_only_known_choices_and_typed_guards() {
        assert!(KEYS.contains(&"notchy-scenarios-v1"));
        let mut value = sample(); assert!(valid_scenarios(&value.to_string()));
        value["mode"] = json!("manual"); value["selected"] = json!("complete");
        value["manualUntil"] = json!(1_792_000_000_000u64); value["lastMorningDay"] = json!("2026-10-14");
        assert!(valid_scenarios(&value.to_string()));
        for (key, invalid) in [("mode",json!("unknown")),("selected",json!("calendar")),("manualUntil",json!(-1)),("lastMorningDay",json!("2026-02-30"))] {
            let mut broken = sample(); broken[key] = invalid; assert!(!valid_scenarios(&broken.to_string()));
        }
        let mut broken = sample(); broken["guards"]["interacting"] = json!("true"); assert!(!valid_scenarios(&broken.to_string()));
        let mut broken = sample(); broken["rules"]["work"]["scenario"] = json!("unknown"); assert!(!valid_scenarios(&broken.to_string()));
        let mut broken = sample(); broken.as_object_mut().unwrap().remove("selected"); broken["extra"] = json!(null); assert!(!valid_scenarios(&broken.to_string()));
        assert!(!valid_scenarios(&" ".repeat(4097))); assert!(!valid_scenarios("null"));
    }
}
#[cfg(test)]
mod experience_preference_tests {
    use super::{persist_preferences, preference_input, restore_preferences, valid_module_order, valid_peer_favorites, KEYS};
    use serde_json::{json, Value};
    use std::collections::BTreeMap;

    const ORDER: &str = "notchy-module-order-v1";
    const FAVORITES: &str = "notchy-peer-favorites-v1";

    fn order() -> Value {
        json!(["shelf", "weather", "music", "tasks", "focus"])
    }
    fn favorite(index: usize) -> Value {
        json!({"identity":format!("{index:064x}"), "alias":"Téléphone de test 📱", "deviceType":"mobile"})
    }

    #[test]
    fn module_order_accepts_only_one_of_each_known_module() {
        assert!(valid_module_order(&order().to_string()));
        assert!(valid_module_order(r#"["music","focus","weather","tasks","shelf"]"#));
        for invalid in [json!([]), json!(["shelf", "music"]), json!(["shelf", "weather", "music", "tasks", "shelf"]),
            json!(["shelf", "weather", "music", "tasks", "health"]), json!(["shelf", "weather", "music", "tasks", 1]),
            json!(["shelf", "weather", "music", "tasks", "focus", "health"]), json!({"order":order()}), Value::Null] {
            assert!(!valid_module_order(&invalid.to_string()), "{invalid}");
        }
        assert!(!valid_module_order(&format!("{}{}", " ".repeat(512), order())));
    }

    #[test]
    fn favorites_are_typed_bounded_unique_and_control_free() {
        assert!(valid_peer_favorites("[]"));
        let mut maximum = (0..32).map(favorite).collect::<Vec<_>>();
        maximum[0]["alias"] = json!("📱".repeat(120));
        maximum[1]["deviceType"] = json!("desktop");
        assert!(valid_peer_favorites(&json!(maximum).to_string()), "Unicode aliases are counted as characters, not UTF-8 bytes");
        let mut too_many = maximum.clone(); too_many.push(favorite(32));
        assert!(!valid_peer_favorites(&json!(too_many).to_string()));
        let mut duplicate = maximum.clone(); duplicate[1]["identity"] = duplicate[0]["identity"].clone();
        assert!(!valid_peer_favorites(&json!(duplicate).to_string()));
        for (field, invalid) in [("identity", json!("A".repeat(64))), ("identity", json!("g".repeat(64))),
            ("identity", json!("a".repeat(63))), ("identity", json!(7)), ("alias", json!("📱".repeat(121))),
            ("alias", json!("")), ("alias", json!("Phone\nInjected")), ("alias", json!("Phone\u{0085}Injected")),
            ("alias", json!(null)), ("deviceType", json!("web")), ("deviceType", json!(true))] {
            let mut broken = favorite(0); broken[field] = invalid;
            assert!(!valid_peer_favorites(&json!([broken]).to_string()), "invalid {field}");
        }
        let mut extra = favorite(0); extra["address"] = json!("192.168.1.42");
        assert!(!valid_peer_favorites(&json!([extra]).to_string()));
        let mut missing = favorite(0); missing.as_object_mut().unwrap().remove("deviceType");
        assert!(!valid_peer_favorites(&json!([missing]).to_string()));
        for text in ["null", "{}", "[null]", "[[]]", "[", &" ".repeat(20_001)] {
            assert!(!valid_peer_favorites(text));
        }
    }

    #[test]
    fn preference_commands_whitelist_and_validate_both_new_values_and_deletion() {
        assert_eq!(KEYS.len(), 8);
        for (key, value) in [(ORDER, order().to_string()), (FAVORITES, json!([favorite(0)]).to_string())] {
            let command = json!({"key":key,"value":value});
            assert_eq!(preference_input(&command).unwrap(), (key, Some(value.as_str())));
            let remove = json!({"key":key,"value":null});
            assert_eq!(preference_input(&remove).unwrap(), (key, None));
            for invalid in [json!({"key":key,"value":"{}"}), json!({"key":key,"value":[]}),
                json!({"key":key}), json!({"key":key,"value":value,"extra":true})] {
                assert_eq!(preference_input(&invalid).unwrap_err().status, 400);
            }
        }
        assert_eq!(preference_input(&json!({"key":"arbitrary-preference","value":"[]"})).unwrap_err().status, 400);
        for (key, value) in [("notchy-minimal-appearance-v1", "{}"), ("notchy-minimal-modules-v1", "{}"),
            ("notchy-minimal-focus-v1", "{}"), ("notchy-minimal-welcome-v1", "done"), ("notchy-language-v1", "en")] {
            let command = json!({"key":key,"value":value});
            assert_eq!(preference_input(&command).unwrap(), (key, Some(value)));
        }
    }

    #[test]
    fn restoration_drops_invalid_new_preferences_without_changing_existing_values() {
        let existing = BTreeMap::from([
            ("notchy-minimal-appearance-v1".into(), "{\"theme\":\"dark\"}".into()),
            ("notchy-minimal-modules-v1".into(), "{\"shelf\":true}".into()),
            ("notchy-minimal-focus-v1".into(), "{\"deadline\":12345}".into()),
            ("notchy-minimal-welcome-v1".into(), "done".into()),
            ("notchy-language-v1".into(), "en".into()),
        ]);
        let mut saved = existing.clone();
        saved.insert(ORDER.into(), order().to_string());
        saved.insert(FAVORITES.into(), json!([favorite(0)]).to_string());
        saved.insert("arbitrary-preference".into(), "[]".into());
        let restored = restore_preferences(saved);
        assert_eq!(restored.len(), existing.len() + 2);
        for (key, value) in &existing { assert_eq!(restored.get(key), Some(value)); }
        let mut invalid = restored;
        invalid.insert(ORDER.into(), "[\"music\",\"music\"]".into());
        invalid.insert(FAVORITES.into(), json!([favorite(0), favorite(0)]).to_string());
        assert_eq!(restore_preferences(invalid), existing);
    }

    #[tokio::test]
    async fn native_json_roundtrip_restores_new_keys_without_an_origin_or_session_binding() {
        let temporary = tempfile::tempdir().unwrap();
        tokio::fs::create_dir(temporary.path().join(".desktop-profile")).await.unwrap();
        let saved = BTreeMap::from([(ORDER.into(), order().to_string()),
            (FAVORITES.into(), json!([favorite(0)]).to_string()), ("notchy-language-v1".into(), "en".into())]);
        for (key, value) in &saved {
            assert!(preference_input(&json!({"key":key,"value":value})).is_ok());
        }
        persist_preferences(temporary.path(), &saved).await.unwrap();
        let path = temporary.path().join(".desktop-profile/tauri-preferences.json");
        let bytes = tokio::fs::read(&path).await.unwrap();
        let from_disk: BTreeMap<String, String> = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(from_disk, saved);
        assert_eq!(restore_preferences(from_disk), saved);
        assert!(!temporary.path().join(".desktop-profile/tauri-preferences.tmp").exists());
        let remaining = BTreeMap::from([("notchy-language-v1".into(), "fr".into())]);
        persist_preferences(temporary.path(), &remaining).await.unwrap();
        let from_disk = serde_json::from_slice(&tokio::fs::read(path).await.unwrap()).unwrap();
        assert_eq!(restore_preferences(from_disk), remaining, "atomic replacement supports later removals");
    }
}
struct DesktopState {
    services: Arc<Services>,
    server: Arc<Server>,
    data: PathBuf,
    origin: String,
    startup: Arc<Startup>,
    geometry: Mutex<Geometry>,
    preferences: tokio::sync::Mutex<BTreeMap<String, String>>,
    discovery_scan: tokio::sync::Mutex<()>,
    tray_items: Mutex<Option<[tauri::menu::MenuItem<tauri::Wry>; 3]>>,
    visible: AtomicBool,
    dialog: AtomicBool,
    downloads: AtomicU64,
    blur: AtomicU64,
    quitting: AtomicBool,
    checking: bool,
    reports: tokio::sync::Mutex<Vec<Value>>,
}
fn initial_geometry() -> Geometry {
    Geometry {
        width: 128.,
        height: 10.,
        band: 10.,
        radius: 6.,
        shoulder: 0.,
        state: NotchState::Rest,
    }
}
fn trusted(window: &WebviewWindow, state: &DesktopState) -> bool {
    window.label() == "main"
        && window.url().ok().is_some_and(|url| {
            url.origin().ascii_serialization() == state.origin
                && url.path() == "/"
                && url
                    .query_pairs()
                    .any(|(key, value)| key == "desktop" && value == "1")
        })
}
fn show(window: &WebviewWindow, state: &DesktopState, reason: &str) {
    state.visible.store(true, Ordering::Relaxed);
    state.blur.fetch_add(1, Ordering::Relaxed);
    resume(window, state, reason);
}
fn resume(window: &WebviewWindow, state: &DesktopState, reason: &str) {
    if !state.visible.load(Ordering::Relaxed) || state.quitting.load(Ordering::Relaxed) {
        return;
    }
    let geometry = *state.geometry.lock().unwrap();
    if let Ok(mut dimensions) = desktop::layout(window, geometry) {
        dimensions["reason"] = json!(reason);
        let _ = window.show();
        let _ = window.set_always_on_top(true);
        let _ = window.emit("notchy:resume", dimensions);
    }
}
fn hide(window: &WebviewWindow, state: &DesktopState) {
    state.visible.store(false, Ordering::Relaxed);
    state.blur.fetch_add(1, Ordering::Relaxed);
    let _ = window.hide();
}
async fn preference(state: &DesktopState, value: Value) -> Result<Value, ApiError> {
    let (key, value) = preference_input(&value)?;
    let mut preferences = state.preferences.lock().await;
    let mut next = preferences.clone();
    if let Some(text) = value {
        next.insert(key.into(), text.into());
    } else {
        next.remove(key);
    }
    persist_preferences(&state.data, &next).await?;
    *preferences = next;
    if key == "notchy-language-v1" {
        let labels = tray_labels(value.unwrap_or("fr"));
        if let Some(items) = state.tray_items.lock().unwrap().as_ref() {
            for (item, label) in items.iter().zip(labels) {
                item.set_text(label).map_err(|_| ApiError::new(503, "Menu de Notchy indisponible."))?;
            }
        }
    }
    Ok(json!({"ok":true}))
}

fn native_guard(window:&WebviewWindow,state:&DesktopState)->Result<(),String> {
    trusted(window,state).then_some(()).ok_or_else(||"Origine refusée.".into())
}
fn diagnostic_port(value:Option<u16>)->Result<u16,String> {
    match value.unwrap_or(notchy::discovery::PORT) {port if port==notchy::discovery::PORT=>Ok(port),_=>Err("Le diagnostic utilise le port LocalSend configuré.".into())}
}
fn local_scan_ip()->Result<std::net::Ipv4Addr,String> {
    notchy::health::local_ipv4().ok_or_else(||"Aucune interface IPv4 privée disponible.".into())
}
async fn replace_preferences(state:&DesktopState,next:BTreeMap<String,String>)->Result<Value,String> {
    // The caller owns the existing preference mutex across read/merge/write.
    persist_preferences(&state.data,&next).await.map_err(|error|error.message)?;
    Ok(notchy::settings::snapshot(&next))
}
fn refresh_preferences_tray(state:&DesktopState,preferences:&BTreeMap<String,String>)->Result<(),String> {
    if let Some(items)=state.tray_items.lock().unwrap().as_ref() {
        for (item,label) in items.iter().zip(tray_labels(preferences.get("notchy-language-v1").map(String::as_str).unwrap_or("fr"))) {
            item.set_text(label).map_err(|_|"Menu de Notchy indisponible.".to_string())?;
        }
    }
    Ok(())
}
#[tauri::command]
async fn health_run(window:WebviewWindow,state:State<'_,Arc<DesktopState>>,localsend_port:Option<u16>)->Result<Value,String> {
    native_guard(&window,&state)?; let port=diagnostic_port(localsend_port)?;
    let spotify=state.services.spotify.command(json!("status")).await.map_err(|error|error.message)?;
    let status=spotify["status"].as_str().unwrap_or("unknown").to_owned();
    let report=tokio::task::spawn_blocking(move ||notchy::health::run(port,&status)).await.map_err(|_|"Diagnostic indisponible.".to_string())?;
    serde_json::to_value(report).map_err(|_|"Diagnostic indisponible.".into())
}
#[tauri::command]
async fn settings_get(window:WebviewWindow,state:State<'_,Arc<DesktopState>>)->Result<Value,String> {
    native_guard(&window,&state)?; Ok(notchy::settings::snapshot(&*state.preferences.lock().await))
}
#[tauri::command]
async fn settings_set(window:WebviewWindow,state:State<'_,Arc<DesktopState>>,patch:Value)->Result<Value,String> {
    native_guard(&window,&state)?; let mut preferences=state.preferences.lock().await;
    let next=notchy::settings::merge(&preferences,&patch).map_err(|error|error.message)?;
    let result=replace_preferences(&state,next.clone()).await?; *preferences=next; refresh_preferences_tray(&state,&preferences)?; Ok(result)
}
#[tauri::command]
async fn favorites_list(window:WebviewWindow,state:State<'_,Arc<DesktopState>>)->Result<Value,String> {
    native_guard(&window,&state)?; Ok(json!(notchy::settings::favorites_list(&*state.preferences.lock().await)))
}
#[tauri::command]
async fn favorites_add(window:WebviewWindow,state:State<'_,Arc<DesktopState>>,favorite:Value)->Result<Value,String> {
    native_guard(&window,&state)?; let mut preferences=state.preferences.lock().await;
    let next=notchy::settings::favorites_add(&preferences,&favorite).map_err(|error|error.message)?;
    replace_preferences(&state,next.clone()).await?; *preferences=next;
    Ok(json!(notchy::settings::favorites_list(&preferences)))
}
#[tauri::command]
async fn discovery_validate(window:WebviewWindow,state:State<'_,Arc<DesktopState>>,address:String)->Result<Value,String> {
    native_guard(&window,&state)?;let endpoint=notchy::discovery::parse_manual(&address).map_err(|error|error.message)?;
    Ok(json!({"address":endpoint.to_string(),"ip":endpoint.ip().to_string(),"port":endpoint.port()}))
}
#[tauri::command]
async fn discovery_first_candidates(window:WebviewWindow,state:State<'_,Arc<DesktopState>>)->Result<Value,String> {
    native_guard(&window,&state)?;let local=local_scan_ip()?;
    let candidates=notchy::discovery::first_candidates(local,notchy::discovery::PORT).map_err(|error|error.message)?;
    Ok(json!({"localIpv4":local,"port":notchy::discovery::PORT,"candidates":candidates.iter().map(ToString::to_string).collect::<Vec<_>>(),"verified":false}))
}
#[tauri::command]
async fn discovery_scan(window:WebviewWindow,state:State<'_,Arc<DesktopState>>)->Result<Value,String> {
    use futures_util::{stream,StreamExt};
    native_guard(&window,&state)?;let local=local_scan_ip()?;
    let _scan=state.discovery_scan.try_lock().map_err(|_|"Une recherche locale est déjà en cours.".to_string())?;
    let candidates=notchy::discovery::scan_subnet(local,notchy::discovery::PORT).await.map_err(|error|error.message)?;
    let count=candidates.len();let nearby=state.services.nearby.clone();let files=state.services.files.clone();
    let verified=stream::iter(candidates.into_iter().take(32)).map(|endpoint| {
        let nearby=nearby.clone();let files=files.clone();async move {
            tokio::time::timeout(Duration::from_secs(3),nearby.command(json!({"command":"connect","address":endpoint.to_string()}),&files)).await.is_ok_and(|result|result.is_ok())
        }
    }).buffer_unordered(8).filter(|accepted|std::future::ready(*accepted)).count().await;
    let mut snapshot=state.services.nearby.snapshot().await;
    snapshot["scan"]=json!({"localIpv4":local,"port":notchy::discovery::PORT,"tcpCandidates":count,"handshakesAccepted":verified,"bounded":true});
    Ok(snapshot)
}
async fn open_shelf(state: &DesktopState, id: Value, reveal: bool) -> Result<Value, ApiError> {
    let id = id
        .as_str()
        .filter(|id| notchy::shelf::valid_id(id))
        .ok_or_else(|| ApiError::new(400, "Fichier invalide."))?;
    let file = state.services.shelf.open(id, false).await?;
    let name = file.item["name"]
        .as_str()
        .ok_or_else(|| ApiError::new(400, "Fichier invalide."))?;
    let extension = std::path::Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let readable="pdf epub txt md csv json yaml yml log rtf docx xlsx pptx odt ods odp png jpg jpeg webp gif bmp tif tiff ico avif heic mp3 m4a wav flac ogg aac mp4 webm mkv avi mov zip";
    if !reveal
        && !readable
            .split_whitespace()
            .any(|format| format == extension)
    {
        return Err(ApiError::new(
            415,
            "Télécharge ce format pour l’ouvrir toi-même dans Windows.",
        ));
    }
    drop(file);
    let path = state
        .services
        .shelf
        .copy_for_open(id, &state.data.join(".desktop-profile/opened-shelf"))
        .await?;
    tokio::task::spawn_blocking(move || {
        let mut command = std::process::Command::new("explorer.exe");
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        if reveal {
            command.arg(format!("/select,{}", path.display()));
        } else {
            command.arg(path);
        }
        command
            .spawn()
            .map_err(|_| ApiError::new(503, "Windows n’a pas pu ouvrir ce fichier."))?;
        Ok::<_, ApiError>(json!({"ok":true,"copy":true}))
    })
    .await
    .map_err(|_| ApiError::new(503, "Ouverture indisponible."))?
}

fn export_ids(value: Value) -> Result<Vec<String>, ApiError> {
    let ids: Vec<String> = serde_json::from_value(value).map_err(|_| ApiError::new(400, "Sélection invalide."))?;
    if ids.is_empty() || ids.len() > notchy::shelf::MAX_FILES || ids.iter().enumerate().any(|(index, id)|
        !notchy::shelf::valid_id(id) || ids[..index].contains(id)) {
        return Err(ApiError::new(400, "Sélection invalide."));
    }
    Ok(ids)
}
fn checked_export_directory(data: &std::path::Path) -> PathBuf {
    data.join(".desktop-profile").join("downloads")
}
async fn export_shelf(window: &WebviewWindow, state: &DesktopState, value: Value) -> Result<Value, ApiError> {
    let ids = export_ids(value)?;
    // The UI supplies opaque IDs only; it never chooses an arbitrary output path.
    let directory = if state.checking {checked_export_directory(&state.data)}
        else {window.app_handle().path().download_dir().map_err(|_| ApiError::new(503, "Le dossier Téléchargements est indisponible."))?};
    struct ActiveDownload<'a>(&'a AtomicU64);
    impl Drop for ActiveDownload<'_> {fn drop(&mut self) {self.0.fetch_sub(1, Ordering::Relaxed);}}
    state.downloads.fetch_add(1, Ordering::Relaxed);
    let _active = ActiveDownload(&state.downloads);
    let mut saved = Vec::new();
    for id in ids {
        match state.services.shelf.export_copy(&id, &directory).await {
            Ok(path) => saved.push(json!({"id":id,"name":path.file_name().unwrap_or_default().to_string_lossy()})),
            Err(cause) => return Ok(json!({"ok":false,"saved":saved,"error":cause.message})),
        }
    }
    Ok(json!({"ok":true,"saved":saved}))
}
#[cfg(test)]
mod export_selection_tests {
    use super::{checked_export_directory, export_ids};
    use serde_json::json;
    #[test]
    fn exports_accept_only_nonempty_unique_opaque_ids() {
        assert_eq!(export_ids(json!(["a".repeat(32), "b".repeat(32)])).unwrap().len(), 2);
        for invalid in [json!([]),json!(["../secret"]),json!(["a".repeat(32),"a".repeat(32)]),json!({"path":"C:/"}),json!([1]),json!((0..21).map(|id|format!("{id:032x}")).collect::<Vec<_>>())] {
            assert!(export_ids(invalid).is_err());
        }
    }
    #[tokio::test]
    async fn native_check_exports_exact_bytes_to_its_isolated_directory_twice() {
        let fixture = tempfile::tempdir().unwrap();
        let shelf = notchy::shelf::Shelf::new(fixture.path().join(".shelf")).await.unwrap();
        let bytes = b"Notchy isolated export fixture";
        let added = shelf.add_stream("isolated-notes.txt", futures_util::stream::iter([
            Ok::<_, std::io::Error>(bytes::Bytes::from_static(bytes))
        ]), Some(bytes.len() as u64)).await.unwrap();
        let id = added["item"]["id"].as_str().unwrap();
        let directory = checked_export_directory(fixture.path());
        for name in ["isolated-notes.txt", "isolated-notes (1).txt"] {
            let saved = shelf.export_copy(id, &directory).await.unwrap();
            assert_eq!(saved.file_name().unwrap(), name);
            assert_eq!(tokio::fs::read(saved).await.unwrap(), bytes);
        }
        assert!(shelf.open(id, false).await.is_ok(), "Export preserves the Shelf original");
    }
}

#[tauri::command]
async fn desktop_command(
    window: WebviewWindow,
    state: State<'_, Arc<DesktopState>>,
    value: Value,
) -> Result<Value, String> {
    let result = async {
        if !trusted(&window, &state) {
            return Err(ApiError::new(403, "Origine refusée."));
        }
        let object = value
            .as_object()
            .filter(|object| object.keys().all(|key| key == "command" || key == "value"))
            .ok_or_else(|| ApiError::new(400, "Commande invalide."))?;
        let command = object
            .get("command")
            .and_then(Value::as_str)
            .ok_or_else(|| ApiError::new(400, "Commande invalide."))?;
        let argument = object.get("value").cloned().unwrap_or(Value::Null);
        match command {
            "geometry" => {
                let geometry: Geometry = serde_json::from_value(argument)
                    .map_err(|_| ApiError::new(400, "Dimensions invalides."))?;
                let result = desktop::layout(&window, geometry)?;
                *state.geometry.lock().unwrap() = geometry;
                Ok(result)
            }
            "interactive" => {
                if !argument.is_boolean() {
                    return Err(ApiError::new(400, "Commande invalide."));
                }
                Ok(json!({"ok":true}))
            }
            "focus" => {
                if state.visible.load(Ordering::Relaxed) {
                    let _ = window.set_focus();
                }
                Ok(json!({"ok":true}))
            }
            "hide" => {
                hide(&window, &state);
                Ok(json!({"ok":true}))
            }
            "quit" => {
                window.app_handle().exit(0);
                Ok(json!({"ok":true}))
            }
            "reload" => {
                if state.dialog.load(Ordering::Relaxed)
                    || state.downloads.load(Ordering::Relaxed) > 0
                {
                    return Err(ApiError::new(
                        409,
                        "Ferme le dialogue de fichiers avant de recharger.",
                    ));
                }
                window
                    .eval("location.reload()")
                    .map_err(|_| ApiError::new(503, "Rechargement indisponible."))?;
                Ok(json!({"ok":true}))
            }
            "dialog" => {
                state.dialog.store(
                    argument
                        .as_bool()
                        .ok_or_else(|| ApiError::new(400, "Commande invalide."))?,
                    Ordering::Relaxed,
                );
                Ok(json!({"ok":true}))
            }
            "music-queue" => state.services.spotify.command(argument).await,
            "copy-text" => {
                let text = argument
                    .as_str()
                    .filter(|text| text.encode_utf16().count() <= 262144)
                    .ok_or_else(|| ApiError::new(400, "Texte invalide."))?
                    .to_owned();
                tokio::task::spawn_blocking(move || notchy::clipboard::write_text(&text))
                    .await
                    .map_err(|_| ApiError::new(503, "Presse-papiers indisponible."))??;
                Ok(json!({"ok":true}))
            }
            "shelf-open" => open_shelf(&state, argument, false).await,
            "shelf-reveal" => open_shelf(&state, argument, true).await,
            "shelf-export" => export_shelf(&window, &state, argument).await,
            "preference" => preference(&state, argument).await,
            "startup" => {
                let enabled = argument.as_bool().ok_or_else(|| ApiError::new(400, "Préférence de démarrage invalide."))?;
                let startup = state.startup.clone();
                let status = tokio::task::spawn_blocking(move || startup.set(enabled)).await
                    .map_err(|_| ApiError::new(503, "Démarrage avec Windows indisponible."))?;
                Ok(serde_json::to_value(status).unwrap())
            }
            "diagnostic" if state.checking => {
                if serde_json::to_vec(&argument).map_or(true, |bytes| bytes.len() > 16384) {
                    return Err(ApiError::new(400, "Diagnostic invalide."));
                }
                let mut reports = state.reports.lock().await;
                let mut report = argument;
                report["visible"] = json!(window.is_visible().unwrap_or(false));
                report["topmost"] = json!(window.is_always_on_top().unwrap_or(false));
                if let Ok(size) = window.inner_size() {
                    report["windowSize"] = json!({"width":size.width,"height":size.height});
                }
                let finished = report["phase"] == "rest" || report["phase"] == "error";
                reports.push(report);
                let pass = reports.iter().any(|r| {
                    r["phase"] == "open"
                        && r["ready"] == true
                        && r["state"] == "open"
                        && r["morphing"] == false
                        && r["desktop"] == true
                        && r["node"] == "undefined"
                        && r["surfaceFill"] == "rgb(0, 0, 0)"
                        && r["captureAvailable"] == false
                        && r["body"] == "rgba(0, 0, 0, 0)"
                        && r["errors"].as_array().is_some_and(Vec::is_empty)
                }) && reports.iter().any(|r| {
                    r["phase"] == "rest"
                        && r["state"] == "rest"
                        && r["geometry"]["height"] == 10
                        && r["geometry"]["width"] == 128
                        && r["geometry"]["radius"] == 6
                        && r["geometry"]["shoulder"] == 0
                        && r["morphing"] == false
                        && r["visible"] == true
                        && r["topmost"] == true
                        && r["errors"].as_array().is_some_and(Vec::is_empty)
                });
                tokio::fs::write(
                    state.data.join("tauri-check.json"),
                    serde_json::to_vec_pretty(&json!({"pass":pass,"reports":&*reports})).unwrap(),
                )
                .await?;
                if finished {
                    window.app_handle().exit(0);
                }
                Ok(json!({"ok":true}))
            }
            _ => Err(ApiError::new(400, "Commande inconnue.")),
        }
    }
    .await;
    result.map_err(|error: ApiError| error.message)
}
fn arguments() -> (Option<PathBuf>, bool) {
    let mut values = std::env::args().skip(1);
    let mut directory = None;
    let mut checking = false;
    while let Some(argument) = values.next() {
        match argument.as_str() {
            "--data-root" => directory = values.next().map(PathBuf::from),
            "--desktop-check" => checking = true,
            _ => {}
        }
    }
    (directory, checking)
}

pub fn run() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let (data_override, checking) = arguments();
    let builder=tauri::Builder::default();
    // Window checks use isolated data and must never activate a running user instance.
    let builder=if checking{builder}else{builder.plugin(tauri_plugin_single_instance::init(|app,arguments,_|{if arguments.iter().any(|argument|argument=="--autostart"){return;}if let (Some(window),Some(state))=(app.get_webview_window("main"),app.try_state::<Arc<DesktopState>>()){show(&window,&state,"open");}}))};
    let application=builder
      .invoke_handler(tauri::generate_handler![desktop_command,health_run,settings_get,settings_set,favorites_list,favorites_add,discovery_validate,discovery_scan,discovery_first_candidates])
      .setup(move|app|{
        let data=data_override.clone().unwrap_or_else(||if checking{std::env::temp_dir().join(format!("notchy-tauri-check-{}",std::process::id()))}else if cfg!(debug_assertions){PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_owned()}else{app.path().app_data_dir().unwrap()});
        std::fs::create_dir_all(data.join(".desktop-profile"))?;
        let packaged=app.path().resource_dir()?.join("native");
        let native=packaged;
        let preferences_file=data.join(".desktop-profile/tauri-preferences.json");
        let preferences:BTreeMap<String,String>=match std::fs::read(&preferences_file){Ok(bytes)=>{if bytes.len()>1024*1024{return Err("Préférences trop volumineuses.".into());}serde_json::from_slice(&bytes)?},Err(error)if error.kind()==std::io::ErrorKind::NotFound=>BTreeMap::new(),Err(error)=>return Err(error.into())};
        let preferences=restore_preferences(preferences);
        let startup=Arc::new(Startup::new(&data,&std::env::current_exe()?,data_override.as_deref(),std::env::args().any(|argument|argument=="--localsend"),cfg!(windows)&&!cfg!(debug_assertions)&&!checking));
        let startup_status=startup.initialize(data_override.is_none());
        let labels=tray_labels(preferences.get("notchy-language-v1").map(String::as_str).unwrap_or("fr"));
        let services=Arc::new(tauri::async_runtime::block_on(Services::new(data.clone(),native.clone()))?);
        if !checking&&std::env::args().any(|argument|argument=="--localsend"){
            let _=tauri::async_runtime::block_on(services.nearby.command(json!({"command":"discover"}),&services.files));
        }
        let server=Arc::new(tauri::async_runtime::block_on(Server::start(services.clone(),if checking{0}else{58252}))?);
        let origin=format!("http://127.0.0.1:{}",server.port);
        let nearby_active=tauri::async_runtime::block_on(services.nearby.snapshot())["available"]==true;
        let config=json!({"token":server.token,"keys":KEYS,"preferences":preferences,"checking":checking,"localSendActive":nearby_active,"startup":startup_status});
        let bridge=include_str!("window_bridge.js").replace("__NOTCHY_CONFIG__",&serde_json::to_string(&config)?);
        let state=Arc::new(DesktopState{services,server,data:data.clone(),origin:origin.clone(),startup,geometry:Mutex::new(initial_geometry()),preferences:tokio::sync::Mutex::new(preferences),discovery_scan:tokio::sync::Mutex::new(()),tray_items:Mutex::new(None),visible:AtomicBool::new(true),dialog:AtomicBool::new(false),downloads:AtomicU64::new(0),blur:AtomicU64::new(0),quitting:AtomicBool::new(false),checking,reports:tokio::sync::Mutex::new(Vec::new())});
        app.manage(state.clone());
        let navigation_origin=origin.clone();let download_state=state.clone();
        let window=WebviewWindowBuilder::new(app,"main",WebviewUrl::External(format!("{origin}/?desktop=1").parse()?))
          .title("Notchy V2").inner_size(960.,312.).decorations(false).transparent(true).shadow(false)
          .resizable(false).always_on_top(true).skip_taskbar(true).visible(false).background_color(tauri::window::Color(0,0,0,0))
          .disable_drag_drop_handler()
          .additional_browser_args("--disable-features=CalculateNativeWinOcclusion --disable-renderer-backgrounding --disable-backgrounding-occluded-windows")
          .data_directory(data.join(".tauri-webview")).initialization_script(&bridge)
          .on_navigation(move|url|url.origin().ascii_serialization()==navigation_origin&&url.path()=="/"&&url.query_pairs().any(|(key,value)|key=="desktop"&&value=="1"))
          .on_new_window(|_,_|tauri::webview::NewWindowResponse::Deny)
          .on_permission_request(|_,_|tauri::webview::PermissionResponse::Deny)
          .on_download(move|_,event|{
              use tauri::webview::DownloadEvent;
              match event{DownloadEvent::Requested{url,..}=>{let valid=url.origin().ascii_serialization()==download_state.origin&&url.path().strip_prefix("/api/shelf/").is_some_and(notchy::shelf::valid_id);if valid{download_state.downloads.fetch_add(1,Ordering::Relaxed);}valid},DownloadEvent::Finished{..}=>{download_state.downloads.try_update(Ordering::Relaxed,Ordering::Relaxed,|value|Some(value.saturating_sub(1))).ok();true},_=>false}
          })
          .build()?;
        desktop::layout(&window,initial_geometry())?;
        let events=state.clone();let event_window=window.clone();
        window.on_window_event(move|event|match event{
          tauri::WindowEvent::CloseRequested{api,..}=>{if !events.quitting.load(Ordering::Relaxed){api.prevent_close();hide(&event_window,&events);}},
          tauri::WindowEvent::Focused(true)=>{events.blur.fetch_add(1,Ordering::Relaxed);},
          tauri::WindowEvent::Focused(false)=>{let generation=events.blur.fetch_add(1,Ordering::Relaxed)+1;let state=events.clone();let window=event_window.clone();tauri::async_runtime::spawn(async move{tokio::time::sleep(Duration::from_millis(180)).await;if state.blur.load(Ordering::Relaxed)==generation&&state.visible.load(Ordering::Relaxed)&&!state.dialog.load(Ordering::Relaxed)&&state.downloads.load(Ordering::Relaxed)==0&&!window.is_focused().unwrap_or(true){let _=window.emit("notchy:deactivate",json!({"reason":"blur"}));}});},
          tauri::WindowEvent::ScaleFactorChanged{..}=>resume(&event_window,&events,"resume"),
          _=>{},
        });
        use tauri::{menu::{Menu,MenuItem,PredefinedMenuItem},tray::{TrayIconBuilder,TrayIconEvent,MouseButton,MouseButtonState}};
        let open=MenuItem::with_id(app,"open",labels[0],true,None::<&str>)?;let hide_item=MenuItem::with_id(app,"hide",labels[1],true,None::<&str>)?;let quit=MenuItem::with_id(app,"quit",labels[2],true,None::<&str>)?;
        let menu=Menu::with_items(app,&[&open,&hide_item,&PredefinedMenuItem::separator(app)?,&quit])?;
        *state.tray_items.lock().unwrap()=Some([open,hide_item,quit]);
        let mut tray=TrayIconBuilder::with_id("notchy").tooltip("Notchy V2").menu(&menu).show_menu_on_left_click(false)
          .on_menu_event(|app,event|{if let (Some(window),Some(state))=(app.get_webview_window("main"),app.try_state::<Arc<DesktopState>>()){match event.id.as_ref(){"open"=>show(&window,&state,"open"),"hide"=>hide(&window,&state),"quit"=>app.exit(0),_=>{}}}})
          .on_tray_icon_event(|tray,event|{if matches!(event,TrayIconEvent::Click{button:MouseButton::Left,button_state:MouseButtonState::Up,..}){let app=tray.app_handle();if let (Some(window),Some(state))=(app.get_webview_window("main"),app.try_state::<Arc<DesktopState>>()){show(&window,&state,"open");}}});
        if let Some(icon)=app.default_window_icon(){tray=tray.icon(icon.clone());}tray.build(app)?;
        window.show()?;
        let pointer_state=state.clone();let pointer_window=window.clone();
        tauri::async_runtime::spawn(async move{
            let mut observer=desktop::PointerObserver::default();
            loop{
                tokio::time::sleep(Duration::from_millis(100)).await;
                if pointer_state.quitting.load(Ordering::Relaxed){break;}
                let geometry=*pointer_state.geometry.lock().unwrap();
                let sample=if pointer_state.visible.load(Ordering::Relaxed){desktop::cursor_sample(&pointer_window,geometry.state)}else{None};
                if let Some(event)=observer.update(sample,geometry.state){let _=pointer_window.emit("notchy:pointer",event);}
            }
        });
        let recovery_state=state.clone();let recovery_window=window.clone();
        tauri::async_runtime::spawn(async move{
            let mut previous_screen=None;
            let mut sampled=std::time::SystemTime::now();
            loop{
                tokio::time::sleep(Duration::from_secs(2)).await;
                if recovery_state.quitting.load(Ordering::Relaxed){break;}
                let now=std::time::SystemTime::now();let resumed=now.duration_since(sampled).map_or(true,|elapsed|elapsed>Duration::from_secs(5));sampled=now;
                if !recovery_state.visible.load(Ordering::Relaxed){continue;}
                let screen=recovery_window.current_monitor().ok().flatten().or_else(||recovery_window.primary_monitor().ok().flatten()).map(|monitor|{
                    let position=monitor.position();let size=monitor.size();(position.x,position.y,size.width,size.height,monitor.scale_factor().to_bits())
                });
                let changed=previous_screen.is_some()&&screen!=previous_screen;previous_screen=screen;
                if resumed||changed||!recovery_window.is_visible().unwrap_or(true){resume(&recovery_window,&recovery_state,"resume");}
                else if !recovery_window.is_always_on_top().unwrap_or(true){let _=recovery_window.set_always_on_top(true);}
            }
        });
        if checking {let watchdog=app.handle().clone();let directory=data.clone();tauri::async_runtime::spawn(async move{tokio::time::sleep(Duration::from_secs(25)).await;if !directory.join("tauri-check.json").is_file(){let _=tokio::fs::write(directory.join("tauri-check.json"),b"{\"pass\":false,\"error\":\"Le renderer ne repond pas.\"}").await;watchdog.exit(1);}});}
        Ok(())
      }).build(tauri::generate_context!());
    match application {
        Ok(app) => app.run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if let Some(state) = app.try_state::<Arc<DesktopState>>() {
                    if !state.quitting.swap(true, Ordering::Relaxed) {
                        api.prevent_exit();
                        let state = state.inner().clone();
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            state.server.dispose().await;
                            state.services.dispose().await;
                            app.exit(0);
                        });
                    }
                }
            }
        }),
        Err(error) => {
            eprintln!("Notchy : {error}");
            #[cfg(windows)]
            unsafe {
                use windows_sys::Win32::UI::WindowsAndMessaging::{
                    MessageBoxW, MB_ICONERROR, MB_OK,
                };
                let message = format!("Notchy ne peut pas démarrer : {error}\0")
                    .encode_utf16()
                    .collect::<Vec<_>>();
                let title = "Notchy V2\0".encode_utf16().collect::<Vec<_>>();
                MessageBoxW(
                    std::ptr::null_mut(),
                    message.as_ptr(),
                    title.as_ptr(),
                    MB_OK | MB_ICONERROR,
                );
            }
        }
    }
}
