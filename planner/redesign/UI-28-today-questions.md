---
id: UI-28
title: "Today and logging: open questions"
status: decide
priority: high
size: XS
type: decision
areas: [nutrition]
after: []
plan: null
prs: []
---

Is a Today row a meal or a food? Should meals of the day be configurable (today a fixed four)? Week-strip dot colours. Viewing another member's day. What "ate some" takes on a fridge swipe.

Decided 2026-11-08, following FigCraft wherever it shows the answer:

- **A Today row is one log** (one `meals` row). Logging from the app makes one log per food or recipe, so rows look exactly like FigCraft. An agent's tool call decides the grouping: separate logs are separate rows; one meal with several items is one row ("Eggs & toast") with its items on the line under it and the meal's P/C/F, and its edit sheet lists each item's amount. FigCraft does not show that state yet; build it as close to the single-food row and sheet as possible.
- Meals of the day stay the fixed four.
- Week-strip dots (FigCraft): accent green = on target, the calories orange = logged but off target, track grey = nothing logged. On target means within 120 kcal of that day's goal (FigCraft's Trends legend, "Near goal" vs "Off by 120+").
- Viewing another member's day lives in Settings › Household › member.
- A fridge swipe-right ("ate some") opens the amount sheet with one usual portion filled in.
- Photo of meal is a follow-up after the redesign (inbox), with no images stored.
