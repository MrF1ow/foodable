/**
 * The live member avatar builder's markup, pinned byte for byte. The design's new
 * component has its own module and class; this output must not move until the
 * pages that call it switch over.
 */
import { expect, test } from "bun:test";
import { raw } from "./html.js";
import { memberAvatar } from "./avatar.js";

test("memberAvatar: the live initials circle is unchanged", () => {
    expect(memberAvatar({ name: "Ethan Flow", enabled: false })).toBe(
        raw('<span class="fd-avatar" aria-hidden="true">EF</span>'),
    );
});

test("memberAvatar: the live photo circle is unchanged", () => {
    expect(
        memberAvatar({
            name: "Ethan Flow",
            userId: "u1",
            version: 1234,
            enabled: true,
            className: "big",
        }),
    ).toBe(
        raw(
            '<span class="fd-avatar big fd-avatar--photo" aria-hidden="true">EF<img class="fd-avatar__img" src="/avatars/u1?v=1234" alt="" loading="lazy" decoding="async"></span>',
        ),
    );
});
