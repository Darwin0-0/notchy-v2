//! Self-contained HTML only. Office documents use the full QuickLook viewer.
use crate::error::ApiError;
use serde::Serialize;
use std::{fs::File, io::Read};

const HTML_LIMIT: u64 = 2 * 1024 * 1024;
type Result<T> = std::result::Result<T, ApiError>;

#[derive(Clone, Serialize)]
pub struct Document { pub name: String, pub html: String }

pub fn supports(name: &str) -> bool {
    name.rsplit_once('.').is_some_and(|(_, suffix)| suffix.eq_ignore_ascii_case("html") || suffix.eq_ignore_ascii_case("htm"))
}

pub fn read(name: String, file: File, size: u64) -> Result<Option<Document>> {
    if !supports(&name) { return Ok(None); }
    let too_large = || ApiError::new(413, "Cette page dépasse la limite de l’aperçu HTML : 2 Mio.");
    if size > HTML_LIMIT { return Err(too_large()); }
    let before = file.metadata()?;
    if !before.is_file() || before.len() != size { return Err(ApiError::new(409, "Le document a changé. Actualise puis réessaie.")); }
    let mut bytes = Vec::new();
    file.take(HTML_LIMIT + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > HTML_LIMIT { return Err(too_large()); }
    if bytes.len() as u64 != size { return Err(ApiError::new(409, "Le document a changé pendant sa lecture.")); }
    let bytes = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(&bytes);
    if bytes.contains(&0) { return Err(ApiError::new(415, "L’aperçu nécessite une page UTF-8, sans caractères nuls.")); }
    let html = std::str::from_utf8(bytes).map_err(|_| ApiError::new(415, "L’aperçu nécessite une page encodée en UTF-8."))?.to_owned();
    Ok(Some(Document { name, html }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Seek, SeekFrom, Write};

    fn fixture(name: &str, bytes: &[u8], size: u64) -> Result<Option<Document>> {
        let mut file = tempfile::tempfile().unwrap();
        file.write_all(bytes).unwrap(); file.seek(SeekFrom::Start(0)).unwrap();
        read(name.into(), file, size)
    }

    #[test]
    fn office_and_other_files_never_enter_the_html_or_simplified_text_reader() {
        for name in ["image.png", "document.docx", "BOOK.XLSX", "slides.PPTX", "old.doc", "old.xls", "old.ppt", "page.html.exe", "folder", "html"] {
            assert!(!supports(name), "{name}");
            assert!(fixture(name, b"not HTML or a valid Office archive", 1).unwrap().is_none(), "{name}");
        }
        assert!(supports("Maquette.HTML")); assert!(supports("page.HtM"));
    }

    #[test]
    fn standalone_html_keeps_its_styles_scripts_and_optional_utf8_bom() {
        let source = "<!doctype html><style>p{color:red}</style><script>window.ready=true</script><p>Été</p>";
        for bytes in [source.as_bytes().to_vec(), [vec![0xef, 0xbb, 0xbf], source.as_bytes().to_vec()].concat()] {
            let document = fixture("Maquette.html", &bytes, bytes.len() as u64).unwrap().unwrap();
            assert_eq!(document.name, "Maquette.html"); assert_eq!(document.html, source);
        }
    }

    #[test]
    fn encoding_size_and_changed_length_are_checked_before_publication() {
        assert_eq!(fixture("page.html", &[0xff], 1).err().unwrap().status, 415);
        assert_eq!(fixture("page.html", b"x\0y", 3).err().unwrap().status, 415);
        assert_eq!(fixture("page.htm", b"<p>page</p>", 1).err().unwrap().status, 409);
        assert_eq!(fixture("page.html", b"", HTML_LIMIT + 1).err().unwrap().status, 413);
        let boundary = vec![b' '; HTML_LIMIT as usize];
        assert_eq!(fixture("page.html", &boundary, HTML_LIMIT).unwrap().unwrap().html.len(), HTML_LIMIT as usize);
    }
}
