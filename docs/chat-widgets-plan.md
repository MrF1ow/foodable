# Chat widgets v2: plan

Status: proposed 2026-11-08. Planner project: [WID](../planner/chat-widgets/). Separate from the [app redesign](./redesign-plan.md).

The MCP Apps widgets (`ui://` resources returned by tools) move to the app's look and gain six new cards. They are only for MCP: the household web app never shows them, and its pages stop embedding them when the old app is retired (UI-27). Design: the "Chat widgets" page of Foodable Design, every card in host-light and host-dark at chat width.

## Rules

- **Style.** The green-tinted Theme palette, following the host's light/dark (`hostContext.theme`, already applied by `bridge.js`). The same gauge, macro bars, rings, hairline rows and chips as the app. Text uses the system font; no inlined Geist or Bricolage. An optional digits-only Bricolage subset for big numbers is a decision (WID-7). This replaces the "neutral widgets" rule: `src/app-brand.test.ts`, the CLAUDE.md widget notes and `public/widgets/STYLE_GUIDE.md` change with WID-5.
- **Size.** About 60 KB raw and 20 KB gzipped per widget, enforced by a test (WID-4). Measured 2026-11-07: nutrition-summary 117 / 37 KB, goal-progress 110 / 35, meal-logged 104 / 33, trends 113 / 36, weight-trends 63 / 20, import-meals 148 / 39, grocery-list 53 / 17, fridge 49 / 16. Whitespace and comment removal alone brings all but import-meals under budget (import-meals about 66 / 21). `WIDGET_STRINGS` (9 KB) is inlined whole into every widget today.
- **Shared geometry.** Gauge, ring and bar maths live in one pure module under `src/` (UI-4), brought into widgets with `@inlinets`, so the app and the widgets draw from the same tested code.
- **Flags.** `mcp-widgets-v2` serves the restyled widgets at new `ui://widget/v2/<name>.html` URIs beside the old ones (hosts cache resources by URI), and `uiMeta` picks the URI per caller. Output schemas only gain fields, so they stay valid for both. Each new widget has its own flag; new tools are gated so `tools/list` follows the flag and the snapshot pins the all-on list. Rollout is by account, not by AI host: tokens carry no client yet.

## The set

| Widget                                        | Tool                                         | Needs                                         |
| --------------------------------------------- | -------------------------------------------- | --------------------------------------------- |
| nutrition-summary, goal-progress, meal-logged | existing                                     | WID-6                                         |
| trends, weight-trends                         | existing                                     | WID-6, streak helpers                         |
| grocery-list, fridge                          | existing; output gains store, product, usual | WID-6, UI-11                                  |
| import-meals                                  | existing                                     | trimmed to budget                             |
| Needs attention digest                        | `list_notices` gains an output schema        | Dismiss calls `dismiss_notice`                |
| Use soon                                      | `list_expiring` gains an output schema       | UI-19's domain function                       |
| Recipe card with Cook                         | `get_recipe` gains an output schema          | UI-20's `cookPreview`; confirm before cooking |
| Product score                                 | `rate_product` (SCORE-6, new)                | SCORE-2, SCORE-4                              |
| Restock nudge                                 | `list_usuals` (new)                          | UI-18                                         |
| Week plan                                     | plan tools (new)                             | UI-21                                         |

New tools update `TOOLS` in `src/copy/tools.ts` and `src/mcp/tools-list.snapshot.json` in the same PR.

## Open questions

WID-19: whether import-meals gets a named size allowance; a confirm step and servings on the Recipe card's Cook; whether the week-plan and grocery widgets write (plan, tick off) or only read; when agents should call the restock nudge; extending `list_expiring` versus a new tool; keeping `set_widget_display` as is.
