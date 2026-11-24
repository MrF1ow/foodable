// The flicker check's analysis and the preview shots' page list are scripts,
// not app code; their rules are pinned here with the app's other tests.
import { describe, expect, test } from "bun:test";
import {
    analyse,
    skipsMissingNav,
    type Nav,
} from "../../scripts/flicker-check";
import { layoutOf } from "../../scripts/app-preview-shots";

const frame = (t: number, over: Record<string, unknown> = {}) => ({
    t,
    doc: "D1",
    gen: 1,
    ready: "complete",
    main: true,
    kids: 5,
    opMax: 1,
    opMin: 1,
    fx: true,
    theme: "",
    bg: "rgb(251, 250, 247)",
    path: "/settings",
    ...over,
});
const dark = { theme: "dark", bg: "rgb(13, 15, 14)" };

describe("flicker-check analysis", () => {
    test("a theme change on the same body is checked: one flip is fine, a dimmed frame or a second flip fails", () => {
        const clean = analyse(
            {
                frames: [frame(0), frame(10), frame(20, dark), frame(30, dark)],
                marks: [{ label: "nav", t: 5 }],
                paints: [],
            },
            "nav",
            { firstLoad: false },
        );
        expect(clean.bodies).toBe(1);
        expect(clean.blank).toEqual([]);
        expect(clean.flips).toEqual([]);

        const flash = analyse(
            {
                frames: [
                    frame(0),
                    frame(10),
                    frame(20, { ...dark, opMax: 0, opMin: 0 }),
                    frame(30, { opMax: 0, opMin: 0 }),
                    frame(40, dark),
                ],
                marks: [{ label: "nav", t: 5 }],
                paints: [],
            },
            "nav",
            { firstLoad: false },
        );
        expect(flash.blank).toHaveLength(1);
        expect(flash.flips.map((f) => f.kind)).toEqual([
            "background flip",
            "theme attribute flip",
        ]);
    });

    test("a Turbo visit is shown only when every child is at full strength", () => {
        const r = analyse(
            {
                frames: [
                    frame(0, { path: "/settings" }),
                    frame(20, { gen: 2, opMin: 0, path: "/settings/account" }),
                    frame(30, { gen: 2, path: "/settings/account" }),
                ],
                marks: [{ label: "nav", t: 10 }],
                paints: [],
            },
            "nav",
            { firstLoad: false },
        );
        expect(r.blank).toHaveLength(1);
    });

    test("an optional navigation that is missing fails on the head and is n/a only on a baseline", () => {
        const nav: Nav = {
            name: "x",
            start: "/",
            click: ["a"],
            optional: true,
        };
        expect(skipsMissingNav(nav, true)).toBe(true);
        expect(skipsMissingNav(nav, false)).toBe(false);
        expect(skipsMissingNav({ ...nav, optional: false }, true)).toBe(false);
    });
});

describe("preview shot windows", () => {
    test("the retired Display and Export pages are not in the tall list; Settings home still is", () => {
        expect(layoutOf("settings-display-light")).toBe("fixed");
        expect(layoutOf("settings-export-dark")).toBe("fixed");
        expect(layoutOf("settings-light")).toBe("tall");
    });
});
