---
id: BAR-1
title: Pick the barcode decoder
status: decide
priority: high
size: S
type: decision
areas: [web]
after: []
plan: null
prs: []
---

The browser's native `BarcodeDetector` where it exists, with a bundled WebAssembly decoder (ZXing) as the fallback, bundled into `/app.js`, no CDN. As of 2026-11-07 iOS Safari still ships `BarcodeDetector` off by default, so the fallback is what iPhones use; check current support and libraries when this is picked.
