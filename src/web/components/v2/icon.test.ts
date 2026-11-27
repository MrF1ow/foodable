import { expect, test } from "bun:test";
import * as fdIcons from "../fd-icons.js";
import * as v2Icons from "./icons.js";
import { ICON_NAMES, icon } from "./icon.js";

// The names of the FigCraft `Icon/<name>` components (Components page), read
// from the design file. A new design icon is added here and in icon.ts.
const FIGCRAFT_ICONS = [
    "bell",
    "bolt",
    "book",
    "bookmark",
    "calendar",
    "camera",
    "cart",
    "check",
    "chevron-left",
    "chevron-right",
    "clock",
    "close",
    "code",
    "copy",
    "download",
    "drop",
    "eye",
    "filter",
    "fridge",
    "gauge",
    "help",
    "link",
    "minus",
    "more",
    "plus",
    "pot",
    "repeat",
    "ruler",
    "scale",
    "scan",
    "search",
    "share",
    "snowflake",
    "star",
    "sun",
    "target",
    "trash",
    "trend",
    "user",
    "users",
].sort();

test("IconName is the 40 FigCraft Icon/* components and the app's own warning glyph", () => {
    expect(FIGCRAFT_ICONS.length).toBe(40);
    expect([...ICON_NAMES].sort() as string[]).toEqual(
        [...FIGCRAFT_ICONS, "warning"].sort(),
    );
});

test("warning is a triangle with a bar and a filled dot, drawn like the other glyphs", () => {
    const svg = icon("warning");
    expect(svg).toStartWith(`<svg class="fd-icon fd-icon--warning"`);
    expect(svg).toContain(`stroke-width="1.8"`);
    expect(svg).toContain(`d="M12 4L21 19L3 19L12 4ZM12 10L12 14"`);
    expect(svg).toContain(
        `<path fill="currentColor" stroke="none" d="M11.1 16.5`,
    );
    expect(svg.match(/<path /g)?.length).toBe(2);
});

test("every icon draws on the 24 box, inherits currentColor and is decorative", () => {
    for (const name of ICON_NAMES) {
        const svg = icon(name);
        expect(svg).toStartWith(`<svg class="fd-icon fd-icon--${name}"`);
        expect(svg).toContain(`width="24" height="24" viewBox="0 0 24 24"`);
        expect(svg).toContain(`stroke="currentColor"`);
        expect(svg).toContain(`aria-hidden="true" focusable="false"`);
        expect(svg).toContain(`stroke-linecap="round"`);
        expect(svg).toEndWith("</svg>");
        expect(svg).toContain("<path ");
    }
});

test("the size argument sets width and height, never the viewBox", () => {
    const svg = icon("plus", 18);
    expect(svg).toContain(`width="18" height="18" viewBox="0 0 24 24"`);
});

test("stroke weight follows the design: 1.8, and 1.7 on the five nav-era glyphs", () => {
    expect(icon("plus")).toContain(`stroke-width="1.8"`);
    for (const name of ["scale", "pot", "fridge", "book", "trend"] as const) {
        expect(icon(name)).toContain(`stroke-width="1.7"`);
    }
});

test("plus is the design's cross", () => {
    expect(icon("plus")).toContain(`d="M12 5L12 19M5 12L19 12"`);
});

test("the dots of more, target and help fill with currentColor and no stroke", () => {
    const more = icon("more");
    expect(more).toContain(
        `<path fill="currentColor" stroke="none" d="M3.4 12`,
    );
    // The dots are the whole glyph: no stroked path.
    expect(more.match(/<path /g)?.length).toBe(1);
    expect(icon("target").match(/<path /g)?.length).toBe(2);
    expect(icon("help").match(/<path /g)?.length).toBe(2);
});

test("refresh, list, settings and log-out have no FigCraft icon", () => {
    for (const name of ["refresh", "list", "settings", "log-out", "logout"]) {
        expect(ICON_NAMES as readonly string[]).not.toContain(name);
    }
});

test("the two older icon modules still emit today's exact markup", () => {
    const parts: string[] = [];
    const mods = [
        ["fd-icons", fdIcons],
        ["v2/icons", v2Icons],
    ] as const;
    for (const [mod, exports] of mods) {
        for (const [key, value] of Object.entries(exports).sort(([a], [b]) =>
            a.localeCompare(b),
        )) {
            if (typeof value !== "function") {
                parts.push(`${mod}:${key}:${JSON.stringify(value)}`);
            } else if (key === "fdIcon") {
                for (const name of Object.keys(fdIcons.FD_ICON_PATHS)) {
                    parts.push(
                        `${mod}:${key}:${name}:${fdIcons.fdIcon(name as fdIcons.FdIconName)}`,
                    );
                }
            } else {
                parts.push(`${mod}:${key}:${(value as () => string)()}`);
            }
        }
    }
    expect(parts.length).toBe(15);
    const digest = new Bun.CryptoHasher("sha256")
        .update(parts.join("\n"))
        .digest("hex");
    expect(digest).toBe(
        "c3fa034e592d477731a50b4cbd57da2a4fbbe473601ca414711c7e7af166af5f",
    );
});

test("a stroked path keeps its weight when the icon is resized; dots keep scaling", () => {
    const small = icon("plus", 18);
    expect(small).toContain(
        `<path vector-effect="non-scaling-stroke" d="M12 5`,
    );
    expect(small).toContain(`stroke-width="1.8"`);
    // The filled dots have no stroke to hold, so they carry no such effect.
    expect(icon("more")).toContain(`<path fill="currentColor" stroke="none"`);
    expect(icon("more")).not.toContain("vector-effect");
});
