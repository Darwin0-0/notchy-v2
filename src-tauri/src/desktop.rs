use crate::error::ApiError;
use serde::{Deserialize, Serialize};
use std::process::{Command, Stdio};
use tauri::{LogicalSize, PhysicalPosition, WebviewWindow};

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Geometry {
    pub width: f64,
    pub height: f64,
    pub band: f64,
    pub radius: f64,
    pub shoulder: f64,
    #[serde(skip_serializing, default)]
    pub state: NotchState,
}
#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum NotchState {
    #[default]
    Discreet,
    Hover,
    Open,
}
#[derive(Default)]
pub struct PointerObserver {
    previous: Option<(PointerSample, NotchState)>,
}
#[derive(Clone, Copy)]
pub struct PointerSample {
    inside: bool,
    position: (i32, i32),
}
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct PointerEvent {
    pub inside: bool,
    pub moved: bool,
}
impl PointerObserver {
    pub fn update(&mut self, sample: Option<PointerSample>, state: NotchState) -> Option<PointerEvent> {
        let moved = sample.zip(self.previous).is_some_and(|(next, (previous, _))| next.position != previous.position);
        let changed = sample.map(|sample| (sample.inside, state)) != self.previous.map(|(sample, state)| (sample.inside, state));
        self.previous = sample.map(|sample| (sample, state));
        if moved || changed { sample.map(|sample| PointerEvent { inside: sample.inside, moved }) } else { None }
    }
}

#[cfg(windows)]
pub fn cursor_sample(window: &WebviewWindow) -> Option<PointerSample> {
    use windows_sys::Win32::{
        Foundation::POINT,
        Graphics::Gdi::{CreateRectRgn, DeleteObject, GetWindowRgn, PtInRegion, ScreenToClient},
        UI::WindowsAndMessaging::{GetCursorPos, IsWindowVisible},
    };
    let hwnd = window.hwnd().ok()?.0;
    unsafe {
        if IsWindowVisible(hwnd) == 0 { return None; }
        let mut cursor = POINT { x: 0, y: 0 };
        if GetCursorPos(&mut cursor) == 0 { return None; }
        let position = (cursor.x, cursor.y);
        if ScreenToClient(hwnd, &mut cursor) == 0 { return None; }
        let region = CreateRectRgn(0, 0, 0, 0);
        if region.is_null() { return None; }
        let sample = if GetWindowRgn(hwnd, region) == 0 { None } else { Some(PointerSample { inside: PtInRegion(region, cursor.x, cursor.y) != 0, position }) };
        DeleteObject(region);
        sample
    }
}
#[cfg(not(windows))]
pub fn cursor_sample(_: &WebviewWindow) -> Option<PointerSample> { None }

impl Geometry {
    pub fn valid(&self) -> bool {
        [
            self.width,
            self.height,
            self.band,
            self.radius,
            self.shoulder,
        ]
        .iter()
        .all(|n| n.is_finite())
            && self.width >= 1.
            && self.width <= 1200.
            && self.height >= 1.
            && self.height <= 900.
            && self.band >= 0.
            && self.band <= self.height + 0.001
            && self.shoulder >= 0.
            && self.shoulder <= self.height
            && self.shoulder * 2. < self.width
            && self.radius >= 0.
            && self.radius <= self.height.min(self.width - self.shoulder * 2.) / 2.
            && self.shoulder + self.radius <= self.height
    }
}

pub fn layout(window: &WebviewWindow, geometry: Geometry) -> Result<serde_json::Value, ApiError> {
    if !geometry.valid() {
        return Err(ApiError::new(400, "Dimensions de l’encoche invalides."));
    }
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())
        .ok_or_else(|| ApiError::new(503, "Écran indisponible."))?;
    let scale = monitor.scale_factor();
    let screen = monitor.size();
    let position = monitor.position();
    let width = 960f64.min(screen.width as f64 / scale);
    let max_height = (screen.height as f64 / scale - 48.).clamp(160., 900.);
    let height = (geometry.height.ceil() + 8.).max(312.).min(max_height);
    let current = window
        .inner_size()
        .map_err(|_| ApiError::new(503, "Fenêtre indisponible."))?;
    if current.width != (width * scale).round() as u32
        || current.height != (height * scale).round() as u32
    {
        window
            .set_size(LogicalSize::new(width, height))
            .map_err(|_| ApiError::new(503, "Dimensions de fenêtre indisponibles."))?;
    }
    let target = PhysicalPosition::new(
        position.x + ((screen.width as f64 - width * scale) / 2.).round() as i32,
        position.y,
    );
    if window.outer_position().ok() != Some(target) {
        let _ = window.set_position(target);
    }
    let _ = window.set_always_on_top(true);
    shape_window(window, geometry, width, scale)?;
    Ok(serde_json::json!({"width":width,"height":height,"maxHeight":max_height}))
}

#[cfg(windows)]
fn shape_window(
    window: &WebviewWindow,
    geometry: Geometry,
    host_width: f64,
    scale: f64,
) -> Result<(), ApiError> {
    use windows_sys::Win32::Graphics::Gdi::{
        CombineRgn, CreateRectRgn, DeleteObject, SetWindowRgn, RGN_OR,
    };
    let hwnd = window
        .hwnd()
        .map_err(|_| ApiError::new(503, "Fenêtre indisponible."))?
        .0;
    unsafe {
        let region = CreateRectRgn(0, 0, 0, 0);
        if region.is_null() {
            return Err(ApiError::new(503, "Contour indisponible."));
        }
        let offset = (host_width - geometry.width) / 2.;
        let height = (geometry.height * scale).ceil() as i32;
        let mut previous: Option<(i32, i32, i32, i32)> = None;
        let add = |x: i32, y: i32, right: i32, bottom: i32| {
            let line = CreateRectRgn(x, y, right, bottom);
            if !line.is_null() {
                CombineRgn(region, region, line, RGN_OR);
                DeleteObject(line);
            }
        };
        for physical_y in 0..height {
            let y = physical_y as f64 / scale;
            let mut inset = geometry.shoulder;
            if y < geometry.shoulder {
                inset = 2. * (geometry.shoulder * y).sqrt() - y;
            } else if geometry.radius > 0. && y >= geometry.height - geometry.radius {
                inset += geometry.radius
                    * (1. - ((geometry.height - y) / geometry.radius).max(0.).sqrt()).powi(2);
            }
            let left = ((offset + inset) * scale).floor().max(0.) as i32;
            let right = ((offset + geometry.width - inset) * scale)
                .ceil()
                .min(host_width * scale) as i32;
            if let Some((x, start, r, bottom)) = previous {
                if x == left && r == right {
                    previous = Some((x, start, r, physical_y + 1));
                } else {
                    add(x, start, r, bottom);
                    previous = Some((left, physical_y, right, physical_y + 1));
                }
            } else {
                previous = Some((left, physical_y, right, physical_y + 1));
            }
        }
        if let Some((x, y, r, b)) = previous {
            add(x, y, r, b);
        }
        if SetWindowRgn(hwnd, region, 1) == 0 {
            DeleteObject(region);
            return Err(ApiError::new(503, "Contour de fenêtre indisponible."));
        }
    }
    Ok(())
}
#[cfg(not(windows))]
fn shape_window(_: &WebviewWindow, _: Geometry, _: f64, _: f64) -> Result<(), ApiError> {
    Ok(())
}

pub fn open_uri(uri: &str) -> Result<(), ApiError> {
    let allowed = matches!(
        uri,
        "spotify:" | "ms-settings:privacy-notifications" | "ms-settings:privacy-location"
    ) || url::Url::parse(uri)
        .map(|url| {
            url.scheme() == "https"
                && url.host_str() == Some("accounts.spotify.com")
                && url.path() == "/authorize"
                && url.username().is_empty()
                && url.password().is_none()
                && url.port().is_none()
        })
        .unwrap_or(false);
    if !allowed {
        return Err(ApiError::new(400, "Adresse externe refusée."));
    }
    let mut command = Command::new("explorer.exe");
    command
        .arg(uri)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
        .spawn()
        .map_err(|_| ApiError::new(503, "Ouverture Windows indisponible."))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pointer_observer_reports_actual_edges_and_state_changes_without_coordinates() {
        let mut observer = PointerObserver::default();
        let outside = Some(PointerSample { inside: false, position: (400, 200) });
        let inside = Some(PointerSample { inside: true, position: (400, 10) });
        let stationary_outside = Some(PointerEvent { inside: false, moved: false });
        let stationary_inside = Some(PointerEvent { inside: true, moved: false });
        assert_eq!(observer.update(outside, NotchState::Discreet), stationary_outside);
        assert_eq!(observer.update(outside, NotchState::Discreet), None);
        assert_eq!(observer.update(inside, NotchState::Discreet), Some(PointerEvent { inside: true, moved: true }));
        assert_eq!(observer.update(inside, NotchState::Hover), stationary_inside);
        assert_eq!(observer.update(inside, NotchState::Hover), None);
        assert_eq!(observer.update(inside, NotchState::Open), stationary_inside);
        assert_eq!(observer.update(outside, NotchState::Open), Some(PointerEvent { inside: false, moved: true }));
        assert_eq!(observer.update(outside, NotchState::Open), None);
        assert_eq!(observer.update(None, NotchState::Open), None);
        assert_eq!(observer.update(None, NotchState::Open), None);
        assert_eq!(observer.update(outside, NotchState::Open), stationary_outside);
    }
    #[test]
    fn pointer_geometry_changes_are_not_movement_and_outside_motion_is_reported() {
        let mut observer = PointerObserver::default();
        let sample = |inside, y| Some(PointerSample { inside, position: (400, y) });
        observer.update(sample(false, 200), NotchState::Discreet);
        assert_eq!(observer.update(sample(false, 200), NotchState::Open), Some(PointerEvent { inside: false, moved: false }));
        assert_eq!(observer.update(sample(true, 200), NotchState::Open), Some(PointerEvent { inside: true, moved: false }));
        assert_eq!(observer.update(sample(false, 200), NotchState::Hover), Some(PointerEvent { inside: false, moved: false }));
        let moved = observer.update(sample(false, 210), NotchState::Hover).unwrap();
        assert_eq!(moved, PointerEvent { inside: false, moved: true });
        assert_eq!(serde_json::to_value(moved).unwrap(), serde_json::json!({"inside":false,"moved":true}));
        assert_eq!(observer.update(sample(false, 210), NotchState::Hover), None);
    }
    #[test]
    fn refuses_user_provided_commands_and_local_paths() {
        for uri in [
            "file:///C:/secret",
            "https://example.com/",
            "cmd:/c calc",
            "https://accounts.spotify.com.evil/authorize",
            "https://user@accounts.spotify.com/authorize",
        ] {
            assert!(open_uri(uri).is_err());
        }
    }
}
