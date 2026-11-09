import { expect, test } from "bun:test";
import * as timers from "node:timers/promises";
import { setTimeout as pause } from "node:timers/promises";

test("sleeps", async () => {
    await Bun.sleep(10);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await new Promise((resolve) => globalThis.setTimeout(resolve, 10));
    const ticker = setInterval(() => {}, 10);
    clearInterval(ticker);
    let ready = false;
    while (!ready) {
        await Bun.sleep(5);
        ready = true;
    }
    await pause(10);
    await timers.setTimeout(10);
    expect(ready).toBe(true);
});
