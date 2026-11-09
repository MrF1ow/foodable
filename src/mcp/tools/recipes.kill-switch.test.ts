import { expect, test } from "bun:test";
import { createMemorySocialReaderStatusStore } from "../../domain/social-readers.js";
import { createMemoryFlags } from "../../flags.js";
import {
    buildRecipeLinkReaderPausedOutcome,
    recipeLinkReaderEnabled,
    RECIPE_LINK_READER_PAUSED_AGENT_MESSAGE,
} from "../../recipe-url-fetcher.js";
import { importRecipeFromUrlPausedStructuredContent } from "./recipes.js";

test("importRecipeFromUrlPausedStructuredContent validates against output schema", () => {
    const payload = importRecipeFromUrlPausedStructuredContent(
        "https://www.tiktok.com/@chef/video/1234567890",
    );
    expect(payload.status).toBe("paste_needed");
    expect(payload.message).toBe(RECIPE_LINK_READER_PAUSED_AGENT_MESSAGE);
    expect(payload.reader_failure).toBeNull();
});

test("recipe-link-reader off skips URL import so social reader status stays clean", async () => {
    const householdId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const flags = createMemoryFlags({ "recipe-link-reader": false });
    expect(
        recipeLinkReaderEnabled(householdId, flags.isEnabled.bind(flags)),
    ).toBe(false);

    const readerStatus = createMemorySocialReaderStatusStore();
    const outcome = buildRecipeLinkReaderPausedOutcome(
        "https://www.tiktok.com/@chef/video/1234567890",
    );
    expect(outcome.status).toBe("paste_needed");
    expect(outcome.readerFailure).toBeNull();

    const rows = await readerStatus.get(householdId);
    expect(rows.find((r) => r.reader === "tiktok")?.lastFailureAt).toBeNull();
});
