import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { resetFlagsForTests } from "../flags.js";
import { createProduct } from "../domain/foods.js";
import {
    createMemoryNotificationsStore,
    type NotificationMember,
    type NotificationPref,
    type NotificationRow,
} from "../domain/notifications.js";
import type { NotificationKind } from "../domain/notification-kinds.js";
import { planRecipe } from "../domain/plan.js";
import { createRecipe, deleteRecipe } from "../domain/recipes.js";
import { mintSiteSession, SITE_COOKIE } from "../site-session.js";
import { bulkRoutes } from "../web/routes/bulk.js";
import { householdRoutes } from "../web/routes/household.js";
import { recipesRoutes } from "../web/routes/recipes.js";
import { usualAddRoutes } from "../web/routes/usual-add.js";
import { setFallbackActorForTests } from "./actor.js";
import { bulkDeleteSavedItems, inBulkTransaction } from "./bulk.js";
import { liveFoodsStore } from "./foods.js";
import { liveNotificationsStore } from "./notifications.js";
import {
    createNotifyQueue,
    liveNotifier,
    notifierFor,
    notifyHousehold,
    liveNotifyDeps,
    setNotifyDepsForTests,
    type NotifyDeps,
} from "./notify.js";
import { liveRecipePlansStore } from "./plans.js";
import { liveRecipesStore } from "./recipes.js";
import { setSqlForTests } from "./sql.js";
import { seedFood, seedHousehold, seedMember } from "./testing/fixtures.js";
import { describeDb } from "./testing/pg.js";
import { findPgBin } from "./testing/pg-temp.js";

process.env.SESSION_SECRET ||= "01234567890123456789012345678901";
process.env.OAUTH_CLIENT_SECRET ||= "test-client-secret-thirty-two-chars-min";

const pgAvailable = await findPgBin();

const HH = "00000000-0000-4000-8000-0000000000a1";
const ACTOR = "00000000-0000-4000-8000-0000000000b1";
const SAM = "00000000-0000-4000-8000-0000000000b2";
const KIM = "00000000-0000-4000-8000-0000000000b3";

const MEMBERS: NotificationMember[] = [
    { userId: ACTOR, role: "owner" },
    { userId: SAM, role: "member" },
    { userId: KIM, role: "admin" },
];

function on(userId: string, kind: NotificationPref["kind"]): NotificationPref {
    return {
        householdId: HH,
        userId,
        kind,
        enabled: true,
        updatedAt: "2026-11-22T10:00:00.000Z",
    };
}

function memoryDeps(prefs: NotificationPref[] = []) {
    const store = createMemoryNotificationsStore();
    for (const pref of prefs) void store.upsertPref(pref);
    const logged: string[] = [];
    const deps: NotifyDeps = {
        store,
        listMembers: async () => MEMBERS,
        log: (message) => logged.push(message),
    };
    return { store, deps, logged };
}

const REMOVED = {
    kind: "recipe_changes",
    subjectKind: "recipe",
    subjectId: "00000000-0000-4000-8000-0000000000c1",
    payload: { recipeName: "Beef chili" },
} as const;

describe("notifyHousehold", () => {
    test("writes one row per member who has the kind on, never the actor", async () => {
        const { store, deps } = memoryDeps([
            on(ACTOR, "recipe_changes"),
            on(SAM, "recipe_changes"),
        ]);
        const rows = await notifyHousehold(deps, {
            householdId: HH,
            event: REMOVED,
            actorUserId: ACTOR,
        });
        expect(rows.map((r) => r.recipientUserId)).toEqual([SAM]);
        const stored = await store.listForHousehold(HH);
        expect(stored).toHaveLength(1);
        expect(stored[0]).toMatchObject({
            recipientUserId: SAM,
            actorUserId: ACTOR,
            kind: "recipe_changes",
            source: "event",
            subjectKind: "recipe",
            payload: { recipeName: "Beef chili" },
        });
    });

    test("a kind that is off by default reaches nobody who has not turned it on", async () => {
        const { store, deps } = memoryDeps();
        await notifyHousehold(deps, {
            householdId: HH,
            event: REMOVED,
            actorUserId: ACTOR,
        });
        expect(await store.listForHousehold(HH)).toEqual([]);
    });

    test("one event shares one event:<uuid> key across its rows", async () => {
        const { store, deps } = memoryDeps([
            on(SAM, "recipe_changes"),
            on(KIM, "recipe_changes"),
        ]);
        await notifyHousehold(deps, {
            householdId: HH,
            event: REMOVED,
            actorUserId: ACTOR,
        });
        const keys = (await store.listForHousehold(HH)).map((r) => r.noticeKey);
        expect(keys).toHaveLength(2);
        expect(keys[0]).toMatch(/^event:[0-9a-f-]{36}$/);
        expect(keys[1]).toBe(keys[0]!);
    });

    test("a null actor reaches every member who has the kind on", async () => {
        const { deps } = memoryDeps([
            on(ACTOR, "recipe_changes"),
            on(SAM, "recipe_changes"),
        ]);
        const rows = await notifyHousehold(deps, {
            householdId: HH,
            event: REMOVED,
            actorUserId: null,
        });
        expect(rows.map((r) => r.recipientUserId).sort()).toEqual(
            [ACTOR, SAM].sort(),
        );
    });
});

describe("notifierFor", () => {
    test("is bound to a household and the person who acted", async () => {
        const { store, deps } = memoryDeps([on(SAM, "recipe_changes")]);
        await notifierFor(deps, HH, ACTOR)(REMOVED);
        expect(
            (await store.listForHousehold(HH)).map((r) => r.actorUserId),
        ).toEqual([ACTOR]);
    });

    test("a failure is logged and never thrown", async () => {
        const { deps, logged } = memoryDeps();
        const broken: NotifyDeps = {
            ...deps,
            listMembers: async () => {
                throw new Error("members unavailable");
            },
        };
        await notifierFor(broken, HH, ACTOR)(REMOVED);
        expect(logged).toHaveLength(1);
        expect(logged[0]).toContain("members unavailable");
        expect(logged[0]).toContain("recipe_changes");
    });
});

describe("createNotifyQueue", () => {
    test("holds events until flush, then delivers them in order", async () => {
        const seen: string[] = [];
        const queue = createNotifyQueue(async (event) => {
            seen.push(String(event.payload.recipeName));
        });
        await queue.notify({ ...REMOVED, payload: { recipeName: "One" } });
        await queue.notify({ ...REMOVED, payload: { recipeName: "Two" } });
        expect(seen).toEqual([]);
        await queue.flush();
        expect(seen).toEqual(["One", "Two"]);
    });

    test("a second flush delivers nothing again", async () => {
        const seen: unknown[] = [];
        const queue = createNotifyQueue(async (event) => {
            seen.push(event);
        });
        await queue.notify(REMOVED);
        await queue.flush();
        await queue.flush();
        expect(seen).toHaveLength(1);
    });

    test("discard drops what is held", async () => {
        const seen: unknown[] = [];
        const queue = createNotifyQueue(async (event) => {
            seen.push(event);
        });
        await queue.notify(REMOVED);
        queue.discard();
        await queue.flush();
        expect(seen).toEqual([]);
    });

    test("a delivery that throws does not stop the rest or the flush", async () => {
        const seen: string[] = [];
        const queue = createNotifyQueue(
            async (event) => {
                if (event.payload.recipeName === "Bad") throw new Error("boom");
                seen.push(String(event.payload.recipeName));
            },
            () => {},
        );
        await queue.notify({ ...REMOVED, payload: { recipeName: "Bad" } });
        await queue.notify({ ...REMOVED, payload: { recipeName: "Good" } });
        await queue.flush();
        expect(seen).toEqual(["Good"]);
    });
});

type Household = {
    householdId: string;
    ownerId: string;
    samId: string;
    kimId: string;
};

describeDb(
    pgAvailable !== null,
    "event notifications (live)",
    (getCtx) => {
        let c: Household;
        let otherHouseholdId: string;
        let otherOwnerId: string;
        const store = liveNotificationsStore();

        async function reset(): Promise<void> {
            const { sql, truncateAll } = getCtx();
            await truncateAll();
            setSqlForTests(sql);
            // A deploy holds one household, but the boundary has to hold for
            // two, so this throwaway database lifts the one-household index.
            await sql`drop index if exists public.households_singleton`;
            const a = await seedHousehold(sql);
            const samId = await seedMember(sql, a.householdId);
            const kimId = await seedMember(sql, a.householdId, {
                role: "admin",
            });
            const b = await seedHousehold(sql);
            c = {
                householdId: a.householdId,
                ownerId: a.userId,
                samId,
                kimId,
            };
            otherHouseholdId = b.householdId;
            otherOwnerId = b.userId;
            setFallbackActorForTests({
                kind: "user",
                userId: a.userId,
                householdId: a.householdId,
            });
        }

        afterEach(() => {
            setNotifyDepsForTests(null);
            setSqlForTests(null);
            resetFlagsForTests();
        });

        /** Turns a kind on (or off) for a person: a row, as Settings writes it. */
        async function setPref(
            userId: string,
            kind: NotificationKind,
            enabled = true,
            householdId = c.householdId,
        ): Promise<void> {
            await store.upsertPref({
                householdId,
                userId,
                kind,
                enabled,
                updatedAt: "2026-11-22T10:00:00.000Z",
            });
        }

        async function everyoneOn(kind: NotificationKind): Promise<void> {
            for (const id of [c.ownerId, c.samId, c.kimId]) {
                await setPref(id, kind);
            }
        }

        const inboxOf = async (): Promise<NotificationRow[]> =>
            (await store.listForHousehold(c.householdId)).filter(
                (row) => row.source === "event",
            );

        const recipients = (rows: readonly NotificationRow[]): string[] =>
            rows.map((r) => r.recipientUserId).sort();

        describe("the live adapter", () => {
            const event = {
                kind: "recipe_changes",
                subjectKind: "recipe",
                subjectId: "00000000-0000-4000-8000-0000000000c1",
                payload: { recipeName: "Beef chili" },
            } as const;

            test("writes one row per recipient under one shared event key, never the actor's", async () => {
                await reset();
                await everyoneOn("recipe_changes");
                await liveNotifier(c.householdId, c.ownerId)(event);
                const rows = await inboxOf();
                expect(recipients(rows)).toEqual([c.kimId, c.samId].sort());
                expect(rows.every((r) => r.actorUserId === c.ownerId)).toBe(
                    true,
                );
                expect(rows.every((r) => r.householdId === c.householdId)).toBe(
                    true,
                );
                const keys = new Set(rows.map((r) => r.noticeKey));
                expect(keys.size).toBe(1);
                expect([...keys][0]).toMatch(/^event:[0-9a-f-]{36}$/);
                expect(rows[0]).toMatchObject({
                    kind: "recipe_changes",
                    bucket: "household",
                    source: "event",
                    subjectKind: "recipe",
                    subjectId: event.subjectId,
                    payload: { recipeName: "Beef chili" },
                    readAt: null,
                    dismissedAt: null,
                });
            });

            test("a person's pref rows decide: on gets it, off and no row (the default) do not", async () => {
                await reset();
                await setPref(c.samId, "recipe_changes", true);
                await setPref(c.kimId, "recipe_changes", false);
                await liveNotifier(c.householdId, c.ownerId)(event);
                expect(recipients(await inboxOf())).toEqual([c.samId]);
            });

            test("a pref for another kind does not turn this one on", async () => {
                await reset();
                await setPref(c.samId, "new_usuals", true);
                await setPref(c.kimId, "week_plan_changes", true);
                await liveNotifier(c.householdId, c.ownerId)(event);
                expect(await inboxOf()).toEqual([]);
            });

            test("two events are two keys", async () => {
                await reset();
                await setPref(c.samId, "recipe_changes");
                const notify = liveNotifier(c.householdId, c.ownerId);
                await notify(event);
                await notify(event);
                const keys = (await inboxOf()).map((r) => r.noticeKey);
                expect(new Set(keys).size).toBe(2);
            });

            test("stays in its household: another household's members and prefs are not touched", async () => {
                await reset();
                await everyoneOn("recipe_changes");
                // Written by the owner connection: the app's own connection
                // is bound to one household.
                await getCtx().sql`
                    insert into public.notification_prefs (
                        household_id, user_id, kind, enabled
                    )
                    values (
                        ${otherHouseholdId}, ${otherOwnerId},
                        ${"recipe_changes"}, ${true}
                    )
                `;
                await liveNotifier(c.householdId, c.ownerId)(event);
                const all = await getCtx().sql`
                    select household_id, recipient_user_id
                    from public.notifications
                `;
                expect(all).toHaveLength(2);
                expect(
                    (all as { household_id: string }[]).every(
                        (r) => r.household_id === c.householdId,
                    ),
                ).toBe(true);
                expect(
                    (all as { recipient_user_id: string }[]).some(
                        (r) => r.recipient_user_id === otherOwnerId,
                    ),
                ).toBe(false);
            });

            test("a failing insert is logged and never thrown", async () => {
                await reset();
                await setPref(c.samId, "recipe_changes");
                const logged: string[] = [];
                const real = liveNotifyDeps();
                const notify = notifierFor(
                    {
                        ...real,
                        store: {
                            ...real.store,
                            insertMany: async () => {
                                throw new Error("insert refused");
                            },
                        },
                        log: (message) => logged.push(message),
                    },
                    c.householdId,
                    c.ownerId,
                );
                await notify(event);
                expect(logged).toHaveLength(1);
                expect(await inboxOf()).toEqual([]);
            });

            test("notifyHousehold reads members and prefs and writes in one transaction", async () => {
                await reset();
                await setPref(c.samId, "recipe_changes");
                const rows = await notifyHousehold(liveNotifyDeps(), {
                    householdId: c.householdId,
                    event,
                    actorUserId: c.ownerId,
                });
                expect(recipients(rows)).toEqual([c.samId]);
            });
        });

        describe("bulk actions queue until the batch commits", () => {
            async function twoRecipes() {
                const recipes = liveRecipesStore();
                const make = (name: string) =>
                    createRecipe(recipes, {
                        householdId: c.householdId,
                        creatorId: c.ownerId,
                        name,
                        yieldPortions: 2,
                    });
                return [await make("Beef chili"), await make("Lentil soup")];
            }

            test("a bulk recipe delete sends one event per recipe, to the others, never the actor", async () => {
                await reset();
                await everyoneOn("recipe_changes");
                const [chili, soup] = await twoRecipes();
                const result = await bulkDeleteSavedItems({
                    householdId: c.householdId,
                    foodIds: [],
                    recipeIds: [chili!.id, soup!.id],
                    actor: { userId: c.ownerId, isOwner: true },
                });
                expect(result).toEqual({ status: "applied", count: 2 });
                const rows = await inboxOf();
                // Two recipes, two recipients: four rows under two keys.
                expect(rows).toHaveLength(4);
                expect(new Set(rows.map((r) => r.noticeKey)).size).toBe(2);
                expect(recipients(rows)).toEqual(
                    [c.kimId, c.kimId, c.samId, c.samId].sort(),
                );
                expect(rows.map((r) => r.payload.recipeName).sort()).toEqual([
                    "Beef chili",
                    "Beef chili",
                    "Lentil soup",
                    "Lentil soup",
                ]);
                expect(
                    await liveRecipesStore().listRecipes(c.householdId),
                ).toEqual([]);
            });

            test("a batch that fails after deleting sends nothing, and the recipes stay", async () => {
                await reset();
                await everyoneOn("recipe_changes");
                const [chili, soup] = await twoRecipes();
                await expect(
                    inBulkTransaction(
                        c.householdId,
                        "saved-delete",
                        async (notify) => {
                            for (const recipe of [chili!, soup!]) {
                                await deleteRecipe(
                                    liveRecipesStore(),
                                    c.householdId,
                                    recipe.id,
                                    { userId: c.ownerId, isOwner: true },
                                    { notify },
                                );
                            }
                            throw new Error("the batch failed");
                        },
                        c.ownerId,
                    ),
                ).rejects.toThrow("the batch failed");
                expect(await inboxOf()).toEqual([]);
                expect(
                    (await liveRecipesStore().listRecipes(c.householdId))
                        .map((r) => r.name)
                        .sort(),
                ).toEqual(["Beef chili", "Lentil soup"]);
            });

            test("nothing is sent before the transaction commits", async () => {
                await reset();
                await everyoneOn("recipe_changes");
                const [chili] = await twoRecipes();
                let seenInside = -1;
                await inBulkTransaction(
                    c.householdId,
                    "saved-delete",
                    async (notify) => {
                        await deleteRecipe(
                            liveRecipesStore(),
                            c.householdId,
                            chili!.id,
                            { userId: c.ownerId, isOwner: true },
                            { notify },
                        );
                        seenInside = (await inboxOf()).length;
                    },
                    c.ownerId,
                );
                expect(seenInside).toBe(0);
                expect(await inboxOf()).toHaveLength(2);
            });

            test("a delivery Postgres refuses cannot undo the batch: the events go out after the commit, on their own", async () => {
                await reset();
                await everyoneOn("recipe_changes");
                const [chili, soup] = await twoRecipes();
                const logged: string[] = [];
                const real = liveNotifyDeps();
                // Postgres refuses this insert (the recipient is not a uuid).
                // Run inside the batch's transaction it would join it and
                // abort it, the swallowed error would let the batch "commit",
                // and the commit would be a rollback: the recipe back, no
                // error to say so.
                setNotifyDepsForTests({
                    ...real,
                    store: {
                        ...real.store,
                        insertMany: (rows) =>
                            real.store.insertMany(
                                rows.map((row) => ({
                                    ...row,
                                    recipientUserId: "not-a-uuid",
                                })),
                            ),
                    },
                    log: (message) => logged.push(message),
                });
                const result = await bulkDeleteSavedItems({
                    householdId: c.householdId,
                    foodIds: [],
                    recipeIds: [chili!.id],
                    actor: { userId: c.ownerId, isOwner: true },
                });
                expect(result).toEqual({ status: "applied", count: 1 });
                expect(
                    (await liveRecipesStore().listRecipes(c.householdId)).map(
                        (r) => r.id,
                    ),
                ).toEqual([soup!.id]);
                // The failure was logged where the delivery ran, and stopped there.
                expect(logged).toHaveLength(1);
                expect(await inboxOf()).toEqual([]);
            });

            test("a repeat of a batch with nothing left to do sends nothing", async () => {
                await reset();
                await everyoneOn("recipe_changes");
                const [chili] = await twoRecipes();
                const input = {
                    householdId: c.householdId,
                    foodIds: [],
                    recipeIds: [chili!.id],
                    actor: { userId: c.ownerId, isOwner: true },
                };
                await bulkDeleteSavedItems(input);
                const before = (await inboxOf()).length;
                const again = await bulkDeleteSavedItems(input);
                expect(again.status).toBe("already");
                expect(await inboxOf()).toHaveLength(before);
            });
        });

        describe("the household app's routes", () => {
            const hono = new Hono();
            hono.route("/", recipesRoutes);
            hono.route("/", householdRoutes);
            hono.route("/", usualAddRoutes);
            hono.route("/", bulkRoutes);

            function post(
                path: string,
                fields: Record<string, string> = {},
                as: string = c.ownerId,
            ): Promise<Response> {
                return Promise.resolve(
                    hono.request(`http://test${path}`, {
                        method: "POST",
                        headers: {
                            cookie: `${SITE_COOKIE}=${mintSiteSession(as)}`,
                            "content-type": "application/x-www-form-urlencoded",
                        },
                        body: new URLSearchParams(fields).toString(),
                    }),
                );
            }

            const chili = () =>
                createRecipe(liveRecipesStore(), {
                    householdId: c.householdId,
                    creatorId: c.ownerId,
                    name: "Beef chili",
                    yieldPortions: 4,
                });

            test("Delete on a recipe tells the others who have it on", async () => {
                await reset();
                await setPref(c.samId, "recipe_changes");
                const recipe = await chili();
                const res = await post(`/recipes/${recipe.id}/delete`);
                expect(res.status).toBe(303);
                const rows = await inboxOf();
                expect(recipients(rows)).toEqual([c.samId]);
                expect(rows[0]).toMatchObject({
                    actorUserId: c.ownerId,
                    payload: { recipeName: "Beef chili" },
                });
            });

            test("a member's refused Delete sends nothing", async () => {
                await reset();
                await setPref(c.ownerId, "recipe_changes");
                const recipe = await chili();
                const res = await post(
                    `/recipes/${recipe.id}/delete`,
                    {},
                    c.samId,
                );
                expect(res.status).toBeGreaterThanOrEqual(400);
                expect(await inboxOf()).toEqual([]);
                expect(
                    await liveRecipesStore().getRecipe(
                        c.householdId,
                        recipe.id,
                    ),
                ).not.toBeNull();
            });

            test("Add to plan tells the others who have it on, once, and a second tap sends nothing", async () => {
                await reset();
                await setPref(c.samId, "week_plan_changes");
                const recipe = await chili();
                const fields = { date: "2099-01-01", slot: "dinner" };
                expect(
                    (await post(`/recipes/${recipe.id}/plan`, fields)).status,
                ).toBe(303);
                await post(`/recipes/${recipe.id}/plan`, fields);
                const rows = await inboxOf();
                expect(rows).toHaveLength(1);
                expect(rows[0]).toMatchObject({
                    recipientUserId: c.samId,
                    kind: "week_plan_changes",
                    payload: {
                        recipeName: "Beef chili",
                        date: "2099-01-01",
                        slot: "dinner",
                        change: "planned",
                    },
                });
            });

            test("Remove from plan goes through unplanRecipe: the others are told, a stale id is not", async () => {
                await reset();
                await setPref(c.samId, "week_plan_changes");
                const recipe = await chili();
                const planned = await planRecipe(liveRecipePlansStore(), {
                    householdId: c.householdId,
                    recipeId: recipe.id,
                    recipeName: recipe.name,
                    recipeYield: 4,
                    date: "2099-01-01",
                    slot: "lunch",
                    today: "2026-11-22",
                    createdBy: c.ownerId,
                });
                const removeAt = `/recipes/plan/${planned!.plan.id}/remove`;
                expect((await post(removeAt)).status).toBe(303);
                expect(
                    await liveRecipePlansStore().getPlan(
                        c.householdId,
                        planned!.plan.id,
                    ),
                ).toBeNull();
                const rows = await inboxOf();
                expect(rows).toHaveLength(1);
                expect(rows[0]).toMatchObject({
                    recipientUserId: c.samId,
                    payload: {
                        recipeName: "Beef chili",
                        date: "2099-01-01",
                        slot: "lunch",
                        change: "unplanned",
                    },
                });
                await post(removeAt);
                expect(await inboxOf()).toHaveLength(1);
            });

            test("moving a plan to another day tells the others once; a servings-only edit tells no one", async () => {
                await reset();
                await setPref(c.samId, "week_plan_changes");
                const recipe = await chili();
                const planned = await planRecipe(liveRecipePlansStore(), {
                    householdId: c.householdId,
                    recipeId: recipe.id,
                    recipeName: recipe.name,
                    recipeYield: 4,
                    date: "2099-01-01",
                    slot: "dinner",
                    today: "2026-11-22",
                    createdBy: c.ownerId,
                });
                const moveAt = `/recipes/plan/${planned!.plan.id}/move`;
                expect(
                    (
                        await post(moveAt, {
                            date: "2099-01-01",
                            slot: "dinner",
                            servings: "6",
                        })
                    ).status,
                ).toBe(303);
                expect(await inboxOf()).toEqual([]);
                expect(
                    (await post(moveAt, { date: "2099-01-03", slot: "lunch" }))
                        .status,
                ).toBe(303);
                const rows = await inboxOf();
                expect(rows).toHaveLength(1);
                expect(rows[0]).toMatchObject({
                    recipientUserId: c.samId,
                    payload: {
                        recipeName: "Beef chili",
                        change: "moved",
                        date: "2099-01-03",
                        slot: "lunch",
                        fromDate: "2099-01-01",
                        fromSlot: "dinner",
                    },
                });
            });

            test("the Saved page's bulk Delete sends one event per recipe", async () => {
                await reset();
                await setPref(c.samId, "recipe_changes");
                const one = await chili();
                const two = await createRecipe(liveRecipesStore(), {
                    householdId: c.householdId,
                    creatorId: c.ownerId,
                    name: "Lentil soup",
                    yieldPortions: 2,
                });
                const res = await post("/settings/saved/bulk/delete", {
                    "recipe_ids[]": one.id,
                });
                expect(res.status).toBe(303);
                const res2 = await post("/settings/saved/bulk/delete", {
                    "recipe_ids[]": two.id,
                });
                expect(res2.status).toBe(303);
                expect(
                    (await inboxOf()).map((r) => r.payload.recipeName).sort(),
                ).toEqual(["Beef chili", "Lentil soup"]);
            });

            describe("new usual products", () => {
                async function milk() {
                    const foodId = await seedFood(getCtx().sql, c.householdId, {
                        name: "Milk",
                    });
                    const product = await createProduct(
                        liveFoodsStore(),
                        c.householdId,
                        foodId,
                        { name: "Horizon Milk", brand: "Horizon" },
                    );
                    return { foodId, product };
                }

                const newUsuals = async () =>
                    (await inboxOf()).filter((r) => r.kind === "new_usuals");

                test("Settings › Usuals: picking the usual product is one event", async () => {
                    await reset();
                    await setPref(c.samId, "new_usuals");
                    const { foodId, product } = await milk();
                    const res = await post(`/kitchen/usuals/${foodId}`, {
                        product_food_id: product.id,
                    });
                    expect(res.status).toBe(303);
                    const rows = await newUsuals();
                    expect(rows).toHaveLength(1);
                    expect(rows[0]).toMatchObject({
                        recipientUserId: c.samId,
                        actorUserId: c.ownerId,
                        payload: {
                            foodName: "Milk",
                            productName: "Horizon Milk",
                        },
                    });
                });

                test("Settings › Items: saving a food with a new usual product is one event, saving it again is none", async () => {
                    await reset();
                    await setPref(c.samId, "new_usuals");
                    const { foodId, product } = await milk();
                    const fields = {
                        name: "Milk",
                        default_unit: "g",
                        usual_product_id: product.id,
                    };
                    const res = await post(
                        `/settings/household/items/${foodId}`,
                        fields,
                    );
                    expect(res.status).toBe(303);
                    await post(`/settings/household/items/${foodId}`, fields);
                    expect(
                        (await newUsuals()).map((r) => r.payload.productName),
                    ).toEqual(["Horizon Milk"]);
                });

                test("Settings › Items: filing a product under a food that was not a usual is one event, under one that was is none", async () => {
                    await reset();
                    await setPref(c.samId, "new_usuals");
                    const sql = getCtx().sql;
                    const eggs = await seedFood(sql, c.householdId, {
                        name: "Eggs",
                    });
                    const kirkland = await seedFood(sql, c.householdId, {
                        name: "Kirkland Eggs",
                    });
                    const farm = await seedFood(sql, c.householdId, {
                        name: "Farm Eggs",
                    });
                    const file = (
                        productId: string,
                        name: string,
                        plainId: string,
                    ) =>
                        post(`/settings/household/items/${productId}`, {
                            name,
                            default_unit: "g",
                            generic_food_id: plainId,
                        });
                    // The first product makes Eggs a usual...
                    expect(
                        (await file(kirkland, "Kirkland Eggs", eggs)).status,
                    ).toBe(303);
                    const rows = await newUsuals();
                    expect(rows).toHaveLength(1);
                    expect(rows[0]).toMatchObject({
                        recipientUserId: c.samId,
                        actorUserId: c.ownerId,
                        subjectId: eggs,
                        payload: {
                            foodName: "Eggs",
                            productName: "Kirkland Eggs",
                        },
                    });
                    // ...a second one, saving it again and unfiling are not new.
                    expect((await file(farm, "Farm Eggs", eggs)).status).toBe(
                        303,
                    );
                    expect(
                        (await file(kirkland, "Kirkland Eggs", eggs)).status,
                    ).toBe(303);
                    expect((await file(farm, "Farm Eggs", "")).status).toBe(
                        303,
                    );
                    expect(await newUsuals()).toHaveLength(1);
                });

                test("Settings › Items: picking a usual product that was not filed under the food yet files it and makes it the usual in one event", async () => {
                    await reset();
                    await setPref(c.samId, "new_usuals");
                    const sql = getCtx().sql;
                    const eggs = await seedFood(sql, c.householdId, {
                        name: "Eggs",
                    });
                    const kirkland = await seedFood(sql, c.householdId, {
                        name: "Kirkland Eggs",
                    });
                    // Eggs gets the usual product Kirkland, which was not filed
                    // under it yet: filing it and making it the usual are one
                    // new usual, not two.
                    const res = await post(
                        `/settings/household/items/${eggs}`,
                        {
                            name: "Eggs",
                            default_unit: "g",
                            usual_product_id: kirkland,
                        },
                    );
                    expect(res.status).toBe(303);
                    const rows = await newUsuals();
                    expect(rows).toHaveLength(1);
                    expect(rows[0]?.payload).toEqual({
                        foodName: "Eggs",
                        productName: "Kirkland Eggs",
                    });
                });

                test("picking a product for a food with none is one event, a second product is none", async () => {
                    await reset();
                    await setPref(c.samId, "new_usuals");
                    const { foodId, product } = await milk();
                    const other = await createProduct(
                        liveFoodsStore(),
                        c.householdId,
                        foodId,
                        { name: "Organic Milk", brand: "Organic" },
                    );
                    await post(`/kitchen/usuals/${foodId}/pick`, {
                        food_id: product.id,
                    });
                    await post(`/kitchen/usuals/${foodId}/pick`, {
                        food_id: other.id,
                    });
                    expect(
                        (await newUsuals()).map((r) => r.payload.productName),
                    ).toEqual(["Horizon Milk"]);
                });

                test("creating a product by hand as the first usual is one event", async () => {
                    await reset();
                    await setPref(c.samId, "new_usuals");
                    const foodId = await seedFood(getCtx().sql, c.householdId, {
                        name: "Milk",
                    });
                    await post(`/kitchen/usuals/${foodId}/products`, {
                        name: "Kirkland Milk",
                    });
                    expect(
                        (await newUsuals()).map((r) => r.payload.productName),
                    ).toEqual(["Kirkland Milk"]);
                });

                test("Add a usual › Scan files the product under a food: one event", async () => {
                    await reset();
                    await setPref(c.samId, "new_usuals");
                    const { foodId } = await milk();
                    const scanned = await createProduct(
                        liveFoodsStore(),
                        c.householdId,
                        await seedFood(getCtx().sql, c.householdId, {
                            name: "Yoghurt",
                        }),
                        { name: "Fage Yoghurt", brand: "Fage" },
                    );
                    await liveFoodsStore().updateFoodRow({
                        ...(await liveFoodsStore().getFood(
                            c.householdId,
                            scanned.id,
                        ))!,
                        genericFoodId: null,
                    });
                    const res = await post("/kitchen/usuals/add/product", {
                        product_id: scanned.id,
                        food_choice: foodId,
                    });
                    expect(res.status).toBe(303);
                    const rows = await newUsuals();
                    expect(rows).toHaveLength(1);
                    expect(rows[0]?.payload).toEqual({
                        foodName: "Milk",
                        productName: "Fage Yoghurt",
                    });
                });

                test("Add a usual › Search adds a plain food as it is: one event", async () => {
                    await reset();
                    await setPref(c.samId, "new_usuals");
                    const foodId = await seedFood(getCtx().sql, c.householdId, {
                        name: "Butter",
                    });
                    const res = await post("/kitchen/usuals/add/product", {
                        product_id: foodId,
                        food_choice: foodId,
                        via: "search",
                    });
                    expect(res.status).toBe(303);
                    const rows = await newUsuals();
                    expect(rows).toHaveLength(1);
                    expect(rows[0]?.payload).toEqual({
                        foodName: "Butter",
                        productName: null,
                    });
                });

                test("Add a usual › Type it is one event", async () => {
                    await reset();
                    await setPref(c.samId, "new_usuals");
                    const res = await post("/kitchen/usuals/add/manual", {
                        name: "Half & Half",
                        basis: "per_100ml",
                        calories: "130",
                        protein_g: "3",
                        carbs_g: "4",
                        fat_g: "11",
                    });
                    expect(res.status).toBe(303);
                    const rows = await newUsuals();
                    expect(rows).toHaveLength(1);
                    expect(rows[0]).toMatchObject({
                        recipientUserId: c.samId,
                        payload: { foodName: "Half & Half" },
                    });
                });

                test("a refused Type it sends nothing", async () => {
                    await reset();
                    await setPref(c.samId, "new_usuals");
                    const res = await post("/kitchen/usuals/add/manual", {
                        name: "Half & Half",
                        basis: "per_100ml",
                    });
                    expect(res.status).toBe(400);
                    expect(await newUsuals()).toEqual([]);
                });
            });
        });
    },
    { actor: null },
);
