---
id: BAR-1
title: Pick the barcode decoder
status: decide
priority: med
size: S
type: decision
areas: [web]
after: []
plan: null
prs: []
---

The browser's native `BarcodeDetector` where it exists, with a bundled library as the fallback. Check iOS Safari support and the current libraries when this is picked. Bundled into `/app.js`, no CDN.
