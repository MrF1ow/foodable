// Import a recipe another Foodable shared: paste its share link or its JSON on
// Recipes. Members only, and only while `mcp-share-links` is on (the route is a
// 404 otherwise), and the household is always the session's. The rules live in
// domain/sharing-source.ts (what may be fetched) and domain/sharing-import.ts
// (how it is matched and written); the live wiring is src/sharing-import.ts,
// shared with the agent tool.
//
// Success is a 303 to the new recipe with a toast. A refusal re-renders Recipes
// in place (422) with the import panel open, the reason beside the paste box
// and what was pasted still in it. Nothing about the pasted link is logged.

import { Hono, type Context } from "hono";
import { gatedRoute } from "../gated.js";
import { formText } from "../form.js";
import { renderRecipesListPage } from "../loaders.js";
import { requireMember, siteMember } from "../middleware.js";
import {
    importSharedRecipeForHousehold,
    sharedImportFailure,
} from "../../sharing-import.js";

export const sharedRecipeImportRoutes = new Hono();

/**
 * How much of a refused paste goes back into the box. A share link or a
 * document of a normal recipe fits well inside; a megabyte of something else
 * is not worth sending back to the browser, so the box comes back empty.
 */
export const SHARED_IMPORT_ECHO_LIMIT = 4096;

/**
 * The refusal as the error card shows it. The one the person can act on, a
 * link that no longer resolves, gets the design's headline and reason; every
 * other refusal is its message as the headline.
 */
function sharedImportErrorParts(failure: { code: string; message: string }): {
    error: string;
    reason?: string;
} {
    if (failure.code === "not_found") {
        return {
            error: "That share link doesn't work any more",
            reason: "Revoked, expired, or not a recipe link",
        };
    }
    return { error: failure.message };
}

/**
 * Imports `input` for the signed-in member and answers the request: a 303 to
 * the new recipe, or the Recipes page with the reason beside the paste box
 * (also when the link was pasted into the link form instead).
 */
export async function answerSharedRecipeImport(
    c: Context,
    input: string,
): Promise<Response> {
    const userId = c.get("userId") as string;
    const member = siteMember(c);
    try {
        const result = await importSharedRecipeForHousehold({
            householdId: member.householdId,
            creatorId: userId,
            input,
        });
        // toast: none
        return c.redirect(`/recipes/${result.recipe.id}`, 303);
    } catch (err) {
        const failure = sharedImportFailure(err);
        if (!failure) throw err;
        const page = await renderRecipesListPage(userId, {
            sharedImport: {
                ...sharedImportErrorParts(failure),
                input: input.length <= SHARED_IMPORT_ECHO_LIMIT ? input : "",
            },
        });
        return c.html(page.html, page.status === 200 ? 422 : page.status);
    }
}

sharedRecipeImportRoutes.post(
    "/recipes/import-shared",
    requireMember,
    gatedRoute("mcp-share-links", { notFound: true }),
    async (c) => {
        const body = await c.req.parseBody();
        return answerSharedRecipeImport(c, formText(body, "shared"));
    },
);
