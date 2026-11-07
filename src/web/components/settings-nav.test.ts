import { test, expect } from "bun:test";
import { renderHouseholdNav, renderSettingsNav } from "./settings-nav.js";

test("settings nav omits from query when back is home", () => {
    expect(renderSettingsNav("account", "/")).toBe(
        '<nav class="subnav" aria-label="Settings sections"><a href="/settings" aria-current="page">Account</a><a href="/settings/household-settings">Household</a><a href="/settings/help">Help</a></nav>',
    );
});

test("settings nav carries from on each link", () => {
    expect(renderSettingsNav("help", "/fridge")).toBe(
        '<nav class="subnav" aria-label="Settings sections"><a href="/settings?from=%2Ffridge">Account</a><a href="/settings/household-settings?from=%2Ffridge">Household</a><a href="/settings/help?from=%2Ffridge" aria-current="page">Help</a></nav>',
    );
});

test("household nav", () => {
    expect(renderHouseholdNav("members")).toContain(
        '<a href="/household" aria-current="page">Members</a>',
    );
    expect(renderHouseholdNav("items")).toContain(
        '<a href="/household/items" aria-current="page">Items</a>',
    );
    expect(renderHouseholdNav("usual-products")).toContain(
        '<a href="/household/usual-products" aria-current="page">Usual products</a>',
    );
});

test("household nav hides Possible duplicates at zero count", () => {
    expect(
        renderHouseholdNav("members", { possibleDuplicates: 0 }),
    ).not.toContain("Possible duplicates");
    expect(
        renderHouseholdNav("possible-duplicates", { possibleDuplicates: 0 }),
    ).not.toContain("Possible duplicates");
    expect(renderHouseholdNav("members", { possibleDuplicates: 2 })).toContain(
        "Possible duplicates",
    );
});
