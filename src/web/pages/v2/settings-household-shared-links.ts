/**
 * Settings › Household › Shared links (FigCraft 425268): the household's
 * active share links, one row each (what is shared, what kind, when it
 * expires) with a ⋯ that revokes it in place. Behind the `mcp-share-links`
 * flag: with it off the page is a 404 and the Household page has no row.
 *
 * The list never carries a link's address: only a hash is stored, so a link
 * cannot be shown or copied again, only revoked and made anew.
 */
import type { AppChromeBase } from "../../attention.js";
import type { ShareLink } from "../../../domain/sharing.js";
import { emptyState } from "../../components/v2/empty-state.js";
import { join, type Html } from "../../components/v2/html.js";
import { itemRow } from "../../components/v2/item-row.js";
import { listGroup } from "../../components/v2/list-group.js";
import { menu } from "../../components/v2/menu.js";
import { dayMonthLabel } from "./settings-household-dates.js";
import { renderHouseholdLayout } from "./settings-household-layout.js";
import { settingsErrorBanner } from "./settings-shared.js";

export const SHARED_LINKS_PATH = "/settings/household/shared-links";

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

function whatLabel(link: SharedLinkRow): string {
    if (link.kind === "grocery_list") return "Grocery list";
    return link.recipeName ?? "Recipe (deleted)";
}

/** "Recipe · expires 12 Dec", "Never expires", "Expires 30 Nov". */
function metaLine(link: SharedLinkRow, now: Date, timezone: string): string {
    const expiry =
        link.expiresAt === null
            ? "Never expires"
            : `Expires ${dayMonthLabel(link.expiresAt, now, timezone)}`;
    // Only a recipe that is still there is named a recipe; its title says the rest.
    if (link.kind === "recipe" && link.recipeName !== null) {
        return `Recipe · ${expiry.charAt(0).toLowerCase()}${expiry.slice(1)}`;
    }
    return expiry;
}

function linkRow(link: SharedLinkRow, now: Date, timezone: string): Html {
    const what = whatLabel(link);
    return itemRow({
        title: what,
        subtitle: metaLine(link, now, timezone),
        trailing: {
            kind: "control",
            html: menu({
                label: `Actions for the link to ${what}`,
                anchor: "more",
                items: [
                    {
                        kind: "destructive",
                        label: "Revoke",
                        confirmLabel: "Revoke link",
                        action: sharedLinkRevokePath(link.id),
                    },
                ],
            }),
        },
    });
}

export type SharedLinksPageView = {
    chrome: AppChromeBase;
    links: readonly SharedLinkRow[];
    /** The household's time zone, which a day is counted in; default UTC. */
    timezone?: string;
    error?: string;
    /** For tests and previews; defaults to the current time. */
    now?: Date;
};

export function renderSharedLinksPage(view: SharedLinksPageView): string {
    const now = view.now ?? new Date();
    const timezone = view.timezone ?? "UTC";
    const body = join([
        settingsErrorBanner(view.error),
        view.links.length > 0
            ? listGroup({
                  rows: view.links.map((link) => linkRow(link, now, timezone)),
                  label: "Shared links",
              })
            : emptyState({ title: "No shared links" }),
    ]);
    return renderHouseholdLayout({
        chrome: view.chrome,
        title: "Shared links",
        body,
    });
}
