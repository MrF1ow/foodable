# Design exports

`figcraft-variables.json` is a committed snapshot of the FigCraft variable collections **Theme** and **Tokens** from `Foodable Design.figcraft`. The `.figcraft` file is read-only in the repo workflow; regenerate this JSON only by re-exporting from the design file.

`scripts/export-figcraft-variables.ts` streams `document.json` out of the design zip (no FigCraft write APIs) and writes `design/figcraft-variables.json`. Default path: `~/Projects/designs/Foodable/Foodable Design.figcraft`. Override with an explicit path argument:

```bash
bun scripts/export-figcraft-variables.ts [path-to.figcraft]
```

After the export changes, update `src/tokens.ts` (`V2_*` and `renderV2TokensCss`) to match, then run `bun run gen:tokens`. `src/tokens-v2.test.ts` compares the module to the JSON and fails if either the generated `public/app/v2/tokens.css` drifts.
