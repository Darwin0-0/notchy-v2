use serde::Serialize;
use std::{io, path::{Path, PathBuf}, sync::Mutex};

#[cfg(windows)]
const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
#[cfg(windows)]
const RUN_VALUE: &str = "Notchy V2";

#[derive(Debug, Serialize)]
pub struct StartupStatus {
    pub ok: bool,
    pub supported: bool,
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub struct Startup {
    preference: PathBuf,
    command: Result<String, String>,
    supported: bool,
    gate: Mutex<()>,
}

impl Startup {
    pub fn new(data: &Path, executable: &Path, data_override: Option<&Path>, localsend: bool, supported: bool) -> Self {
        Self {
            preference: data.join(".desktop-profile/startup.json"),
            command: startup_command(executable, data_override, localsend).map_err(|error| error.to_string()),
            supported,
            gate: Mutex::new(()),
        }
    }

    pub fn initialize(&self, enable_new_installation: bool) -> StartupStatus {
        if !self.supported { return self.status(None); }
        match read_preference(&self.preference).map(|saved| initialization_choice(saved, enable_new_installation)) {
            Ok(Some(enabled)) => self.set(enabled),
            // A removed Windows startup entry stays disabled until the user enables it again.
            Ok(_) => self.status(None),
            Err(error) => self.status(Some(format!("Préférence de démarrage illisible : {error}"))),
        }
    }

    pub fn set(&self, enabled: bool) -> StartupStatus {
        if !self.supported {
            return self.status(Some("Le démarrage avec Windows est disponible dans la version installée.".into()));
        }
        let _guard = self.gate.lock().unwrap();
        let result = (|| {
            let command = self.command.as_ref().map_err(|error| io::Error::other(error.clone()))?;
            let previous = read_registration()?;
            change_registration(previous, command, enabled, write_registration, |choice| write_preference(&self.preference, choice))
        })();
        self.status(result.err().map(|error| format!("Le démarrage avec Windows n’a pas pu être modifié : {error}")))
    }

    fn status(&self, error: Option<String>) -> StartupStatus {
        if !self.supported {
            return StartupStatus { ok: error.is_none(), supported: false, enabled: false, error };
        }
        let registration = self.command.as_ref().map_err(Clone::clone).and_then(|command| {
            read_registration().map(|value| value.is_some_and(|value| value.eq_ignore_ascii_case(command))).map_err(|error| error.to_string())
        });
        let enabled = registration.as_ref().copied().unwrap_or(false);
        let error = error.or_else(|| registration.err());
        StartupStatus { ok: error.is_none(), supported: true, enabled, error }
    }
}

fn initialization_choice(saved: Option<bool>, enable_new_installation: bool) -> Option<bool> {
    match saved {
        None if enable_new_installation => Some(true),
        Some(false) => Some(false),
        _ => None,
    }
}

fn startup_command(executable: &Path, data_override: Option<&Path>, localsend: bool) -> io::Result<String> {
    fn quoted(path: &Path) -> io::Result<String> {
        let path = std::path::absolute(path)?;
        let text = path.to_str().filter(|text| !text.chars().any(|c| c == '"' || c.is_control()))
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "Chemin de démarrage invalide."))?;
        // Windows doubles trailing backslashes before a quoted argument's closing quote.
        let trailing = text.chars().rev().take_while(|c| *c == '\\').count();
        Ok(format!("\"{text}{}\"", "\\".repeat(trailing)))
    }
    let mut command = format!("{} --autostart", quoted(executable)?);
    if let Some(root) = data_override { command.push_str(&format!(" --data-root {}", quoted(root)?)); }
    if localsend { command.push_str(" --localsend"); }
    if command.encode_utf16().count() > 260 {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "Le chemin dépasse la limite du démarrage Windows."));
    }
    Ok(command)
}

fn read_preference(path: &Path) -> io::Result<Option<bool>> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    if bytes.len() > 16 { return Err(io::Error::new(io::ErrorKind::InvalidData, "Préférence invalide.")); }
    serde_json::from_slice::<bool>(&bytes).map(Some).map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

fn write_preference(path: &Path, enabled: bool) -> io::Result<()> {
    let temporary = path.with_extension("tmp");
    std::fs::write(&temporary, if enabled { b"true".as_slice() } else { b"false".as_slice() })?;
    std::fs::rename(&temporary, path)
}

fn change_registration(
    previous: Option<String>, command: &str, enabled: bool,
    mut write: impl FnMut(Option<&str>) -> io::Result<()>,
    persist: impl FnOnce(bool) -> io::Result<()>,
) -> io::Result<()> {
    let next = if enabled { Some(command) }
        else if previous.as_deref().is_some_and(|value| value.eq_ignore_ascii_case(command)) { None }
        else { previous.as_deref() };
    let changed = next != previous.as_deref();
    if changed { write(next)?; }
    if let Err(error) = persist(enabled) {
        if changed {
            write(previous.as_deref()).map_err(|rollback| io::Error::other(format!("{error}; restauration du démarrage impossible : {rollback}")))?;
        }
        return Err(error);
    }
    Ok(())
}

#[cfg(windows)]
fn wide(value: &str) -> Vec<u16> { value.encode_utf16().chain(Some(0)).collect() }

#[cfg(windows)]
fn read_registration() -> io::Result<Option<String>> {
    use windows_sys::Win32::{Foundation::ERROR_FILE_NOT_FOUND, System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_SZ}};
    let mut buffer = vec![0u16; 32768];
    let mut bytes = (buffer.len() * 2) as u32;
    let result = unsafe { RegGetValueW(HKEY_CURRENT_USER, wide(RUN_KEY).as_ptr(), wide(RUN_VALUE).as_ptr(), RRF_RT_REG_SZ,
        std::ptr::null_mut(), buffer.as_mut_ptr().cast(), &mut bytes) };
    if result == ERROR_FILE_NOT_FOUND { return Ok(None); }
    if result != 0 { return Err(io::Error::from_raw_os_error(result as i32)); }
    let units = &buffer[..bytes as usize / 2];
    let units = units.strip_suffix(&[0]).unwrap_or(units);
    String::from_utf16(units).map(Some).map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

#[cfg(windows)]
fn write_registration(command: Option<&str>) -> io::Result<()> {
    use windows_sys::Win32::{Foundation::ERROR_FILE_NOT_FOUND, System::Registry::{RegCloseKey, RegCreateKeyW,
        RegDeleteKeyValueW, RegSetValueExW, HKEY_CURRENT_USER, REG_SZ}};
    let result = if let Some(command) = command {
        let mut key = std::ptr::null_mut();
        let opened = unsafe { RegCreateKeyW(HKEY_CURRENT_USER, wide(RUN_KEY).as_ptr(), &mut key) };
        if opened != 0 { return Err(io::Error::from_raw_os_error(opened as i32)); }
        let value = wide(command);
        let written = unsafe { RegSetValueExW(key, wide(RUN_VALUE).as_ptr(), 0, REG_SZ, value.as_ptr().cast(), (value.len() * 2) as u32) };
        unsafe { RegCloseKey(key); }
        written
    } else {
        unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, wide(RUN_KEY).as_ptr(), wide(RUN_VALUE).as_ptr()) }
    };
    if result == 0 || (command.is_none() && result == ERROR_FILE_NOT_FOUND) { Ok(()) }
    else { Err(io::Error::from_raw_os_error(result as i32)) }
}

#[cfg(not(windows))]
fn read_registration() -> io::Result<Option<String>> { Ok(None) }
#[cfg(not(windows))]
fn write_registration(_: Option<&str>) -> io::Result<()> { Err(io::Error::new(io::ErrorKind::Unsupported, "Windows requis.")) }

#[cfg(test)]
mod tests {
    use super::*;
    const COMMAND: &str = "\"C:\\Program Files\\Notchy V2\\notchy-v2.exe\" --autostart";

    #[test]
    fn startup_default_applies_once_and_never_overrides_a_saved_opt_out_or_an_isolated_profile() {
        assert_eq!(initialization_choice(None, true), Some(true));
        assert_eq!(initialization_choice(None, false), None);
        for new_installation in [true, false] {
            assert_eq!(initialization_choice(Some(false), new_installation), Some(false));
            assert_eq!(initialization_choice(Some(true), new_installation), None,
                "an existing preference must not restore a startup entry removed in Windows");
        }
    }

    #[cfg(windows)]
    #[test]
    fn startup_command_quotes_spaces_and_preserves_an_explicit_profile_and_localsend() {
        let exe = Path::new(r"C:\Program Files\Notchy V2\notchy-v2.exe");
        assert_eq!(startup_command(exe, None, false).unwrap(), COMMAND);
        assert_eq!(startup_command(exe, Some(Path::new(r"C:\Users\A B\Notchy\")), true).unwrap(),
            "\"C:\\Program Files\\Notchy V2\\notchy-v2.exe\" --autostart --data-root \"C:\\Users\\A B\\Notchy\\\\\" --localsend");
        assert!(startup_command(Path::new("C:\\bad\"path.exe"), None, false).is_err());
        assert!(startup_command(Path::new(&format!("C:\\{}.exe", "a".repeat(260))), None, false).is_err());
    }

    #[test]
    fn startup_choice_round_trips_and_rejects_untyped_or_corrupted_preferences() {
        let directory = tempfile::tempdir().unwrap(); let path = directory.path().join("startup.json");
        assert_eq!(read_preference(&path).unwrap(), None);
        for enabled in [true, false] {
            write_preference(&path, enabled).unwrap(); assert_eq!(read_preference(&path).unwrap(), Some(enabled));
        }
        for invalid in ["null", "\"false\"", "{}", "1", "", "false trailing", "                 "] {
            std::fs::write(&path, invalid).unwrap(); assert!(read_preference(&path).is_err());
        }
    }

    #[test]
    fn startup_registration_saves_enabled_and_disabled_choices_without_touching_another_profile() {
        let mut writes = Vec::new(); let mut choices = Vec::new();
        change_registration(None, COMMAND, true, |value| { writes.push(value.map(str::to_owned)); Ok(()) }, |choice| { choices.push(choice); Ok(()) }).unwrap();
        assert_eq!(writes, [Some(COMMAND.to_owned())]); assert_eq!(choices, [true]);
        writes.clear();
        change_registration(Some(COMMAND.into()), COMMAND, false, |value| { writes.push(value.map(str::to_owned)); Ok(()) }, |choice| { choices.push(choice); Ok(()) }).unwrap();
        assert_eq!(writes, [None]); assert_eq!(choices, [true, false]);
        writes.clear();
        change_registration(Some(format!("{COMMAND} --data-root \"C:\\Other\"")), COMMAND, false,
            |value| { writes.push(value.map(str::to_owned)); Ok(()) }, |_| Ok(())).unwrap();
        assert!(writes.is_empty());
    }

    #[test]
    fn startup_registration_failure_does_not_save_and_persistence_failure_restores_previous_command() {
        let mut persisted = false;
        assert!(change_registration(None, COMMAND, true, |_| Err(io::Error::new(io::ErrorKind::PermissionDenied, "refused")),
            |_| { persisted = true; Ok(()) }).is_err());
        assert!(!persisted);
        for previous in [None, Some("another copy".to_owned()), Some(COMMAND.to_owned())] {
            let mut writes = Vec::new(); let enabled = previous.as_deref() != Some(COMMAND);
            let result = change_registration(previous.clone(), COMMAND, enabled,
                |value| { writes.push(value.map(str::to_owned)); Ok(()) }, |_| Err(io::Error::new(io::ErrorKind::PermissionDenied, "disk refused")));
            assert!(result.is_err()); assert_eq!(writes.last(), Some(&previous));
        }
    }
}
