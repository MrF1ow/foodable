# Foodable roadmap

Foodable is one household's food system: what everyone eats, what is in the fridge, what to buy, and what to cook, run by the household's own AI agents and a small web app. This page is the big picture. Every item, with its status, priority and size, is a file in [planner/](planner/), and `bun run planner --next` says what to work on.

## Where it is heading

1. **Fewer loose ends in the food data.** One food per real food, every warning shown the same way, and the grocery list filling itself from what runs out.
2. **Nutrition over time, not just today.** A calendar with goals that can differ by day.
3. **Less typing.** Scan barcodes, import recipes from links, share recipes instead of re-entering them.
4. **A deploy that is safe to change.** Staging before production, and features that ship switched off.

## Projects

| Project                                          | What it is for                                                                   |
| ------------------------------------------------ | -------------------------------------------------------------------------------- |
| [Cleanup, notices and restock](planner/cleanup/) | Merge duplicate foods, one model for warnings, expiring food back on the list    |
| [Nutrition calendar](planner/calendar/)          | A month view with a goal per day                                                 |
| [Postgres](planner/postgres/)                    | Cleanup from the move off Supabase, then row level security as the real boundary |
| [Barcode scanning](planner/barcode/)             | Scan with the phone camera instead of typing digits                              |
| [Sharing](planner/sharing/)                      | Share a recipe or list by link, or send a recipe to another deploy               |
| [Staging and feature flags](planner/staging/)    | A staging deploy first, and features that ship dark                              |
| [Recipe import](planner/recipe-import/)          | Shipped; optional ideas left                                                     |
| [General](planner/general/)                      | Single items too small for a project                                             |

New ideas start in [planner/inbox/](planner/inbox/) and join a project once they are decided. Bugs are [GitHub issues](https://github.com/MrF1ow/foodable/issues). How items are written and closed: [planner/README.md](planner/README.md).

## Shipped

- Recipe import from links, captions and the phone share sheet (#165–#175)
- Usual products: one plain food, many brands (#156–#164)
- Own Postgres and auth, off Supabase (#129–#145)
- Hosted on Railway with Railway Postgres, with an optional Cloudflare domain ([self-hosting.md](docs/self-hosting.md))

## Not planned

Public sign-up, billing, a marketing site, translations, and per-user theming beyond the one accent (see `CONTRIBUTING.md`, "Out of scope").

In-app photo meal estimation: the household's chat agents already log a plated meal from a photo through `log_meal`. A server-side vision call would add an API key, a per-photo cost and image storage for something that already works. Improvements go in the `log_meal` / `search_meals` tool descriptions.

Multi-household hosting: not planned, but Postgres v2 keeps it possible.
