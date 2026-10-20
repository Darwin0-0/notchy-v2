use crate::error::ApiError;
use serde::{Deserialize, Serialize};
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
    Rest,
    Compact,
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
struct WindowDpiContext(windows_sys::Win32::UI::HiDpi::DPI_AWARENESS_CONTEXT);
#[cfg(windows)]
impl WindowDpiContext {
    fn enter(hwnd: windows_sys::Win32::Foundation::HWND) -> Option<Self> {
        use windows_sys::Win32::UI::HiDpi::{GetWindowDpiAwarenessContext, SetThreadDpiAwarenessContext};
        let context = unsafe { GetWindowDpiAwarenessContext(hwnd) };
        if context.is_null() { return None; }
        let previous = unsafe { SetThreadDpiAwarenessContext(context) };
        if previous.is_null() { None } else { Some(Self(previous)) }
    }
}
#[cfg(windows)]
impl Drop for WindowDpiContext {
    fn drop(&mut self) {
        unsafe { windows_sys::Win32::UI::HiDpi::SetThreadDpiAwarenessContext(self.0); }
    }
}
#[cfg(windows)]
fn sample_window_cursor(
    hwnd: windows_sys::Win32::Foundation::HWND,
    read_cursor: impl FnOnce(&mut windows_sys::Win32::Foundation::POINT) -> bool,
) -> Option<PointerSample> {
    use windows_sys::Win32::{
        Foundation::POINT,
        Graphics::Gdi::{CreateRectRgn, DeleteObject, GetWindowRgn, PtInRegion, ScreenToClient},
    };
    // Tokio workers may inherit a different DPI context from the UI thread.
    // Both the cursor conversion and the physical window region must use the HWND's context.
    let _dpi = WindowDpiContext::enter(hwnd)?;
    unsafe {
        let mut cursor = POINT { x: 0, y: 0 };
        if !read_cursor(&mut cursor) { return None; }
        let position = (cursor.x, cursor.y);
        if ScreenToClient(hwnd, &mut cursor) == 0 { return None; }
        let region = CreateRectRgn(0, 0, 0, 0);
        if region.is_null() { return None; }
        let sample = if GetWindowRgn(hwnd, region) == 0 { None } else {
            let inside = PtInRegion(region, cursor.x, cursor.y) != 0;
            Some(PointerSample { inside, position })
        };
        DeleteObject(region);
        sample
    }
}
#[cfg(windows)]
pub fn cursor_sample(window: &WebviewWindow, _state: NotchState) -> Option<PointerSample> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetCursorPos, IsWindowVisible};
    let hwnd = window.hwnd().ok()?.0;
    if unsafe { IsWindowVisible(hwnd) } == 0 { return None; }
    sample_window_cursor(hwnd, |point| unsafe { GetCursorPos(point) != 0 })
}
#[cfg(not(windows))]
pub fn cursor_sample(_: &WebviewWindow, _: NotchState) -> Option<PointerSample> { None }

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
            && self.radius <= self.height.min((self.width - self.shoulder * 2.) / 2.)
            && self.shoulder + self.radius <= self.height
    }
}

#[cfg(any(windows, test))]
fn contour_inset(geometry: Geometry, y: f64) -> f64 {
    if geometry.shoulder > 0. && y < geometry.shoulder {
        if y <= 0. { return 0.; }
        // Export 19.2: C11 0 20 9 20 20, normalized to the current ear size.
        let normalized_y = y / geometry.shoulder;
        let (mut low, mut high) = (0., 1.);
        for _ in 0..32 {
            let t = (low + high) / 2.;
            if t * t * (1.35 - 0.35 * t) < normalized_y { low = t; } else { high = t; }
        }
        let t = (low + high) / 2.;
        return geometry.shoulder * t * (1.65 - 0.3 * t - 0.35 * t * t);
    }
    let mut inset = geometry.shoulder;
    if geometry.radius > 0. && y >= geometry.height - geometry.radius {
        if geometry.shoulder > 0. {
            let dy = (y - (geometry.height - geometry.radius)).clamp(0., geometry.radius);
            inset += geometry.radius - (geometry.radius * geometry.radius - dy * dy).max(0.).sqrt();
        } else {
            inset += geometry.radius
                * (1. - ((geometry.height - y) / geometry.radius).max(0.).sqrt()).powi(2);
        }
    }
    inset
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
    let hwnd = window
        .hwnd()
        .map_err(|_| ApiError::new(503, "Fenêtre indisponible."))?
        .0;
    shape_native_window(hwnd, geometry, host_width, scale)
}

#[cfg(windows)]
fn shape_native_window(
    hwnd: windows_sys::Win32::Foundation::HWND,
    geometry: Geometry,
    host_width: f64,
    scale: f64,
) -> Result<(), ApiError> {
    use windows_sys::Win32::Graphics::Gdi::{
        CombineRgn, CreateRectRgn, DeleteObject, SetWindowRgn, RGN_OR,
    };
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
            let inset = contour_inset(geometry, y);
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
    open_uri_with(uri, |wide| {
        #[cfg(windows)]
        {
            use windows_sys::Win32::{
                System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE},
                UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL},
            };
            // Shell extensions may require STA; Tokio workers do not provide one.
            std::thread::scope(|scope| scope.spawn(move || unsafe {
                if CoInitializeEx(std::ptr::null(), (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32) < 0 {
                    return 0;
                }
                let operation: Vec<u16> = "open".encode_utf16().chain(Some(0)).collect();
                let result = ShellExecuteW(
                    std::ptr::null_mut(), operation.as_ptr(), wide.as_ptr(),
                    std::ptr::null(), std::ptr::null(), SW_SHOWNORMAL,
                ) as isize;
                CoUninitialize();
                result
            }).join().unwrap_or(0))
        }
        #[cfg(not(windows))]
        {
            let _ = wide;
            0
        }
    })
}

fn open_uri_with(uri: &str, launch: impl FnOnce(&[u16]) -> isize) -> Result<(), ApiError> {
    let allowed = matches!(
        uri,
        "spotify:" | "ms-settings:privacy-notifications" | "ms-settings:privacy-location"
            | "https://github.com/QL-Win/QuickLook/releases/latest"
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
    if !allowed || uri.len() > 16384 || uri.chars().any(char::is_control) {
        return Err(ApiError::new(400, "Adresse externe refusée."));
    }
    let wide: Vec<u16> = uri.encode_utf16().chain(Some(0)).collect();
    if launch(&wide) <= 32 {
        return Err(ApiError::new(503, "Ouverture Windows indisponible."));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn native_geometry_accepts_exactly_the_frontend_state_vocabulary() {
        for (name, expected) in [("rest", super::NotchState::Rest),("compact", super::NotchState::Compact),("open", super::NotchState::Open)] {
            let value=serde_json::json!({"width":240.0,"height":40.0,"band":40.0,"radius":6.0,"shoulder":0.0,"state":name});
            let geometry: super::Geometry=serde_json::from_value(value).unwrap();
            assert_eq!(geometry.state,expected);
            assert_eq!(serde_json::to_value(expected).unwrap(),name);
        }
        for name in ["discreet","hover","expanded","unknown"] {
            assert!(serde_json::from_value::<super::NotchState>(serde_json::json!(name)).is_err());
        }
    }
    use super::*;
    #[cfg(windows)]
    #[test]
    fn cursor_sampling_uses_window_dpi_and_restores_the_worker_context() {
        use windows_sys::Win32::{
            Foundation::HWND,
            UI::{
                HiDpi::{AreDpiAwarenessContextsEqual, GetThreadDpiAwarenessContext,
                    GetWindowDpiAwarenessContext, SetThreadDpiAwarenessContext,
                    DPI_AWARENESS_CONTEXT_UNAWARE, DPI_AWARENESS_CONTEXT_SYSTEM_AWARE,
                    DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2},
                WindowsAndMessaging::{CreateWindowExW, DestroyWindow, IsWindowVisible, WS_POPUP},
            },
        };
        let previous = unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
        assert!(!previous.is_null());
        let _restore = WindowDpiContext(previous);
        struct TestWindow(HWND);
        impl Drop for TestWindow {
            fn drop(&mut self) { unsafe { DestroyWindow(self.0); } }
        }
        let class: Vec<u16> = "STATIC".encode_utf16().chain(Some(0)).collect();
        let window = TestWindow(unsafe {
            CreateWindowExW(0, class.as_ptr(), std::ptr::null(), WS_POPUP,
                100, 120, 1440, 468, std::ptr::null_mut(), std::ptr::null_mut(),
                std::ptr::null_mut(), std::ptr::null())
        });
        assert!(!window.0.is_null());
        assert_eq!(unsafe { IsWindowVisible(window.0) }, 0, "the test never shows a window or moves the mouse");
        shape_native_window(window.0, Geometry { width: 240., height: 40., band: 40.,
            radius: 10., shoulder: 0., state: NotchState::Compact }, 960., 1.5).unwrap();
        let window_context = unsafe { GetWindowDpiAwarenessContext(window.0) };
        for worker_context in [DPI_AWARENESS_CONTEXT_UNAWARE, DPI_AWARENESS_CONTEXT_SYSTEM_AWARE,
            DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2] {
            assert!(!unsafe { SetThreadDpiAwarenessContext(worker_context) }.is_null());
            let caller_context = unsafe { GetThreadDpiAwarenessContext() };
            let mut observer = PointerObserver::default();
            for (physical_y, inside) in [(128, true), (200, false)] {
                let sample = sample_window_cursor(window.0, |point| {
                    assert_ne!(unsafe { AreDpiAwarenessContextsEqual(GetThreadDpiAwarenessContext(), window_context) }, 0);
                    point.x = 820; point.y = physical_y; true
                }).unwrap();
                assert_eq!(sample.position, (820, physical_y));
                assert_eq!(sample.inside, inside, "physical cursor coordinates must match the 150% native contour");
                assert_ne!(unsafe { AreDpiAwarenessContextsEqual(GetThreadDpiAwarenessContext(), caller_context) }, 0,
                    "sampling must not change the Tokio worker's subsequent DPI context");
                assert_eq!(observer.update(Some(sample), NotchState::Compact),
                    Some(PointerEvent { inside, moved: !inside }), "the physical departure reaches the native event pipeline");
            }
            assert!(sample_window_cursor(window.0, |_| false).is_none());
            assert_ne!(unsafe { AreDpiAwarenessContextsEqual(GetThreadDpiAwarenessContext(), caller_context) }, 0,
                "an early cursor read failure must also restore the caller's context");
        }
    }
    #[test]
    fn activity_inset_matches_the_export_cubic_ears_and_circular_bottom_corners() {
        let bezier = |t: f64, first: f64, second: f64, end: f64| {
            let u = 1. - t;
            3. * u * u * t * first + 3. * u * t * t * second + t * t * t * end
        };
        for factor in [1., 1.2] {
            let geometry = Geometry { width: 280. * factor, height: 42. * factor, band: 42. * factor,
                radius: 22. * factor, shoulder: 20. * factor, state: NotchState::Rest };
            for t in [0., 0.1, 0.25, 0.5, 0.75, 0.9, 1.] {
                let x = bezier(t, 11. * factor, 20. * factor, 20. * factor);
                let y = bezier(t, 0., 9. * factor, 20. * factor);
                assert!((contour_inset(geometry, y) - x).abs() < 0.000001,
                    "the native ear follows C11 0 20 9 20 20 at every sampled point");
            }
            for angle in [0., std::f64::consts::FRAC_PI_8, std::f64::consts::FRAC_PI_4,
                3. * std::f64::consts::FRAC_PI_8, std::f64::consts::FRAC_PI_2] {
                let y = geometry.height - geometry.radius + geometry.radius * angle.sin();
                let x = geometry.shoulder + geometry.radius * (1. - angle.cos());
                assert!((contour_inset(geometry, y) - x).abs() < 0.000001,
                    "the native bottom corner matches the SVG circular arc and CSS border radius");
            }
        }
    }
    #[test]
    fn plain_rest_compact_and_open_contours_keep_their_existing_quadratic_corners() {
        for (width, height, radius) in [(128., 10., 6.), (240., 40., 20.), (594., 324., 32.), (708., 324., 32.), (744., 324., 32.), (780., 324., 32.), (824., 428., 14.), (860., 464., 14.), (900., 464., 14.), (900., 496., 14.), (900., 504., 14.), (570., 350., 38.)] {
            let geometry = Geometry { width, height, band: height, radius, shoulder: 0., state: NotchState::Rest };
            for y in [0., height - radius, height - radius / 2., height - 0.01] {
                let expected = if y < height - radius { 0. } else {
                    radius * (1. - ((height - y) / radius).max(0.).sqrt()).powi(2)
                };
                assert!((contour_inset(geometry, y) - expected).abs() < 0.000000000001);
            }
        }
    }
    #[cfg(windows)]
    #[test]
    fn native_window_region_excludes_transparent_edges_and_the_former_rest_hover_area() {
        use windows_sys::Win32::{
            Foundation::HWND,
            Graphics::Gdi::{CreateRectRgn, DeleteObject, GetWindowRgn, HRGN, PtInRegion},
            UI::WindowsAndMessaging::{CreateWindowExW, DestroyWindow, IsWindowVisible, WS_POPUP},
        };
        struct TestWindow(HWND);
        impl Drop for TestWindow {
            fn drop(&mut self) { unsafe { DestroyWindow(self.0); } }
        }
        struct TestRegion(HRGN);
        impl Drop for TestRegion {
            fn drop(&mut self) { unsafe { DeleteObject(self.0); } }
        }
        let geometries = [
            Geometry { width: 128., height: 10., band: 10., radius: 6., shoulder: 0., state: NotchState::Rest },
            Geometry { width: 240., height: 40., band: 40., radius: 20., shoulder: 0., state: NotchState::Compact },
            Geometry { width: 594., height: 324., band: 48., radius: 32., shoulder: 0., state: NotchState::Open },
            Geometry { width: 708., height: 324., band: 48., radius: 32., shoulder: 0., state: NotchState::Open },
            Geometry { width: 744., height: 324., band: 48., radius: 32., shoulder: 0., state: NotchState::Open },
            Geometry { width: 780., height: 324., band: 48., radius: 32., shoulder: 0., state: NotchState::Open },
            Geometry { width: 824., height: 428., band: 48., radius: 14., shoulder: 0., state: NotchState::Open },
            Geometry { width: 860., height: 464., band: 48., radius: 14., shoulder: 0., state: NotchState::Open },
            Geometry { width: 900., height: 464., band: 48., radius: 14., shoulder: 0., state: NotchState::Open },
            Geometry { width: 900., height: 496., band: 48., radius: 14., shoulder: 0., state: NotchState::Open },
            Geometry { width: 900., height: 504., band: 48., radius: 14., shoulder: 0., state: NotchState::Open },
            Geometry { width: 570., height: 350., band: 48., radius: 38., shoulder: 0., state: NotchState::Open },
            Geometry { width: 280., height: 42., band: 42., radius: 22., shoulder: 20., state: NotchState::Rest },
            Geometry { width: 340., height: 42., band: 42., radius: 22., shoulder: 20., state: NotchState::Rest },
            Geometry { width: 400., height: 42., band: 42., radius: 22., shoulder: 20., state: NotchState::Rest },
            Geometry { width: 480., height: 50.4, band: 50.4, radius: 26.4, shoulder: 24., state: NotchState::Compact },
        ];
        for scale in [1_f64, 1.25, 1.5, 2.] {
            let class: Vec<u16> = "STATIC".encode_utf16().chain(Some(0)).collect();
            let window = TestWindow(unsafe {
                CreateWindowExW(0, class.as_ptr(), std::ptr::null(), WS_POPUP,
                    0, 0, (960. * scale).round() as i32, (512. * scale).round() as i32,
                    std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null())
            });
            assert!(!window.0.is_null(), "create a real hidden Windows region host");
            assert_eq!(unsafe { IsWindowVisible(window.0) }, 0);
            let region = TestRegion(unsafe { CreateRectRgn(0, 0, 0, 0) });
            assert!(!region.0.is_null());
            for geometry in geometries {
                assert!(geometry.valid());
                shape_native_window(window.0, geometry, 960., scale).unwrap();
                assert_ne!(unsafe { GetWindowRgn(window.0, region.0) }, 0);
                let contains = |x, y| unsafe { PtInRegion(region.0, x, y) != 0 };
                let left = (((960. - geometry.width) / 2.) * scale).floor() as i32;
                let right = (((960. + geometry.width) / 2.) * scale).ceil() as i32;
                let center = (480. * scale).round() as i32;
                let bottom = (geometry.height * scale).ceil() as i32;
                assert!(contains(left, 0), "straight top edge remains clickable");
                assert!(contains(center, bottom - 1), "black surface remains clickable at each scale");
                assert!(!contains(left - 1, 0), "transparent left margin is outside");
                assert!(!contains(right, 0), "transparent right margin is outside");
                assert!(!contains(center, -1), "the area above the contour is outside");
                assert!(!contains(center, bottom), "the area below the contour is outside");
                assert!(!contains(left, bottom - 1), "rounded bottom corner cutouts are outside");
                if geometry.shoulder > 0. {
                    let ear_x = left + (geometry.shoulder * scale / 2.).floor() as i32;
                    assert!(contains(ear_x, scale.floor() as i32), "a painted black ear is inside the real region");
                    assert!(!contains(left, (geometry.shoulder * scale * 0.75).floor() as i32), "the transparent part of an ear bounding box stays outside");
                    let offset = (960. - geometry.width) / 2.;
                    let cubic_x = ((offset + geometry.shoulder * 0.70625) * scale).floor() as i32;
                    let cubic_y = (geometry.shoulder * 0.29375 * scale).floor() as i32;
                    assert!(contains(cubic_x, cubic_y), "the export cubic midpoint is inside; the former quadratic cut it away");
                    let diagonal = std::f64::consts::FRAC_1_SQRT_2;
                    let corner_x = ((offset + geometry.shoulder + geometry.radius * (1. - diagonal) - 1.) * scale).floor() as i32;
                    let corner_y = ((geometry.height - geometry.radius + geometry.radius * diagonal) * scale).ceil() as i32;
                    assert!(!contains(corner_x, corner_y), "the exact circular corner excludes pixels painted by the former quadratic");
                }
                if geometry.height == 10. {
                    assert!(!contains(center, (20. * scale).round() as i32), "the former invisible 240 by 28 rest target is outside");
                }
            }
        }
    }
    #[test]
    fn geometry_accepts_reference_bottom_corners_without_relaxing_other_bounds() {
        let rest = Geometry { width: 128., height: 10., band: 10., radius: 6., shoulder: 0., state: NotchState::Rest };
        assert!(rest.valid());
        assert!(Geometry { width: 240., height: 40., radius: 20., state: NotchState::Compact, ..rest }.valid());
        assert!(Geometry { width: 440., height: 240., radius: 32., state: NotchState::Open, ..rest }.valid());
        let activity = Geometry { width: 280., height: 42., band: 42., radius: 22., shoulder: 20., ..rest };
        assert!(activity.valid());
        assert!(Geometry { width: 336., height: 50.4, band: 50.4, radius: 26.4, shoulder: 24., state: NotchState::Compact }.valid());
        assert!(!Geometry { radius: 22.1, ..activity }.valid(), "ear plus bottom radius cannot exceed the row height");
        assert!(Geometry { radius: 10., ..rest }.valid());
        assert!(!Geometry { radius: 10.1, ..rest }.valid());
        assert!(!Geometry { width: 11., ..rest }.valid());
        assert!(!Geometry { shoulder: 5., ..rest }.valid());
        assert!(!Geometry { band: 11., ..rest }.valid());
        assert!(!Geometry { radius: f64::NAN, ..rest }.valid());
    }
    #[test]
    fn pointer_observer_reports_actual_edges_and_state_changes_without_coordinates() {
        let mut observer = PointerObserver::default();
        let outside = Some(PointerSample { inside: false, position: (400, 200) });
        let inside = Some(PointerSample { inside: true, position: (400, 10) });
        let stationary_outside = Some(PointerEvent { inside: false, moved: false });
        let stationary_inside = Some(PointerEvent { inside: true, moved: false });
        assert_eq!(observer.update(outside, NotchState::Rest), stationary_outside);
        assert_eq!(observer.update(outside, NotchState::Rest), None);
        assert_eq!(observer.update(inside, NotchState::Rest), Some(PointerEvent { inside: true, moved: true }));
        assert_eq!(observer.update(inside, NotchState::Compact), stationary_inside);
        assert_eq!(observer.update(inside, NotchState::Compact), None);
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
        observer.update(sample(false, 200), NotchState::Rest);
        assert_eq!(observer.update(sample(false, 200), NotchState::Open), Some(PointerEvent { inside: false, moved: false }));
        assert_eq!(observer.update(sample(true, 200), NotchState::Open), Some(PointerEvent { inside: true, moved: false }));
        assert_eq!(observer.update(sample(false, 200), NotchState::Compact), Some(PointerEvent { inside: false, moved: false }));
        let moved = observer.update(sample(false, 210), NotchState::Compact).unwrap();
        assert_eq!(moved, PointerEvent { inside: false, moved: true });
        assert_eq!(serde_json::to_value(moved).unwrap(), serde_json::json!({"inside":false,"moved":true}));
        assert_eq!(observer.update(sample(false, 210), NotchState::Compact), None);
    }
    #[test]
    fn refuses_user_provided_commands_and_local_paths() {
        for uri in [
            "file:///C:/secret",
            "https://example.com/",
            "cmd:/c calc",
            "https://github.com/QL-Win/QuickLook/releases/latest?redirect=evil",
            "https://github.com/QL-Win/QuickLook/releases/latest/other",
            "https://github.com.evil/QL-Win/QuickLook/releases/latest",
            "https://accounts.spotify.com.evil/authorize",
            "https://user@accounts.spotify.com/authorize",
            "https://accounts.spotify.com:444/authorize",
            "https://accounts.spotify.com/authorize\0hidden",
            "https://accounts.spotify.com/authorize?state=bad\nvalue",
            "https://accounts.spotify.com/authorize?state=bad\tvalue",
        ] {
            let mut called = false;
            assert!(open_uri_with(uri, |_| { called = true; 33 }).is_err());
            assert!(!called);
        }
    }
    #[test]
    fn spotify_authorization_keeps_the_entire_url_for_the_windows_association() {
        let uri = format!("https://accounts.spotify.com/authorize?client_id={}&response_type=code&redirect_uri=http%3A%2F%2F127.0.0.1%3A43821%2Fcallback&scope=user-read-playback-state+user-read-currently-playing+user-modify-playback-state&state={}&code_challenge_method=S256&code_challenge={}", "a".repeat(32), "s".repeat(43), "c".repeat(43));
        let mut calls = 0;
        open_uri_with(&uri, |wide| {
            calls += 1;
            assert_eq!(wide.last(), Some(&0));
            assert_eq!(String::from_utf16(&wide[..wide.len() - 1]).unwrap(), uri);
            33
        }).unwrap();
        assert_eq!(calls, 1);
    }
    #[test]
    fn uri_launch_uses_shell_success_and_failure_codes() {
        for uri in ["spotify:", "ms-settings:privacy-notifications", "ms-settings:privacy-location", "https://github.com/QL-Win/QuickLook/releases/latest"] {
            assert!(open_uri_with(uri, |_| 33).is_ok());
            for status in [0, 2, 5, 31, 32] {
                assert!(open_uri_with(uri, |_| status).is_err());
            }
        }
    }
}
