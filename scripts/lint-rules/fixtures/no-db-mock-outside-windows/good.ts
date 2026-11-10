import * as bt from "bun:test";
import { mock } from "bun:test";

// Not a db module, and not bun:test's mock either.
mock.module("../../../../src/copy/notices.js", () => ({}));
mock.module("./local.js", () => ({}));
bt.mock.module("../../../../src/copy/notices.js", () => ({}));
const local = { module: (_spec: string) => 1 };
local.module("../../../../src/db/tokens.js");
void mock;
