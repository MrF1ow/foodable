// Writes the token stylesheets from src/tokens.ts:
//
//   bun run gen:tokens
//
// src/tokens.test.ts fails when either committed file differs from what this
// would write, so an edit to a stylesheet instead of the module is caught.
import { renderBrandCss, renderTokensCss } from "../src/tokens.js";

const OUTPUTS: [string, () => string][] = [
    ["public/widgets/src/shared/tokens.css", renderTokensCss],
    ["public/app/brand.css", renderBrandCss],
];

for (const [path, render] of OUTPUTS) {
    await Bun.write(path, render());
    console.log(`wrote ${path}`);
}
