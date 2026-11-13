import { test, expect } from "bun:test";
import { renderHouseholdNav } from "./settings-nav.js";

test("household nav", () => {
    expect(renderHouseholdNav("members")).toContain(
        '<a href="/settings/household" aria-current="page">Members</a>',
    );
    expect(renderHouseholdNav("items")).toContain(
        '<a href="/settings/household/items" aria-current="page">Items</a>',
    );
    expect(renderHouseholdNav("usual-products")).toContain(
        '<a href="/kitchen/usuals" aria-current="page">Usual products</a>',
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
