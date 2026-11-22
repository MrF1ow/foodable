import { describe, expect, test } from "bun:test";
import { emptyState } from "./empty-state.js";
import { raw } from "./html.js";
import { XSS, XSS_ESCAPED } from "./test-helpers.js";

describe("emptyState (FigCraft 381519)", () => {
    test("a title and a body, centred", () => {
        expect(
            String(
                emptyState({
                    title: "Nothing here yet",
                    body: "Things you add show up here",
                }),
            ),
        ).toBe(
            '<div class="fd-empty-state"><p class="fd-empty-state__title">Nothing here yet</p><p class="fd-empty-state__body">Things you add show up here</p></div>',
        );
    });

    test("the body and the action are optional", () => {
        const html = String(emptyState({ title: "Empty" }));
        expect(html).not.toContain("__body");
        expect(html).not.toContain("__action");
    });

    test("an action slot sits under the text", () => {
        const html = String(
            emptyState({ title: "Empty", action: raw('<a href="/x">Add</a>') }),
        );
        expect(html).toContain(
            '<div class="fd-empty-state__action"><a href="/x">Add</a></div>',
        );
    });

    test("escapes the text and the class", () => {
        const html = String(
            emptyState({ title: XSS, body: XSS, className: XSS }),
        );
        expect(html).not.toContain("<script>");
        expect(html.split(XSS_ESCAPED).length - 1).toBe(3);
    });
});
