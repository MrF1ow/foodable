---
id: CLN-10
title: Use the household timezone for "today" in expiry and notices
status: todo
priority: med
size: S
type: improvement
areas: [fridge, household]
after: []
plan: docs/restock-plan.md
prs: []
---

#189 added `householdTimezone(prefs, ownerProfile)`, and only the restock run (#191) uses it. Expiry still works out "today" in UTC (`utcTodayFromDate`), in `noticesFor`, `get_fridge` and the fridge page, so an item can read as expired, or "expires tomorrow", a few hours early or late in the evening. Move those readers, and any notice sentence that names a day, onto the household timezone.
