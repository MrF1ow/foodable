/**
 * Settings › Household › Shared links: the household's active share links
 * (what is shared, who made it, when, when it expires) with Revoke.
 *
 * FigCraft Settings › Household (phone 23470 / 28382) has no such section; it
 * is built from the page's own rows and the app's confirm sheet. The list never
 * carries a link's address: only a hash is stored, so a link cannot be shown
 * again, only revoked and made anew.
 */
import type { ShareLink } from "../../../domain/sharing.js";
import { esc, raw, type Html } from "../../components/v2/html.js";
import { rowList, sectionHeader } from "../../components/v2/rows.js";
import { confirmSheet, sheetTrigger } from "../../components/v2/sheet.js";
import { shareDateLabel, shareExpiryLabel } from "./share-sheet.js";

export type SharedLinkRow = {
    id: string;
    kind: "recipe" | "grocery_list";
    /** The recipe's name; null for the list, and for a recipe since deleted. */
    recipeName: string | null;
    createdByName: string | null;
    createdAt: string;
    expiresAt: string | null;
};

/**
 * The rows for a household's links: each recipe link's name and each link's
 * maker by id. A link whose recipe is gone or whose maker left has no name; the
 * row says what it can.
 */
export function buildSharedLinkRows(
    links: readonly Pick<
        ShareLink,
        "id" | "kind" | "targetId" | "createdBy" | "createdAt" | "expiresAt"
    >[],
    memberNames: ReadonlyMap<string, string>,
    recipeNames: ReadonlyMap<string, string>,
): SharedLinkRow[] {
    return links.map((link) => ({
        id: link.id,
        kind: link.kind,
        recipeName:
            link.targetId === null
                ? null
                : (recipeNames.get(link.targetId) ?? null),
        createdByName:
            link.createdBy === null
                ? null
                : (memberNames.get(link.createdBy) ?? null),
        createdAt: link.createdAt,
        expiresAt: link.expiresAt,
    }));
}

export function sharedLinkRevokePath(id: string): string {
    return `/settings/household/shared-links/${encodeURIComponent(id)}/revoke`;
}

function sharedLinkSheetId(id: string): string {
    return `fd-shared-link-revoke-${id}`;
}

function whatLabel(link: SharedLinkRow): string {
    if (link.kind === "grocery_list") return "Grocery list";
    return link.recipeName ?? "Recipe (deleted)";
}

function metaLine(link: SharedLinkRow): string {
    const parts = [
        link.createdByName
            ? `Shared by ${link.createdByName} on ${shareDateLabel(link.createdAt)}`
            : `Shared on ${shareDateLabel(link.createdAt)}`,
        shareExpiryLabel(link.expiresAt),
    ];
    return parts.join(" · ");
}

function linkRow(link: SharedLinkRow): Html {
    const sheetId = sharedLinkSheetId(link.id);
    const revoke = sheetTrigger({
        target: sheetId,
        label: "Revoke",
        ariaLabel: `Revoke the link to ${whatLabel(link)}`,
        className: "fd-settings-btn fd-settings-btn--sm",
    });
    return raw(
        `<li class="fd-row fd-row--shared-link"><div class="fd-row__body"><div class="fd-row__main"><span class="fd-row__title">${esc(whatLabel(link))}</span><span class="fd-row__meta">${esc(metaLine(link))}</span></div>${revoke}</div></li>`,
    );
}

function revokeSheet(link: SharedLinkRow): string {
    return confirmSheet({
        id: sharedLinkSheetId(link.id),
        title: "Revoke link",
        subtitle: whatLabel(link),
        message:
            "Anyone who has this link will no longer be able to open it. You can share again to make a new one.",
        action: sharedLinkRevokePath(link.id),
        confirmLabel: "Revoke",
    });
}

/** The section, heading included: a list of active links, or an empty state. */
export function renderSharedLinksSection(
    links: readonly SharedLinkRow[],
): string {
    const head = String(
        sectionHeader({
            title: "Shared links",
            count: links.length > 0 ? String(links.length) : undefined,
            level: 2,
        }),
    );
    if (links.length === 0) {
        return `${head}<p class="fd-settings-household-empty">No shared links. Share a recipe or the grocery list and its link shows here.</p>`;
    }
    return `${head}${String(rowList(links.map(linkRow), { label: "Shared links" }))}${links.map(revokeSheet).join("")}`;
}
