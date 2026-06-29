# ADR-0012 — PDF.js renderer, not the native webview viewer

**Status:** Accepted
**Date:** 2026-06-23

## Context

The PDF reader must display PDFs inside a pane. The obvious-looking path is to point an `<iframe>`/`<embed>` at the file via the Tauri asset protocol (`convertFileSrc`) and let the OS webview render it. That relies on each platform's webview shipping a built-in PDF viewer. We ship to all three Tauri targets (confirmed in `release.yml`: macOS aarch64 + x86_64, ubuntu-22.04, windows-latest):

- **Windows** (WebView2 / Chromium): built-in PDF viewer. ✅
- **macOS** (WKWebView): does not reliably render PDFs inline in an iframe. ⚠️
- **Linux** (WebKitGTK): no built-in PDF viewer at all. ❌

## Decision

Render PDFs with **PDF.js (`pdfjs-dist`)** — pure JS/canvas — behind a Grimoire-styled minimal viewer. Do not use the native webview viewer.

## Rationale

- **Cross-platform identity.** PDF.js renders identically on every webview; the native path is broken on Linux and flaky on macOS, which is disqualifying for a tool shipped to all three.
- **Viewer control.** We own the chrome, so the viewer reads as Grimoire (restrained, themed) rather than a grey browser toolbar — and we set the initial state we want (100% zoom by default, not fit-width).
- **Roadmap fit.** PDF.js's text layer gives in-tab find and text selection for free, and is the natural substrate for the future annotation feature. (PDF full-text *indexing* for global search is separate, Rust-side text extraction.)

## Consequences

- ~1–2 MB added to the bundle (the `pdfjs-dist` worker + library). Accepted for a desktop app delivered by the Tauri updater.
- We render lazily, page-by-page as pages scroll into view, so large/many-page documents stay responsive.
- We own the viewer's failure states (corrupt PDF, password-protected → shown as unsupported in v1) rather than inheriting the webview's.
