import { describe, expect, test } from "bun:test";
import { profileCard } from "./profile-card.js";
import { XSS, XSS_ESCAPED } from "./test-helpers.js";

const FIELDS = [
    { key: "Household", value: "The Flow household" },
    { key: "Members", value: "3" },
    { key: "Role", value: "Owner" },
];

describe("profileCard (FigCraft 381535)", () => {
    test("name, email, avatar and the key/value fields", () => {
        const html = String(
            profileCard({
                name: "Ethan Flow",
                email: "ethan@example.com",
                fields: FIELDS,
            }),
        );
        expect(html).toContain('<div class="fd-profile-card">');
        expect(html).toContain(
            '<span class="fd-profile-card__name">Ethan Flow</span>',
        );
        expect(html).toContain(
            '<span class="fd-profile-card__email">ethan@example.com</span>',
        );
        expect(html).toContain(
            '<span class="fd-avatar-initials" aria-hidden="true">EF</span>',
        );
        expect(html).toContain(
            '<div class="fd-profile-card__field"><dt class="fd-profile-card__key">Household</dt><dd class="fd-profile-card__val">The Flow household</dd></div>',
        );
        expect(html.match(/fd-profile-card__field"/g)?.length).toBe(3);
    });

    test("the email and the fields are optional", () => {
        const html = String(profileCard({ name: "Ethan Flow", fields: [] }));
        expect(html).not.toContain("__email");
        expect(html).not.toContain("<dl");
    });

    test("initials can be given", () => {
        expect(
            String(
                profileCard({ name: "Ethan Flow", initials: "XX", fields: [] }),
            ),
        ).toContain(">XX<");
    });

    test("an unknown field value is a dash", () => {
        const html = String(
            profileCard({ name: "A", fields: [{ key: "Role", value: null }] }),
        );
        expect(html).toContain("—");
    });

    test("escapes every string", () => {
        const html = String(
            profileCard({
                name: XSS,
                email: XSS,
                initials: XSS,
                className: XSS,
                fields: [{ key: XSS, value: XSS }],
            }),
        );
        expect(html).not.toContain("<script>");
        expect(html.split(XSS_ESCAPED).length - 1).toBe(6);
    });
});
