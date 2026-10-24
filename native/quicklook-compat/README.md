# Notchy PDF/HTML compatibility build

This is a **Notchy compatibility build** of QuickLook 4.5.0's GPL-3.0 PDFViewer plugin. It fixes rendering before the WPF layout has a valid size and work that continues after a preview is disposed. It also exports a compact HTML compatibility viewer that delegates rendering and menus to the unchanged official HtmlViewer. It is not an upstream QuickLook release. The OfficeViewer 6 plugin and its Syncfusion components remain the unchanged official download; this package does not contain or rebuild them.

Notchy contributors modified `PdfViewerControl.xaml.cs` on 2026-10-21. The source notices from QL-Win Contributors remain intact; the accompanying patch and this notice identify the changes under GPL-3.0-or-later.

The upstream source is pinned to commit `b13df028f3cce1f84792f7043b57bf5cea3a3e4c`. Download its complete source archive from [QL-Win/QuickLook](https://codeload.github.com/QL-Win/QuickLook/zip/b13df028f3cce1f84792f7043b57bf5cea3a3e4c). The required archive SHA256 is:

```text
bfa2d2bfa00ff9ea0a44a989cacc1d9f0b5241d7ad59126d305dc45cca56616a
```

## Rebuild locally

Use Windows PowerShell 5.1 or newer, Git, an existing Visual Studio MSBuild 17.14 installation with Roslyn 4.14, and the already installed .NET Framework 4.8 WPF runtime assemblies. Point `QuickLookRoot` at a local extracted official QuickLook 4.5.0 portable directory. It supplies `QuickLook.Common.dll`, `QuickLook.Plugin.ImageViewer.dll` and `PdfiumViewer.dll`; no NuGet packages or network restore are used.

From the repository root:

```powershell
& .\native\quicklook-compat\Build-PdfCompatibility.ps1 `
  -SourceArchive 'C:\qa\QuickLook-b13df028f3cce1f84792f7043b57bf5cea3a3e4c.zip' `
  -QuickLookRoot 'C:\qa\QuickLook-4.5.0' `
  -OutputDirectory 'C:\qa\notchy-pdf-compat-build'
```

The paths above are examples. `OutputDirectory` must not exist. `ZipPath` optionally overrides the default `native/bin/QuickLookPdfCompatibility.zip` when the tracked recipe is run from this directory. The script preserves the supplied engine and never installs, launches, stops or patches an application in place.

The recipe verifies the source archive, extracts only the PDFViewer source directory, copies the adjacent CompactHtmlPlugin.cs, applies the adjacent patch with `git apply`, and generates the project and assembly version source inline. It builds with local references and checks the resulting DLL against `manifest.json`'s `patched_dll_sha256`. A mismatch stops packaging instead of silently changing the manifest.

The tested compiler is MSBuild `17.14.40.60911` with Roslyn file version `4.1400.25.41206`. The generated project enables deterministic compilation and maps its staging source path to `/notchy-pdf-compat`. The assembly keeps version `4.5.0.0`, uses file version `4.5.0.2`, and carries the `4.5.0-notchy-pdf-html-compat.2` informational version and `pdf-layout-disposal-v1;html-compact-v1` compatibility marker.

## Package contents and license

The ZIP contains exactly these eight flat files, sorted by ordinal filename with entry timestamps fixed at 1980-01-01:

- `Build-PdfCompatibility.ps1`
- `CompactHtmlPlugin.cs`
- `Test-CompactHtml.ps1`
- `LICENSE-GPL.txt`
- `PdfViewerControl.xaml.cs.patch`
- `QuickLook.Plugin.PDFViewer.dll`
- `README.md`
- `manifest.json`

`LICENSE-GPL.txt`, the patch, pinned source archive and complete build recipe accompany the modified GPL PDFViewer binary. The manifest records the source and upstream/patched binary hashes without timestamps or machine-specific paths. OfficeViewer source is separately MIT-licensed; its Syncfusion runtime components have their own proprietary license. Neither that source license nor Notchy's license changes the GPL license of this modified PDFViewer plugin.

A visible QuickLook window can still be loading. Native routing checks must be combined with the compatibility component tests, exception-log checks and a visual review before claiming that a document rendered successfully.

## Compact HTML initial bounds

`CompactHtmlPlugin` (Notchy contributors, 2026-10-22, GPL-3.0-or-later) has priority 1 over the official HtmlViewer's priority 0. It delegates supported extensions, rendering, cleanup and menus to that original viewer. The HTML renderer and Office/Syncfusion binaries are not rebuilt or modified.

Each new HTML preview starts with content fitted from 800 by 520 DIPs to 70% of the active monitor work area, unless the user has explicitly entered F11 fullscreen. A single dispatcher callback restores normal compact outer bounds after QuickLook applies its remembered manual size. There are no permanent resize handlers, maximum-size constraints or repeating timers: manual resize/maximize works after opening. Cleanup cancels pending callbacks so they cannot affect the next plugin. Notchy's internal sandboxed HTML iframe is a separate path and is unchanged.

Run the STA component self-check (does not preview a file or show a window):

```powershell
& .\native\quicklook-compat\Test-CompactHtml.ps1 `
  -QuickLookRoot 'C:\qa\QuickLook-4.5.0' `
  -OutputDirectory 'C:\qa\compact-html-check'
```

The check covers routing, bounded initial size, navigation from maximized/large state, unrestricted manual maximize/resize, preservation of explicit F11 fullscreen and disposal cancellation. Visual/native QA is still required on Explorer/Desktop with multiple monitor DPI scales. The wrapper recognizes upstream F11 through its public borderless/non-resizable window properties and skips its compact-size correction in that mode; it never changes QuickLook's private fullscreen state.
