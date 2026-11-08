# Foodable roadmap

Foodable is one household's food system: what everyone eats, what is in the fridge, what to buy, and what to cook, run by the household's own AI agents and a small web app. This page is the big picture. Every item, with its status, priority and size, is a file in [planner/](planner/), and `bun run planner --next` says what to work on.

## Where it is heading

1. **A new app, shipped carefully.** A mobile-first redesign with a desktop layout, released page by page behind feature flags to one account, then testers, then everyone, while the current app keeps working. The barcode scanner and the product score arrive as part of it. Plan: [redesign-plan.md](docs/redesign-plan.md).
2. **Built as if for many users.** Flags target accounts and households, stay consistent across the web app and MCP, and survive Railway being unreachable. Every migration is rehearsed on a copy of production data first; a staging environment follows once the redesign is finished.
3. **Chat widgets in the same look.** The MCP widgets restyled within a size budget, plus new cards, on their own track ([chat-widgets-plan.md](docs/chat-widgets-plan.md)).
4. **Fewer loose ends in the food data.** One food per real food, every warning shown the same way, and the grocery list filling itself from what you usually buy.
5. **Know what you are buying.** A scanned food's score, weighted the way you choose, and a warning for whoever in the house it does not suit.

## Projects

| Project                                            | What it is for                                                                                                    |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [Redesign of the household app](planner/redesign/) | The new app, page by page behind flags, then the old one retired                                                  |
| [Feature flags](planner/staging/)                  | Flags built for many users, and migrations rehearsed on production data; comes before the redesign. Staging later |
| [Chat widgets v2](planner/chat-widgets/)           | The MCP widgets in the app's look, within a size budget, plus new cards                                           |
| [Barcode scanning](planner/barcode/)               | The camera scanner, built into the redesign's log sheet                                                           |
| [Product score](planner/score/)                    | How good a food is, with your own weights, and what it means for each person                                      |
| [Cleanup, notices and restock](planner/cleanup/)   | Merge duplicate foods, one model for warnings, expiring food back on the list                                     |
| [Nutrition calendar](planner/calendar/)            | Per-day goals in MCP and the export; the month view moved to Trends                                               |
| [Postgres](planner/postgres/)                      | Cleanup from the move off Supabase, then row level security as the real boundary                                  |
| [Sharing](planner/sharing/)                        | Share a recipe or list by link, or send a recipe to another deploy                                                |
| [Recipe import](planner/recipe-import/)            | Shipped; optional ideas left                                                                                      |
| [General](planner/general/)                        | Single items too small for a project                                                                              |

New ideas start in [planner/inbox/](planner/inbox/) and join a project once they are decided. Bugs are [GitHub issues](https://github.com/MrF1ow/foodable/issues). How items are written and closed: [planner/README.md](planner/README.md).

## Shipped

- Recipe import from links, captions and the phone share sheet (#165–#175)
- Usual products: one plain food, many brands (#156–#164)
- Own Postgres and auth, off Supabase (#129–#145)
- Hosted on Railway with Railway Postgres, with an optional Cloudflare domain ([self-hosting.md](docs/self-hosting.md))

## Not planned

Public sign-up, billing, a marketing site, translations, and per-user theming beyond the one accent (see `CONTRIBUTING.md`, "Out of scope").

In-app photo meal estimation, and storing any images (recipe or food photos): the household's chat agents already log a plated meal from a photo through `log_meal`. A server-side vision call would add an API key, a per-photo cost and image storage for something that already works. Improvements go in the `log_meal` / `search_meals` tool descriptions.

Multi-household hosting: not built yet. Postgres v2 keeps it possible, and the feature flags and new tables are designed as if it were.
