//! The main navigation callback does not observe WebView2 child-frame navigation.
use url::Url;

// Tauri's RemoteUrlPattern broadens "/" to every pathname; use a dedicated route.
pub const MAIN_PATH: &str = "/notchy-ui";
pub fn is_main_navigation(origin: &str, url: &Url) -> bool {
    url.origin().ascii_serialization() == origin
        && url.scheme() == "http" && url.host_str() == Some("127.0.0.1")
        && url.username().is_empty() && url.password().is_none()
        && url.path() == MAIN_PATH && url.query() == Some("desktop=1") && url.fragment().is_none()
}

fn checked_origin(value: &str) -> Result<Url, String> {
    let origin = Url::parse(value).map_err(|_| "Origine d’aperçu invalide.")?;
    if origin.scheme() != "http"
        || origin.host_str() != Some("127.0.0.1")
        || origin.username() != ""
        || origin.password().is_some()
        || origin.path() != "/"
        || origin.query().is_some()
        || origin.fragment().is_some()
        || origin.origin().ascii_serialization() != value
    {
        return Err("Origine d’aperçu invalide.".into());
    }
    Ok(origin)
}

fn allowed_frame_navigation(origin: &Url, target: &str) -> bool {
    if target == "about:blank" {
        return true;
    }
    // Saved bundles bootstrap opaque pages through canonical blank markers.
    if let Some(id) = target.strip_prefix("blob:null/")
        .or_else(|| target.strip_prefix("about:blank#"))
    {
        return uuid::Uuid::parse_str(id)
            .is_ok_and(|uuid| uuid.hyphenated().to_string() == id);
    }
    let Ok(url) = Url::parse(target) else { return false; };
    if url.origin() != origin.origin()
        || url.username() != ""
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return false;
    }
    let Some(id) = url.path().strip_prefix("/rendered-preview/") else { return false; };
    // Exact canonical spelling rejects encoded separators and normalized dot paths.
    crate::shelf::valid_id(id)
        && target == format!("{}/rendered-preview/{id}", origin.origin().ascii_serialization())
}

/// Install once, before exposing HTML previews. An error must leave the feature disabled.
/// The locked Windows runtime runs this closure inline on the UI thread; elsewhere
/// the dispatcher must acknowledge registration before this function returns success.
pub fn install(window: &tauri::WebviewWindow, origin: String) -> Result<(), String> {
    let origin = checked_origin(&origin)?;
    #[cfg(windows)]
    {
        use std::{sync::mpsc, time::Duration};
        use webview2_com::{take_pwstr, NavigationStartingEventHandler};

        let (sender, receiver) = mpsc::sync_channel(1);
        window.with_webview(move |platform| {
            let result = (|| -> Result<(), String> {
                unsafe {
                    let core = platform.controller().CoreWebView2()
                        .map_err(|_| "Protection des aperçus indisponible.".to_string())?;
                    let handler = NavigationStartingEventHandler::create(Box::new(move |_, args| {
                        let Some(args) = args else { return Ok(()); };
                        args.SetCancel(true)?;
                        let mut uri = Default::default();
                        if args.Uri(&mut uri).is_err() { return Ok(()); }
                        if allowed_frame_navigation(&origin, &take_pwstr(uri)) {
                            args.SetCancel(false)?;
                        }
                        Ok(())
                    }));
                    // WebView2 retains the handler until its owning WebView is destroyed.
                    let mut token = 0;
                    core.add_FrameNavigationStarting(&handler, &mut token)
                        .map_err(|_| "Protection des aperçus indisponible.".to_string())?;
                }
                Ok(())
            })();
            let _ = sender.send(result);
        }).map_err(|_| "Protection des aperçus indisponible.".to_string())?;
        receiver.recv_timeout(Duration::from_secs(5))
            .map_err(|_| "Protection des aperçus non confirmée.".to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (window, origin);
        Err("Les aperçus HTML nécessitent la protection native Windows.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn origin() -> Url { checked_origin("http://127.0.0.1:54321").unwrap() }
    fn document() -> String { format!("http://127.0.0.1:54321/rendered-preview/{}", "a".repeat(32)) }

    #[test]
    fn only_the_exact_canonical_loopback_origin_can_be_configured() {
        assert!(checked_origin("http://127.0.0.1:54321").is_ok());
        for value in ["http://[::1]:54321", "http://localhost:54321", "https://127.0.0.1:54321",
            "http://127.0.0.1:54321/", "http://127.0.0.1:54321/?desktop=1", "http://127.0.0.1:54321/#",
            "http://user@127.0.0.1:54321", "http://127.0.0.1:54321/path", "http://127.1:54321", "not a URL"]
        { assert!(checked_origin(value).is_err(), "{value}"); }
    }

    #[test]
    fn a_current_origin_document_and_the_closed_blank_frame_are_allowed() {
        assert!(allowed_frame_navigation(&origin(), &document()));
        assert!(allowed_frame_navigation(&origin(), "about:blank"));
        assert!(allowed_frame_navigation(&origin(), &document().replace(&"a".repeat(32), &"0123456789abcdef".repeat(2))));
    }

    #[test]
    fn only_canonical_opaque_blob_pages_from_self_contained_bundles_are_allowed() {
        for id in ["1ab97d4e-1f72-4c2f-8686-ede3532458f1", "01234567-89ab-cdef-0123-456789abcdef"] {
            for prefix in ["blob:null/", "about:blank#"] {
                let target = format!("{prefix}{id}");
                assert!(allowed_frame_navigation(&origin(), &target));
                assert!(!is_main_navigation("http://127.0.0.1:54321", &Url::parse(&target).unwrap()));
                let pattern: tauri::utils::acl::RemoteUrlPattern = "http://127.0.0.1:*/notchy-ui".parse().unwrap();
                assert!(!pattern.test(&Url::parse(&target).unwrap()));
            }
        }
        for target in [
            "blob:null/", "blob:null/not-a-uuid", "blob:null/1AB97D4E-1F72-4C2F-8686-EDE3532458F1",
            "blob:null/1ab97d4e1f724c2f8686ede3532458f1", "blob:null/{1ab97d4e-1f72-4c2f-8686-ede3532458f1}",
            "blob:null/1ab97d4e-1f72-4c2f-8686-ede3532458f1/child", "blob:null/1ab97d4e-1f72-4c2f-8686-ede3532458f1?x",
            "blob:null/1ab97d4e-1f72-4c2f-8686-ede3532458f1#x", " blob:null/1ab97d4e-1f72-4c2f-8686-ede3532458f1",
            "blob:null/1ab97d4e-1f72-4c2f-8686-ede3532458f1\n", "blob:null/%31ab97d4e-1f72-4c2f-8686-ede3532458f1",
            "blob:http://127.0.0.1:54321/1ab97d4e-1f72-4c2f-8686-ede3532458f1",
            "blob:https://example.invalid/1ab97d4e-1f72-4c2f-8686-ede3532458f1",
            "blob:file:///1ab97d4e-1f72-4c2f-8686-ede3532458f1", "data:text/html,<h1>embedded</h1>",
            "about:blank#", "about:blank#not-a-uuid", "about:blank#1AB97D4E-1F72-4C2F-8686-EDE3532458F1",
            "about:blank#1ab97d4e1f724c2f8686ede3532458f1", "about:blank#1ab97d4e-1f72-4c2f-8686-ede3532458f1/child",
            "about:blank#1ab97d4e-1f72-4c2f-8686-ede3532458f1?x", "about:blank?x#1ab97d4e-1f72-4c2f-8686-ede3532458f1",
            "about:blank#1ab97d4e-1f72-4c2f-8686-ede3532458f1#x", "about:srcdoc#1ab97d4e-1f72-4c2f-8686-ede3532458f1",
            "about:blank#%31ab97d4e-1f72-4c2f-8686-ede3532458f1", " about:blank#1ab97d4e-1f72-4c2f-8686-ede3532458f1",
        ] { assert!(!allowed_frame_navigation(&origin(), target), "{target:?}"); }
    }

    #[test]
    fn other_hosts_ports_credentials_and_protocols_cannot_receive_the_frame() {
        let path = format!("/rendered-preview/{}", "a".repeat(32));
        for prefix in ["https://127.0.0.1:54321", "http://127.0.0.1:54322", "http://localhost:54321",
            "http://[::1]:54321", "http://127.0.0.1.evil.example:54321", "http://evil.example:54321",
            "http://user@127.0.0.1:54321", "http://user:pass@127.0.0.1:54321", "http://127.1:54321"]
        { assert!(!allowed_frame_navigation(&origin(), &format!("{prefix}{path}")), "{prefix}"); }
        for value in ["javascript:alert(1)", "data:text/html,hello", "blob:http://127.0.0.1:54321/test",
            "file:///C:/private.txt", "ipc://localhost/desktop_command", "http://ipc.localhost/desktop_command",
            "about:srcdoc", "about:blank#x", "about:blank?x", "//127.0.0.1:54321/", ""]
        { assert!(!allowed_frame_navigation(&origin(), value), "{value}"); }
    }

    #[test]
    fn rendered_tokens_are_opaque_ids_not_arbitrary_routes_or_names() {
        for value in ["/", "/?desktop=1", "/api/shelf/", "/api/files/input/", "/rendered-preview/",
            "/rendered-preview/not-an-id", "/rendered-preview/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "/rendered-preview/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "/rendered-preview/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            "/rendered-preview/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/child", "/rendered-preview/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]
        { assert!(!allowed_frame_navigation(&origin(), &format!("http://127.0.0.1:54321{value}")), "{value}"); }
    }

    #[test]
    fn query_fragments_encoded_separators_and_dot_normalization_are_rejected() {
        let good = document();
        for value in [format!("{good}?"), format!("{good}?id=x"), format!("{good}#"), format!("{good}#fragment"),
            good.replace("/rendered-preview/", "/other/../rendered-preview/"),
            good.replace("/rendered-preview/", "/other/%2e%2e/rendered-preview/"),
            good.replace("/rendered-preview/", "/rendered-preview%2f/"),
            good.replace("/rendered-preview/", "/rendered-preview\\"),
            good.replace("/rendered-preview/", "/rendered-preview//"),
            good.replace("/rendered-preview/", "/rendered-preview/%61"),
            format!(" {good}"), format!("{good}\n")]
        { assert!(!allowed_frame_navigation(&origin(), &value), "{value:?}"); }
    }

    #[test]
    fn main_acl_uses_a_real_non_root_path_and_accepts_queryless_native_ipc_sources() {
        let pattern: tauri::utils::acl::RemoteUrlPattern = "http://127.0.0.1:*/notchy-ui".parse().unwrap();
        for address in [
            "http://127.0.0.1:54321/notchy-ui?desktop=1",
            "http://127.0.0.1:54321/notchy-ui",
            "http://127.0.0.1:58252/notchy-ui?desktop=1",
            "http://127.0.0.1:58252/notchy-ui",
        ] {
            assert!(pattern.test(&Url::parse(address).unwrap()), "{address}");
        }
        // The actual Tauri wrapper preserves pathname but drops the query on its
        // native IPC source URL. The path, not a query parameter, is the ACL boundary.
        let mut ipc_source = Url::parse("http://127.0.0.1:54321/notchy-ui?desktop=1").unwrap();
        ipc_source.set_query(None);
        assert!(pattern.test(&ipc_source));
    }

    #[test]
    fn actual_tauri_acl_main_path_never_grants_rendered_documents_or_other_origins() {
        let pattern: tauri::utils::acl::RemoteUrlPattern = "http://127.0.0.1:*/notchy-ui".parse().unwrap();
        for path in [
            "/", "/?desktop=1", "/index.html", "/rendered-preview/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "/rendered-preview/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?desktop=1", "/api/shelf", "/api/files/input/a",
            "/api/search-status", "/other", "/notchy-ui/", "/notchy-ui/child", "/notchy-ui.js", "/NOTCHY-UI",
        ] {
            let address = format!("http://127.0.0.1:54321{path}");
            assert!(!pattern.test(&Url::parse(&address).unwrap()), "{address}");
        }
        for address in [
            "https://127.0.0.1:54321/notchy-ui", "http://localhost:54321/notchy-ui",
            "http://[::1]:54321/notchy-ui", "http://127.0.0.2:54321/notchy-ui",
            "http://127.0.0.1.evil.example:54321/notchy-ui", "https://example.invalid/notchy-ui",
            "file:///notchy-ui", "about:blank", "about:srcdoc", "data:text/html,notchy-ui",
        ] {
            assert!(!pattern.test(&Url::parse(address).unwrap()), "{address}");
        }
    }

    #[test]
    fn root_tauri_acl_patterns_expand_to_all_paths_and_are_not_a_safe_main_boundary() {
        let broad: tauri::utils::acl::RemoteUrlPattern = "http://127.0.0.1:*/".parse().unwrap();
        let dedicated: tauri::utils::acl::RemoteUrlPattern = "http://127.0.0.1:*/notchy-ui".parse().unwrap();
        let child = Url::parse(&document()).unwrap();
        // tauri-utils 2.10.1 intentionally turns pathname '/' into '*'. Keep this
        // regression against the actual dependency, rather than an assumed URL matcher.
        assert!(broad.test(&child));
        assert!(broad.test(&Url::parse("http://127.0.0.1:54321/api/shelf").unwrap()));
        assert!(!dedicated.test(&child));
        let old_query_boundary: tauri::utils::acl::RemoteUrlPattern = "http://127.0.0.1:*/?desktop=1".parse().unwrap();
        assert!(!old_query_boundary.test(&Url::parse("http://127.0.0.1:54321/").unwrap()),
            "A query-dependent ACL cannot authorize the actual queryless main IPC source");
    }

    #[test]
    fn main_native_navigation_requires_the_exact_dedicated_document_and_desktop_query() {
        let expected = "http://127.0.0.1:54321";
        assert_eq!(MAIN_PATH, "/notchy-ui");
        assert!(is_main_navigation(expected, &Url::parse(&format!("{expected}{MAIN_PATH}?desktop=1")).unwrap()));
        assert!(is_main_navigation("http://127.0.0.1:58252", &Url::parse("http://127.0.0.1:58252/notchy-ui?desktop=1").unwrap()));
        for address in [
            "http://127.0.0.1:54321/", "http://127.0.0.1:54321/?desktop=1",
            "http://127.0.0.1:54321/index.html?desktop=1", "http://127.0.0.1:54321/notchy-ui",
            "http://127.0.0.1:54321/notchy-ui/child?desktop=1", "http://127.0.0.1:54321/notchy-ui/?desktop=1",
            "http://127.0.0.1:54321/rendered-preview/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?desktop=1",
            "http://127.0.0.1:54321/api/shelf?desktop=1", "http://127.0.0.1:54321/notchy-ui?desktop=0",
            "http://127.0.0.1:54321/notchy-ui?desktop=1&x=1", "http://127.0.0.1:54321/notchy-ui?desktop=1&desktop=1",
            "http://127.0.0.1:54321/notchy-ui?desktop=1#", "http://127.0.0.1:54321/notchy-ui?desktop=1#frame",
            "http://user@127.0.0.1:54321/notchy-ui?desktop=1", "http://user:pass@127.0.0.1:54321/notchy-ui?desktop=1",
            "http://127.0.0.1:54322/notchy-ui?desktop=1", "http://localhost:54321/notchy-ui?desktop=1",
            "http://[::1]:54321/notchy-ui?desktop=1", "https://127.0.0.1:54321/notchy-ui?desktop=1",
            "https://example.invalid/notchy-ui?desktop=1", "about:blank",
        ] {
            assert!(!is_main_navigation(expected, &Url::parse(address).unwrap()), "{address}");
        }
    }
}
