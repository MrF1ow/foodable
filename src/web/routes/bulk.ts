/**
 * Select several rows, act once: one POST per list action, each taking the
 * ticked rows as `ids[]` (Saved foods & recipes: `food_ids[]` and
 * `recipe_ids[]`) and running them as one transaction (`src/db/bulk.ts`).
 *
 * Success is a 303 back to the list with a toast. A batch with nothing left to
 * do (`already`: a double submit, or a page that was stale) is the same 303
 * without a toast, since nothing changed. A refusal (a row that is gone,
 * nothing selected, a recipe the member may not delete) re-renders the list
 * with the reason at 400 and writes nothing, so Turbo shows it in place. The
 * list comes back with the filter it was on (`store`, `q` from `return_to`).
 */
import { Hono } from "hono";
import {
    BulkSelectionError,
    parseBulkIds,
    type BulkResult,
} from "../../domain/bulk.js";
import { FoodsInputError } from "../../domain/foods.js";
import { RecipeForbiddenError } from "../../domain/recipes.js";
import { StockInputError } from "../../domain/stock.js";
import {
    bulkDeleteSavedItems,
    bulkDiscardFridgeItems,
    bulkRemoveUsuals,
} from "../../db/bulk.js";
import { formText } from "../form.js";
import {
    renderFridgeInventoryPage,
    renderSettingsSavedV2Route,
    renderUsualProductsListPage,
} from "../loaders.js";
import { requireMember, siteMember } from "../middleware.js";
import { redirectWithToast } from "../components/toast.js";
import type { ToastKey } from "../../copy/toasts.js";
import { safeReturnPath } from "../usual-products-path.js";

export const bulkRoutes = new Hono();

type FormBody = Record<string, string | File | (string | File)[]>;

const GENERIC_ERROR = "Could not complete that. Try again.";

/** The reason to show: a domain refusal says why; anything else is not shown. */
function refusal(err: unknown): string {
    if (
        err instanceof BulkSelectionError ||
        err instanceof StockInputError ||
        err instanceof FoodsInputError ||
        err instanceof RecipeForbiddenError
    ) {
        return err.message;
    }
    console.error("bulk action failed", err);
    return GENERIC_ERROR;
}

/** `ids[]` as posted, or a single `ids` for a client that sends no brackets. */
function postedIds(body: FormBody, name = "ids"): unknown {
    return body[`${name}[]`] ?? body[name];
}

function returnPath(
    body: FormBody,
    fallback: string,
    resolve: (raw: string, fallback: string) => string = safeReturnPath,
): string {
    return resolve(
        formText(body as Record<string, string | File>, "return_to"),
        fallback,
    );
}

const SAVED_PATH = "/settings/saved";

/**
 * Where a Saved foods & recipes batch goes back to: the page itself with its
 * search. `safeReturnPath` refuses every `/settings/...` path as a back link,
 * so it would drop the `q` the person was searching with.
 */
function savedReturnPath(raw: string): string {
    try {
        const url = new URL(raw.trim(), "http://foodable.local");
        const q = url.searchParams.get("q")?.trim() ?? "";
        if (url.origin !== "http://foodable.local") {
            return SAVED_PATH;
        }
        if (url.pathname !== SAVED_PATH || q === "") return SAVED_PATH;
        return `${SAVED_PATH}?q=${encodeURIComponent(q)}`;
    } catch {
        return SAVED_PATH;
    }
}

/** A filter the list was on, read back from `return_to`; blank counts as none. */
function filterOf(path: string, name: "store" | "q"): string | undefined {
    try {
        const value = new URL(path, "http://foodable.local").searchParams.get(
            name,
        );
        return value && value.trim() !== "" ? value : undefined;
    } catch {
        return undefined;
    }
}

const storeOf = (path: string) => filterOf(path, "store");

type Render = (message: string) => Promise<{ html: string }>;

/** The shared shape of every action: parse, run, redirect or re-render. */
async function act(
    c: import("hono").Context,
    opts: {
        fallback: string;
        /** How `return_to` becomes a path; the default is `safeReturnPath`. */
        resolve?: (raw: string, fallback: string) => string;
        toast: ToastKey;
        run: (body: FormBody) => Promise<BulkResult>;
        render: (message: string, returnTo: string) => ReturnType<Render>;
    },
): Promise<Response> {
    const body = (await c.req.parseBody({ all: true })) as FormBody;
    const returnTo = returnPath(body, opts.fallback, opts.resolve);
    let result: BulkResult;
    try {
        result = await opts.run(body);
    } catch (err) {
        const page = await opts.render(refusal(err), returnTo);
        return c.html(page.html, 400);
    }
    // toast: none. Nothing changed, so there is nothing to announce.
    if (result.status === "already") return c.redirect(returnTo, 303);
    return redirectWithToast(c, returnTo, opts.toast);
}

bulkRoutes.post("/kitchen/fridge/bulk/discard", requireMember, (c) => {
    const member = siteMember(c);
    return act(c, {
        fallback: "/kitchen/fridge",
        toast: "fridge.items.discarded",
        run: (body) =>
            bulkDiscardFridgeItems({
                householdId: member.householdId,
                itemIds: parseBulkIds(postedIds(body)),
                actorUserId: c.get("userId"),
            }),
        render: (error) => renderFridgeInventoryPage(c.get("userId"), error),
    });
});

bulkRoutes.post("/kitchen/usuals/bulk/remove", requireMember, (c) => {
    const member = siteMember(c);
    return act(c, {
        fallback: "/kitchen/usuals",
        toast: "usuals.removed",
        run: (body) =>
            bulkRemoveUsuals({
                householdId: member.householdId,
                foodIds: parseBulkIds(postedIds(body)),
            }),
        render: (error, returnTo) =>
            renderUsualProductsListPage(c.get("userId"), {
                error,
                from: returnTo,
                storeFilter: storeOf(returnTo),
            }),
    });
});

bulkRoutes.post("/settings/saved/bulk/delete", requireMember, (c) => {
    const member = siteMember(c);
    return act(c, {
        fallback: SAVED_PATH,
        resolve: savedReturnPath,
        toast: "settings.saved.deleted",
        run: (body) => {
            const foodIds = body["food_ids[]"] ?? body["food_ids"];
            const recipeIds = body["recipe_ids[]"] ?? body["recipe_ids"];
            if (foodIds == null && recipeIds == null) {
                // Same refusal as an empty list, in one place.
                parseBulkIds(undefined);
            }
            return bulkDeleteSavedItems({
                householdId: member.householdId,
                foodIds: foodIds == null ? [] : parseBulkIds(foodIds),
                recipeIds: recipeIds == null ? [] : parseBulkIds(recipeIds),
                actor: {
                    userId: c.get("userId"),
                    isOwner: member.role === "owner",
                },
            });
        },
        render: (error, returnTo) =>
            renderSettingsSavedV2Route(c.get("userId"), {
                error,
                q: filterOf(returnTo, "q"),
            }),
    });
});
