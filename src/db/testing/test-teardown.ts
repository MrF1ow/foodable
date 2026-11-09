// Preloaded by `bun test` (bunfig.toml). bun test fires no process `exit`
// event, so this global afterAll is what stops the shared test Postgres and
// deletes its folder at the end of a normal run. A run that is killed instead
// is cleaned up by each cluster's reaper, or by the sweep on the next run.
import { afterAll } from "bun:test";
import { stopAllTempPostgres } from "./pg-temp.js";

afterAll(() => {
    stopAllTempPostgres();
});
