import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import type { HouseholdMember } from "../../../household.js";
import {
    renderSettingsMemberV2Page,
    SETTINGS_MEMBER_V2_MARKER,
} from "./settings-member.js";

const chrome = {
    theme: "light" as const,
    attention: { count: 0, tabs: {} },
    flags: { ...FIXTURE_APP_CHROME_FLAGS, uiV2: true },
};

const bob: HouseholdMember = {
    householdId: "hh-1",
    userId: "22222222-2222-4222-8222-222222222222",
    role: "member",
    displayName: "Bob",
};

describe("settings member v2", () => {
    test("peer member page shows Today link", () => {
        const html = renderSettingsMemberV2Page({
            chrome,
            member: bob,
            viewer: {
                householdId: "hh-1",
                userId: "11111111-1111-4111-8111-111111111111",
                role: "owner",
                displayName: "Alice",
            },
            todayHref: `/?member=${bob.userId}`,
        });
        expect(html).toContain(SETTINGS_MEMBER_V2_MARKER);
        expect(html).toContain(`href="/?member=${bob.userId}"`);
        expect(html).toContain("Today");
    });
});
