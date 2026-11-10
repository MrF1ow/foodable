import * as bt from "bun:test";
import { mock } from "bun:test";

// Not a sanctioned window: this file must not stub a db module.
mock.module("../../../../src/db/tokens.js", () => ({}));
mock.module("../../../../src/db/sql", () => ({}));
mock.module("../../../../src/db/testing/pg.js", () => ({}));
bt.mock.module("../../../../src/db/users.js", () => ({}));
