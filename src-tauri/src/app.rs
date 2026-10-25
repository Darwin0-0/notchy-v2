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
        json!(["shelf", "weather", "music", "focus"])
    }
    fn favorite(index: usize) -> Value {
        json!({"identity":format!("{index:064x}"), "alias":"Téléphone de test 📱", "deviceType":"mobile"})
    }

    #[test]
    fn module_order_accepts_only_one_of_each_known_module() {
        assert!(valid_module_order(&order().to_string()));
        assert!(valid_module_order(r#"["music","focus","weather","shelf"]"#));
        assert!(valid_module_order(r#"["music","focus","weather","tasks","shelf"]"#));
        for invalid in [json!([]), json!(["shelf", "music"]), json!(["shelf", "weather", "music", "tasks", "shelf"]),
            json!(["music", "tasks", "weather", "shelf"]), json!(["music", "focus", "weather", "focus"]),
            json!(["music", "focus", "weather", "health"]), json!(["music", "focus", "weather", 1]),
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
        assert_eq!(KEYS.len(), 10);
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
    tray_items: Mutex<Option<[tauri::menu::MenuItem<tauri::Wry>; 3]>>,
    visible: AtomicBool,
    dialog: AtomicBool,
    downloads: AtomicU64,
    blur: AtomicU64,
    quitting: Arc<AtomicBool>,
    checking: bool,
    reports: tokio::sync::Mutex<Vec<Value>>,
    search: Option<Arc<notchy::search::SearchService>>,
    search_error: Option<String>,
    search_shortcut: Mutex<Option<Arc<Mutex<notchy::search_hotkey::ShortcutStatus>>>>,
    quicklook_active: AtomicBool,
    quicklook_start_requested: AtomicBool,
    quicklook_autostart: bool,
    rendered_ready: AtomicBool,
    quicklook_module: Arc<notchy::quicklook_module::Module>,
    quicklook_command: tokio::sync::Mutex<Option<PreviewSource>>,
    preview_request: AtomicU64,
    office_preview: tokio::sync::Mutex<Option<Arc<notchy::office_preview::Broker>>>,
    office_preview_error: Mutex<Option<String>>,
    office_preview_starting: AtomicBool,
    native: PathBuf,
    quicklook_shelf_copies: Mutex<BTreeMap<String, notchy::shelf::ShelfPreview>>,
    quicklook_shelf_cleanup: Mutex<Vec<notchy::shelf::ShelfPreview>>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PreviewSource { Search, Shelf }
fn preview_source_code(source: PreviewSource) -> u64 { match source { PreviewSource::Search => 1, PreviewSource::Shelf => 2 } }
fn begin_preview_request(state: &AtomicU64, source: PreviewSource) -> u64 {
    let code = preview_source_code(source);
    let previous = state.try_update(Ordering::AcqRel, Ordering::Acquire, |value| Some((value.wrapping_add(4) & !3) | code)).unwrap();
    (previous.wrapping_add(4) & !3) | code
}
fn cancel_preview_request(state: &AtomicU64, source: PreviewSource) -> bool {
    state.try_update(Ordering::AcqRel, Ordering::Acquire, |value| (value & 3 == preview_source_code(source)).then_some(value.wrapping_add(4) & !3)).is_ok()
}

const OFFICE_RESTART_REQUIRED: &str = "Quitte QuickLook puis relance Notchy pour activer les aperçus Office protégés.";
fn reload_managed_office_proxy(changed: bool, running: bool, allowed: bool) -> bool { changed && running && allowed }
fn office_preview_gate(path: &std::path::Path, failure: Option<&str>) -> Result<(), String> {
    match failure.filter(|_| notchy::office_preview::supports(path)) { Some(error) => Err(error.into()), None => Ok(()) }
}
fn office_worker_window(status: &Value) -> Option<(u32, usize)> {
    let preview = status.get("preview")?;
    if preview.get("phase")?.as_str()? != "ready" { return None; }
    let pid = u32::try_from(preview.get("pid")?.as_u64()?).ok().filter(|pid| *pid != 0)?;
    let hwnd = preview.get("hwnd")?.as_str()?.parse::<usize>().ok().filter(|hwnd| *hwnd != 0)?;
    Some((pid, hwnd))
}
fn office_worker_is_foreground(status: &Value) -> bool {
    let Some((expected, hwnd)) = office_worker_window(status) else { return false; };
    #[cfg(windows)] unsafe {
        use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId, IsWindow};
        let mut owner = 0; let mut foreground = 0;
        IsWindow(hwnd as _) != 0 && GetWindowThreadProcessId(hwnd as _, &mut owner) != 0 && owner == expected
            && GetWindowThreadProcessId(GetForegroundWindow(), &mut foreground) != 0 && foreground == expected
    }
    #[cfg(not(windows))] { let _ = (expected, hwnd); false }
}

fn request_office_preview_start(state: &Arc<DesktopState>, native: PathBuf) {
    if state.checking { return; }
    let Some(quicklook) = notchy::quicklook::installation() else { request_quicklook_start(state); return; };
    if state.office_preview_starting.swap(true, Ordering::AcqRel) { return; }
    let state = state.clone();
    tauri::async_runtime::spawn(async move {
        let data = state.data.clone(); let installation = quicklook.clone();
        let managed = state.quicklook_module.directory().to_path_buf(); let reload_allowed = state.quicklook_autostart;
        let files = tokio::task::spawn_blocking(move || {
            if notchy::office_preview_install::restart_pending(&data)? {
                if notchy::quicklook::listener_running() { return Err(OFFICE_RESTART_REQUIRED.into()); }
                notchy::office_preview_install::set_restart_pending(&data, false)?;
            }
            let (worker, office, proxy, changed) = notchy::office_preview_install::prepare(&data, &native, &installation)?;
            let running = notchy::quicklook::listener_running();
            let stopped = if reload_managed_office_proxy(changed, running, reload_allowed) { notchy::quicklook::stop_managed(&managed)? } else { false };
            if changed && running && notchy::quicklook::listener_running() {
                notchy::office_preview_install::set_restart_pending(&data, true)?;
                return Err(OFFICE_RESTART_REQUIRED.into());
            }
            Ok::<_, String>((worker, office, proxy, stopped))
        }).await;
        let result = match files {
            Ok(Ok((worker, office, proxy, stopped))) => {
                if stopped { state.quicklook_start_requested.store(false, Ordering::Release); }
                notchy::office_preview::Broker::start(&state.data, worker, quicklook, office, proxy).await
            }
            Ok(Err(error)) => Err(error),
            Err(_) => Err("La passerelle Office ne peut pas démarrer.".into()),
        };
        match result {
            Ok(broker) => { if state.quitting.load(Ordering::Acquire) { broker.stop().await; } else { *state.office_preview_error.lock().unwrap() = None; *state.office_preview.lock().await = Some(broker); } }
            Err(error) => { state.office_preview_starting.store(error == OFFICE_RESTART_REQUIRED, Ordering::Release); *state.office_preview_error.lock().unwrap() = Some(error); }
        }
        // QuickLook scans plug-ins at launch; publish the broker before starting its listener.
        request_quicklook_start(&state);
    });
}
fn request_quicklook_start(state: &Arc<DesktopState>) {
    if !state.quicklook_autostart || state.quitting.load(Ordering::Relaxed)
        || state.quicklook_start_requested.swap(true, Ordering::Relaxed) { return; }
    let state = state.clone();
    tauri::async_runtime::spawn(async move {
        let _command = state.quicklook_command.lock().await;
        if state.quitting.load(Ordering::Relaxed) { return; }
        if !matches!(tokio::task::spawn_blocking(notchy::quicklook::ensure_running).await, Ok(Ok(()))) {
            state.quicklook_start_requested.store(false, Ordering::Relaxed);
        }
    });
}
fn preview_keeps_notch_below(owned_preview: bool, viewer_visible: Option<bool>) -> bool {
    owned_preview || viewer_visible == Some(true)
}
fn quicklook_shelf_directory(data: &std::path::Path) -> PathBuf {
    data.join(".desktop-profile").join("quicklook-shelf")
}
fn preview_close_matches(owner: Option<PreviewSource>, source: PreviewSource) -> bool {
    owner == Some(source)
}
#[cfg(test)]
mod preview_ownership_tests {
    use super::{preview_close_matches, PreviewSource::{Search, Shelf}};
    #[test]
    fn office_setup_errors_block_office_launches_without_blocking_other_preview_formats() {
        let error = super::OFFICE_RESTART_REQUIRED;
        for path in ["book.xlsx", "report.docx", "slides.PPTX", "legacy.xls"] {
            assert_eq!(super::office_preview_gate(std::path::Path::new(path), Some(error)).unwrap_err(), error);
            assert!(super::office_preview_gate(std::path::Path::new(path), None).is_ok());
        }
        for path in ["photo.png", "document.pdf", "page.html", "movie.mp4"] {
            assert!(super::office_preview_gate(std::path::Path::new(path), Some(error)).is_ok());
        }
    }
    #[test]
    fn only_a_ready_live_worker_snapshot_can_qualify_for_focus_reclamation() {
        let mut status = serde_json::json!({"preview":{"phase":"ready","pid":42,"hwnd":"123"}});
        assert_eq!(super::office_worker_window(&status), Some((42, 123)));
        status["preview"]["phase"] = serde_json::json!("closed"); assert!(super::office_worker_window(&status).is_none());
        status["preview"]["phase"] = serde_json::json!("ready"); status["preview"]["pid"] = serde_json::json!(0); assert!(super::office_worker_window(&status).is_none());
        status["preview"]["pid"] = serde_json::json!(42); status["preview"]["hwnd"] = serde_json::json!("0"); assert!(super::office_worker_window(&status).is_none());
        status["preview"]["hwnd"] = serde_json::json!("not-a-window"); assert!(super::office_worker_window(&status).is_none());
        assert!(super::office_worker_window(&serde_json::json!({"preview":{"phase":"loading","pid":42,"hwnd":"123"}})).is_none());
    }
    #[test]
    fn native_requests_are_invalidated_before_the_command_lock_and_scoped_to_the_source() {
        use std::sync::atomic::{AtomicU64, Ordering};
        let requests = AtomicU64::new(0);
        let first = super::begin_preview_request(&requests, Search);
        assert!(!super::cancel_preview_request(&requests, Shelf));
        assert_eq!(requests.load(Ordering::Acquire), first);
        assert!(super::cancel_preview_request(&requests, Search));
        assert_ne!(requests.load(Ordering::Acquire), first);
        let second = super::begin_preview_request(&requests, Shelf);
        assert_ne!(first, second);
        assert!(!super::cancel_preview_request(&requests, Search));
        assert_eq!(requests.load(Ordering::Acquire), second);
    }
    #[test]
    fn global_previews_lower_the_notch_without_becoming_notchy_owned() {
        assert!(super::preview_keeps_notch_below(false, Some(true)));
        for visible in [None, Some(false), Some(true)] {
            assert!(super::preview_keeps_notch_below(true, visible));
        }
        assert!(!super::preview_keeps_notch_below(false, Some(false)));
        assert!(!super::preview_keeps_notch_below(false, None));
        assert!(!preview_close_matches(None, Search));
        assert!(!preview_close_matches(None, Shelf));
    }
    #[test]
    fn a_delayed_shelf_close_cannot_close_the_new_search_owner_and_vice_versa() {
        for (previous, current) in [(Shelf, Search), (Search, Shelf)] {
            let mut owner = Some(current);
            if preview_close_matches(owner, previous) { owner = None; }
            assert_eq!(owner, Some(current));
            assert!(preview_close_matches(owner, current));
            owner = None;
            assert!(!preview_close_matches(owner, previous));
            assert!(!preview_close_matches(owner, current));
        }
    }
    #[cfg(windows)]
    #[test]
    fn shelf_preview_directory_uses_native_windows_path_components() {
        let directory = super::quicklook_shelf_directory(std::path::Path::new(r"C:\Native QA\profile"));
        assert_eq!(directory, std::path::PathBuf::from(r"C:\Native QA\profile\.desktop-profile\quicklook-shelf"));
        assert!(!directory.as_os_str().to_string_lossy().contains('/'), "Canonical Shelf directory checks require native separators");
    }
}
async fn clear_quicklook_shelf_copies(state: &DesktopState) {
    let mut copies: Vec<_> = std::mem::take(&mut *state.quicklook_shelf_copies.lock().unwrap()).into_values().collect();
    copies.append(&mut std::mem::take(&mut *state.quicklook_shelf_cleanup.lock().unwrap()));
    if !copies.is_empty() {
        if let Ok(retained) = tokio::task::spawn_blocking(move || {
            let mut retained = Vec::new();
            for mut copy in copies { if copy.try_cleanup().is_err() { retained.push(copy); } }
            retained
        }).await { state.quicklook_shelf_cleanup.lock().unwrap().extend(retained); }
    }
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
            notchy::rendered_navigation::is_main_navigation(&state.origin, &url)
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
        if let Ok(_command) = state.quicklook_command.try_lock() {
            let _ = window.set_always_on_top(!preview_keeps_notch_below(
                state.quicklook_active.load(Ordering::Relaxed), notchy::quicklook::preview_visible()));
        }
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
fn search_service(state: &DesktopState) -> Result<Arc<notchy::search::SearchService>, ApiError> {
    state.search.clone().ok_or_else(|| ApiError::new(503, "La recherche locale est indisponible."))
}
fn search_status_value(state: &DesktopState) -> Value {
    let mut value = state.search.as_ref().map(|service| json!(service.status())).unwrap_or_else(||
        json!({"files":0,"indexing":false,"updatedAt":0,"roots":[],"lastError":state.search_error}));
    value["shortcut"] = state.search_shortcut.lock().unwrap().as_ref()
        .map(|shortcut| json!(*shortcut.lock().unwrap()))
        .unwrap_or_else(|| json!({"shortcut":"Ctrl+Space","available":false}));
    value["quickLook"] = json!(notchy::quicklook::status());
    value["quickLookModule"] = json!(state.quicklook_module.status());
    value["renderedPreview"] = json!({"supported":state.rendered_ready.load(Ordering::Relaxed),"visible":state.server.rendered_visible()});
    value
}
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct SearchQueryInput { q: String, limit: Option<usize> }
fn search_query_input(value: Value) -> Result<(String, usize), ApiError> {
    let input: SearchQueryInput = serde_json::from_value(value).map_err(|_| ApiError::new(400, "Recherche invalide."))?;
    let limit = input.limit.unwrap_or(8);
    if input.q.chars().count() > 256 || input.q.chars().any(char::is_control) || !(1..=20).contains(&limit) {
        return Err(ApiError::new(400, "Recherche invalide."));
    }
    Ok((input.q, limit))
}
fn search_result_id(value: Value) -> Result<String, ApiError> {
    let object = value.as_object().filter(|value| value.len() == 1)
        .ok_or_else(|| ApiError::new(400, "Résultat invalide."))?;
    object.get("id").and_then(Value::as_str).filter(|id| notchy::shelf::valid_id(id))
        .map(str::to_owned).ok_or_else(|| ApiError::new(400, "Résultat invalide."))
}
#[cfg(test)]
mod search_input_tests {
    use super::{search_query_input, search_result_id};
    use serde_json::json;

    #[test]
    fn search_queries_are_literal_typed_and_bounded_in_unicode_characters() {
        assert_eq!(search_query_input(json!({"q":"réunion"})).unwrap(), ("réunion".into(), 8));
        assert!(search_query_input(json!({"q":"é".repeat(256),"limit":20})).is_ok());
        for invalid in [json!({"q":"é".repeat(257)}), json!({"q":"report\nnotes"}),
            json!({"q":"abc","limit":0}), json!({"q":"abc","limit":21}),
            json!({"q":3}), json!({"q":"abc","path":"C:/"}), json!({}), json!(null)] {
            assert_eq!(search_query_input(invalid).unwrap_err().status, 400);
        }
    }

    #[test]
    fn search_actions_accept_one_opaque_id_and_never_a_path() {
        let id = "a".repeat(32);
        assert_eq!(search_result_id(json!({"id":id})).unwrap(), id);
        for invalid in [json!({"path":"C:/report.txt"}), json!({"id":"../report.txt"}),
            json!({"id":"A".repeat(32)}), json!({"id":"a".repeat(31)}),
            json!({"id":id,"path":"C:/"}), json!({"id":null}), json!(id), json!(null)] {
            assert_eq!(search_result_id(invalid).unwrap_err().status, 400);
        }
    }
}
async fn search_stage_file(state: &DesktopState, id: String) -> Result<Value, ApiError> {
    use tokio::io::AsyncReadExt;
    let search = search_service(state)?;
    let (name, reader, size) = tokio::task::spawn_blocking(move || search.share_source(&id)).await
        .map_err(|_| ApiError::new(503, "Fichier indisponible."))?
        .map_err(|_| ApiError::new(409, "Ce fichier a changé. Relance la recherche."))?;
    struct CopyGuard<'a>(&'a AtomicU64);
    impl Drop for CopyGuard<'_> { fn drop(&mut self) { self.0.fetch_sub(1, Ordering::Relaxed); } }
    state.downloads.fetch_add(1, Ordering::Relaxed);
    let _copying = CopyGuard(&state.downloads);
    let stream = futures_util::stream::try_unfold(tokio::fs::File::from_std(reader), |mut file| async {
        let mut bytes = vec![0; 64 * 1024];
        let size = file.read(&mut bytes).await?;
        bytes.truncate(size);
        Ok::<_, std::io::Error>(if size == 0 { None } else { Some((bytes::Bytes::from(bytes), file)) })
    });
    state.services.shelf.add_search_stream(&name, stream, Some(size)).await
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
    let result=replace_preferences(&state,next.clone()).await?; *preferences=next;
    // A tray-label refresh must not turn an already persisted change into an apparent failed save.
    let _=refresh_preferences_tray(&state,&preferences); Ok(result)
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
    native_guard(&window,&state)?;let local=local_scan_ip()?;
    state.services.nearby.scan_local_network(local).await.map_err(|error|error.message)
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
            "search-status" => {
                if !argument.is_null() && argument != json!({}) { return Err(ApiError::new(400, "Recherche invalide.")); }
                Ok(search_status_value(&state))
            }
            "search-query" => {
                let (query, limit) = search_query_input(argument)?;
                let search = search_service(&state)?;
                let hits = tokio::task::spawn_blocking(move || search.query(&query, limit)).await
                    .map_err(|_| ApiError::new(503, "Recherche indisponible."))?
                    .map_err(|_| ApiError::new(503, "Recherche indisponible."))?;
                let mut value = search_status_value(&state); value["hits"] = json!(hits); Ok(value)
            }
            "search-open" | "search-reveal" => {
                let id = search_result_id(argument)?;
                let search = search_service(&state)?;
                let reveal = command == "search-reveal";
                tokio::task::spawn_blocking(move || if reveal { search.reveal(&id) } else { search.open(&id) }).await
                    .map_err(|_| ApiError::new(503, "Ouverture indisponible."))?
                    .map_err(|_| ApiError::new(409, "Cet élément a changé ou nécessite une ouverture depuis l’Explorateur."))?;
                Ok(json!({"ok":true}))
            }
            "search-reindex" => {
                if !argument.is_null() && argument != json!({}) { return Err(ApiError::new(400, "Recherche invalide.")); }
                search_service(&state)?.request_reindex(); Ok(search_status_value(&state))
            }
            "search-preview" | "shelf-preview" => {
                let id = search_result_id(argument)?;
                let source = if command == "shelf-preview" { PreviewSource::Shelf } else { PreviewSource::Search };
                let request = begin_preview_request(&state.preview_request, source);
                let generation = notchy::quicklook::generation();
                let mut owner = state.quicklook_command.lock().await;
                if state.preview_request.load(Ordering::Acquire) != request { return Ok(json!({"ok":true,"cancelled":true})); }
                let search = if command == "search-preview" { Some(search_service(&state)?) } else { None };
                let document = if let Some(search) = search.clone() {
                    let id = id.clone();
                    tokio::task::spawn_blocking(move || search.rendered_preview(&id)).await
                        .map_err(|_| ApiError::new(503, "Aperçu interrompu."))?
                        .map_err(|message| ApiError::new(409, message))?
                } else {
                    let file = state.services.shelf.open(&id, false).await?;
                    let name = file.item.get("name").and_then(Value::as_str).ok_or_else(||ApiError::new(409,"Nom de fichier indisponible."))?.to_owned();
                    let size = file.item.get("size").and_then(Value::as_u64).ok_or_else(||ApiError::new(409,"Taille de fichier indisponible."))?;
                    if notchy::rendered_preview::supports(&name) {
                        let reader = file.file.into_std().await;
                        tokio::task::spawn_blocking(move || notchy::rendered_preview::read(name, reader, size)).await
                            .map_err(|_| ApiError::new(503, "Aperçu interrompu."))??
                    } else { None }
                };
                if state.preview_request.load(Ordering::Acquire) != request { return Ok(json!({"ok":true,"cancelled":true})); }
                if let Some(document) = document {
                    if !state.rendered_ready.load(Ordering::Relaxed) { return Err(ApiError::new(503, "La protection de l’aperçu est indisponible.")); }
                    if state.quicklook_active.load(Ordering::Relaxed) { let _ = tokio::task::spawn_blocking(notchy::quicklook::close).await; }
                    state.quicklook_active.store(false, Ordering::Relaxed); *owner = Some(source);
                    clear_quicklook_shelf_copies(&state).await;
                    let name = document.name.clone(); let url = state.server.publish_rendered(document)?;
                    let _ = window.set_always_on_top(true);
                    return Ok(json!({"ok":true,"rendered":{"name":name,"url":url}}));
                }
                let office_ready = state.office_preview.lock().await.is_some();
                let office_failure = if office_ready { None } else {
                    let error = state.office_preview_error.lock().unwrap().clone();
                    if error.is_none() && state.office_preview_starting.load(Ordering::Acquire) {
                        return Err(ApiError::new(503, "Les aperçus se préparent. Réessaie dans un instant."));
                    }
                    Some(error.unwrap_or_else(|| "Le moteur Office protégé est indisponible. Complète le module QuickLook depuis le Market.".into()))
                };
                state.server.clear_rendered();
                let shelf_path = if command == "shelf-preview" {
                    // Revalidate the opaque ID even when its immutable session
                    // copy is already cached: a removed Shelf item is not valid.
                    let authoritative = state.services.shelf.open(&id, false).await?.path;
                    let existing = state.quicklook_shelf_copies.lock().unwrap().get(&id).map(|copy| copy.checked_path()).transpose()?;
                    let path = if let Some(path) = existing { path } else {
                        if state.quicklook_shelf_copies.lock().unwrap().len() + state.quicklook_shelf_cleanup.lock().unwrap().len() >= notchy::shelf::MAX_FILES {
                            return Err(ApiError::new(409, "Ferme les aperçus avant de prévisualiser davantage de fichiers."));
                        }
                        let prepared = state.services.shelf.prepare_preview(&id, &quicklook_shelf_directory(&state.data)).await?;
                        let path = prepared.path.clone();
                        state.quicklook_shelf_copies.lock().unwrap().insert(id.clone(), prepared);
                        path
                    };
                    if notchy::office_preview::supports(&path) {
                        let broker = state.office_preview.lock().await.clone();
                        if let Some(broker) = broker {
                            let copy = path.clone();
                            tokio::task::spawn_blocking(move || broker.register_shelf_source(&copy, &authoritative)).await
                                .map_err(|_| ApiError::new(503, "Le cache de l’aperçu est indisponible."))?
                                .map_err(|message| ApiError::new(409, message))?;
                        }
                    }
                    Some(path)
                } else { None };
                if state.preview_request.load(Ordering::Acquire) != request { return Ok(json!({"ok":true,"cancelled":true})); }
                state.quicklook_active.store(true, Ordering::Relaxed);
                *owner = Some(source);
                if window.set_always_on_top(false).is_err() {
                    state.quicklook_active.store(false, Ordering::Relaxed);
                    *owner = None;
                    clear_quicklook_shelf_copies(&state).await;
                    return Err(ApiError::new(503, "Aperçu indisponible."));
                }
                // Relinquish Notchy's layer before QuickLook creates/activates its
                // viewer. The normal recovery loop must not raise Notchy over it.
                let failure_for_launch = office_failure.clone();
                let result = tokio::task::spawn_blocking(move || match (search, shelf_path) {
                    (Some(search), _) => search.preview_with(&id, |path| { office_preview_gate(path, failure_for_launch.as_deref())?; notchy::quicklook::preview_in_generation(path, generation) }),
                    (_, Some(path)) => { office_preview_gate(&path, failure_for_launch.as_deref())?; notchy::quicklook::preview_in_generation(&path, generation) },
                    _ => Err("Invalid preview source.".into()),
                }).await;
                if !matches!(&result, Ok(Ok(()))) {
                    let _ = tokio::task::spawn_blocking(notchy::quicklook::close).await;
                    state.quicklook_active.store(false, Ordering::Relaxed);
                    *owner = None;
                    let _ = window.set_always_on_top(true);
                    clear_quicklook_shelf_copies(&state).await;
                }
                result
                    .map_err(|_| ApiError::new(503, "Aperçu indisponible."))?
                    .map_err(|message| ApiError::new(409, if office_failure.as_deref() == Some(message.as_str()) { message } else { "L’aperçu QuickLook est indisponible. Actualise les résultats et vérifie que QuickLook est installé.".into() }))?;
                Ok(json!({"ok":true}))
            }
            "quicklook-module-source" => {
                if !argument.is_null() && argument != json!({}) { return Err(ApiError::new(400, "Commande invalide.")); }
                desktop::open_uri("https://github.com/QL-Win/QuickLook/tree/b13df028f3cce1f84792f7043b57bf5cea3a3e4c")?;
                Ok(json!({"ok":true}))
            }
            "quicklook-module-status" | "quicklook-module-install" | "search-quicklook-install" | "quicklook-module-remove" => {
                if !argument.is_null() && argument != json!({}) { return Err(ApiError::new(400, "Commande invalide.")); }
                let status = match command {
                    "quicklook-module-status" => state.quicklook_module.status(),
                    "quicklook-module-install" | "search-quicklook-install" => {
                        let accepted = state.quicklook_module.begin_install()
                            .map_err(|_| ApiError::new(409, "Le module QuickLook est déjà occupé. Réessaie après l’opération en cours."))?;
                        if matches!(accepted.phase.as_str(), "downloading" | "verifying" | "extracting") {
                            state.quicklook_start_requested.store(false, Ordering::Relaxed);
                        }
                        accepted
                    }
                    _ => {
                        let mut owner = state.quicklook_command.lock().await;
                        if let Some(broker) = state.office_preview.lock().await.take() { broker.stop().await; }
                        state.office_preview_starting.store(false, Ordering::Release);
                        if state.quicklook_active.load(Ordering::Relaxed) {
                            let _ = tokio::task::spawn_blocking(notchy::quicklook::close).await;
                        }
                        state.quicklook_active.store(false, Ordering::Relaxed);
                        *owner = None;
                        state.server.clear_rendered();
                        let _ = window.set_always_on_top(true);
                        clear_quicklook_shelf_copies(&state).await;
                        let removed = state.quicklook_module.remove().await
                            .map_err(|_| ApiError::new(409, "Le module QuickLook n’a pas pu être retiré. Ferme son aperçu puis réessaie."))?;
                        state.quicklook_start_requested.store(false, Ordering::Relaxed);
                        removed
                    }
                };
                if status.installed && matches!(status.phase.as_str(), "installed" | "idle" | "error") {
                    request_office_preview_start(&state, state.native.clone());
                }
                Ok(json!(status))
            }
            "search-preview-close" | "shelf-preview-close" => {
                if !argument.is_null() && argument != json!({}) { return Err(ApiError::new(400, "Commande invalide.")); }
                let source = if command == "shelf-preview-close" { PreviewSource::Shelf } else { PreviewSource::Search };
                if cancel_preview_request(&state.preview_request, source) { notchy::quicklook::cancel_pending(); }
                let mut owner = state.quicklook_command.lock().await;
                // A controller's delayed Close must not dismiss the other
                // controller's newer Invoke once it has acquired this mutex.
                if !preview_close_matches(*owner, source) { return Ok(json!({"ok":true,"closed":false})); }
                // Some Office controls activate QuickLook after loading. Return
                // to its Notchy owner before closing, without stealing focus
                // from an unrelated application the user has switched to.
                let viewer_foreground = notchy::quicklook::is_foreground() || if let Some(broker) = state.office_preview.lock().await.as_ref() { office_worker_is_foreground(&broker.snapshot().await) } else { false };
                if state.quicklook_active.load(Ordering::Relaxed) && viewer_foreground {
                    state.blur.fetch_add(1, Ordering::Relaxed);
                    let _ = window.set_focus();
                }
                state.server.clear_rendered();
                let result = if state.quicklook_active.load(Ordering::Relaxed) {
                    tokio::task::spawn_blocking(notchy::quicklook::close).await
                        .map_err(|_| ApiError::new(503, "Aperçu indisponible."))?
                } else { Ok(()) };
                state.quicklook_active.store(false, Ordering::Relaxed);
                *owner = None;
                let _ = window.set_always_on_top(true);
                clear_quicklook_shelf_copies(&state).await;
                result
                    .map_err(|_| ApiError::new(503, "Fermeture de l’aperçu indisponible."))?;
                Ok(json!({"ok":true}))
            }
            "office-preview-status" => {
                if !argument.is_null() && argument != json!({}) { return Err(ApiError::new(400, "Commande invalide.")); }
                match state.office_preview.lock().await.as_ref() {
                    Some(broker) => Ok(broker.snapshot().await),
                    None => Ok(json!({"available":false,"error":state.office_preview_error.lock().unwrap().clone()})),
                }
            }
            "search-stage" => search_stage_file(&state, search_result_id(argument)?).await,
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
fn development_profile(root: &std::path::Path) -> PathBuf {
    // Join components separately: a literal slash survives in Windows PathBuf
    // strings and fails the native LocalSend canonical storage guard.
    root.join(".development").join("profile")
}
fn search_shortcut_enabled(checking: bool, data_override: Option<&std::path::Path>) -> bool {
    !checking && data_override.is_none()
}

#[cfg(test)]
mod development_profile_tests {
    use super::{development_profile, search_shortcut_enabled, Services};

    #[test]
    fn interactive_trial_keeps_spotlight_shortcut_while_isolated_checks_do_not_register_it() {
        assert!(search_shortcut_enabled(false, None));
        assert!(!search_shortcut_enabled(true, None));
        let isolated = std::path::Path::new("isolated-qa");
        assert!(!search_shortcut_enabled(false, Some(isolated)));
        assert!(!search_shortcut_enabled(true, Some(isolated)));
    }

    #[tokio::test]
    async fn default_trial_profile_initializes_real_native_services_with_a_canonical_windows_path() {
        let repository = tempfile::tempdir().unwrap();
        let profile = development_profile(repository.path());
        assert!(profile.is_absolute());
        assert!(profile.starts_with(repository.path()));
        #[cfg(windows)]
        assert!(!profile.to_string_lossy().contains('/'), "The debug profile must use native Windows separators");
        let services = Services::new(profile.clone(), repository.path().join("missing-native"))
            .await.expect("The default trial profile must pass the unchanged native storage guards");
        let identity = tokio::fs::read(profile.join(".localsend").join("localsend-identity.json"))
            .await.expect("Real LocalSend initialization creates its isolated TLS identity");
        let encoded: serde_json::Value = serde_json::from_slice(&identity).unwrap();
        assert!(encoded["cert"].as_str().is_some_and(|value| value.contains("BEGIN CERTIFICATE")));
        assert!(encoded["key"].as_str().is_some_and(|value| value.contains("PRIVATE KEY")));
        assert_eq!(services.nearby.snapshot().await["available"], false, "Construction never starts a LAN listener");
        services.dispose().await;
    }
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
    let mut context = tauri::generate_context!();
    // Isolate the debug process before the single-instance plugin sees the identifier.
    // This also makes a plain cargo build safe beside the installed application.
    if cfg!(debug_assertions) {
        context.config_mut().identifier = "dev.notchy.v2.trial".into();
        context.config_mut().product_name = Some("Notchy V2 — Essai".into());
    }
    let builder=tauri::Builder::default();
    // Window checks use isolated data and must never activate a running user instance.
    let builder=if checking{builder}else{builder.plugin(tauri_plugin_single_instance::init(|app,arguments,_|{if arguments.iter().any(|argument|argument=="--autostart"){return;}if let (Some(window),Some(state))=(app.get_webview_window("main"),app.try_state::<Arc<DesktopState>>()){if cfg!(debug_assertions)&&arguments.iter().any(|argument|argument=="--reload-ui")&&!state.dialog.load(Ordering::Relaxed)&&state.downloads.load(Ordering::Relaxed)==0{let _=window.eval("location.reload()");}show(&window,&state,"open");}}))};
    let application=builder
      .invoke_handler(tauri::generate_handler![desktop_command,health_run,settings_get,settings_set,favorites_list,favorites_add,discovery_validate,discovery_scan,discovery_first_candidates])
      .setup(move|app|{
        let data=data_override.clone().unwrap_or_else(||if checking{std::env::temp_dir().join(format!("notchy-tauri-check-{}",std::process::id()))}else if cfg!(debug_assertions){development_profile(PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap())}else{app.path().app_data_dir().unwrap()});
        std::fs::create_dir_all(data.join(".desktop-profile"))?;
        let quicklook_module = Arc::new(notchy::quicklook_module::Module::new(&data).map_err(std::io::Error::other)?);
        notchy::quicklook::set_managed_directory(quicklook_module.directory()).map_err(std::io::Error::other)?;
        let packaged=app.path().resource_dir()?.join("native");
        let native=packaged;
        let preferences_file=data.join(".desktop-profile/tauri-preferences.json");
        let preferences:BTreeMap<String,String>=match std::fs::read(&preferences_file){Ok(bytes)=>{if bytes.len()>1024*1024{return Err("Préférences trop volumineuses.".into());}serde_json::from_slice(&bytes)?},Err(error)if error.kind()==std::io::ErrorKind::NotFound=>BTreeMap::new(),Err(error)=>return Err(error.into())};
        let preferences=restore_preferences(preferences);
        let startup=Arc::new(Startup::new(&data,&std::env::current_exe()?,data_override.as_deref(),std::env::args().any(|argument|argument=="--localsend"),cfg!(windows)&&!cfg!(debug_assertions)&&!checking));
        let startup_status=startup.initialize(data_override.is_none());
        let labels=tray_labels(preferences.get("notchy-language-v1").map(String::as_str).unwrap_or("fr"));
        let services=Arc::new(tauri::async_runtime::block_on(Services::new(data.clone(),native.clone()))?);
        // Listener failures remain in the service snapshot and are shown by Tray and Health.
        let _=tauri::async_runtime::block_on(services.nearby.start_on_launch(checking));
        let search_roots = if checking || data_override.is_some() {
            data.file_name().map(|name| vec![data.with_file_name(format!("{}-search-fixtures", name.to_string_lossy()))]).unwrap_or_default()
        } else { notchy::search::default_roots() };
        let (search, search_error) = match notchy::search::SearchService::new(&data, search_roots) {
            Ok(service) => { service.start_worker(); (Some(service), None) },
            Err(error) => (None, Some(error)),
        };
        let server=Arc::new(tauri::async_runtime::block_on(Server::start(services.clone(),if checking||cfg!(debug_assertions){0}else{58252}))?);
        let origin=format!("http://127.0.0.1:{}",server.port);
        let nearby_active=tauri::async_runtime::block_on(services.nearby.snapshot())["available"]==true;
        let config=json!({"token":server.token,"keys":KEYS,"preferences":preferences,"checking":checking,"development":cfg!(debug_assertions),"localSendActive":nearby_active,"startup":startup_status});
        let bridge=include_str!("window_bridge.js").replace("__NOTCHY_CONFIG__",&serde_json::to_string(&config)?);
        let state=Arc::new(DesktopState{services,server,data:data.clone(),origin:origin.clone(),startup,geometry:Mutex::new(initial_geometry()),preferences:tokio::sync::Mutex::new(preferences),tray_items:Mutex::new(None),visible:AtomicBool::new(true),dialog:AtomicBool::new(false),downloads:AtomicU64::new(0),blur:AtomicU64::new(0),quitting:Arc::new(AtomicBool::new(false)),checking,reports:tokio::sync::Mutex::new(Vec::new()),search,search_error,search_shortcut:Mutex::new(None),quicklook_active:AtomicBool::new(false),quicklook_start_requested:AtomicBool::new(false),quicklook_autostart:!checking&&data_override.is_none(),rendered_ready:AtomicBool::new(false),quicklook_module,quicklook_command:tokio::sync::Mutex::new(None),preview_request:AtomicU64::new(0),office_preview:tokio::sync::Mutex::new(None),office_preview_error:Mutex::new(None),office_preview_starting:AtomicBool::new(false),native:native.clone(),quicklook_shelf_copies:Mutex::new(BTreeMap::new()),quicklook_shelf_cleanup:Mutex::new(Vec::new())});
        app.manage(state.clone());
        request_office_preview_start(&state, native.clone());
        let navigation_origin=origin.clone();let download_state=state.clone();
        let window=WebviewWindowBuilder::new(app,"main",WebviewUrl::External(format!("{origin}{}?desktop=1",notchy::rendered_navigation::MAIN_PATH).parse()?))
          .title(if cfg!(debug_assertions){"Notchy V2 — Essai"}else{"Notchy V2"}).inner_size(960.,312.).decorations(false).transparent(true).shadow(false)
          .resizable(false).always_on_top(true).skip_taskbar(true).visible(false).background_color(tauri::window::Color(0,0,0,0))
          .disable_drag_drop_handler()
          .additional_browser_args("--disable-features=CalculateNativeWinOcclusion --disable-renderer-backgrounding --disable-backgrounding-occluded-windows")
          .data_directory(data.join(".tauri-webview")).initialization_script(&bridge)
          .on_navigation(move|url|notchy::rendered_navigation::is_main_navigation(&navigation_origin,url))
          .on_new_window(|_,_|tauri::webview::NewWindowResponse::Deny)
          .on_permission_request(|_,_|tauri::webview::PermissionResponse::Deny)
          .on_download(move|_,event|{
              use tauri::webview::DownloadEvent;
              match event{DownloadEvent::Requested{url,..}=>{let valid=url.origin().ascii_serialization()==download_state.origin&&url.path().strip_prefix("/api/shelf/").is_some_and(notchy::shelf::valid_id);if valid{download_state.downloads.fetch_add(1,Ordering::Relaxed);}valid},DownloadEvent::Finished{..}=>{download_state.downloads.try_update(Ordering::Relaxed,Ordering::Relaxed,|value|Some(value.saturating_sub(1))).ok();true},_=>false}
          })
          .build()?;
        if notchy::rendered_navigation::install(&window, origin.clone()).is_ok() {
            state.rendered_ready.store(true, Ordering::Relaxed);
        }
        desktop::layout(&window,initial_geometry())?;
        if search_shortcut_enabled(checking, data_override.as_deref()) {
            let search_window=window.clone(); let search_state=state.clone();
            let shortcut=notchy::search_hotkey::start(app.handle().clone(), move || {
                if !search_state.dialog.load(Ordering::Relaxed) && search_state.downloads.load(Ordering::Relaxed)==0 {
                    show(&search_window,&search_state,"search"); let _=search_window.set_focus();
                }
            },state.quitting.clone());
            *state.search_shortcut.lock().unwrap()=Some(shortcut);
        }
        let events=state.clone();let event_window=window.clone();
        window.on_window_event(move|event|match event{
          tauri::WindowEvent::CloseRequested{api,..}=>{if !events.quitting.load(Ordering::Relaxed){api.prevent_close();hide(&event_window,&events);}},
          tauri::WindowEvent::Focused(true)=>{events.blur.fetch_add(1,Ordering::Relaxed);},
          tauri::WindowEvent::Focused(false)=>{let generation=events.blur.fetch_add(1,Ordering::Relaxed)+1;let state=events.clone();let window=event_window.clone();tauri::async_runtime::spawn(async move{tokio::time::sleep(Duration::from_millis(180)).await;if state.blur.load(Ordering::Relaxed)==generation&&state.visible.load(Ordering::Relaxed)&&!state.dialog.load(Ordering::Relaxed)&&state.downloads.load(Ordering::Relaxed)==0&&!window.is_focused().unwrap_or(true){let _=window.emit("notchy:deactivate",json!({"reason":"blur","quickLook":state.quicklook_active.load(Ordering::Relaxed)||notchy::quicklook::is_foreground()}));}});},
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
                // The viewer may be closed with its own Escape/close button.
                // Reuse this existing two-second recovery cadence; never race a
                // pending Invoke/Close or introduce an aggressive polling loop.
                let screen=recovery_window.current_monitor().ok().flatten().or_else(||recovery_window.primary_monitor().ok().flatten()).map(|monitor|{
                    let position=monitor.position();let size=monitor.size();(position.x,position.y,size.width,size.height,monitor.scale_factor().to_bits())
                });
                let changed=previous_screen.is_some()&&screen!=previous_screen;previous_screen=screen;
                if resumed||changed||!recovery_window.is_visible().unwrap_or(true){resume(&recovery_window,&recovery_state,"resume");}
                if let Ok(mut owner)=recovery_state.quicklook_command.try_lock(){
                    let viewer_visible=notchy::quicklook::preview_visible();
                    if recovery_state.quicklook_active.load(Ordering::Relaxed)
                        && viewer_visible==Some(false)
                    {recovery_state.quicklook_active.store(false,Ordering::Relaxed);*owner=None;}
                    if !recovery_state.quicklook_active.load(Ordering::Relaxed){clear_quicklook_shelf_copies(&recovery_state).await;}
                    let topmost=!preview_keeps_notch_below(recovery_state.quicklook_active.load(Ordering::Relaxed),viewer_visible);
                    if recovery_window.is_always_on_top().ok()!=Some(topmost){let _=recovery_window.set_always_on_top(topmost);}
                }
            }
        });
        if checking {let watchdog=app.handle().clone();let directory=data.clone();tauri::async_runtime::spawn(async move{tokio::time::sleep(Duration::from_secs(25)).await;if !directory.join("tauri-check.json").is_file(){let _=tokio::fs::write(directory.join("tauri-check.json"),b"{\"pass\":false,\"error\":\"Le renderer ne repond pas.\"}").await;watchdog.exit(1);}});}
        Ok(())
      }).build(context);
    match application {
        Ok(app) => app.run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if let Some(state) = app.try_state::<Arc<DesktopState>>() {
                    if !state.quitting.swap(true, Ordering::Relaxed) {
                        api.prevent_exit();
                        let state = state.inner().clone();
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let mut owner=state.quicklook_command.lock().await;
                            if state.quicklook_active.swap(false,Ordering::Relaxed){
                                let _=tokio::task::spawn_blocking(notchy::quicklook::close).await;
                                if let Some(window)=app.get_webview_window("main"){let _=window.set_always_on_top(true);}
                            }
                            clear_quicklook_shelf_copies(&state).await;
                            *owner=None;
                            if let Some(broker)=state.office_preview.lock().await.take(){broker.stop().await;}
                            let managed_directory=state.quicklook_module.directory().to_path_buf();
                            let _=tokio::task::spawn_blocking(move||notchy::quicklook::stop_managed(&managed_directory)).await;
                            if let Some(search)=&state.search { search.stop(); }
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
