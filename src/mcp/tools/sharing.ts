import { type McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { withAnalytics } from "../../analytics.js";
import { listHouseholdMembers } from "../../db/household.js";
import { liveRecipesStore } from "../../db/recipes.js";
import { liveShareLinkStore } from "../../db/share-links.js";
import {
    createShareLink,
    MAX_SHARE_EXPIRY_DAYS,
    MIN_SHARE_EXPIRY_DAYS,
    revokeShareLink,
    SHARE_KINDS,
    ShareLinkInputError,
    type ShareLink,
} from "../../domain/sharing.js";
import { gatedTool } from "../gated.js";
import type { ToolContext } from "../shared.js";

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CREATE_OUTPUT_SCHEMA = z.object({
    id: z.string(),
    kind: z.enum(SHARE_KINDS),
    target_id: z.string().nullable(),
    url: z.string(),
    created_at: z.string(),
    expires_at: z.string().nullable(),
});

const LIST_OUTPUT_SCHEMA = z.object({
    links: z.array(
        z.object({
            id: z.string(),
            kind: z.enum(SHARE_KINDS),
            target_id: z.string().nullable(),
            recipe_name: z.string().nullable(),
            created_at: z.string(),
            expires_at: z.string().nullable(),
            created_by: z.string().nullable(),
            created_by_name: z.string().nullable(),
        }),
    ),
});

const REVOKE_OUTPUT_SCHEMA = z.object({
    id: z.string(),
    kind: z.enum(SHARE_KINDS),
    revoked_at: z.string(),
});

export const SHARE_LINK_OUTPUT_SCHEMAS = {
    create: CREATE_OUTPUT_SCHEMA,
    list: LIST_OUTPUT_SCHEMA,
    revoke: REVOKE_OUTPUT_SCHEMA,
};

/** The public address a visitor opens: `<origin>/s/<token>`. */
export function shareLinkUrl(origin: string, token: string): string {
    return `${origin.replace(/\/+$/, "")}/s/${token}`;
}

const KIND_LABEL: Record<ShareLink["kind"], string> = {
    recipe: "recipe",
    grocery_list: "grocery list",
};

export function registerSharingTools(server: McpServer, ctx: ToolContext) {
    const { auth, baseUrl, callerHouseholdId, analytics } = ctx;

    gatedTool(
        server,
        ctx,
        "mcp-share-links",
        "create_share_link",
        {
            title: "Create Share Link",
            description: `Create a public, read-only link to one recipe or to the household's grocery list, for anyone who has the link (no account needed). The link is returned once in url and cannot be shown again; to hand out another, create another. kind is "recipe" (target_id = the recipe id) or "grocery_list" (no target_id). expires_in_days is a whole number from ${MIN_SHARE_EXPIRY_DAYS} to ${MAX_SHARE_EXPIRY_DAYS}; leave it out for a link that never expires. Anyone holding the link can read the shared recipe or list, so confirm with the person before creating one. Revoke it with revoke_share_link.`,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            inputSchema: z.object({
                kind: z.enum(SHARE_KINDS),
                target_id: z
                    .string()
                    .optional()
                    .describe("The recipe id. Required for kind recipe."),
                expires_in_days: z
                    .number()
                    .optional()
                    .describe(
                        `Whole days from ${MIN_SHARE_EXPIRY_DAYS} to ${MAX_SHARE_EXPIRY_DAYS}. Omit for a link that never expires.`,
                    ),
            }),
            outputSchema: CREATE_OUTPUT_SCHEMA,
        },
        async (args) =>
            withAnalytics(
                "create_share_link",
                async () => {
                    const householdId = await callerHouseholdId();
                    // The live recipes store casts the id to a uuid and throws
                    // a raw database error on anything else.
                    if (
                        args.kind === "recipe" &&
                        args.target_id != null &&
                        !UUID_RE.test(args.target_id)
                    ) {
                        throw new Error(
                            "target_id must be a recipe id (a uuid); find it with list_recipes.",
                        );
                    }
                    let created;
                    try {
                        created = await createShareLink(
                            liveShareLinkStore(),
                            {
                                householdId,
                                kind: args.kind,
                                targetId: args.target_id ?? null,
                                // A household token has no member behind it.
                                createdBy:
                                    auth.kind === "household"
                                        ? null
                                        : auth.userId,
                                expiresInDays: args.expires_in_days,
                            },
                            new Date(),
                            liveRecipesStore(),
                        );
                    } catch (err) {
                        if (err instanceof ShareLinkInputError) {
                            throw new Error(err.message);
                        }
                        throw err;
                    }
                    const { link, token } = created;
                    const url = shareLinkUrl(baseUrl, token);
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: `Share link for the ${KIND_LABEL[link.kind]}: ${url}\nIt is shown only now. ${
                                    link.expiresAt
                                        ? `It expires ${link.expiresAt}.`
                                        : "It never expires."
                                } Revoke it with revoke_share_link id ${link.id}.`,
                            },
                        ],
                        structuredContent: {
                            id: link.id,
                            kind: link.kind,
                            target_id: link.targetId,
                            url,
                            created_at: link.createdAt,
                            expires_at: link.expiresAt,
                        },
                    };
                },
                analytics,
            ),
    );

    gatedTool(
        server,
        ctx,
        "mcp-share-links",
        "list_share_links",
        {
            title: "List Share Links",
            description:
                "List the household's active share links (not revoked, not expired): id, kind, the recipe name for a recipe link, when it was made and who made it, and when it expires. The link addresses themselves cannot be recovered; create a new link to get one.",
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            outputSchema: LIST_OUTPUT_SCHEMA,
        },
        async () =>
            withAnalytics(
                "list_share_links",
                async () => {
                    const householdId = await callerHouseholdId();
                    const links =
                        await liveShareLinkStore().listForHousehold(
                            householdId,
                        );
                    const [members, recipes] = await Promise.all([
                        links.some((l) => l.createdBy !== null)
                            ? listHouseholdMembers(householdId)
                            : Promise.resolve([]),
                        links.some((l) => l.kind === "recipe")
                            ? liveRecipesStore().listRecipes(householdId)
                            : Promise.resolve([]),
                    ]);
                    const memberName = new Map(
                        members.map((m) => [m.userId, m.displayName]),
                    );
                    const recipeName = new Map(
                        recipes.map((r) => [r.id, r.name]),
                    );
                    const wire = links.map((l) => ({
                        id: l.id,
                        kind: l.kind,
                        target_id: l.targetId,
                        recipe_name:
                            l.targetId === null
                                ? null
                                : (recipeName.get(l.targetId) ?? null),
                        created_at: l.createdAt,
                        expires_at: l.expiresAt,
                        created_by: l.createdBy,
                        created_by_name:
                            l.createdBy === null
                                ? null
                                : (memberName.get(l.createdBy) ?? null),
                    }));
                    const text =
                        wire.length === 0
                            ? "No active share links."
                            : wire
                                  .map(
                                      (l) =>
                                          `${l.id} ${
                                              l.recipe_name
                                                  ? `recipe "${l.recipe_name}"`
                                                  : l.kind === "recipe"
                                                    ? "recipe (deleted)"
                                                    : "grocery list"
                                          }, made ${l.created_at}${
                                              l.created_by_name
                                                  ? ` by ${l.created_by_name}`
                                                  : ""
                                          }, ${
                                              l.expires_at
                                                  ? `expires ${l.expires_at}`
                                                  : "never expires"
                                          }`,
                                  )
                                  .join("\n");
                    return {
                        content: [{ type: "text" as const, text }],
                        structuredContent: { links: wire },
                    };
                },
                analytics,
            ),
    );

    gatedTool(
        server,
        ctx,
        "mcp-share-links",
        "revoke_share_link",
        {
            title: "Revoke Share Link",
            description:
                "Revoke a share link of this household by id (from list_share_links or create_share_link): the link stops working at once. Revoking a link that is already revoked succeeds and changes nothing; an unknown id, or one from another household, is not found.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: z.object({ id: z.string() }),
            outputSchema: REVOKE_OUTPUT_SCHEMA,
        },
        async ({ id }) =>
            withAnalytics(
                "revoke_share_link",
                async () => {
                    const householdId = await callerHouseholdId();
                    const link = await revokeShareLink(
                        liveShareLinkStore(),
                        householdId,
                        id,
                        new Date(),
                    );
                    if (!link || link.revokedAt === null) {
                        throw new Error("Share link not found.");
                    }
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: `Revoked the ${KIND_LABEL[link.kind]} share link ${link.id}. It no longer works.`,
                            },
                        ],
                        structuredContent: {
                            id: link.id,
                            kind: link.kind,
                            revoked_at: link.revokedAt,
                        },
                    };
                },
                analytics,
            ),
    );
}
