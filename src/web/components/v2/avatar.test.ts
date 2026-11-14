import { describe, expect, test } from "bun:test";
import { memberAvatar } from "./avatar.js";

const USER = "11111111-1111-4111-8111-111111111111";

describe("memberAvatar", () => {
    test("flag off: initials only, never an image", () => {
        const html = memberAvatar({
            name: "Ethan Flow",
            userId: USER,
            version: new Date(1700000000000),
            enabled: false,
            className: "fd-settings-profile__avatar",
        });
        expect(String(html)).toBe(
            '<span class="fd-avatar fd-settings-profile__avatar" aria-hidden="true">EF</span>',
        );
        expect(html).not.toContain("<img");
    });

    test("on but no picture: initials only", () => {
        for (const version of [null, undefined]) {
            const html = memberAvatar({
                name: "Ethan Flow",
                userId: USER,
                version,
                enabled: true,
            });
            expect(String(html)).toBe(
                '<span class="fd-avatar" aria-hidden="true">EF</span>',
            );
        }
    });

    test("on with a version: an img carrying the version, initials underneath", () => {
        const html = memberAvatar({
            name: "Ethan Flow",
            userId: USER,
            version: new Date(1700000000123),
            enabled: true,
            className: "fd-avatar--row",
        });
        expect(html).toContain(
            'class="fd-avatar fd-avatar--row fd-avatar--photo"',
        );
        expect(html).toContain(`src="/avatars/${USER}?v=1700000000123"`);
        expect(html).toContain('alt=""');
        expect(html).toContain('loading="lazy"');
        expect(html).toContain('decoding="async"');
        expect(html).toContain("EF");
        expect(html).toContain('aria-hidden="true"');
    });

    test("a numeric version is used as given", () => {
        const html = memberAvatar({
            name: "A",
            userId: USER,
            version: 42,
            enabled: true,
        });
        expect(html).toContain(`?v=42"`);
    });

    test("no user id means no picture even when enabled", () => {
        const html = memberAvatar({
            name: "A",
            version: 42,
            enabled: true,
        });
        expect(html).not.toContain("<img");
    });

    test("names and ids are escaped", () => {
        const html = memberAvatar({
            name: '<b>"x"</b>',
            userId: 'a"><script>',
            version: 1,
            enabled: true,
            className: 'x" onclick="y',
        });
        expect(html).not.toContain("<script>");
        expect(html).not.toContain("<b>");
        expect(html).not.toContain('onclick="y"');
        expect(html).toContain("&lt;");
    });
});
