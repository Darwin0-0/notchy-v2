# Isolated Office preview

Copyright (C) 2026 Notchy contributors. GPL-3.0-or-later; see LICENSE-GPL.txt.

This optional QuickLook 4.5.0 proxy keeps its parent UI responsive while the unchanged,
separately installed official QuickLook OfficeViewer plug-in renders the document in
a dedicated .NET Framework 4.8 WPF worker. No Syncfusion assembly, key or modified
OfficeViewer binary is distributed here. Rendering and licensing remain with the
official installed plug-in, invoked through its IViewer interface. Read-only document
properties are inspected to distinguish asynchronous loading from a usable frame.

## Build

Use an already installed Visual Studio Roslyn compiler and .NET Framework 4.8:

```powershell
./Build-OfficePreview.ps1 -QuickLookRoot '<existing QuickLook directory>' -OutputDirectory '<new build directory>'
```

The generated ZIP contains the proxy, worker, worker runtime configuration, these
corresponding sources, this recipe, GPL license and a SHA-256 manifest. It contains
no QuickLook or Office/Syncfusion renderer binary. The ABI reference remains external.

## Broker contract

The supervising Notchy Rust process creates `NotchyBroker.json` next to the proxy:
`{"pipe":"\\\\.\\pipe\\<local name>","secret":"<64 hex characters>","pid":123}`.
An absent/invalid config disables interception; the optional pid must still exist.
The local named pipe accepts one UTF-8 JSON request/reply per connection. Every
request includes `secret`. Requests are `open` (id, path, width, height), `status`
(id), or `close` (id). IDs are 32 hexadecimal characters. Responses contain `phase`
(`loading`, `ready`, `error`, `closed`), nullable decimal-string `hwnd`, optional
`cachePath` (a validated local PNG), and optional user-safe `error` text.

The proxy connects asynchronously (400 ms connection timeout), polls at 80 ms and
never waits on its UI thread. Cleanup cancels pending polling and independently
requests close for that exact session. Cached first-viewport images stay marked as
saved previews until the interactive worker is ready; this is not an instant full
workbook cache. The broker owns validation, ACLs, cache invalidation and eviction,
session cancellation, resource limits, and the process Job Object.

Worker positional arguments are QuickLook root, official Office plug-in directory,
source path, unique pending PNG path, viewport width and viewport height. It waits
for `start\n` on stdin before loading plug-in or document, so the broker can attach
resource limits first. Stdout emits `loading` with HWND before parsing, then `ready`
only after WPF layout/render turns and atomic PNG creation. Stderr contains error
type/HRESULT only, never document contents. Parent must not parse stdout as success
until a matching valid PNG and a ready message both exist. Parent must terminate
the owned job on timeout, failed open, cancellation, or Notchy exit.

## Interaction and limits

The live worker is hosted as a native child window; no document HTML or scripting
is injected into Notchy. Esc/Space from the worker request close through QuickLook's
existing current-user pipe. Worker resizing uses asynchronous SetWindowPos so a
busy renderer cannot block the proxy. The ordinary renderer still loads a full
workbook; this implementation contains that work rather than pretending that a
small displayed viewport is a partially parsed workbook. Its cache accelerates
the initial image, and interactive loading remains bounded by the supervisor.

Verify native DPI/resize, close and switch during parse, real Word/PPT/Excel layout,
images/charts, cache invalidation and large/malformed workbooks before distribution.
