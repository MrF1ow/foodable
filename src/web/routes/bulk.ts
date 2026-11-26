/**
 * Select several rows, act once. Saved foods & recipes is the one list with a
 * select mode: its POST takes the ticked rows as `food_ids[]` and
 * `recipe_ids[]` and runs them as one transaction (`src/db/bulk.ts`). The
 * Kitchen tabs have none (their bulk routes are gone).
 *
 * Success is a 303 back to the list, with no toast: the list shows what
 * changed. A batch with nothing left to do (`already`: a double submit, or a
 * page that was stale) is the same 303. A refusal (a row that is gone,
 * nothing selected, a recipe the member may not delete) re-renders the list
 * with the reason at 400 and writes nothing, so Turbo shows it in place. The
 * list comes back with the search it was on (`q` from `return_to`).
 */
import { Hono } from "hono";
import {
    BulkSelectionError,
    parseBulkIds,
    type BulkResult,
} from "../../domain/bulk.js";
import { FoodsInputError } from "../../domain/foods.js";
import { can } from "../../domain/permissions.js";
import { RecipeForbiddenError } from "../../domain/recipes.js";
import { bulkDeleteSavedItems } from "../../db/bulk.js";
import { formText } from "../form.js";
import { renderSettingsSavedV2Route } from "../loaders.js";
import { requireMember, siteMember } from "../middleware.js";
import { safeReturnPath } from "../usual-products-path.js";

export const bulkRoutes = new Hono();

type FormBody = Record<string, string | File | (string | File)[]>;

const GENERIC_ERROR = "Could not complete that. Try again.";

/** The reason to show: a domain refusal says why; anything else is not shown. */
function refusal(err: unknown): string {
    if (
        err instanceof BulkSelectionError ||
        err instanceof FoodsInputError ||
        err instanceof RecipeForbiddenError
    ) {
        return err.message;
    }
    console.error("bulk action failed", err);
    return GENERIC_ERROR;
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
function filterOf(path: string, name: "q"): string | undefined {
    try {
        const value = new URL(path, "http://foodable.local").searchParams.get(
            name,
        );
        return value && value.trim() !== "" ? value : undefined;
    } catch {
        return undefined;
    }
}

type Render = (message: string) => Promise<{ html: string }>;

/** The shared shape of every action: parse, run, redirect or re-render. */
async function act(
    c: import("hono").Context,
    opts: {
        fallback: string;
        /** How `return_to` becomes a path; the default is `safeReturnPath`. */
        resolve?: (raw: string, fallback: string) => string;
        run: (body: FormBody) => Promise<BulkResult>;
        render: (message: string, returnTo: string) => ReturnType<Render>;
    },
): Promise<Response> {
    const body = (await c.req.parseBody({ all: true })) as FormBody;
    const returnTo = returnPath(body, opts.fallback, opts.resolve);
    try {
        await opts.run(body);
    } catch (err) {
        const page = await opts.render(refusal(err), returnTo);
        return c.html(page.html, 400);
    }
    // toast: none. The list shows what changed.
    return c.redirect(returnTo, 303);
}

bulkRoutes.post("/settings/saved/bulk/delete", requireMember, (c) => {
    const member = siteMember(c);
    return act(c, {
        fallback: SAVED_PATH,
        resolve: savedReturnPath,
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
                    isOwner: can(member, "recipe.delete_any").ok,
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
