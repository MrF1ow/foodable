import { describe, expect, test } from "bun:test";
import { avatarInitials } from "./avatar-initials.js";
import { XSS, XSS_ESCAPED } from "./test-helpers.js";

describe("avatarInitials (Avatar, FigCraft 171937)", () => {
    test("initials from a name, decorative by default", () => {
        expect(String(avatarInitials({ name: "Ethan Flow" }))).toBe(
            '<span class="fd-avatar-initials" aria-hidden="true">EF</span>',
        );
    });

    test("initials passed in are used as they are", () => {
        expect(
            String(avatarInitials({ initials: "MK", name: "Zed" })),
        ).toContain(">MK<");
    });

    test("a label makes it an image with that name", () => {
        const html = String(
            avatarInitials({ name: "Ethan Flow", label: "Ethan Flow" }),
        );
        expect(html).toContain('role="img" aria-label="Ethan Flow"');
        expect(html).not.toContain("aria-hidden");
    });

    test("needs a name or initials", () => {
        expect(() => avatarInitials({})).toThrow();
    });

    test("escapes the text, the label and the class", () => {
        const html = String(
            avatarInitials({ initials: XSS, label: XSS, className: XSS }),
        );
        expect(html).not.toContain("<script>");
        expect(html.split(XSS_ESCAPED).length - 1).toBe(3);
    });

    test("leaves the live .fd-avatar circle alone", () => {
        expect(String(avatarInitials({ name: "A B" }))).not.toContain(
            '"fd-avatar"',
        );
    });
});

describe("avatarInitials with empty initials", () => {
    test("empty or blank initials count as absent, so the name is used", () => {
        expect(
            String(avatarInitials({ initials: "", name: "Ethan Flow" })),
        ).toContain(">EF<");
        expect(
            String(avatarInitials({ initials: "  ", name: "Ethan Flow" })),
        ).toContain(">EF<");
        expect(String(avatarInitials({ initials: "", name: "  " }))).toContain(
            ">?<",
        );
    });

    test("empty initials and no name is an error, not an empty circle", () => {
        expect(() => avatarInitials({ initials: "" })).toThrow();
        expect(() => avatarInitials({ initials: "  " })).toThrow();
    });
});
