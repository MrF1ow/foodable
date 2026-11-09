import { mock } from "bun:test";

// Listed under "allow" in the fixture config, so this window is fine for the
// module named there (src/db/tokens) ...
mock.module("../../../../src/db/tokens.js", () => ({}));
// ... but not for any other db module.
mock.module("../../../../src/db/sql.js", () => ({}));
