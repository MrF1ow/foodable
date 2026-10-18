import { test, expect } from "bun:test";
import {
    appScriptHref,
    appStylesheetHref,
    getAppCss,
    getAppJs,
} from "./widgets.js";
import { appHead } from "./web/shell.js";

test("app asset hrefs are content-versioned after warm assembly", async () => {
    await getAppCss();
    await getAppJs();
    const css = appStylesheetHref();
    const js = appScriptHref();
    expect(css).toMatch(/^\/app\.css\?v=[a-f0-9]{12}$/);
    expect(js).toMatch(/^\/app\.js\?v=[a-f0-9]{12}$/);
    const head = appHead("Test", "system");
    expect(head).toContain(`href="${css}"`);
    expect(head).toContain(`src="${js}"`);
});

test("app asset hashes change when bundle content changes", async () => {
    const cssA = await getAppCss();
    const hashA = appStylesheetHref();
    const jsA = await getAppJs();
    const jsHashA = appScriptHref();
    expect(hashA).toContain("?v=");
    expect(jsHashA).toContain("?v=");
    expect(cssA.length).toBeGreaterThan(100);
    expect(jsA.length).toBeGreaterThan(100);
    expect(hashA).not.toBe(jsHashA);
});
