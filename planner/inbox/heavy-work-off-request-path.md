---
title: Keep heavy work off the request path
---

`export_all_data` builds the whole ZIP in memory, and bulk imports and recipe fetches run inside the request, which blocks other requests while they run. Stream the export and move long jobs to a worker or a job table before many households share one deploy.
