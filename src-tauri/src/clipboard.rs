use crate::error::ApiError;
use std::time::Duration;
type Result<T> = std::result::Result<T, ApiError>;
fn error(status: u16, message: impl ToString) -> ApiError { ApiError::new(status, message) }

pub fn write_text(text: &str) -> Result<()> {
    if text.is_empty() || text.contains('\0') || text.encode_utf16().count() > 262_144 {
        return Err(error(400, "Texte à recopier invalide ou trop volumineux."));
    }
    write_platform(text)
}
#[cfg(not(windows))]
fn write_platform(_: &str) -> Result<()> {
    Err(error(503, "Le presse-papiers Windows est indisponible."))
}
#[cfg(windows)]
fn write_platform(text: &str) -> Result<()> {
    use windows_sys::Win32::{
        Foundation::GlobalFree,
        System::{
            DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData},
            Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE},
        },
        UI::WindowsAndMessaging::{CreateWindowExW, DestroyWindow, HWND_MESSAGE},
    };
    let utf16: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    let class: Vec<u16> = "STATIC".encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        let owner = CreateWindowExW(
            0,
            class.as_ptr(),
            std::ptr::null(),
            0,
            0,
            0,
            0,
            0,
            HWND_MESSAGE,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null(),
        );
        if owner.is_null() {
            return Err(error(503, "Impossible d’ouvrir le presse-papiers Windows."));
        }
        let memory = GlobalAlloc(GMEM_MOVEABLE, utf16.len() * 2);
        if memory.is_null() {
            DestroyWindow(owner);
            return Err(error(503, "Mémoire du presse-papiers indisponible."));
        }
        let buffer = GlobalLock(memory) as *mut u16;
        if buffer.is_null() {
            GlobalFree(memory);
            DestroyWindow(owner);
            return Err(error(503, "Mémoire du presse-papiers indisponible."));
        }
        std::ptr::copy_nonoverlapping(utf16.as_ptr(), buffer, utf16.len());
        GlobalUnlock(memory);
        let mut opened = false;
        for attempt in 0..4 {
            if OpenClipboard(owner) != 0 {
                opened = true;
                break;
            }
            if attempt < 3 {
                std::thread::sleep(Duration::from_millis(25));
            }
        }
        if !opened {
            GlobalFree(memory);
            DestroyWindow(owner);
            return Err(error(
                503,
                "Le presse-papiers Windows est occupé. Réessaie.",
            ));
        }
        let written = EmptyClipboard() != 0 && !SetClipboardData(13, memory).is_null();
        CloseClipboard();
        if !written {
            GlobalFree(memory);
        }
        DestroyWindow(owner);
        if written {
            Ok(())
        } else {
            Err(error(503, "Impossible de recopier dans Windows."))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn invalid_text_is_rejected_before_accessing_the_system_clipboard() {
        for text in [String::new(), "embedded\0nul".into(), "a".repeat(262145)] {
            assert_eq!(write_text(&text).unwrap_err().status, 400);
        }
    }
}
