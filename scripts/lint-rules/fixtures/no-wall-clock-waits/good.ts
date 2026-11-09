import { expect, test } from "bun:test";
import { setTimeout as pause } from "node:timers/promises";

test("awaits the thing itself", async () => {
    // A zero delay only yields to the event loop; it waits for no time.
    await new Promise((resolve) => setTimeout(resolve, 0));
    // A missing delay is a zero delay.
    await new Promise((resolve) => setTimeout(resolve));
    await pause(0);
    await Bun.sleep(0);
    const done = new Promise<number>((resolve) =>
        queueMicrotask(() => resolve(1)),
    );
    expect(await done).toBe(1);
    const clock = { sleep: (n: number) => n };
    expect(clock.sleep(3)).toBe(3);
    const sleeper = { Bun: { sleeping: true } };
    expect(sleeper.Bun.sleeping).toBe(true);
});
