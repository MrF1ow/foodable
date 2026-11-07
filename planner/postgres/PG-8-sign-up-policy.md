---
id: PG-8
title: "v2.5 Sign-up policy setting and `household_id` indexes"
status: todo
priority: low
size: M
type: improvement
areas: [db]
after: []
plan: null
prs: []
---

The single-household checks become a sign-up policy (`closed`, `invite`, `open`; default `closed`), and every filtered `household_id` column gets an index.
