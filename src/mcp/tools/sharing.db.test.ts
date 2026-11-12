// The share link tools against real Postgres, through the real /mcp handler on
// both protocol eras: the link a member creates resolves with the returned
// token, a revoked one no longer does, and one household cannot touch another's.
// The in-memory tool tests are in the "share link tools" block of src/mcp.test.ts.
import {
    Client,
    StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { setSqlForTests } from "../../db/sql.js";
import { liveRecipesStore } from "../../db/recipes.js";
import { liveShareLinkStore } from "../../db/share-links.js";
import { asUser, seedHousehold } from "../../db/testing/fixtures.js";
import { describeDb } from "../../db/testing/pg.js";
import { findPgBin } from "../../db/testing/pg-temp.js";
import { createRecipe } from "../../domain/recipes.js";
import { resolveShareToken } from "../../domain/sharing.js";
import {
    createMemoryFlags,
    resetFlagsForTests,
    setFlagsForTests,
} from "../../flags.js";
import { handleMcp } from "../server.js";
import { SHARE_LINK_OUTPUT_SCHEMAS } from "./sharing.js";

const pgAvailable = await findPgBin();
if (!pgAvailable) {
    if (process.env.CI) {
        throw new Error(
            "database tests skipped: no initdb (install postgresql and set PG_BIN)",
        );
    }
    console.warn("database tests skipped: no initdb (set PG_BIN)");
}

type Era = "legacy" | { pin: "2026-07-28" };
const ERAS: Era[] = ["legacy", { pin: "2026-07-28" }];

type Result = {
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
    content: { type: string; text: string }[];
};

async function withClient<T>(
    auth: { kind: "user"; userId: string },
    era: Era,
    run: (
        call: (name: string, args?: Record<string, unknown>) => Promise<Result>,
    ) => Promise<T>,
): Promise<T> {
    const app = new Hono();
    app.all("/mcp", (c) => {
        c.set("authContext", auth);
        return handleMcp(c);
    });
    const client = new Client(
        { name: "t", version: "0" },
        { versionNegotiation: { mode: era } },
    );
    await client.connect(
        new StreamableHTTPClientTransport(new URL("http://test.local/mcp"), {
            fetch: async (url, init) =>
                app.request(new Request(String(url), init)),
        }),
    );
    try {
        return await run(
            async (name, args) =>
                (await client.callTool({
                    name,
                    arguments: args ?? {},
                })) as Result,
        );
    } finally {
        await client.close();
    }
}

describeDb(pgAvailable !== null, "share link tools (db)", (getCtx) => {
    let householdId: string;
    let ownerId: string;
    let otherHouseholdId: string;
    let otherOwnerId: string;

    beforeEach(async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        setFlagsForTests(createMemoryFlags({ "mcp-share-links": true }));
        ({ householdId, userId: ownerId } = await seedHousehold(sql));
        ({ householdId: otherHouseholdId, userId: otherOwnerId } =
            await seedHousehold(sql));
    });

    afterEach(() => {
        resetFlagsForTests();
        setSqlForTests(null);
    });

    const recipes = liveRecipesStore();
    const store = liveShareLinkStore();

    async function seedRecipe(hh: string, by: string, name = "Lentil soup") {
        const made = await asUser(
            by,
            () =>
                createRecipe(recipes, {
                    householdId: hh,
                    creatorId: by,
                    name,
                    yieldPortions: 4,
                }),
            hh,
        );
        return made.id;
    }

    function resolve(token: string) {
        return asUser(
            ownerId,
            () => resolveShareToken(store, token, new Date()),
            householdId,
        );
    }

    test.each(ERAS)(
        "create resolves with the returned token, list shows it, revoke ends it (%p)",
        async (era) => {
            const recipeId = await seedRecipe(householdId, ownerId);
            await withClient(
                { kind: "user", userId: ownerId },
                era,
                async (call) => {
                    const made = await call("create_share_link", {
                        kind: "recipe",
                        target_id: recipeId,
                        expires_in_days: 30,
                    });
                    expect(made.isError).toBeFalsy();
                    const parsed = SHARE_LINK_OUTPUT_SCHEMAS.create.parse(
                        made.structuredContent,
                    );
                    const token = parsed.url.split("/s/")[1]!;
                    expect(parsed.url).toBe(`http://test.local/s/${token}`);

                    const link = await resolve(token);
                    expect(link).toMatchObject({
                        id: parsed.id,
                        householdId,
                        kind: "recipe",
                        targetId: recipeId,
                        createdBy: ownerId,
                    });

                    const listed = SHARE_LINK_OUTPUT_SCHEMAS.list.parse(
                        (await call("list_share_links")).structuredContent,
                    );
                    expect(listed.links).toHaveLength(1);
                    expect(listed.links[0]).toMatchObject({
                        id: parsed.id,
                        recipe_name: "Lentil soup",
                        created_by: ownerId,
                        created_by_name: "Owner",
                    });

                    const revoked = await call("revoke_share_link", {
                        id: parsed.id,
                    });
                    expect(revoked.isError).toBeFalsy();
                    expect(await resolve(token)).toBeNull();
                    // Revoking again is not an error.
                    expect(
                        (await call("revoke_share_link", { id: parsed.id }))
                            .isError,
                    ).toBeFalsy();
                    expect(
                        SHARE_LINK_OUTPUT_SCHEMAS.list.parse(
                            (await call("list_share_links")).structuredContent,
                        ).links,
                    ).toEqual([]);
                },
            );
        },
    );

    test.each(ERAS)(
        "a grocery list link resolves, and another household's recipe or link is refused (%p)",
        async (era) => {
            const foreignRecipe = await seedRecipe(
                otherHouseholdId,
                otherOwnerId,
                "Secret stew",
            );
            const foreignLink = await asUser(
                otherOwnerId,
                () =>
                    store.create({
                        householdId: otherHouseholdId,
                        kind: "grocery_list",
                        targetId: null,
                        createdBy: otherOwnerId,
                        tokenHash: "d".repeat(64),
                        expiresAt: null,
                    }),
                otherHouseholdId,
            );
            await withClient(
                { kind: "user", userId: ownerId },
                era,
                async (call) => {
                    const grocery = await call("create_share_link", {
                        kind: "grocery_list",
                    });
                    const parsed = SHARE_LINK_OUTPUT_SCHEMAS.create.parse(
                        grocery.structuredContent,
                    );
                    expect(
                        (await resolve(parsed.url.split("/s/")[1]!))?.kind,
                    ).toBe("grocery_list");

                    const cross = await call("create_share_link", {
                        kind: "recipe",
                        target_id: foreignRecipe,
                    });
                    expect(cross.isError).toBe(true);
                    expect(cross.content[0]!.text).toMatch(
                        /not in your household/i,
                    );

                    const garbage = await call("create_share_link", {
                        kind: "recipe",
                        target_id: "not-a-uuid",
                    });
                    expect(garbage.isError).toBe(true);
                    expect(garbage.content[0]!.text).not.toMatch(
                        /failed|syntax/i,
                    );

                    const revoke = await call("revoke_share_link", {
                        id: foreignLink.id,
                    });
                    expect(revoke.isError).toBe(true);
                    expect(revoke.content[0]!.text).toMatch(/not found/i);
                },
            );
            const still = await asUser(
                otherOwnerId,
                () => store.listForHousehold(otherHouseholdId),
                otherHouseholdId,
            );
            expect(still).toHaveLength(1);
            expect(still[0]!.revokedAt).toBeNull();
        },
    );
});
