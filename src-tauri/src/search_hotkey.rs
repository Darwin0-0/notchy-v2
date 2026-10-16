//! One thread owns the Windows shortcut and unregisters it before stopping.
use serde::Serialize;
use std::sync::{atomic::AtomicBool, Arc, Mutex};
use tauri::AppHandle;

#[derive(Clone, Debug, Serialize)]
pub struct ShortcutStatus {
    pub shortcut: String,
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn status(shortcut: &str, available: bool, error: Option<&str>) -> ShortcutStatus {
    ShortcutStatus {
        shortcut: shortcut.into(),
        available,
        error: error.map(str::to_owned),
    }
}

fn publish(target: &Mutex<ShortcutStatus>, next: ShortcutStatus) {
    *target
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = next;
}

#[cfg(any(windows, test))]
fn register_shortcut(
    mut register: impl FnMut(bool) -> Result<(), u32>,
) -> Result<&'static str, u32> {
    match register(false) {
        Ok(()) => Ok("Ctrl+Space"),
        // ERROR_HOTKEY_ALREADY_REGISTERED: do not take another application's shortcut.
        Err(1409) => register(true).map(|_| "Ctrl+Shift+Space"),
        Err(error) => Err(error),
    }
}

/// The callback runs on Tauri's main thread. Set `stop` when the app begins quitting.
pub fn start(
    app: AppHandle,
    trigger: impl Fn() + Send + 'static,
    stop: Arc<AtomicBool>,
) -> Arc<Mutex<ShortcutStatus>> {
    let current = Arc::new(Mutex::new(status("Ctrl+Space", false, None)));
    #[cfg(windows)]
    {
        use std::{sync::atomic::Ordering, time::Duration};
        use windows_sys::Win32::{
            Foundation::GetLastError,
            UI::{
                Input::KeyboardAndMouse::{
                    RegisterHotKey, UnregisterHotKey, MOD_CONTROL, MOD_NOREPEAT, MOD_SHIFT,
                    VK_SPACE,
                },
                WindowsAndMessaging::{PeekMessageW, MSG, PM_REMOVE, WM_HOTKEY},
            },
        };
        const IDENTIFIER: i32 = 0x4e53;
        struct Registration;
        impl Drop for Registration {
            fn drop(&mut self) {
                unsafe {
                    UnregisterHotKey(std::ptr::null_mut(), IDENTIFIER);
                }
            }
        }
        let shared = current.clone();
        let spawned = std::thread::Builder::new().name("notchy-search-shortcut".into()).spawn(move || {
            if stop.load(Ordering::Acquire) { return; }
            let registered = register_shortcut(|shift| {
                let modifiers = MOD_CONTROL | MOD_NOREPEAT | if shift { MOD_SHIFT } else { 0 };
                if unsafe { RegisterHotKey(std::ptr::null_mut(), IDENTIFIER, modifiers, VK_SPACE as u32) } != 0 {
                    Ok(())
                } else {
                    Err(unsafe { GetLastError() })
                }
            });
            let shortcut = match registered {
                Ok(shortcut) => shortcut,
                Err(_) => {
                    publish(&shared, status("Ctrl+Space", false, Some("Raccourci global indisponible. Utilise le bouton Rechercher.")));
                    return;
                }
            };
            let _registration = Registration;
            publish(&shared, status(shortcut, true, None));
            let trigger = Arc::new(Mutex::new(trigger));
            while !stop.load(Ordering::Acquire) {
                let mut message: MSG = unsafe { std::mem::zeroed() };
                // A bounded drain prevents repeated keys from delaying shutdown.
                for _ in 0..32 {
                    if stop.load(Ordering::Acquire)
                        || unsafe { PeekMessageW(&mut message, std::ptr::null_mut(), WM_HOTKEY, WM_HOTKEY, PM_REMOVE) } == 0 {
                        break;
                    }
                    if message.wParam != IDENTIFIER as usize { continue; }
                    let callback = trigger.clone();
                    let stopping = stop.clone();
                    if app.run_on_main_thread(move || {
                        if !stopping.load(Ordering::Acquire) {
                            if let Ok(callback) = callback.lock() { callback(); }
                        }
                    }).is_err() {
                        publish(&shared, status(shortcut, false, Some("La recherche n’a pas pu s’ouvrir. Utilise le bouton Rechercher.")));
                        return;
                    }
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            publish(&shared, status(shortcut, false, None));
        });
        if spawned.is_err() {
            publish(
                &current,
                status(
                    "Ctrl+Space",
                    false,
                    Some("Raccourci global indisponible. Utilise le bouton Rechercher."),
                ),
            );
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (app, trigger, stop);
        publish(
            &current,
            status(
                "Ctrl+Space",
                false,
                Some("Utilise le bouton Rechercher sur cette plateforme."),
            ),
        );
    }
    current
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uses_primary_shortcut_without_registering_a_second_one() {
        let mut attempts = Vec::new();
        assert_eq!(
            register_shortcut(|shift| {
                attempts.push(shift);
                Ok(())
            }),
            Ok("Ctrl+Space")
        );
        assert_eq!(attempts, [false]);
    }

    #[test]
    fn an_owned_shortcut_uses_fallback_without_stealing_it() {
        let mut attempts = Vec::new();
        assert_eq!(
            register_shortcut(|shift| {
                attempts.push(shift);
                if shift {
                    Ok(())
                } else {
                    Err(1409)
                }
            }),
            Ok("Ctrl+Shift+Space")
        );
        assert_eq!(attempts, [false, true]);
    }

    #[test]
    fn reports_both_shortcuts_busy_and_does_not_retry_unrelated_failures() {
        assert_eq!(register_shortcut(|_| Err(1409)), Err(1409));
        let mut attempts = 0;
        assert_eq!(
            register_shortcut(|_| {
                attempts += 1;
                Err(5)
            }),
            Err(5)
        );
        assert_eq!(attempts, 1);
    }
}
