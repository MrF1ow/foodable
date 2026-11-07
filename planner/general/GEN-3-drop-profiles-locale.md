---
id: GEN-3
title: "Drop the unread `profiles.locale`"
status: done
priority: low
size: XS
type: contract
areas: [db]
after: []
plan: null
prs: [197]
---

Unread since the app went English-only. Drop it in a contract migration, together with the field on the `Profile` type.
