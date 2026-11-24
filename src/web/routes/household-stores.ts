import { Hono, type Context } from "hono";

import { liveGroceryStore } from "../../db/grocery.js";
import { liveStoreManagement } from "../../db/grocery-stores.js";
import { liveRulesStore } from "../../db/rules.js";
import { liveSettingsStore } from "../../db/settings.js";
import {
    addSection,
    applyOrderMove,
    renameStore,
    reorderSections,
    setSectionHidden,
} from "../../domain/grocery-sections.js";
import {
    deleteStore,
    reorderStores,
    saveGroceryPreferences,
    storeLineCount,
} from "../../domain/grocery-stores.js";
import { addStoreRule, RulesInputError } from "../../domain/rules.js";
import {
    createGroceryStore,
    renameSection,
    SettingsInputError,
    type GroceryPreferences,
} from "../../domain/settings.js";
import { formText } from "../form.js";
import {
    renderSettingsStoreV2Route,
    renderSettingsStoresV2Route,
} from "../loaders.js";
import { requireManager, requireMember, siteMember } from "../middleware.js";
import {
    STORES_ADD_ID,
    STORES_PATH,
    STORES_REORDER_PATH,
} from "../pages/v2/settings-stores.js";
import {
    STORE_ADD_RULE_ID,
    STORE_ADD_SECTION_ID,
    STORE_DELETE_SHEET_ID,
} from "../pages/v2/settings-stores-detail.js";

/**
 * Settings › Household › Stores. Reading is open to every member; every write
 * is for owners and admins.
 */
export const householdStoresRoutes = new Hono();

const GENERIC_ERROR = "Could not save that. Try again.";

function errorMessage(err: unknown): string {
    return err instanceof SettingsInputError || err instanceof RulesInputError
        ? err.message
        : GENERIC_ERROR;
}

/** Everything the list page posts: re-render it with the message, 400. */
async function listError(
    c: Context,
    err: unknown,
    opts: { open?: string; reorder?: boolean } = {},
): Promise<Response> {
    const page = await renderSettingsStoresV2Route(c.get("userId"), {
        error: errorMessage(err),
        ...opts,
    });
    return c.html(page.html, page.status === 200 ? 400 : page.status);
}

/**
 * Everything a store page posts: re-render that page with the message, 400. A
 * store that is gone has no page to show, so the list carries the message.
 */
async function storeError(
    c: Context,
    storeId: string,
    err: unknown,
    opts: { open?: string; rename?: boolean; renameSectionId?: string } = {},
): Promise<Response> {
    const page = await renderSettingsStoreV2Route(c.get("userId"), storeId, {
        error: errorMessage(err),
        ...opts,
    });
    if (page.status === 404) return listError(c, err);
    return c.html(page.html, page.status === 200 ? 400 : page.status);
}

function storePath(storeId: string): string {
    return `${STORES_PATH}/${encodeURIComponent(storeId)}`;
}

/** `focus=` for a redirect after an up/down press; stores.js puts focus back on that arrow. */
function focusParam(move: string): string {
    return move === "" ? "" : `focus=${encodeURIComponent(move)}`;
}

function orderIds(
    body: Record<string, string | File | (string | File)[]>,
): string[] {
    const value = body.order;
    const list = Array.isArray(value)
        ? value
        : value === undefined
          ? []
          : [value];
    return list.filter((item): item is string => typeof item === "string");
}

async function storeInHousehold(
    householdId: string,
    storeId: string,
): Promise<boolean> {
    const stores = await liveSettingsStore().listStores(householdId);
    return stores.some((row) => row.id === storeId);
}

/** The section must be one of this store's, or the id is stale or foreign. */
async function sectionOfStore(
    householdId: string,
    storeId: string,
    sectionId: string,
): Promise<void> {
    const section = await liveSettingsStore().getSection(
        householdId,
        sectionId,
    );
    if (!section || section.storeId !== storeId) {
        throw new SettingsInputError("Unknown section.");
    }
}

householdStoresRoutes.get(STORES_PATH, requireMember, async (c) => {
    const page = await renderSettingsStoresV2Route(c.get("userId"), {
        reorder: c.req.query("reorder") === "1",
    });
    return c.html(page.html, page.status);
});

householdStoresRoutes.get(`${STORES_PATH}/:id`, requireMember, async (c) => {
    const page = await renderSettingsStoreV2Route(
        c.get("userId"),
        c.req.param("id"),
        {
            rename: c.req.query("rename") === "1",
            renameSectionId: c.req.query("rename_section") || undefined,
        },
    );
    return c.html(page.html, page.status);
});

householdStoresRoutes.post(
    `${STORES_PATH}/add`,
    requireMember,
    requireManager,
    async (c) => {
        const manager = siteMember(c);
        const body = await c.req.parseBody();
        try {
            await createGroceryStore(
                liveSettingsStore(),
                manager.householdId,
                formText(body, "name"),
            );
        } catch (err) {
            return listError(c, err, { open: STORES_ADD_ID });
        }
        // toast: none
        return c.redirect(STORES_PATH, 303);
    },
);

// The up/down buttons of the order form post `move=<id>:up|down` beside the
// full order; a drag posts the order alone. Either way the whole order is
// written, so a stale list is refused rather than half applied.
householdStoresRoutes.post(
    `${STORES_PATH}/order`,
    requireMember,
    requireManager,
    async (c) => {
        const manager = siteMember(c);
        const body = await c.req.parseBody({ all: true });
        const move = formText(body, "move");
        const ordered = move
            ? applyOrderMove(orderIds(body), move)
            : orderIds(body);
        try {
            await reorderStores(
                {
                    management: liveStoreManagement(),
                    settings: liveSettingsStore(),
                },
                manager.householdId,
                ordered,
            );
        } catch (err) {
            return listError(c, err, { reorder: true });
        }
        const focus = focusParam(move);
        // toast: none
        return c.redirect(
            `${STORES_REORDER_PATH}${focus ? `&${focus}` : ""}`,
            303,
        );
    },
);

householdStoresRoutes.post(
    `${STORES_PATH}/preferences`,
    requireMember,
    requireManager,
    async (c) => {
        const manager = siteMember(c);
        const body = await c.req.parseBody();
        const patch: Partial<GroceryPreferences> = {};
        if ("default_store_id" in body) {
            const id = formText(body, "default_store_id").trim();
            patch.defaultStoreId = id === "" ? null : id;
        }
        if ("use_usual_store" in body) {
            patch.useUsualStore = formText(body, "use_usual_store") === "1";
        }
        try {
            await saveGroceryPreferences(
                liveSettingsStore(),
                manager.householdId,
                patch,
            );
        } catch (err) {
            return listError(c, err);
        }
        // toast: none
        return c.redirect(STORES_PATH, 303);
    },
);

householdStoresRoutes.post(
    `${STORES_PATH}/:id/rename`,
    requireMember,
    requireManager,
    async (c) => {
        const manager = siteMember(c);
        const storeId = c.req.param("id");
        const body = await c.req.parseBody();
        try {
            await renameStore(
                liveSettingsStore(),
                manager.householdId,
                storeId,
                formText(body, "name"),
            );
        } catch (err) {
            return storeError(c, storeId, err, { rename: true });
        }
        // toast: none
        return c.redirect(storePath(storeId), 303);
    },
);

householdStoresRoutes.post(
    `${STORES_PATH}/:id/delete`,
    requireMember,
    requireManager,
    async (c) => {
        const manager = siteMember(c);
        const storeId = c.req.param("id");
        const body = await c.req.parseBody();
        const mode = formText(body, "mode");
        const moveTo = formText(body, "move_to").trim();
        try {
            const stores = await liveSettingsStore().listStores(
                manager.householdId,
            );
            const store = stores.find((row) => row.id === storeId);
            if (!store) throw new SettingsInputError("Unknown store.");
            const lines = await storeLineCount(
                liveStoreManagement(),
                manager.householdId,
                storeId,
            );
            // The dialog quoted a count; if lines came or went since, the
            // choice was made on stale numbers. Refuse and show the new count.
            const shown = Number.parseInt(formText(body, "lines"), 10);
            if (Number.isInteger(shown) && shown !== lines) {
                throw new SettingsInputError(
                    `The store changed: it now has ${lines} ${lines === 1 ? "line" : "lines"} on the list, not ${shown}. Check the choices and try again.`,
                );
            }
            if (lines > 0 && mode !== "move" && mode !== "delete") {
                throw new SettingsInputError(
                    `This store has ${lines} ${lines === 1 ? "line" : "lines"} on the list. Choose what to do with ${lines === 1 ? "it" : "them"}.`,
                );
            }
            if (mode === "move" && moveTo === "") {
                throw new SettingsInputError(
                    "Pick a store to move the lines to.",
                );
            }
            await deleteStore(
                {
                    management: liveStoreManagement(),
                    settings: liveSettingsStore(),
                    grocery: liveGroceryStore(),
                },
                manager.householdId,
                storeId,
                { moveTo: mode === "move" ? moveTo : null },
            );
        } catch (err) {
            return storeError(c, storeId, err, { open: STORE_DELETE_SHEET_ID });
        }
        // toast: none
        return c.redirect(STORES_PATH, 303);
    },
);

householdStoresRoutes.post(
    `${STORES_PATH}/:id/sections`,
    requireMember,
    requireManager,
    async (c) => {
        const manager = siteMember(c);
        const storeId = c.req.param("id");
        const body = await c.req.parseBody();
        try {
            await addSection(
                liveSettingsStore(),
                manager.householdId,
                storeId,
                formText(body, "name"),
            );
        } catch (err) {
            return storeError(c, storeId, err, { open: STORE_ADD_SECTION_ID });
        }
        // toast: none
        return c.redirect(storePath(storeId), 303);
    },
);

householdStoresRoutes.post(
    `${STORES_PATH}/:id/sections/order`,
    requireMember,
    requireManager,
    async (c) => {
        const manager = siteMember(c);
        const storeId = c.req.param("id");
        const body = await c.req.parseBody({ all: true });
        const move = formText(body, "move");
        // A section's ⋯ posts only the move; the order it applies to is the
        // one stored now, in walking order.
        const posted = orderIds(body);
        const bare = move !== "" && posted.length === 0;
        try {
            if (
                bare &&
                !(await storeInHousehold(manager.householdId, storeId))
            ) {
                throw new SettingsInputError("Unknown store.");
            }
            const current = bare
                ? (await liveSettingsStore().listSections(storeId))
                      .filter((row) => !row.hidden && !row.isOther)
                      .map((row) => row.id)
                : posted;
            const ordered = move ? applyOrderMove(current, move) : current;
            await reorderSections(
                liveSettingsStore(),
                manager.householdId,
                storeId,
                ordered,
            );
        } catch (err) {
            return storeError(c, storeId, err);
        }
        // After a section's ⋯ the menu closes with the page: stores.js puts
        // focus back on that section's ⋯.
        const section = bare ? move.slice(0, move.lastIndexOf(":")) : "";
        // toast: none
        return c.redirect(
            `${storePath(storeId)}${section ? `?focus=${encodeURIComponent(section)}` : ""}`,
            303,
        );
    },
);

householdStoresRoutes.post(
    `${STORES_PATH}/:id/sections/:sectionId/rename`,
    requireMember,
    requireManager,
    async (c) => {
        const manager = siteMember(c);
        const storeId = c.req.param("id");
        const sectionId = c.req.param("sectionId");
        const body = await c.req.parseBody();
        try {
            await sectionOfStore(manager.householdId, storeId, sectionId);
            await renameSection(
                liveSettingsStore(),
                manager.householdId,
                sectionId,
                formText(body, "name"),
            );
        } catch (err) {
            return storeError(c, storeId, err, {
                renameSectionId: sectionId,
            });
        }
        // toast: none
        return c.redirect(storePath(storeId), 303);
    },
);

householdStoresRoutes.post(
    `${STORES_PATH}/:id/sections/:sectionId/visibility`,
    requireMember,
    requireManager,
    async (c) => {
        const manager = siteMember(c);
        const storeId = c.req.param("id");
        const sectionId = c.req.param("sectionId");
        const body = await c.req.parseBody();
        const hide = formText(body, "hidden") === "1";
        try {
            await sectionOfStore(manager.householdId, storeId, sectionId);
            await setSectionHidden(
                liveSettingsStore(),
                manager.householdId,
                sectionId,
                hide,
            );
        } catch (err) {
            return storeError(c, storeId, err);
        }
        // toast: none
        return c.redirect(storePath(storeId), 303);
    },
);

householdStoresRoutes.post(
    `${STORES_PATH}/:id/rules/add`,
    requireMember,
    requireManager,
    async (c) => {
        const manager = siteMember(c);
        const storeId = c.req.param("id");
        const body = await c.req.parseBody();
        try {
            if (!(await storeInHousehold(manager.householdId, storeId))) {
                throw new SettingsInputError("Unknown store.");
            }
            await addStoreRule(liveRulesStore(), {
                householdId: manager.householdId,
                storeId,
                body: formText(body, "body"),
            });
        } catch (err) {
            return storeError(c, storeId, err, { open: STORE_ADD_RULE_ID });
        }
        // toast: none
        return c.redirect(storePath(storeId), 303);
    },
);
