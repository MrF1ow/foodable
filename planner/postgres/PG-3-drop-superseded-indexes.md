---
id: PG-3
title: "Drop the single-column indexes replaced by #142"
status: todo
priority: med
size: XS
type: contract
areas: [db]
after: []
plan: null
prs: []
---

The single-column `user_id` / `logged_at` indexes are covered by the composites from `20261102120000_hot_query_indexes.sql`.
