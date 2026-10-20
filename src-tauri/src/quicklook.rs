//! Optional QuickLook integration. The external application owns its viewers and updates.
use serde::Serialize;
use std::path::{Path, PathBuf};
static VIEWER_PID: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

#[derive(Serialize)]
pub struct Status {
    pub supported: bool,
    pub available: bool,
    #[serde(rename = "previewVisible")]
    pub preview_visible: Option<bool>,
}

pub fn status() -> Status {
    Status { supported: cfg!(windows), available: executable().is_some(), preview_visible: preview_visible() }
}

#[cfg(windows)]
fn preview_visible() -> Option<bool> {
    let pid = VIEWER_PID.load(std::sync::atomic::Ordering::Relaxed);
    if pid == 0 { return None; }
    Some(viewer_window(pid).is_some())
}

#[cfg(windows)]
fn viewer_window(pid: u32) -> Option<windows_sys::Win32::Foundation::HWND> {
    use windows_sys::{core::BOOL, Win32::{Foundation::{HWND, LPARAM, RECT}, UI::WindowsAndMessaging::{EnumWindows, GetWindowRect, GetWindowTextLengthW, GetWindowThreadProcessId, IsWindowVisible}}};
    unsafe extern "system" fn visit(window: HWND, context: LPARAM) -> BOOL {
        let (pid, found) = &mut *(context as *mut (u32, HWND));
        let mut owner = 0; GetWindowThreadProcessId(window, &mut owner);
        let mut rect: RECT = std::mem::zeroed();
        if owner == *pid && IsWindowVisible(window) != 0
            && preview_window_candidate(GetWindowTextLengthW(window),
                if GetWindowRect(window, &mut rect) != 0 { rect.right - rect.left } else { 0 },
                rect.bottom - rect.top)
        { *found = window; return 0; }
        1
    }
    let mut state: (u32, HWND) = (pid, std::ptr::null_mut());
    unsafe { EnumWindows(Some(visit), (&mut state as *mut (u32, HWND)) as LPARAM); }
    (!state.1.is_null()).then_some(state.1)
}

fn preview_window_candidate(title_length: i32, width: i32, height: i32) -> bool {
    // QuickLook also owns a message/tray window. It is not a file preview.
    title_length > 0 && width > 0 && height > 0
}

#[cfg(not(windows))]
fn preview_visible() -> Option<bool> { None }

pub fn is_foreground() -> bool {
    #[cfg(windows)] {
        use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};
        let expected = VIEWER_PID.load(std::sync::atomic::Ordering::Relaxed);
        let mut actual = 0; unsafe { GetWindowThreadProcessId(GetForegroundWindow(), &mut actual); }
        expected != 0 && expected == actual
    }
    #[cfg(not(windows))] { false }
}

fn checked_executable(path: PathBuf) -> Option<PathBuf> {
    if !path.is_absolute()
        || !path.file_name()?.to_str()?.eq_ignore_ascii_case("QuickLook.exe")
        || !path.is_file()
    {
        return None;
    }
    std::fs::canonicalize(path).ok()
}

#[cfg(windows)]
fn executable() -> Option<PathBuf> {
    // No PATH/current-directory lookup: a search result must never become the viewer.
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("NOTCHY_QUICKLOOK_PATH") {
        candidates.push(PathBuf::from(path));
    }
    if let Ok(app) = std::env::current_exe() {
        if let Some(directory) = app.parent() {
            candidates.push(directory.join("quicklook/QuickLook.exe"));
        }
    }
    for (variable, suffix) in [
        ("LOCALAPPDATA", "Programs/QuickLook/QuickLook.exe"),
        ("ProgramFiles", "QuickLook/QuickLook.exe"),
        ("ProgramFiles(x86)", "QuickLook/QuickLook.exe"),
        ("USERPROFILE", "scoop/apps/quicklook/current/QuickLook.exe"),
        ("SCOOP", "apps/quicklook/current/QuickLook.exe"),
        ("SCOOP_GLOBAL", "apps/quicklook/current/QuickLook.exe"),
    ] {
        if let Some(root) = std::env::var_os(variable) {
            candidates.push(PathBuf::from(root).join(suffix));
        }
    }
    if let Some(found) = candidates.into_iter().find_map(checked_executable) {
        return Some(found);
    }
    windows_registration()
}

#[cfg(not(windows))]
fn executable() -> Option<PathBuf> { None }

#[cfg(windows)]
fn windows_registration() -> Option<PathBuf> {
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegEnumKeyExW, RegGetValueW, RegOpenKeyExW,
        HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, RRF_RT_REG_SZ,
    };
    fn wide(value: &str) -> Vec<u16> { value.encode_utf16().chain(Some(0)).collect() }
    fn string(root: HKEY, key: &str, name: &str) -> Option<String> {
        let mut buffer = vec![0u16; 32768];
        let mut bytes = (buffer.len() * 2) as u32;
        let result = unsafe { RegGetValueW(root, wide(key).as_ptr(), wide(name).as_ptr(), RRF_RT_REG_SZ,
            std::ptr::null_mut(), buffer.as_mut_ptr().cast(), &mut bytes) };
        if result != 0 || bytes < 2 || bytes as usize > buffer.len() * 2 { return None; }
        String::from_utf16(&buffer[..bytes as usize / 2 - 1]).ok()
    }
    for root in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        for key in [r"Software\Microsoft\Windows\CurrentVersion\App Paths\QuickLook.exe",
                    r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\QuickLook.exe"] {
            if let Some(found) = string(root, key, "").and_then(|value| checked_executable(PathBuf::from(value.trim_matches('"')))) {
                return Some(found);
            }
        }
    }
    // Store installations do not necessarily publish an executable alias.
    const PACKAGES: &str = r"Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\Repository\Packages";
    let mut key = std::ptr::null_mut();
    if unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, wide(PACKAGES).as_ptr(), 0, KEY_READ, &mut key) } != 0 {
        return None;
    }
    let mut found = None;
    for index in 0..4096 {
        let mut name = [0u16; 512]; let mut count = name.len() as u32;
        let result = unsafe { RegEnumKeyExW(key, index, name.as_mut_ptr(), &mut count,
            std::ptr::null(), std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut()) };
        if result != 0 { break; }
        let Ok(name) = String::from_utf16(&name[..count as usize]) else { continue; };
        if name.starts_with("21090PaddyXu.QuickLook_") || name.starts_with("CE36AF3D-FF94-43EB-9908-7EC8FD1D29FB_") {
            found = string(key, &name, "PackageRootFolder")
                .and_then(|root| checked_executable(PathBuf::from(root).join("QuickLook.exe")));
            if found.is_some() { break; }
        }
    }
    unsafe { RegCloseKey(key); }
    found
}

pub(crate) fn preview(path: &Path) -> Result<(), String> {
    let message = message("Invoke", path.to_str().ok_or("Invalid preview path.")?)?;
    let pipe = pipe_name()?;
    let missing = match write_pipe(&pipe, &message) {
        Ok(()) => return show_preview_above_client(),
        Err(error) => error.kind() == std::io::ErrorKind::NotFound,
    };
    if missing {
        let viewer = executable().ok_or("QuickLook is not installed.")?;
        // Start once; IPC selection changes must never toggle the same preview closed.
        start(&viewer)?;
    }
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(8);
    loop {
        if write_pipe(&pipe, &message).is_ok() { return show_preview_above_client(); }
        if std::time::Instant::now() >= deadline { return Err("QuickLook did not become ready.".into()); }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
}

#[cfg(windows)]
fn show_preview_above_client() -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{IsIconic, SetWindowPos, ShowWindow, HWND_TOP, SWP_NOMOVE, SWP_NOSIZE, SWP_NOACTIVATE, SW_SHOWNOACTIVATE};
    // QuickLook creates its viewer asynchronously after consuming Invoke.
    // This runs on the command's blocking worker, never the WebView/UI thread.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(4);
    loop {
        let pid = VIEWER_PID.load(std::sync::atomic::Ordering::Relaxed);
        if let Some(window) = (pid != 0).then(|| viewer_window(pid)).flatten() {
            unsafe {
                if IsIconic(window) != 0 { ShowWindow(window, SW_SHOWNOACTIVATE); }
                // Notchy has temporarily relinquished its own topmost layer.
                // Keep keyboard focus in Notchy so physical arrows, typing and
                // Escape continue to act on the same Spotlight results. This is
                // also how QuickLook's own BringToFront shows its viewer.
                // Do not alter QuickLook's persistent Topmost preference.
                SetWindowPos(window, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
            }
            return Ok(());
        }
        if std::time::Instant::now() >= deadline { return Err("QuickLook did not show a preview.".into()); }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
}

#[cfg(not(windows))]
fn show_preview_above_client() -> Result<(), String> { Err("QuickLook requires Windows.".into()) }

pub fn close() -> Result<(), String> {
    let pipe = pipe_name()?;
    match write_pipe(&pipe, &message("Close", "")?) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("QuickLook preview could not be closed.".into()),
    }
}

fn message(operation: &str, path: &str) -> Result<Vec<u8>, String> {
    if !matches!(operation, "Invoke" | "Close") || path.chars().any(|c| c == '|' || c.is_control()) || path.len() > 65536 {
        return Err("Invalid QuickLook request.".into());
    }
    Ok(format!("QuickLook.App.PipeMessages.{operation}|{path}|\n").into_bytes())
}

#[cfg(windows)]
fn pipe_name() -> Result<String, String> {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, LocalFree},
        Security::{Authorization::ConvertSidToStringSidW, GetTokenInformation, TokenUser, TOKEN_QUERY, TOKEN_USER},
        System::Threading::{GetCurrentProcess, OpenProcessToken},
    };
    unsafe {
        let mut token = std::ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 { return Err("QuickLook session unavailable.".into()); }
        let mut size = 0;
        GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut size);
        let mut buffer = vec![0usize; (size as usize).div_ceil(std::mem::size_of::<usize>())];
        let ok = size > 0 && GetTokenInformation(token, TokenUser, buffer.as_mut_ptr().cast(), size, &mut size) != 0;
        CloseHandle(token);
        if !ok { return Err("QuickLook session unavailable.".into()); }
        let user = &*(buffer.as_ptr().cast::<TOKEN_USER>());
        let mut text = std::ptr::null_mut();
        if ConvertSidToStringSidW(user.User.Sid, &mut text) == 0 { return Err("QuickLook session unavailable.".into()); }
        let mut len = 0; while len < 256 && *text.add(len) != 0 { len += 1; }
        let sid = String::from_utf16(std::slice::from_raw_parts(text, len));
        LocalFree(text.cast());
        let sid = sid.map_err(|_| "QuickLook session unavailable.")?;
        Ok(format!(r"\\.\pipe\QuickLook.App.Pipe.{sid}"))
    }
}

#[cfg(not(windows))]
fn pipe_name() -> Result<String, String> { Err("QuickLook requires Windows.".into()) }

#[cfg(windows)]
fn write_pipe(pipe: &str, bytes: &[u8]) -> std::io::Result<()> {
    use std::{io::Write, os::windows::{fs::OpenOptionsExt, io::AsRawHandle}};
    // Identification-only access prevents a pipe server impersonating Notchy.
    let mut client = std::fs::OpenOptions::new().write(true).custom_flags(0x00110000).open(pipe)?;
    let mut pid = 0;
    if unsafe { windows_sys::Win32::System::Pipes::GetNamedPipeServerProcessId(client.as_raw_handle().cast(), &mut pid) } != 0 {
        VIEWER_PID.store(pid, std::sync::atomic::Ordering::Relaxed);
    }
    client.write_all(bytes)?;
    Ok(())
}

#[cfg(not(windows))]
fn write_pipe(_: &str, _: &[u8]) -> std::io::Result<()> { Err(std::io::ErrorKind::Unsupported.into()) }

#[cfg(windows)]
fn start(viewer: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    std::process::Command::new(viewer).arg("/autorun")
        .current_dir(viewer.parent().ok_or("QuickLook is unavailable.")?)
        .creation_flags(0x08000000).spawn()
        .map(|_| ()).map_err(|_| "QuickLook could not be started.".into())
}

#[cfg(not(windows))]
fn start(_: &Path) -> Result<(), String> { Err("QuickLook requires Windows.".into()) }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ipc_protocol_preserves_paths_and_rejects_delimiter_or_operation_injection() {
        let path = r"C:\Documents\résumé & draft.pdf";
        assert_eq!(String::from_utf8(message("Invoke", path).unwrap()).unwrap(), format!("QuickLook.App.PipeMessages.Invoke|{path}|\n"));
        assert_eq!(message("Close", "").unwrap(), b"QuickLook.App.PipeMessages.Close||\n");
        for path in ["file|command", "file\ncommand", "file\rcommand", "file\0command"] { assert!(message("Invoke", path).is_err()); }
        assert!(message("RunAndClose", path).is_err());
    }

    #[test]
    fn tray_and_message_windows_are_not_reported_as_visible_previews() {
        assert!(preview_window_candidate(18, 600, 400));
        for (title, width, height) in [(0, 600, 400), (18, 0, 400), (18, 600, 0), (18, -1, 400)] {
            assert!(!preview_window_candidate(title, width, height));
        }
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn preview_messages_reach_an_isolated_real_windows_pipe() {
        use tokio::{io::AsyncReadExt, net::windows::named_pipe::ServerOptions};
        let name = format!(r"\\.\pipe\Notchy.QuickLook.Test.{}", uuid::Uuid::new_v4());
        let mut server = ServerOptions::new().create(&name).unwrap();
        let expected = message("Invoke", r"C:\Documents\two words & résumé.pdf").unwrap();
        let bytes = expected.clone();
        let sender = tokio::task::spawn_blocking(move || write_pipe(&name, &bytes));
        tokio::time::timeout(std::time::Duration::from_secs(3), server.connect()).await.unwrap().unwrap();
        let mut received = vec![0; expected.len()];
        tokio::time::timeout(std::time::Duration::from_secs(3), server.read_exact(&mut received)).await.unwrap().unwrap();
        sender.await.unwrap().unwrap(); assert_eq!(received, expected);
        assert!(pipe_name().unwrap().starts_with(r"\\.\pipe\QuickLook.App.Pipe.S-1-"));
    }
    #[test]
    fn only_an_absolute_existing_quicklook_executable_is_accepted() {
        let root = tempfile::tempdir().unwrap();
        let viewer = root.path().join("QuickLook.exe");
        assert!(checked_executable(viewer.clone()).is_none());
        std::fs::write(&viewer, b"test fixture, never executed").unwrap();
        assert!(checked_executable(viewer).is_some());
        let other = root.path().join("other.exe"); std::fs::write(&other, b"fixture").unwrap();
        assert!(checked_executable(other).is_none());
        assert!(checked_executable(PathBuf::from("QuickLook.exe")).is_none());
        assert!(checked_executable(root.path().to_path_buf()).is_none());
    }
}
