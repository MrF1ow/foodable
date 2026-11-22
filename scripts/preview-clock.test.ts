import { afterEach, describe, expect, test, setSystemTime } from "bun:test";
import vm from "node:vm";
import {
    PREVIEW_NOW,
    pinBrowserClock,
    pinServerClock,
    pinTimeZone,
} from "./preview-clock.js";

afterEach(() => setSystemTime());

/** The inserted script, run in a fresh realm so its Date is its own. */
function pinnedRealm(html: string): vm.Context {
    const match = /<script data-preview-clock>([\s\S]*?)<\/script>/.exec(html);
    if (!match) throw new Error("no clock script in the page");
    const realm = vm.createContext({});
    vm.runInContext(match[1]!, realm);
    return realm;
}

describe("pinServerClock", () => {
    test("makes new Date() and Date.now() read PREVIEW_NOW", () => {
        pinServerClock();
        expect(new Date().toISOString()).toBe("2026-11-12T18:00:00.000Z");
        expect(Date.now()).toBe(PREVIEW_NOW.getTime());
    });
});

describe("pinTimeZone", () => {
    test("local time reads as UTC whatever the host TZ was", () => {
        const before = process.env.TZ;
        try {
            process.env.TZ = "Pacific/Kiritimati";
            pinTimeZone();
            const at = new Date("2026-11-12T18:00:00Z");
            expect(process.env.TZ).toBe("UTC");
            expect(at.getHours()).toBe(18);
            expect(at.getDate()).toBe(12);
        } finally {
            if (before === undefined) delete process.env.TZ;
            else process.env.TZ = before;
        }
    });
});

describe("pinBrowserClock", () => {
    const page =
        "<!doctype html><html><head><title>x</title></head><body></body></html>";

    test("inserts the script first in <head>", () => {
        const out = pinBrowserClock(page);
        expect(
            out.indexOf("<head><script data-preview-clock>"),
        ).toBeGreaterThan(-1);
        expect(out).toContain("<title>x</title>");
    });

    test("hides the text caret, after the clock script", () => {
        const out = pinBrowserClock(page);
        const style =
            "<style data-preview-caret>*,*::before,*::after{caret-color:transparent!important}</style>";
        expect(out).toContain(style);
        expect(out.indexOf("data-preview-clock")).toBeLessThan(
            out.indexOf("data-preview-caret"),
        );
        expect(out.indexOf(style)).toBeLessThan(out.indexOf("<title>"));
    });

    test("handles <head> with attributes", () => {
        expect(
            pinBrowserClock('<html><head lang="en"><meta></head></html>'),
        ).toMatch(/<head lang="en"><script data-preview-clock>/);
    });

    test("with no <head>, goes after the doctype, never before it", () => {
        const out = pinBrowserClock("<!DOCTYPE html><p>bare</p>");
        expect(
            out.startsWith("<!DOCTYPE html><script data-preview-clock>"),
        ).toBe(true);
        expect(out.endsWith("<p>bare</p>")).toBe(true);
    });

    test("with no <head>, goes after <html …> when there is no doctype", () => {
        const out = pinBrowserClock('<html lang="en"><body>x</body></html>');
        expect(
            out.startsWith('<html lang="en"><script data-preview-clock>'),
        ).toBe(true);
    });

    test("with no head, doctype or html, is prepended", () => {
        expect(pinBrowserClock("<p>bare</p>")).toMatch(
            /^<script data-preview-clock>[\s\S]*<\/style><p>bare<\/p>$/,
        );
    });

    test("starts the page's Date at PREVIEW_NOW", () => {
        const realm = pinnedRealm(pinBrowserClock(page));
        const now = vm.runInContext("Date.now()", realm) as number;
        expect(Math.abs(now - PREVIEW_NOW.getTime())).toBeLessThan(1000);
        const iso = vm.runInContext(
            "new Date().toISOString()",
            realm,
        ) as string;
        expect(iso.startsWith("2026-11-12T18:00:0")).toBe(true);
    });

    test("keeps running: two reads of the pinned Date.now() advance", () => {
        const realm = pinnedRealm(pinBrowserClock(page));
        // Spin on the pinned clock itself until it has moved on 5 ms.
        const advanced = vm.runInContext(
            "var a = Date.now(); while (Date.now() - a < 5) {} Date.now() - a",
            realm,
        ) as number;
        expect(advanced).toBeGreaterThanOrEqual(5);
        const now = vm.runInContext("new Date().getTime()", realm) as number;
        expect(Math.abs(now - PREVIEW_NOW.getTime())).toBeLessThan(5000);
    });

    test("leaves dated constructors and statics alone", () => {
        const realm = pinnedRealm(pinBrowserClock(page));
        const run = (code: string) => vm.runInContext(code, realm);
        expect(run('new Date("2020-01-02T03:04:05Z").toISOString()')).toBe(
            "2020-01-02T03:04:05.000Z",
        );
        expect(run("new Date(0).getTime()")).toBe(0);
        expect(run("new Date(2020, 0, 2).getFullYear()")).toBe(2020);
        expect(run('Date.parse("2020-01-02T00:00:00Z")')).toBe(1577923200000);
        expect(run("Date.UTC(2020, 0, 2)")).toBe(1577923200000);
        expect(run("new Date() instanceof Date")).toBe(true);
        expect(run("Object.prototype.toString.call(new Date())")).toBe(
            "[object Date]",
        );
        expect(run("typeof Date()")).toBe("string");
    });
});
