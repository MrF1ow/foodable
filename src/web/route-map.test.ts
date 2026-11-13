import { describe, expect, test } from "bun:test";
import {
    APP_PATHS,
    LEGACY_PATH_MOVES,
    canonicalAppPath,
    findLegacyLinks,
    legacyRedirectTarget,
} from "./route-map.js";

describe("APP_PATHS", () => {
    test("names no retired page", () => {
        const retired = [
            "/log-meal",
            "/log-water",
            "/log-weight",
            "/nutrition/layout",
            "/settings/household-settings",
        ];
        for (const path of Object.values(APP_PATHS)) {
            expect(retired).not.toContain(path);
        }
    });
});

describe("legacyRedirectTarget", () => {
    const cases: { in: string; want: string | null }[] = [
        { in: "/fridge", want: APP_PATHS.kitchenFridge },
        { in: "/fridge/", want: APP_PATHS.kitchenFridge },
        { in: "/household/items/?a=1", want: "/settings/household/items?a=1" },
        { in: "/settings/foods/", want: APP_PATHS.settingsHouseholdItems },
        { in: "/fridge/items/abc/eat", want: "/kitchen/fridge/items/abc/eat" },
        { in: "/fridge?q=1", want: "/kitchen/fridge?q=1" },
        {
            in: "/fridge?a=1&from=%2Ffridge",
            want: "/kitchen/fridge?a=1&from=%2Ffridge",
        },
        { in: "/grocery", want: APP_PATHS.kitchenGroceries },
        {
            in: "/grocery/lines/7/put-away",
            want: "/kitchen/groceries/lines/7/put-away",
        },
        {
            in: "/household/usual-products/F1/products/P2/remove",
            want: "/kitchen/usuals/F1/products/P2/remove",
        },
        {
            in: "/household/items/merge",
            want: "/settings/household/items/merge",
        },
        {
            in: "/household/possible-duplicates/merge",
            want: "/settings/household/possible-duplicates/merge",
        },
        {
            in: "/household/members/U/role",
            want: "/settings/household/members/U/role",
        },
        { in: "/settings/foods/x", want: "/settings/household/items/x" },
        { in: "/fridges", want: null },
        { in: "/householder", want: null },
        { in: "/groceryx", want: null },
        { in: "/settings/household-settings", want: null },
        { in: "/settings/household", want: null },
        { in: APP_PATHS.kitchenFridge, want: null },
        { in: "/recipes", want: null },
    ];

    for (const { in: input, want } of cases) {
        test(input, () => {
            expect(legacyRedirectTarget(input)).toBe(want);
        });
    }

    test("every mapped target is not legacy", () => {
        for (const row of LEGACY_PATH_MOVES) {
            const target = legacyRedirectTarget(`${row.from}/x`);
            expect(target).not.toBeNull();
            expect(legacyRedirectTarget(target!)).toBeNull();
        }
    });
});

describe("canonicalAppPath", () => {
    test("passes through canonical paths", () => {
        expect(canonicalAppPath("/recipes")).toBe("/recipes");
    });
    test("rewrites legacy", () => {
        expect(canonicalAppPath("/household")).toBe(
            APP_PATHS.settingsHousehold,
        );
    });
});

describe("findLegacyLinks", () => {
    test("finds href and from params", () => {
        const html = `<a href="/fridge">x</a><form action="/grocery/lines" formaction="/household"></form>
        <a href="/settings?from=%2Ffridge">settings</a>`;
        const found = findLegacyLinks(html);
        expect(found).toContain("/fridge");
        expect(found).toContain("/grocery/lines");
        expect(found).toContain("/household");
    });
    test("clean page has no legacy links", () => {
        expect(
            findLegacyLinks(
                `<a href="${APP_PATHS.kitchenFridge}">f</a><a href="${APP_PATHS.settingsHousehold}">h</a>`,
            ),
        ).toEqual([]);
    });
});

describe("legacy path literals in source", () => {
    const OLD = ["/fridge", "/grocery", "/household", "/settings/foods"];
    const NEEDLES = OLD.flatMap((path) => [
        `"${path}`,
        `'${path}`,
        `\`${path}`,
    ]);
    /** route-map.ts holds the old paths on purpose; nav-check.ts drives
     *  one legacy URL to prove the redirect. */
    const SKIP = new Set(["src/web/route-map.ts", "scripts/nav-check.ts"]);

    async function hitsUnder(dir: string): Promise<string[]> {
        const hits: string[] = [];
        for await (const rel of new Bun.Glob("**/*.{ts,js}").scan({
            cwd: dir,
            onlyFiles: true,
        })) {
            const path = `${dir}/${rel}`;
            if (SKIP.has(path) || path.endsWith(".test.ts")) continue;
            const text = await Bun.file(path).text();
            for (const needle of NEEDLES) {
                if (text.includes(needle)) hits.push(`${path}: ${needle}`);
            }
        }
        return hits;
    }

    test("src (incl. client JS) and scripts name no old path", async () => {
        expect([
            ...(await hitsUnder("src")),
            ...(await hitsUnder("scripts")),
        ]).toEqual([]);
    });
});
