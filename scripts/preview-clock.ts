/**
 * The one instant every app-preview render reads, so two renders at different
 * hours or on different UTC dates give the same pixels. The server side pins
 * the process clock (`pinServerClock`); the page side shifts the browser's
 * `Date` by a constant (`pinBrowserClock`), so timers still advance.
 */
import { setSystemTime } from "bun:test";

/** The clock the preview pages read. */
export const PREVIEW_NOW = new Date("2026-11-12T18:00:00Z");

/**
 * Pin this process's clock to PREVIEW_NOW. `setSystemTime` comes from
 * `bun:test` but works in a plain bun process.
 */
export function pinServerClock(): void {
    setSystemTime(PREVIEW_NOW);
}

/**
 * The page script: `Date.now()` and `new Date()` with no arguments read the
 * page's real clock shifted by a constant, so the page starts at PREVIEW_NOW
 * and runs on from there. Dated constructors, `Date.parse` and `Date.UTC`
 * pass through, and `instanceof Date` still holds.
 */
const BROWSER_CLOCK_SCRIPT = `(function () {
    var Real = Date;
    var offset = ${PREVIEW_NOW.getTime()} - Real.now();
    var shifted = function () { return Real.now() + offset; };
    globalThis.Date = new Proxy(Real, {
        construct: function (target, args, newTarget) {
            return Reflect.construct(
                target,
                args.length === 0 ? [shifted()] : args,
                newTarget === undefined ? target : newTarget,
            );
        },
        apply: function () { return new Real(shifted()).toString(); },
        get: function (target, key) {
            if (key === "now") return shifted;
            return Reflect.get(target, key, target);
        },
    });
})();`;

/**
 * A blinking caret lands on a different frame from one render to the next, so
 * a focused input would flake a shot. Preview pages only, never app CSS.
 */
const PREVIEW_CARET_STYLE =
    "<style data-preview-caret>*,*::before,*::after{caret-color:transparent!important}</style>";

/**
 * Insert the browser clock (first script) and the caret style into the page's
 * `<head>`. A page with no `<head>` gets them after its doctype, else after
 * `<html …>`, else at the start; never before a doctype, which would drop the
 * page into quirks mode.
 */
export function pinBrowserClock(html: string): string {
    const tags = `<script data-preview-clock>${BROWSER_CLOCK_SCRIPT}</script>${PREVIEW_CARET_STYLE}`;
    const at =
        /<head(\s[^>]*)?>/i.exec(html) ??
        /<!doctype[^>]*>/i.exec(html) ??
        /<html(\s[^>]*)?>/i.exec(html);
    const end = at ? at.index + at[0].length : 0;
    return html.slice(0, end) + tags + html.slice(end);
}

/**
 * Pin the time zone of this process and of the Chromium it starts (a child
 * inherits the environment), since local-time reads such as `getHours()`
 * follow the host's TZ, not the pinned instant.
 */
export function pinTimeZone(): void {
    process.env.TZ = "UTC";
}
