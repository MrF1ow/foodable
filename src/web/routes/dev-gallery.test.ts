import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import type { HouseholdMember } from "../../household.js";
import { resetFlagsForTests } from "../../flags.js";
import * as actualHousehold from "../../db/household.js";
import * as actualProfiles from "../../db/profiles.js";
import * as actualAttention from "../attention.js";

const realHousehold = { ...actualHousehold };
const realProfiles = { ...actualProfiles };
const realAttention = { ...actualAttention };

const ALICE = "11111111-1111-4111-8111-111111111111";

const member: HouseholdMember = {
    userId: ALICE,
    householdId: "hh-1",
    role: "owner",
    displayName: "Alice",
};

// oxlint-disable-next-line foodable/no-db-mock-outside-windows -- route test owns a household stub in this file
mock.module("../../db/household.js", () => ({
    ...realHousehold,
    getHouseholdMembership: async (userId: string) =>
        userId === ALICE ? member : null,
    householdExists: async () => true,
}));

// oxlint-disable-next-line foodable/no-db-mock-outside-windows -- route test owns a profiles stub in this file
mock.module("../../db/profiles.js", () => ({
    ...realProfiles,
    getProfile: async (userId: string) =>
        userId === ALICE
            ? {
                  user_id: ALICE,
                  theme: "light",
                  timezone: "UTC",
                  preferred_weight_unit: null,
                  widgets_enabled: true,
                  alcohol_tracking_enabled: false,
                  preferred_drink_unit: null,
                  created_at: "2026-01-01T00:00:00.000Z",
                  updated_at: "2026-01-01T00:00:00.000Z",
              }
            : null,
}));

mock.module("../attention.js", () => ({
    ...realAttention,
    viewerChromeWithAttention: async (
        profile: { theme?: string | null } | null,
        viewer: HouseholdMember,
    ) => {
        const flags = await realAttention.viewerFlagsFor(viewer);
        return {
            theme:
                profile?.theme === "light" || profile?.theme === "dark"
                    ? profile.theme
                    : "light",
            attention: { count: 0, tabs: {} },
            flags,
            identity: {
                viewerName: viewer.displayName,
                viewerRole: viewer.role,
                householdName: "Test household",
                memberCount: 2,
            },
        };
    },
}));

afterAll(() => {
    // oxlint-disable-next-line foodable/no-db-mock-outside-windows -- restores the household stub window
    mock.module("../../db/household.js", () => realHousehold);
    // oxlint-disable-next-line foodable/no-db-mock-outside-windows -- restores the profiles stub window
    mock.module("../../db/profiles.js", () => realProfiles);
    mock.module("../attention.js", () => realAttention);
});

process.env.OAUTH_CLIENT_ID ||= "test-client-id";
process.env.OAUTH_CLIENT_SECRET ||= "test-client-secret";

const { app } = await import("../../index.js");
const { mintSiteSession, SITE_COOKIE } = await import("../../site-session.js");

function sessionCookie(userId: string): string {
    return `${SITE_COOKIE}=${mintSiteSession(userId)}`;
}

const galleryUrl = "http://x/dev/gallery-v2";

const savedNodeEnv = process.env.NODE_ENV;
const savedRailwayEnv = process.env.RAILWAY_ENVIRONMENT_NAME;

afterEach(() => {
    resetFlagsForTests();
    if (savedRailwayEnv === undefined) {
        delete process.env.RAILWAY_ENVIRONMENT_NAME;
    } else {
        process.env.RAILWAY_ENVIRONMENT_NAME = savedRailwayEnv;
    }
    if (savedNodeEnv === undefined) {
        delete process.env.NODE_ENV;
    } else {
        process.env.NODE_ENV = savedNodeEnv;
    }
});

describe("GET /dev/gallery-v2", () => {
    test("returns 404 when env is not local", async () => {
        process.env.RAILWAY_ENVIRONMENT_NAME = "production";
        const res = await app.request(galleryUrl, {
            headers: { cookie: sessionCookie(ALICE) },
        });
        expect(res.status).toBe(404);
    });

    test("returns 404 when NODE_ENV is production without Railway env", async () => {
        process.env.NODE_ENV = "production";
        delete process.env.RAILWAY_ENVIRONMENT_NAME;
        const res = await app.request(galleryUrl, {
            headers: { cookie: sessionCookie(ALICE) },
        });
        expect(res.status).toBe(404);
    });

    test("returns 200 with the components when local", async () => {
        delete process.env.RAILWAY_ENVIRONMENT_NAME;
        delete process.env.NODE_ENV;
        const res = await app.request(galleryUrl, {
            headers: { cookie: sessionCookie(ALICE) },
        });
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain('class="fd-shell"');
        expect(html).toContain("fd-row fd-row--food fd-row--swipe");
        expect(html).toContain('class="fd-chip');
        expect(html).toContain('class="fd-stepper"');
        expect(html).toContain('class="fd-sheet');
        expect(html).toContain('class="fd-dot fd-dot--protein"');
        expect(html).toContain('class="fd-score');
        expect(html).toContain('class="fd-tiles"');
    });
});
