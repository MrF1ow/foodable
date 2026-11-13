import { expect, test } from "bun:test";
import { findPlaywrightCore } from "../../../../scripts/sheet-tap-repro.js";

// Opt-in: drives the real assembled /app-v2.js + /app-v2.css in Playwright
// WebKit (touch) and Chromium (mouse). Playwright is not a dependency, so this
// only runs when SHEET_TOUCH=1 and a playwright-core 1.65.x is found (see
// scripts/sheet-tap-repro.ts for PLAYWRIGHT_CORE / WEBKIT_BIN).
const enabled =
    process.env.SHEET_TOUCH === "1" && findPlaywrightCore() !== null;

for (const engine of ["webkit", "chromium"]) {
    test.skipIf(!enabled)(
        `backdrop taps close a sheet in ${engine}`,
        async () => {
            const proc = Bun.spawn(
                ["bun", "--no-env-file", "scripts/sheet-tap-repro.ts", engine],
                { stdout: "pipe", stderr: "pipe" },
            );
            const [out, code] = await Promise.all([
                new Response(proc.stdout).text(),
                proc.exited,
            ]);
            expect(out).not.toContain("FAIL");
            expect(code).toBe(0);
        },
    );
}
