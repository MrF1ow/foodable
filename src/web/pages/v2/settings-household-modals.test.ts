import { expect, test } from "bun:test";
import {
    HOUSEHOLD_ROTATE_TOKEN_MODAL_ID,
    HOUSEHOLD_SOCIAL_READER_FACEBOOK_MODAL_ID,
    HOUSEHOLD_SOCIAL_READER_TIKTOK_MODAL_ID,
    renderRotateTokenModal,
    renderSocialReaderModals,
} from "./settings-household-modals.js";

test("the rotate-token confirm opts out of Turbo and says what it does", () => {
    const html = renderRotateTokenModal({ open: false });
    expect(html).toContain(`id="${HOUSEHOLD_ROTATE_TOKEN_MODAL_ID}"`);
    expect(html).toMatch(
        /<form[^>]*method="post"[^>]*action="\/settings\/household\/rotate-token"[^>]*data-turbo="false"/,
    );
    expect(html).toContain(
        "Issue a new household bot token? The old token stops working immediately.",
    );
    expect(html).toContain(">Rotate token</button>");
    expect(html).not.toContain("data-modal-open-on-load");
});

test("the rotate-token confirm reopens when asked", () => {
    expect(renderRotateTokenModal({ open: true })).toContain(
        "data-modal-open-on-load",
    );
});

test("the social reader dialogs carry the risk text and the research link", () => {
    const html = renderSocialReaderModals({});
    expect(html).toContain(`id="${HOUSEHOLD_SOCIAL_READER_TIKTOK_MODAL_ID}"`);
    expect(html).toContain(`id="${HOUSEHOLD_SOCIAL_READER_FACEBOOK_MODAL_ID}"`);
    expect(html).toContain("Turn on TikTok reader");
    expect(html).toContain("Turn on Facebook reader");
    expect(html).toContain("Facebook doesn't document");
    expect(
        html.match(/goes against that platform's terms of service/g)?.length,
    ).toBeGreaterThanOrEqual(2);
    expect(
        html.match(/recipe-import-terms-2026-11\.md/g)?.length,
    ).toBeGreaterThanOrEqual(2);
});

test("a social reader error shows inside the dialog it belongs to", () => {
    const html = renderSocialReaderModals({
        error: "Confirm the terms.",
        openModalId: HOUSEHOLD_SOCIAL_READER_TIKTOK_MODAL_ID,
    });
    expect(html.match(/Confirm the terms\./g)).toHaveLength(1);
});
