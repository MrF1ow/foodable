import { afterEach, beforeEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { liveAgentActionDeps } from "../../db/agent-actions.js";
import { liveGroceryStore } from "../../db/grocery.js";
import { liveSettingsStore } from "../../db/settings.js";
import { setSqlForTests } from "../../db/sql.js";
import { sampleGroceryLine } from "../../db/contract/helpers.js";
import { describeDb } from "../../db/testing/pg.js";
import {
    asUser,
    seedFood,
    seedGrocerySection,
    seedGroceryStore,
    seedHousehold,
} from "../../db/testing/fixtures.js";
import { findPgBin } from "../../db/testing/pg-temp.js";
import {
    AgentActionsDisabledError,
    AGENT_UNDO_TTL_MS,
    withAgentAction,
} from "../../domain/agent-actions.js";
import { resetFlagsForTests } from "../../flags.js";
import { mintSiteSession, SITE_COOKIE } from "../../site-session.js";
import { nutritionRoutes } from "./nutrition.js";
import { settingsRoutes } from "./settings.js";

process.env.SESSION_SECRET ||= "01234567890123456789012345678901";
process.env.OAUTH_CLIENT_SECRET ||= "test-client-secret-thirty-two-chars-min";

const pgAvailable = await findPgBin();

const app = new Hono();
app.route("/", settingsRoutes);
app.route("/", nutritionRoutes);

const FORM = { "content-type": "application/x-www-form-urlencoded" };

function cookie(userId: string): string {
    return `${SITE_COOKIE}=${mintSiteSession(userId)}`;
}

describeDb(
    pgAvailable !== null,
    "settings › AI connections: switch, activity, undo",
    (getCtx) => {
        let ownerId: string;
        let memberId: string;
        let otherId: string;
        let householdId: string;
        let storeId: string;
        let sectionId: string;
        let foodId: string;

        beforeEach(async () => {
            const { sql, truncateAll } = getCtx();
            await truncateAll();
            setSqlForTests(sql);
            ({ userId: ownerId, householdId } = await seedHousehold(sql));
            const addMember = async (name: string) => {
                const id = crypto.randomUUID();
                await sql`
                    insert into public.users (id, email)
                    values (${id}, ${`${name}-${id}@foodable.test`})
                `;
                await sql`
                    insert into public.household_members (
                        household_id, user_id, role, display_name
                    )
                    values (${householdId}, ${id}, ${"member"}, ${name})
                `;
                return id;
            };
            memberId = await addMember("Sam");
            otherId = await addMember("Alex");
            storeId = await seedGroceryStore(sql, householdId, "Main");
            sectionId = await seedGrocerySection(sql, householdId, storeId);
            foodId = await seedFood(sql, householdId);
        });

        afterEach(() => {
            setSqlForTests(null);
            resetFlagsForTests();
        });

        /**
         * An agent clearing one grocery line, recorded as the guard records it.
         * `ago` backdates it (the guard's clock), `as` is the member the agent
         * acted as.
         */
        async function agentClears(
            opts: {
                name?: string;
                as?: string | null;
                connection?: string;
                ago?: number;
            } = {},
        ): Promise<{ actionId: string; lineId: string }> {
            const grocery = liveGroceryStore();
            const name = opts.name ?? "Milk";
            const line = await asUser(
                ownerId,
                () =>
                    grocery.insertLine(
                        sampleGroceryLine(
                            {
                                householdId,
                                userId: ownerId,
                                otherHouseholdId: crypto.randomUUID(),
                                storeId,
                                sectionId,
                                foodId,
                                locationId: crypto.randomUUID(),
                            },
                            { displayName: name },
                        ),
                    ),
                householdId,
            );
            const at = new Date(Date.now() - (opts.ago ?? 0));
            const { action } = await asUser(
                ownerId,
                () =>
                    withAgentAction(
                        { ...liveAgentActionDeps(), now: () => at },
                        {
                            householdId,
                            memberId:
                                opts.as === undefined ? memberId : opts.as,
                            connection: opts.connection ?? "Claude",
                        },
                        {
                            tool: "delete_grocery_line",
                            summary: `Deleted grocery line ${name}`,
                        },
                        async (rec) => {
                            await rec.captureByIds(
                                "grocery_lines",
                                [line.id],
                                "deleted",
                            );
                            await grocery.deleteLine(householdId, line.id);
                        },
                    ),
                householdId,
            );
            return { actionId: action.id, lineId: line.id };
        }

        async function lineCount(): Promise<number> {
            const [row] = (await getCtx().sql`
                select count(*)::int as n from public.grocery_lines
            `) as { n: number }[];
            return row!.n;
        }

        function page(userId: string) {
            return app.request("http://test/settings/ai-connections", {
                headers: { cookie: cookie(userId) },
            });
        }

        function post(
            userId: string,
            path: string,
            body: Record<string, string> = {},
        ) {
            return app.request(`http://test${path}`, {
                method: "POST",
                headers: { cookie: cookie(userId), ...FORM },
                body: new URLSearchParams(body).toString(),
            });
        }

        const undoPath = (id: string) =>
            `/settings/ai-connections/actions/${id}/undo`;
        const SWITCH = "/settings/ai-connections/destructive";

        test("the owner sees the switch on, and turning it Off persists and makes the guard refuse", async () => {
            const html = await (await page(ownerId)).text();
            expect(html).toContain("Agents may make destructive changes");
            expect(html).toContain('role="switch" aria-checked="true"');
            expect(html).toContain(`action="${SWITCH}"`);
            expect(html).toContain("agents can still read and add");

            const res = await post(ownerId, SWITCH, { allowed: "0" });

            expect(res.status).toBe(303);
            expect(res.headers.get("location")).toBe(
                "/settings/ai-connections",
            );
            expect(
                await liveSettingsStore().getAgentDestructiveAllowed(
                    householdId,
                ),
            ).toBe(false);
            expect(await (await page(ownerId)).text()).toContain(
                'role="switch" aria-checked="false"',
            );
            await expect(
                withAgentAction(
                    liveAgentActionDeps(),
                    {
                        householdId,
                        memberId: null,
                        connection: "household token",
                    },
                    { tool: "delete_grocery_line", summary: "x" },
                    async () => {},
                ),
            ).rejects.toBeInstanceOf(AgentActionsDisabledError);

            expect((await post(ownerId, SWITCH, { allowed: "1" })).status).toBe(
                303,
            );
            expect(
                await liveSettingsStore().getAgentDestructiveAllowed(
                    householdId,
                ),
            ).toBe(true);
        });

        test("a member sees the value read-only, and posting the switch is a 403 that changes nothing", async () => {
            const html = await (await page(memberId)).text();
            expect(html).toContain("Agents may make destructive changes");
            expect(html).toContain("Only the household owner can change this.");
            expect(html).not.toContain(`action="${SWITCH}"`);
            expect(html).not.toContain('role="switch"');

            const res = await post(memberId, SWITCH, { allowed: "0" });

            expect(res.status).toBe(403);
            expect(
                await liveSettingsStore().getAgentDestructiveAllowed(
                    householdId,
                ),
            ).toBe(true);
        });

        test("a switch post with no value is refused as a bad choice", async () => {
            const res = await post(ownerId, SWITCH, { allowed: "maybe" });
            expect(res.status).toBe(400);
            expect(await res.text()).toContain("Choose Allowed or Off.");
        });

        test("the activity list shows when, connection, member and summary, newest first", async () => {
            await agentClears({
                name: "Eggs",
                ago: 3 * 60 * 60 * 1000,
                connection: "Grok CLI",
                as: memberId,
            });
            await agentClears({
                name: "Milk",
                connection: "household token",
                as: null,
            });

            const html = await (await page(ownerId)).text();

            expect(html).toContain("Agent activity");
            expect(html).toContain("Deleted grocery line Eggs");
            expect(html).toContain("Grok CLI · as Sam");
            expect(html).toContain("3 hours ago");
            expect(html).toContain("household token");
            expect(html.indexOf("Deleted grocery line Milk")).toBeLessThan(
                html.indexOf("Deleted grocery line Eggs"),
            );
            expect(html.match(/class="fd-settings-ai__undo"/g)).toHaveLength(2);
        });

        test("the activity list is empty-stated when agents have done nothing", async () => {
            const html = await (await page(ownerId)).text();
            expect(html).toContain("Agent activity");
            expect(html).toContain("Nothing yet.");
        });

        test("the owner undoes an agent change and the row is back", async () => {
            const { actionId } = await agentClears();
            expect(await lineCount()).toBe(0);

            const res = await post(ownerId, undoPath(actionId));

            expect(res.status).toBe(303);
            expect(res.headers.get("location")).toBe(
                "/settings/ai-connections",
            );
            expect(await lineCount()).toBe(1);
            const html = await (await page(ownerId)).text();
            expect(html).toContain("Undone");
            expect(html).not.toContain('class="fd-settings-ai__undo"');
        });

        test("the member the agent acted as undoes it too", async () => {
            const { actionId } = await agentClears({ as: memberId });

            const res = await post(memberId, undoPath(actionId));

            expect(res.status).toBe(303);
            expect(await lineCount()).toBe(1);
        });

        test("another member is refused cleanly: no Undo is offered and a post changes nothing", async () => {
            const { actionId } = await agentClears({ as: memberId });

            const html = await (await page(otherId)).text();
            expect(html).toContain("Deleted grocery line Milk");
            expect(html).not.toContain('class="fd-settings-ai__undo"');
            expect(html).toContain("Sam or the owner can undo");

            const res = await post(otherId, undoPath(actionId));

            expect(res.status).toBe(404);
            expect(await res.text()).toContain("That change was not found.");
            expect(await lineCount()).toBe(0);
        });

        test("after 24 hours the entry stays as a record without Undo, and a post says the time has passed", async () => {
            const { actionId } = await agentClears({
                ago: AGENT_UNDO_TTL_MS + 60_000,
            });

            const html = await (await page(ownerId)).text();
            expect(html).toContain("Deleted grocery line Milk");
            expect(html).toContain("Can no longer be undone");
            expect(html).not.toContain('class="fd-settings-ai__undo"');

            const res = await post(ownerId, undoPath(actionId));

            expect(res.status).toBe(409);
            expect(await res.text()).toContain(
                "The 24 hours to undo that change have passed.",
            );
            expect(await lineCount()).toBe(0);
        });

        test("undoing twice is a message, not a second undo or a server error", async () => {
            const { actionId } = await agentClears();
            expect((await post(ownerId, undoPath(actionId))).status).toBe(303);

            const again = await post(ownerId, undoPath(actionId));

            expect(again.status).toBe(409);
            expect(await again.text()).toContain(
                "That change was already undone.",
            );
            expect(await lineCount()).toBe(1);
        });

        test("a change something has since collided with shows its message, not a 500", async () => {
            const { actionId, lineId } = await agentClears();
            // The household put the same row back by hand before undoing.
            await getCtx().sql`
                insert into public.grocery_lines (
                    id, household_id, store_id, section_id, kind,
                    display_name, amount, unit, food_id, checked, source
                )
                values (
                    ${lineId}, ${householdId}, ${storeId}, ${sectionId},
                    ${"food"}, ${"Milk again"}, 1, ${"L"}, ${foodId}, false,
                    ${"manual"}
                )
            `;

            const res = await post(ownerId, undoPath(actionId));

            expect(res.status).toBe(409);
            const html = await res.text();
            expect(html).toContain("fd-settings-error");
            expect(html).toContain("A grocery line named Milk already exists.");
            expect(await lineCount()).toBe(1);
        });

        test("an id that is not a change is a 404 message, never a database error", async () => {
            for (const id of ["nope", crypto.randomUUID()]) {
                const res = await post(ownerId, undoPath(id));
                expect(res.status).toBe(404);
                expect(await res.text()).toContain(
                    "That change was not found.",
                );
            }
        });

        test("an undo from Today goes back to Today; any other back path goes to Settings", async () => {
            const first = await agentClears({ name: "Milk" });
            const second = await agentClears({ name: "Eggs" });

            const fromToday = await post(ownerId, undoPath(first.actionId), {
                back: "/",
            });
            const elsewhere = await post(ownerId, undoPath(second.actionId), {
                back: "https://evil.example/",
            });

            expect(fromToday.headers.get("location")).toBe("/");
            expect(elsewhere.headers.get("location")).toBe(
                "/settings/ai-connections",
            );
        });

        test("signed out, an undo is not done", async () => {
            const { actionId } = await agentClears();
            const res = await app.request(`http://test${undoPath(actionId)}`, {
                method: "POST",
                headers: FORM,
                body: "",
            });
            expect(res.status).not.toBe(303);
            expect(await lineCount()).toBe(0);
        });

        function today(userId: string) {
            return app.request("http://test/", {
                headers: { cookie: cookie(userId) },
            });
        }

        test("Today shows the owner a notice with Undo for a recent change, and it goes once undone", async () => {
            const { actionId } = await agentClears({ name: "Milk" });

            const html = await (await today(ownerId)).text();

            expect(html).toContain('data-notice="agent.action"');
            expect(html).toContain("Deleted grocery line Milk (by Claude)");
            expect(html).toContain(`action="${undoPath(actionId)}"`);
            expect(html).toContain('href="/settings/ai-connections"');

            expect(
                (await post(ownerId, undoPath(actionId), { back: "/" })).status,
            ).toBe(303);
            expect(await (await today(ownerId)).text()).not.toContain(
                'data-notice="agent.action"',
            );
        });

        test("Today shows no agent notice for an expired change, or to a member it is not theirs to undo", async () => {
            await agentClears({ name: "Old", ago: AGENT_UNDO_TTL_MS + 60_000 });
            await agentClears({ name: "Sams", as: memberId });

            expect(await (await today(ownerId)).text()).not.toContain(
                "Deleted grocery line Old",
            );
            expect(await (await today(otherId)).text()).not.toContain(
                'data-notice="agent.action"',
            );
            const samsOwn = await (await today(memberId)).text();
            expect(samsOwn).toContain("Deleted grocery line Sams (by Claude)");
        });
    },
);
