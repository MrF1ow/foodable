import { Hono, type Context } from "hono";

import { run } from "../../db/sql.js";
import { liveFoodsStore } from "../../db/foods.js";
import { liveFridgeStore } from "../../db/fridge.js";
import { getProfile } from "../../db/profiles.js";
import { liveStockStore } from "../../db/stock.js";
import { addLocation, FridgeInputError } from "../../domain/fridge.js";
import { removeFridgeLocation, StockInputError } from "../../domain/stock.js";
import { canManageHousehold } from "../../household.js";
import { loadViewerNotices, viewerChromeWithAttention } from "../attention.js";
import { formText } from "../form.js";
import { requireManager, requireMember, siteMember } from "../middleware.js";
import {
    PLACES_ADD_ID,
    PLACES_PATH,
    placeRemoveSheetId,
    renderSettingsPlacesV2Page,
    type PlaceSummary,
} from "../pages/v2/settings-places.js";

/**
 * Settings › Household › Fridge places. Reading is open to every member; every
 * write is for owners and admins (as Stores is).
 */
export const householdPlacesRoutes = new Hono();

const GENERIC_ERROR = "Could not save that. Try again.";

function errorMessage(err: unknown): string {
    return err instanceof FridgeInputError || err instanceof StockInputError
        ? err.message
        : GENERIC_ERROR;
}

/** The household's places, in their order, with what is filed under each. */
async function placeSummaries(householdId: string): Promise<PlaceSummary[]> {
    const fridge = liveFridgeStore();
    const [locations, items] = await Promise.all([
        fridge.listLocations(householdId),
        fridge.listItems(householdId),
    ]);
    const counts = new Map<string, number>();
    for (const item of items) {
        counts.set(item.locationId, (counts.get(item.locationId) ?? 0) + 1);
    }
    return [...locations]
        .sort(
            (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
        )
        .map((row) => ({
            id: row.id,
            name: row.name,
            itemCount: counts.get(row.id) ?? 0,
        }));
}

async function renderPlaces(
    c: Context,
    opts: { error?: string; open?: string } = {},
): Promise<string> {
    const viewer = siteMember(c);
    const [profile, places, notices] = await Promise.all([
        getProfile(viewer.userId),
        placeSummaries(viewer.householdId),
        loadViewerNotices(viewer),
    ]);
    return renderSettingsPlacesV2Page({
        chrome: await viewerChromeWithAttention(profile, viewer, notices),
        places,
        canManage: canManageHousehold(viewer),
        error: opts.error,
        open: opts.open,
    });
}

/** A refused write: the page again with the message, 400. */
async function placesError(
    c: Context,
    err: unknown,
    open?: string,
): Promise<Response> {
    return c.html(
        await renderPlaces(c, { error: errorMessage(err), open }),
        400,
    );
}

householdPlacesRoutes.get(PLACES_PATH, requireMember, async (c) =>
    c.html(await renderPlaces(c)),
);

householdPlacesRoutes.post(
    `${PLACES_PATH}/add`,
    requireMember,
    requireManager,
    async (c) => {
        const manager = siteMember(c);
        const body = await c.req.parseBody();
        try {
            await addLocation(
                liveFridgeStore(),
                manager.householdId,
                formText(body, "name"),
            );
        } catch (err) {
            return placesError(c, err, PLACES_ADD_ID);
        }
        // toast: none
        return c.redirect(PLACES_PATH, 303);
    },
);

// The place's items go with it, each through the stock ledger, in one
// transaction: either the place and its items are gone, or nothing changed.
householdPlacesRoutes.post(
    `${PLACES_PATH}/:id/remove`,
    requireMember,
    requireManager,
    async (c) => {
        const manager = siteMember(c);
        const id = c.req.param("id");
        try {
            const result = await removeFridgeLocation(
                liveFridgeStore(),
                liveStockStore(),
                liveFoodsStore(),
                {
                    householdId: manager.householdId,
                    locationId: id,
                    actorUserId: manager.userId,
                    transaction: run,
                },
            );
            if (!result.removed) {
                throw new FridgeInputError("That place is already gone.");
            }
        } catch (err) {
            return placesError(c, err, placeRemoveSheetId(id));
        }
        // toast: none
        return c.redirect(PLACES_PATH, 303);
    },
);
