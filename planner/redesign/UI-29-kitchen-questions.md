---
id: UI-29
title: "Kitchen and usuals: open questions"
status: done
priority: high
size: XS
type: decision
areas: [grocery]
after: []
plan: null
prs: [208]
---

Where a usual's schedule lives (proposed: the plain food). What "low" means. Whether the expiring-food restock (CLN-2) stays beside schedules. A shopping day per store. Deleting a store with lines. Hidden sections and store rules. Whether Freeze changes expiry.

Decided 2026-11-08:

- A usual's schedule lives on the plain food.
- "Low" is a level set per usual ("below 6"), defaulting to a quarter of the usual amount.
- The expiring-food restock (CLN-2) stays, beside schedules, as its own source of list lines.
- No per-store shopping day for now; one household restock day.
- Deleting a store with lines on the list asks: move the N lines to the default store, or delete the store and its N lines. A store with no lines is deleted after a normal confirm.
- Hidden sections and store rules stay, on the store's own page.
- Freeze moves the item to the Freezer and sets a new expiry, keeping the original bought, put-away or made date (`purchasedOn`, `openedOn`).
