---
id: PG-3
title: "Drop the single-column indexes replaced by #142"
status: done
priority: med
size: XS
type: contract
areas: [db]
after: []
plan: null
prs: [197]
---

The single-column `user_id` indexes are covered by the `(user_id, logged_at, id)` composites from `20261102120000_hot_query_indexes.sql`. The single-column `logged_at` indexes are not a leading prefix of those composites, so they stay.
