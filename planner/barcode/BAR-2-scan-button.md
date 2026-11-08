---
id: BAR-2
title: "Camera scanner in the log sheet and top bar, landing on the Product screen (`barcode-camera`)"
status: todo
priority: med
size: M
type: feature
areas: [foods, web]
after: [BAR-1, UI-10, UI-26]
plan: null
prs: []
---

Opens the camera from the log sheet (phone) or the scan button (desktop top bar), decodes EAN/UPC and opens the Product screen (UI-26); anything already in the fridge shows first. "Type the number instead" is always there. Flag `barcode-camera`, kept afterwards as a kill switch. Camera access needs HTTPS or localhost; the torch button only where supported.
