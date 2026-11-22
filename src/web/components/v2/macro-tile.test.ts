import { describe, expect, test } from "bun:test";
import * as macroTileModule from "./macro-tile.js";
import { macroTiles, type MacroTileOptions } from "./macro-tile.js";
import { XSS, XSS_ESCAPED } from "./test-helpers.js";

/** One tile, through the only entry point: the group's inner markup. */
const macroTile = (tile: MacroTileOptions) =>
    String(macroTiles({ label: "Macros", tiles: [tile] }))
        .replace(/^<dl[^>]*>/, "")
        .replace(/<\/dl>$/, "");

test("the single tile is not exported; macroTiles is the entry point", () => {
    expect("macroTile" in macroTileModule).toBe(false);
    expect("macroTiles" in macroTileModule).toBe(true);
});

describe("macroTile (Macro tile, FigCraft 172344)", () => {
    test("kcal: a calories dot, the label and the value", () => {
        expect(macroTile({ kind: "kcal", value: "248" })).toBe(
            '<div class="fd-macro-tile fd-macro-tile--kcal"><dt class="fd-macro-tile__label"><span class="fd-dot fd-dot--calories fd-dot--sm" aria-hidden="true"></span>kcal</dt><dd class="fd-macro-tile__value">248</dd></div>',
        );
    });

    test("each kind has its own dot and default label", () => {
        const expected = {
            kcal: ["calories", "kcal"],
            protein: ["protein", "Protein"],
            carbs: ["carbs", "Carbs"],
            fat: ["fat", "Fat"],
        } as const;
        for (const [kind, [dot, label]] of Object.entries(expected)) {
            const html = macroTile({
                kind: kind as keyof typeof expected,
                value: "1 g",
            });
            expect(html).toContain(`fd-macro-tile--${kind}`);
            expect(html).toContain(`fd-dot--${dot}`);
            expect(html).toContain(`</span>${label}</dt>`);
        }
    });

    test("a label can be overridden", () => {
        expect(
            macroTile({ kind: "protein", value: "1 g", label: "Prot" }),
        ).toContain("</span>Prot</dt>");
    });

    test("an unknown value is a dash, zero stays zero", () => {
        const unknown = macroTile({ kind: "carbs", value: null });
        expect(unknown).toContain("—");
        expect(unknown).toContain("no data");
        expect(macroTile({ kind: "carbs", value: "0 g" })).toContain(">0 g<");
    });

    test("escapes the value, label and class", () => {
        const html = macroTile({
            kind: "fat",
            value: XSS,
            label: XSS,
            className: XSS,
        });
        expect(html).not.toContain("<script>");
        expect(html.split(XSS_ESCAPED).length - 1).toBe(3);
    });
});

describe("macroTiles (FigCraft 172345)", () => {
    test("a named list of tiles", () => {
        const html = String(
            macroTiles({
                label: "Macros",
                tiles: [
                    { kind: "kcal", value: "248" },
                    { kind: "protein", value: "47 g" },
                    { kind: "carbs", value: "0 g" },
                    { kind: "fat", value: "5 g" },
                ],
            }),
        );
        expect(
            html.startsWith('<dl class="fd-macro-tiles" aria-label="Macros">'),
        ).toBe(true);
        expect(html.match(/fd-macro-tile fd-macro-tile--/g)?.length).toBe(4);
    });

    test("escapes the name", () => {
        const html = String(macroTiles({ label: XSS, tiles: [] }));
        expect(html).toContain(XSS_ESCAPED);
    });
});

test("a negative amount is unknown, as in the macro bar", () => {
    const html = macroTile({ kind: "kcal", value: -120 });
    expect(html).not.toContain("-120");
    expect(html).toContain("no data");
});
