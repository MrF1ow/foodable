// Every place the app draws a member's circle: the picture when the flag is on
// and the member has set one, initials otherwise (flag off, or no picture).
import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../test-support/chrome-flags.js";
import type { HouseholdMember } from "../household.js";
import type { NoticesForResult } from "../domain/notices-for.js";
import { memberCheckRow } from "./components/v2/rows.js";
import { renderSettingsAccountV2Page } from "./pages/v2/settings-account.js";
import { renderSettingsHomeV2Page } from "./pages/v2/settings-home.js";
import { renderSettingsHouseholdV2Page } from "./pages/v2/settings-household.js";
import {
    buildProductMemberCards,
    buildProductScoreSection,
    renderProductScoreSection,
} from "./pages/v2/product-score.js";
import { newFood } from "../domain/foods.js";
import { renderAppShell, type AppChrome, type ShellIdentity } from "./shell.js";
import type { AppChromeBase } from "./attention.js";

const EMPTY_NOTICES: NoticesForResult = {
    notices: [],
    dismissals: [],
    subjectNames: new Map(),
    subjectTimes: new Map(),
    noticeFoods: new Map(),
    catalogFoods: [],
    aliasMap: new Map(),
    barcodedIds: new Set(),
    possibleDuplicatePairs: [],
    recipesListPrefetch: {
        recipes: [],
        allIngredients: [],
        fridgeItems: [],
        foodsById: new Map(),
    },
};

const ME = "11111111-1111-4111-8111-111111111111";
const PEER = "22222222-2222-4222-8222-222222222222";
const T = new Date(1700000000000);
const VERSIONS = new Map([
    [ME, T],
    [PEER, new Date(1700000001000)],
]);

function identity(on: boolean, versions = VERSIONS): ShellIdentity {
    return {
        viewerUserId: ME,
        viewerName: "Ethan Flow",
        viewerRole: "owner",
        householdName: "The Flow household",
        memberCount: 2,
        ...(on ? { avatarVersions: versions } : {}),
    };
}

function base(on: boolean, versions = VERSIONS): AppChromeBase {
    return {
        theme: "light",
        attention: { count: 0, tabs: {} },
        flags: FIXTURE_APP_CHROME_FLAGS,
        identity: identity(on, versions),
    };
}

const MEMBERS: HouseholdMember[] = [
    { householdId: "h", userId: ME, role: "owner", displayName: "Ethan Flow" },
    { householdId: "h", userId: PEER, role: "member", displayName: "Sam" },
];

const imgFor = (id: string) => `src="/avatars/${id}?v=`;

describe("shell sidebar account", () => {
    const shell = (on: boolean, versions?: Map<string, Date>) =>
        renderAppShell({
            ...(base(on, versions) as AppChromeBase),
            title: "T",
            active: "nutrition",
            body: "<h1>B</h1>",
        } as AppChrome);

    test("with a picture: the img, with the initials kept under it", () => {
        const html = shell(true);
        expect(html).toContain(`${imgFor(ME)}${T.getTime()}"`);
        expect(html).toContain("fd-avatar--photo");
        // The household's own letter is never a picture.
        expect(html).not.toContain(imgFor("hh"));
        // The sidebar row and the phone header chip each draw the viewer once.
        expect(html.match(/<img class="fd-avatar__img"/g)?.length).toBe(2);
    });

    test("no picture yet: initials only", () => {
        const html = shell(true, new Map());
        expect(html).not.toContain("/avatars/");
        expect(html).toContain(">EF<");
    });
});

describe("phone header account chip", () => {
    const chip = (on: boolean, versions?: Map<string, Date>) => {
        const html = renderAppShell({
            ...(base(on, versions) as AppChromeBase),
            title: "T",
            active: "nutrition",
            body: "<h1>B</h1>",
        } as AppChrome);
        return html.match(/<a class="fd-account-chip[^>]*>[\s\S]*?<\/a>/)![0];
    };

    test("with a picture: the viewer's img, initials kept under it", () => {
        const html = chip(true);
        expect(html).toContain(`${imgFor(ME)}${T.getTime()}"`);
        expect(html).toContain("fd-account-chip--photo");
        expect(html).toContain(">EF<");
        // The link and its name for assistive tech are unchanged.
        expect(html).toContain('href="/settings"');
        expect(html).toContain(
            'aria-label="Settings, signed in as Ethan Flow"',
        );
    });

    test("no picture yet: the plain initials chip", () => {
        const html = chip(true, new Map());
        expect(html).not.toContain("/avatars/");
        expect(html).not.toContain("fd-account-chip--photo");
        expect(html).toContain(">EF</a>");
    });
});

describe("Settings profile card", () => {
    const home = (on: boolean, versions?: Map<string, Date>) =>
        renderSettingsHomeV2Page({
            chrome: base(on, versions),
            displayName: "Ethan Flow",
            email: "e@example.com",
        });

    test("shows the viewer's picture", () => {
        const html = home(true);
        expect(html).toContain(imgFor(ME));
        expect(html).toContain("fd-settings-profile__avatar");
    });
    test("initials when there is no picture or the pictures did not load", () => {
        expect(home(true, new Map())).not.toContain("/avatars/");
        const off = home(false);
        expect(off).not.toContain("/avatars/");
        expect(off).toContain("fd-settings-profile__avatar");
    });
});

describe("Household member rows", () => {
    const view = (on: boolean, versions?: Map<string, Date>) =>
        renderSettingsHouseholdV2Page({
            chrome: base(on, versions),
            householdName: "Home",
            members: MEMBERS,
            stores: [],
            isOwner: true,
            canManage: true,
            viewerUserId: ME,
            noticeResult: EMPTY_NOTICES,
            duplicatePairs: [],
            refCounts: new Map(),
        });

    test("each member with a picture shows it; others keep initials", () => {
        const only = new Map([[PEER, new Date(1700000001000)]]);
        const html = view(true, only);
        expect(html).toContain(`${imgFor(PEER)}1700000001000"`);
        expect(html).not.toContain(imgFor(ME));
        expect(html).toContain(
            '<span class="fd-avatar fd-settings-member-avatar" aria-hidden="true">EF</span>',
        );
    });
    test("pictures not loaded: initials for everyone", () => {
        const html = view(false);
        expect(html).not.toContain("/avatars/");
        expect(html).toContain(
            '<span class="fd-avatar fd-settings-member-avatar" aria-hidden="true">S</span>',
        );
    });
});

describe("Product score member rows", () => {
    const food = newFood({
        householdId: "h",
        kind: "food",
        name: "Yogurt",
        calories: 59,
        proteinG: 10,
        carbsG: 4,
        fatG: 0.4,
        sugarG: 4,
        saturatedFatG: 2,
        offQuality: {
            nutriscoreGrade: "a",
            novaGroup: 1,
            ecoscoreGrade: "b",
            additives: [],
            allergensTags: [],
            tracesTags: null,
            ingredientsAnalysisTags: [],
            labelsTags: [],
            fetchedAt: "2026-01-01T00:00:00.000Z",
        },
    });
    const people = [
        { id: ME, name: "Ethan Flow", allergens: [], dislikes: [] },
        { id: PEER, name: "Sam", allergens: [], dislikes: [] },
    ];
    const render = (versions?: Map<string, Date>) => {
        const cards = buildProductMemberCards(
            food,
            people as never,
            new Map(),
            versions,
        );
        return renderProductScoreSection(
            food,
            buildProductScoreSection(food, cards)!,
        );
    };

    test("picture for the member who has one, initials for the other", () => {
        const html = render(new Map([[PEER, T]]));
        expect(html).toContain(imgFor(PEER));
        expect(html).not.toContain(imgFor(ME));
        expect(html).toContain(
            '<span class="fd-avatar fd-avatar--row" aria-hidden="true">EF</span>',
        );
    });
    test("no versions given: initials only", () => {
        expect(render(undefined)).not.toContain("/avatars/");
    });
});

describe("memberCheckRow", () => {
    test("renders the picture only when given an avatar with a version", () => {
        const row = (avatar?: { userId: string; version: Date | null }) =>
            memberCheckRow({
                name: "Sam",
                initials: "S",
                verdict: "good",
                reason: "ok",
                avatar,
            });
        expect(row({ userId: PEER, version: T })).toContain(imgFor(PEER));
        expect(row({ userId: PEER, version: null })).not.toContain("<img");
        expect(row()).not.toContain("<img");
    });
});

describe("Settings > Account", () => {
    const page = (photo?: { userId: string; version: Date | null }) =>
        renderSettingsAccountV2Page({
            chrome: base(photo !== undefined, new Map()),
            backHref: "/",
            displayName: "Ethan Flow",
            timezone: "UTC",
            weightUnit: "",
            widgetsEnabled: true,
            alcoholTrackingEnabled: false,
            drinkUnit: "",
            photo,
        });

    test("no photo data: no photo control at all", () => {
        const html = page(undefined);
        expect(html).not.toContain('name="photo"');
        expect(html).not.toContain("Change photo");
        expect(html).not.toContain("/avatars/");
    });
    test("no picture yet: change only, initials circle", () => {
        const html = page({ userId: ME, version: null });
        expect(html).toContain('action="/settings/account/photo"');
        expect(html).toContain('enctype="multipart/form-data"');
        expect(html).toContain("data-fd-avatar-upload");
        expect(html).toContain('data-turbo="false"');
        expect(html).toContain('accept="image/jpeg,image/png,image/webp"');
        expect(html).not.toContain("Remove photo");
        expect(html).not.toContain("<img");
    });
    test("with a picture: shown big, with Remove", () => {
        const html = page({ userId: ME, version: T });
        expect(html).toContain(imgFor(ME));
        expect(html).toContain('action="/settings/account/photo/remove"');
        expect(html).toContain("Remove photo");
    });
    test("Remove is the small destructive button, not a primary submit", () => {
        const html = page({ userId: ME, version: T });
        const remove = html.match(/<button[^>]*>Remove photo<\/button>/)?.[0];
        expect(remove).toContain(
            "fd-settings-btn fd-settings-btn--danger fd-settings-btn--sm",
        );
        expect(remove).not.toContain("fd-settings-submit");
        expect(html).not.toContain("fd-settings-submit--quiet");
    });
    test("the Photo card keeps the gap other Account cards have", async () => {
        const css = await Bun.file("public/app/v2/settings.css").text();
        const rule = css.match(/\.fd-settings-photo \{[^}]*\}/)?.[0];
        expect(rule).toContain("margin-bottom: var(--fd-s-12)");
        expect(css).not.toContain("fd-settings-submit--quiet");
    });
});
