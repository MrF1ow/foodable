import { expect, test } from "bun:test";
import { Glob } from "bun";
import type { Notice } from "../../domain/notices.js";
import {
    noticeAction,
    noticeBadge,
    noticeList,
    type NoticeRouteContext,
} from "./notices.js";

function baseNotice(
    over: Partial<Notice> & Pick<Notice, "code" | "severity">,
): Notice {
    return {
        subject: {
            kind: "recipe_ingredient",
            id: "i1",
            recipeId: "r1",
        },
        related: [],
        params: { name: "Test" },
        ...over,
    };
}

test("noticeBadge uses severity pill classes and data-notice", () => {
    expect(
        noticeBadge(
            baseNotice({ code: "recipe.no_nutrition", severity: "block" }),
        ),
    ).toBe(
        '<span class="pill pill-bad" data-notice="recipe.no_nutrition">No nutrition</span>',
    );
    expect(
        noticeBadge(baseNotice({ code: "recipe.no_food", severity: "warn" })),
    ).toBe(
        '<span class="pill pill-warn" data-notice="recipe.no_food">Not linked</span>',
    );
    expect(
        noticeBadge(
            baseNotice({ code: "recipe.partial_nutrition", severity: "info" }),
        ),
    ).toBe(
        '<span class="pill pill-dim" data-notice="recipe.partial_nutrition">Partial nutrition</span>',
    );
});

test("noticeList empty, className, escaping, dedupe, action with ctx", () => {
    expect(noticeList([])).toBe("");
    const a: Notice = {
        code: "recipe.no_nutrition",
        severity: "warn",
        subject: {
            kind: "recipe_ingredient",
            id: "i1",
            recipeId: "r1",
        },
        related: [],
        params: { name: "<bad>", foodId: "f1" },
    };
    const html = noticeList([a], { className: "recipe-macros-reasons" });
    expect(html).toContain('class="notice-list recipe-macros-reasons"');
    expect(html).toContain(
        "&lt;bad&gt;: no nutrition — add it, or pick a usual product",
    );
    const dup: Notice = { ...a, subject: { ...a.subject, id: "i2" } };
    expect(
        noticeList([a, dup], { className: "recipe-macros-reasons" }),
    ).toMatch(/<li>[^<]*<\/li>/);
    expect(
        (noticeList([a, dup], { className: "x" }).match(/<li>/g) ?? []).length,
    ).toBe(1);

    const ctx: NoticeRouteContext = {
        from: "/recipes/r1",
        foods: new Map([["f1", { genericFoodId: "f-generic" }]]),
    };
    const withAction = noticeList([a], { className: "x", ctx });
    expect(withAction).toContain(
        `<a href="/household/usual-products/f-generic?from=%2Frecipes%2Fr1">Pick usual product</a>`,
    );
});

test("noticeAction builds href for plain food and for product generic id", () => {
    const plain: Notice = {
        code: "recipe.no_nutrition",
        severity: "warn",
        subject: {
            kind: "recipe_ingredient",
            id: "i1",
            recipeId: "r1",
        },
        related: [],
        params: { name: "Milk", foodId: "f-plain" },
    };
    const ctxPlain: NoticeRouteContext = {
        from: "/recipes/r1",
        foods: new Map([["f-plain", { genericFoodId: null }]]),
    };
    expect(noticeAction(plain, ctxPlain)).toBe(
        '<a href="/household/usual-products/f-plain?from=%2Frecipes%2Fr1">Pick usual product</a>',
    );

    const product: Notice = {
        ...plain,
        params: { name: "Milk", foodId: "f-prod" },
    };
    const ctxProd: NoticeRouteContext = {
        from: "/recipes/r1",
        foods: new Map([["f-prod", { genericFoodId: "f-generic" }]]),
    };
    expect(noticeAction(product, ctxProd)).toBe(
        '<a href="/household/usual-products/f-generic?from=%2Frecipes%2Fr1">Pick usual product</a>',
    );
});

test("no hand-built recipe-macros-reasons lists outside notices.ts", async () => {
    const badUl = /<ul\b[^>]*recipe-macros-reasons/g;
    const badClass = /class="[^"]*recipe-macros-reasons/g;
    const offenders: string[] = [];
    for await (const path of new Glob("src/web/**/*.ts").scan(".")) {
        if (
            path.endsWith(".test.ts") ||
            path.endsWith("components/notices.ts")
        ) {
            continue;
        }
        const src = await Bun.file(path).text();
        for (const m of src.matchAll(badUl)) {
            offenders.push(`${path}: ${m[0]}`);
        }
        for (const m of src.matchAll(badClass)) {
            offenders.push(`${path}: ${m[0]}`);
        }
    }
    expect(offenders).toEqual([]);
});
