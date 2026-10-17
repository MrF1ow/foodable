// Writes public/widgets/src/shared/tokens.css from src/tokens.ts:
//
//   bun run gen:tokens
//
// src/tokens.test.ts fails when the committed file differs from what this
// would write, so an edit to the stylesheet instead of the module is caught.
import { renderTokensCss } from "../src/tokens.js";

const path = "public/widgets/src/shared/tokens.css";
await Bun.write(path, renderTokensCss());
console.log(`wrote ${path}`);
