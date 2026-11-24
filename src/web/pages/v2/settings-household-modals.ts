import { escapeHtml } from "../../shell.js";
import { confirmModal, errorBanner, modal } from "../../components/ui.js";
import {
    SOCIAL_READER_FACEBOOK_CAVEAT,
    SOCIAL_READER_LABELS,
    SOCIAL_READER_RESEARCH_URL,
    SOCIAL_READER_RISK_INTRO,
    socialReaderConfirmLabel,
    socialReaderTurnOnLabel,
    type SocialReaderId,
} from "../../../copy/social-readers.js";

export const HOUSEHOLD_ADD_STORE_MODAL_ID = "household-add-store";
export const HOUSEHOLD_ROTATE_TOKEN_MODAL_ID = "household-rotate-token";
export const HOUSEHOLD_SOCIAL_READER_TIKTOK_MODAL_ID =
    "household-social-reader-tiktok";
export const HOUSEHOLD_SOCIAL_READER_FACEBOOK_MODAL_ID =
    "household-social-reader-facebook";

function socialReaderRiskBlock(): string {
    return `<p class="hint">${escapeHtml(SOCIAL_READER_RISK_INTRO)} <a href="${SOCIAL_READER_RESEARCH_URL}" target="_blank" rel="noopener noreferrer">Terms research</a>.</p>`;
}

function socialReaderEnableModal(
    reader: SocialReaderId,
    modalId: string,
    view: { error?: string; openModalId?: string },
): string {
    const open = view.openModalId === modalId;
    const label = SOCIAL_READER_LABELS[reader];
    const extra =
        reader === "facebook"
            ? `<p class="hint">${escapeHtml(SOCIAL_READER_FACEBOOK_CAVEAT)}</p>`
            : "";
    return modal({
        id: modalId,
        title: `Turn on ${label} reader`,
        openOnLoad: open,
        body: `${open && view.error ? errorBanner(view.error) : ""}<form method="post" action="/settings/household/social-readers" class="modal-confirm social-reader-enable">
<input type="hidden" name="reader" value="${reader}" />
<input type="hidden" name="enabled" value="1" />
<p class="modal-message">Enable automatic reading of ${escapeHtml(label)} captions for recipe imports?</p>
${socialReaderRiskBlock()}
${extra}
<label><input type="checkbox" name="confirm" value="1" required /> ${escapeHtml(socialReaderConfirmLabel(reader))}</label>
<div class="modal-actions">
<button type="button" command="close" commandfor="${escapeHtml(modalId)}">Cancel</button>
<button type="submit" class="btn-primary">${escapeHtml(socialReaderTurnOnLabel(reader))}</button>
</div>
</form>`,
    });
}

/**
 * The rotate-token confirm. The route answers 200 HTML carrying the one-time
 * secret, so the form opts out of Turbo.
 */
export function renderRotateTokenModal(opts: { open: boolean }): string {
    return confirmModal({
        id: HOUSEHOLD_ROTATE_TOKEN_MODAL_ID,
        title: "Rotate household token",
        message:
            "Issue a new household bot token? The old token stops working immediately.",
        action: "/settings/household/rotate-token",
        confirmLabel: "Rotate token",
        formClass: "rotate-token modal-confirm",
        turboFalse: true,
        openOnLoad: opts.open,
    });
}

/** The two terms-confirm dialogs for turning a recipe link reader on (owner only). */
export function renderSocialReaderModals(view: {
    error?: string;
    openModalId?: string;
}): string {
    return [
        socialReaderEnableModal(
            "tiktok",
            HOUSEHOLD_SOCIAL_READER_TIKTOK_MODAL_ID,
            view,
        ),
        socialReaderEnableModal(
            "facebook",
            HOUSEHOLD_SOCIAL_READER_FACEBOOK_MODAL_ID,
            view,
        ),
    ].join("");
}
