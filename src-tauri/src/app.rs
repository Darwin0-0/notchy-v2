use notchy::{
    desktop::{self, Geometry, NotchState},
    server::{Server, Services},
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

const KEYS: [&str; 5] = [
    "notchy-minimal-appearance-v1",
    "notchy-minimal-modules-v1",
    "notchy-minimal-focus-v1",
    "notchy-minimal-welcome-v1",
    "notchy-language-v1",
];
fn valid_language(value: &str) -> bool {
    matches!(value, "fr" | "en")
}
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
struct DesktopState {
    services: Arc<Services>,
    server: Arc<Server>,
    data: PathBuf,
    origin: String,
    geometry: Mutex<Geometry>,
    preferences: tokio::sync::Mutex<BTreeMap<String, String>>,
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
        width: 267.,
        height: 10.,
        band: 10.,
        radius: 4.,
        shoulder: 3.5,
        state: NotchState::Discreet,
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
    let object = value
        .as_object()
        .filter(|object| object.len() == 2)
        .ok_or_else(|| ApiError::new(400, "Préférence invalide."))?;
    let key = object
        .get("key")
        .and_then(Value::as_str)
        .filter(|key| KEYS.contains(key))
        .ok_or_else(|| ApiError::new(400, "Préférence inconnue."))?;
    let value = object
        .get("value")
        .ok_or_else(|| ApiError::new(400, "Préférence invalide."))?;
    if !value.is_null()
        && !value.as_str().is_some_and(|text| {
            text.len() <= 262144
                && if key == "notchy-minimal-welcome-v1" {
                    text == "done"
                } else if key == "notchy-language-v1" {
                    valid_language(text)
                } else {
                    serde_json::from_str::<Value>(text).is_ok()
                }
        })
    {
        return Err(ApiError::new(400, "Préférence invalide."));
    }
    let mut preferences = state.preferences.lock().await;
    let mut next = preferences.clone();
    if let Some(text) = value.as_str() {
        next.insert(key.into(), text.into());
    } else {
        next.remove(key);
    }
    let destination = state.data.join(".desktop-profile/tauri-preferences.json");
    let temporary = destination.with_extension("tmp");
    tokio::fs::write(
        &temporary,
        serde_json::to_vec(&next).map_err(|_| ApiError::new(500, "Préférence invalide."))?,
    )
    .await?;
    tokio::fs::rename(&temporary, &destination).await?;
    *preferences = next;
    if key == "notchy-language-v1" {
        let labels = tray_labels(value.as_str().unwrap_or("fr"));
        if let Some(items) = state.tray_items.lock().unwrap().as_ref() {
            for (item, label) in items.iter().zip(labels) {
                item.set_text(label).map_err(|_| ApiError::new(503, "Menu de Notchy indisponible."))?;
            }
        }
    }
    Ok(json!({"ok":true}))
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
            "preference" => preference(&state, argument).await,
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
                let finished = report["phase"] == "discreet" || report["phase"] == "error";
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
                    r["phase"] == "discreet"
                        && r["state"] == "discreet"
                        && r["geometry"]["height"] == 10
                        && r["geometry"]["radius"] == 4
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
    let builder=if checking{builder}else{builder.plugin(tauri_plugin_single_instance::init(|app,_,_|{if let (Some(window),Some(state))=(app.get_webview_window("main"),app.try_state::<Arc<DesktopState>>()){show(&window,&state,"open");}}))};
    let application=builder
      .invoke_handler(tauri::generate_handler![desktop_command])
      .setup(move|app|{
        let data=data_override.clone().unwrap_or_else(||if checking{std::env::temp_dir().join(format!("notchy-tauri-check-{}",std::process::id()))}else if cfg!(debug_assertions){PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_owned()}else{app.path().app_data_dir().unwrap()});
        std::fs::create_dir_all(data.join(".desktop-profile"))?;
        let packaged=app.path().resource_dir()?.join("native");
        let native=packaged;
        let preferences_file=data.join(".desktop-profile/tauri-preferences.json");
        let preferences:BTreeMap<String,String>=match std::fs::read(&preferences_file){Ok(bytes)=>{if bytes.len()>1024*1024{return Err("Préférences trop volumineuses.".into());}serde_json::from_slice(&bytes)?},Err(error)if error.kind()==std::io::ErrorKind::NotFound=>BTreeMap::new(),Err(error)=>return Err(error.into())};
        let preferences=preferences.into_iter().filter(|(key,value)|KEYS.contains(&key.as_str())&&value.len()<=262144&&(key!="notchy-language-v1"||valid_language(value))).collect::<BTreeMap<_,_>>();
        let labels=tray_labels(preferences.get("notchy-language-v1").map(String::as_str).unwrap_or("fr"));
        let services=Arc::new(tauri::async_runtime::block_on(Services::new(data.clone(),native.clone()))?);
        if !checking&&std::env::args().any(|argument|argument=="--localsend"){
            let _=tauri::async_runtime::block_on(services.nearby.command(json!({"command":"discover"}),&services.files));
        }
        let server=Arc::new(tauri::async_runtime::block_on(Server::start(services.clone(),if checking{0}else{58252}))?);
        let origin=format!("http://127.0.0.1:{}",server.port);
        let nearby_active=tauri::async_runtime::block_on(services.nearby.snapshot())["available"]==true;
        let config=json!({"token":server.token,"keys":KEYS,"preferences":preferences,"checking":checking,"localSendActive":nearby_active});
        let bridge=include_str!("window_bridge.js").replace("__NOTCHY_CONFIG__",&serde_json::to_string(&config)?);
        let state=Arc::new(DesktopState{services,server,data:data.clone(),origin:origin.clone(),geometry:Mutex::new(initial_geometry()),preferences:tokio::sync::Mutex::new(preferences),tray_items:Mutex::new(None),visible:AtomicBool::new(true),dialog:AtomicBool::new(false),downloads:AtomicU64::new(0),blur:AtomicU64::new(0),quitting:AtomicBool::new(false),checking,reports:tokio::sync::Mutex::new(Vec::new())});
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
                let sample=if pointer_state.visible.load(Ordering::Relaxed){desktop::cursor_sample(&pointer_window)}else{None};
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
