// share_links against real Postgres: the unique token hash, the kind/target
// check, per-household listing and revoking, row level security as
// foodable_app, and the cascades. The in-memory twin is covered in
// src/domain/sharing.test.ts.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { liveRecipesStore } from "./recipes.js";
import { liveShareLinkStore } from "./share-links.js";
import { setSqlForTests } from "./sql.js";
import { asUser, seedHousehold } from "./testing/fixtures.js";
import { describeDb } from "./testing/pg.js";
import { findPgBin } from "./testing/pg-temp.js";
import { createRecipe } from "../domain/recipes.js";
import {
    createShareLink,
    hashToken,
    ShareLinkInputError,
    resolveShareToken,
    revokeShareLink,
} from "../domain/sharing.js";

const pgAvailable = await findPgBin();
if (!pgAvailable) {
    if (process.env.CI) {
        throw new Error(
            "database tests skipped: no initdb (install postgresql and set PG_BIN)",
        );
    }
    console.warn("database tests skipped: no initdb (set PG_BIN)");
}

const NOW = new Date("2026-11-12T12:00:00.000Z");

describeDb(pgAvailable !== null, "share links db", (getCtx) => {
    let householdId: string;
    let ownerId: string;
    let otherHouseholdId: string;
    let otherOwnerId: string;

    beforeEach(async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const a = await seedHousehold(sql);
        householdId = a.householdId;
        ownerId = a.userId;
        const b = await seedHousehold(sql);
        otherHouseholdId = b.householdId;
        otherOwnerId = b.userId;
    });

    afterEach(() => {
        setSqlForTests(null);
    });

    const store = liveShareLinkStore();
    const recipes = liveRecipesStore();

    // A real recipe in `hh`, made as that household's owner.
    async function seedRecipe(hh: string, by: string): Promise<string> {
        const made = await asUser(
            by,
            () =>
                createRecipe(recipes, {
                    householdId: hh,
                    creatorId: by,
                    name: "Lentil soup",
                    yieldPortions: 4,
                }),
            hh,
        );
        return made.id;
    }

    async function mintRecipe(
        hh = householdId,
        by: string | null = ownerId,
        expiresInDays?: number,
    ) {
        const author = by ?? (hh === householdId ? ownerId : otherOwnerId);
        const targetId = await seedRecipe(hh, author);
        return asUser(
            author,
            () =>
                createShareLink(
                    store,
                    {
                        householdId: hh,
                        kind: "recipe",
                        targetId,
                        createdBy: by,
                        expiresInDays,
                    },
                    NOW,
                    recipes,
                ),
            hh,
        );
    }

    test("a link is stored by hash, found by hash, and the raw token is nowhere in the table", async () => {
        const { sql } = getCtx();
        const { link, token } = await mintRecipe();
        expect(link.kind).toBe("recipe");
        expect(link.householdId).toBe(householdId);
        expect(link.createdBy).toBe(ownerId);
        expect(link.revokedAt).toBeNull();
        expect(link.expiresAt).toBeNull();

        const [row] = (await sql`
            select token_hash, to_jsonb(s)::text as whole
            from public.share_links s where id = ${link.id}
        `) as { token_hash: string; whole: string }[];
        expect(row!.token_hash).toBe(hashToken(token));
        expect(row!.whole).not.toContain(token);

        const found = await store.findByHash(hashToken(token));
        expect(found).toEqual(link);
        // the raw token is not a hash
        expect(await store.findByHash(token)).toBeNull();
    });

    test("a link cannot name a recipe that is missing or another household's", async () => {
        const theirs = await seedRecipe(otherHouseholdId, otherOwnerId);
        for (const targetId of [theirs, crypto.randomUUID()]) {
            await expect(
                asUser(
                    ownerId,
                    () =>
                        createShareLink(
                            store,
                            {
                                householdId,
                                kind: "recipe",
                                targetId,
                                createdBy: ownerId,
                            },
                            NOW,
                            recipes,
                        ),
                    householdId,
                ),
            ).rejects.toBeInstanceOf(ShareLinkInputError);
        }
        expect(
            await asUser(
                ownerId,
                () =>
                    store.listForHousehold(householdId, {
                        now: NOW,
                        includeInactive: true,
                    }),
                householdId,
            ),
        ).toEqual([]);
    });

    test("the public lookup works for a visitor in no household", async () => {
        const { link, token } = await mintRecipe();
        // no actor at all: findByHash supplies its own system actor
        const found = await resolveShareToken(store, token, NOW);
        expect(found?.id).toBe(link.id);
        // and as a member of another household
        const asOther = await asUser(
            otherOwnerId,
            () => resolveShareToken(store, token, NOW),
            otherHouseholdId,
        );
        expect(asOther?.id).toBe(link.id);
    });

    test("expiry round trips as an instant, and an expired link does not resolve", async () => {
        const { link, token } = await mintRecipe(householdId, ownerId, 2);
        expect(link.expiresAt).toBe("2026-11-14T12:00:00.000Z");
        expect(await resolveShareToken(store, token, NOW)).not.toBeNull();
        expect(
            await resolveShareToken(
                store,
                token,
                new Date("2026-11-14T12:00:00.000Z"),
            ),
        ).toBeNull();
    });

    test("token_hash is unique", async () => {
        const { sql } = getCtx();
        const { link } = await mintRecipe();
        const [stored] = (await sql`
            select token_hash from public.share_links where id = ${link.id}
        `) as { token_hash: string }[];
        const token_hash = stored!.token_hash;
        await expect(
            asUser(
                ownerId,
                () =>
                    store.create({
                        householdId,
                        kind: "grocery_list",
                        targetId: null,
                        createdBy: ownerId,
                        tokenHash: token_hash,
                        expiresAt: null,
                    }),
                householdId,
            ),
        ).rejects.toThrow(/duplicate key|unique/i);
    });

    test("a recipe needs a target and the grocery list refuses one", async () => {
        const { sql } = getCtx();
        const insert = async (kind: string, targetId: string | null) => {
            await sql`
                insert into public.share_links (household_id, kind, target_id, token_hash)
                values (${householdId}, ${kind}, ${targetId}, ${crypto.randomUUID()})
            `;
        };
        await expect(insert("recipe", null)).rejects.toThrow(/check/i);
        await expect(
            insert("grocery_list", crypto.randomUUID()),
        ).rejects.toThrow(/check/i);
        await expect(insert("fridge", null)).rejects.toThrow(/check/i);
        await insert("recipe", crypto.randomUUID());
        await insert("grocery_list", null);
    });

    test("listing is per household, newest first, active only unless asked", async () => {
        const first = await mintRecipe();
        const second = await mintRecipe(householdId, ownerId, 1);
        const third = await mintRecipe();
        await mintRecipe(otherHouseholdId, otherOwnerId);
        await asUser(
            ownerId,
            () => revokeShareLink(store, householdId, third.link.id, NOW),
            householdId,
        );

        const later = new Date("2026-11-14T00:00:00.000Z");
        const active = await asUser(
            ownerId,
            () => store.listForHousehold(householdId, { now: later }),
            householdId,
        );
        expect(active.map((l) => l.id)).toEqual([first.link.id]);

        const all = await asUser(
            ownerId,
            () =>
                store.listForHousehold(householdId, {
                    now: later,
                    includeInactive: true,
                }),
            householdId,
        );
        expect(all.map((l) => l.id)).toEqual([
            third.link.id,
            second.link.id,
            first.link.id,
        ]);
        expect(all.every((l) => l.householdId === householdId)).toBe(true);
    });

    test("revoking is household-scoped and idempotent", async () => {
        const { link, token } = await mintRecipe();

        // household B cannot revoke household A's link: the policy hides it
        const crossed = await asUser(
            otherOwnerId,
            () => revokeShareLink(store, householdId, link.id, NOW),
            otherHouseholdId,
        );
        expect(crossed).toBeNull();
        // asking as one's own household for this link's id finds nothing too:
        // the query filters on household_id (this runs on the app pool, so the
        // policy applies as well)
        const sameHouseholdOnly = await asUser(
            otherOwnerId,
            () => revokeShareLink(store, otherHouseholdId, link.id, NOW),
            otherHouseholdId,
        );
        expect(sameHouseholdOnly).toBeNull();
        expect(await resolveShareToken(store, token, NOW)).not.toBeNull();

        const first = await asUser(
            ownerId,
            () => revokeShareLink(store, householdId, link.id, NOW),
            householdId,
        );
        expect(first?.revokedAt).toBe(NOW.toISOString());
        expect(await resolveShareToken(store, token, NOW)).toBeNull();

        const second = await asUser(
            ownerId,
            () =>
                revokeShareLink(
                    store,
                    householdId,
                    link.id,
                    new Date("2026-11-20T00:00:00.000Z"),
                ),
            householdId,
        );
        expect(second?.revokedAt).toBe(NOW.toISOString());

        // an id that is not a uuid, or not a link, is simply not found
        expect(
            await asUser(
                ownerId,
                () => revokeShareLink(store, householdId, "nope", NOW),
                householdId,
            ),
        ).toBeNull();
        expect(
            await asUser(
                ownerId,
                () =>
                    revokeShareLink(
                        store,
                        householdId,
                        crypto.randomUUID(),
                        NOW,
                    ),
                householdId,
            ),
        ).toBeNull();
    });

    test("row level security: another household reads, writes and deletes nothing", async () => {
        const { sql, appSql } = getCtx();
        const { link } = await mintRecipe();

        async function asApp<T>(
            hh: string,
            user: string,
            fn: (tx: typeof appSql) => Promise<T>,
        ): Promise<T> {
            return (await appSql.begin(async (tx) => {
                await tx`select set_config('request.jwt.claim.sub', ${user}, true),
                                set_config('app.household_id', ${hh}, true)`;
                return fn(tx as unknown as typeof appSql);
            })) as T;
        }

        const seen = await asApp(
            otherHouseholdId,
            otherOwnerId,
            (tx) => tx`select id from public.share_links`,
        );
        expect(seen).toHaveLength(0);

        const own = await asApp(
            householdId,
            ownerId,
            (tx) => tx`select id from public.share_links`,
        );
        expect(own.map((r: { id: string }) => r.id)).toEqual([link.id]);

        // insert into the other household's id
        await expect(
            asApp(
                otherHouseholdId,
                otherOwnerId,
                (tx) => tx`
                    insert into public.share_links (household_id, kind, token_hash)
                    values (${householdId}, ${"grocery_list"}, ${crypto.randomUUID()})
                `,
            ),
        ).rejects.toThrow(/row-level security/i);

        const updated = await asApp(
            otherHouseholdId,
            otherOwnerId,
            (tx) => tx`
                update public.share_links set revoked_at = now()
                where id = ${link.id} returning id
            `,
        );
        expect(updated).toHaveLength(0);
        const deleted = await asApp(
            otherHouseholdId,
            otherOwnerId,
            (tx) =>
                tx`delete from public.share_links where id = ${link.id} returning id`,
        );
        expect(deleted).toHaveLength(0);

        // with no household set the table is empty to the app role
        const none = await asApp(
            "",
            "",
            (tx) => tx`select id from public.share_links`,
        );
        expect(none).toHaveLength(0);

        const [still] = (await sql`
            select revoked_at from public.share_links where id = ${link.id}
        `) as { revoked_at: unknown }[];
        expect(still!.revoked_at).toBeNull();
    });

    test("deleting the household takes its links", async () => {
        const { sql } = getCtx();
        const mine = await mintRecipe();
        const theirs = await mintRecipe(otherHouseholdId, otherOwnerId);
        await sql`delete from public.households where id = ${householdId}`;
        expect(await store.findByHash(hashToken(mine.token))).toBeNull();
        expect((await store.findByHash(hashToken(theirs.token)))?.id).toBe(
            theirs.link.id,
        );
    });

    test("deleting the member who made a link keeps it, with no creator", async () => {
        const { sql } = getCtx();
        const { link, token } = await mintRecipe();
        await sql`delete from public.users where id = ${ownerId}`;
        const found = await resolveShareToken(store, token, NOW);
        expect(found?.id).toBe(link.id);
        expect(found?.createdBy).toBeNull();
    });
});
