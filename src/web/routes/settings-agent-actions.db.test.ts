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
import { AI_ACTIVITY_LIMIT } from "../pages/v2/settings-ai.js";

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
                        household_id, user_id, role, display_name, agents_can_delete
                    )
                    values (${householdId}, ${id}, ${"member"}, ${name}, ${true})
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
                            personId:
                                (opts.as === undefined ? memberId : opts.as) ??
                                ownerId,
                            role:
                                (opts.as === undefined ? memberId : opts.as) ===
                                null
                                    ? "owner"
                                    : "member",
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

        function appPage(userId: string, encodedApp: string) {
            return app.request(
                `http://test/settings/ai-connections?app=${encodedApp}`,
                { headers: { cookie: cookie(userId) } },
            );
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

        const OWN = "/settings/ai-connections/agent-delete";

        test("the owner sees the household switch on, and turning it Off persists and makes the guard refuse", async () => {
            const html = await (await page(ownerId)).text();
            expect(html).toContain("Any agent can delete");
            expect(html).toContain("Household · owner only");
            expect(html).toContain('role="switch" aria-checked="true"');
            expect(html).toContain(`action="${SWITCH}"`);
            expect(html).not.toContain("agents can still read and add");

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
            const off = await (await page(ownerId)).text();
            expect(off).toMatch(
                /aria-label="Any agent can delete"[^>]*aria-checked="false"/,
            );
            await expect(
                withAgentAction(
                    liveAgentActionDeps(),
                    {
                        householdId,
                        memberId: null,
                        connection: "household token",
                        personId: ownerId,
                        role: "owner",
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

        test("a member does not see the household switch, and posting it is a 403 that changes nothing", async () => {
            const html = await (await page(memberId)).text();
            expect(html).not.toContain("Any agent can delete");
            expect(html).not.toContain("Household · owner only");
            expect(html).not.toContain(`action="${SWITCH}"`);
            // Their own switch is there.
            expect(html).toContain("Your agents can delete");
            expect(html).toContain(`action="${OWN}"`);

            const res = await post(memberId, SWITCH, { allowed: "0" });

            expect(res.status).toBe(403);
            expect(
                await liveSettingsStore().getAgentDestructiveAllowed(
                    householdId,
                ),
            ).toBe(true);
        });

        test("a member turns their own switch on and off; nobody else's moves, and the guard follows", async () => {
            const settings = liveSettingsStore();
            // Members are added with their switch off.
            const { sql } = getCtx();
            const fresh = crypto.randomUUID();
            await sql`
                insert into public.users (id, email)
                values (${fresh}, ${`fresh-${fresh}@foodable.test`})
            `;
            await sql`
                insert into public.household_members (household_id, user_id, role, display_name)
                values (${householdId}, ${fresh}, 'member', 'Fresh')
            `;
            const offHtml = await (await page(fresh)).text();
            expect(offHtml).toMatch(
                /aria-label="Your agents can delete"[^>]*aria-checked="false"/,
            );
            expect(offHtml).toContain(
                "Off by default · only what you can delete",
            );
            const guard = () =>
                withAgentAction(
                    liveAgentActionDeps(),
                    {
                        householdId,
                        memberId: fresh,
                        connection: "Claude",
                        personId: fresh,
                        role: "member",
                    },
                    { tool: "delete_grocery_line", summary: "x" },
                    async () => {},
                );
            await expect(guard()).rejects.toMatchObject({
                reason: "person_off",
            });

            const on = await post(fresh, OWN, { allowed: "1" });
            expect(on.status).toBe(303);
            expect(on.headers.get("location")).toBe("/settings/ai-connections");
            expect(
                await settings.getMemberAgentsCanDelete(householdId, fresh),
            ).toBe(true);
            // Nobody else's switch moved, nor the household's.
            expect(
                await settings.getMemberAgentsCanDelete(householdId, otherId),
            ).toBe(true);
            expect(await settings.getAgentDestructiveAllowed(householdId)).toBe(
                true,
            );
            await guard();
            expect(await (await page(fresh)).text()).toMatch(
                /aria-label="Your agents can delete"[^>]*aria-checked="true"/,
            );

            expect((await post(fresh, OWN, { allowed: "0" })).status).toBe(303);
            expect(
                await settings.getMemberAgentsCanDelete(householdId, fresh),
            ).toBe(false);
            await expect(guard()).rejects.toMatchObject({
                reason: "person_off",
            });
        });

        test("the owner's own switch is theirs, not the household's, and a member's post cannot reach another person's", async () => {
            const settings = liveSettingsStore();
            await settings.setMemberAgentsCanDelete(
                householdId,
                ownerId,
                false,
            );
            expect((await post(ownerId, OWN, { allowed: "1" })).status).toBe(
                303,
            );
            expect(
                await settings.getMemberAgentsCanDelete(householdId, ownerId),
            ).toBe(true);
            // The form names no person: whoever is signed in is the one changed.
            await settings.setMemberAgentsCanDelete(householdId, otherId, true);
            expect(
                (
                    await post(memberId, OWN, {
                        allowed: "0",
                        user_id: otherId,
                        member: otherId,
                    })
                ).status,
            ).toBe(303);
            expect(
                await settings.getMemberAgentsCanDelete(householdId, otherId),
            ).toBe(true);
            expect(
                await settings.getMemberAgentsCanDelete(householdId, memberId),
            ).toBe(false);
        });

        test("with the household switch off a member sees their own as plain Off, naming the owner", async () => {
            await post(ownerId, SWITCH, { allowed: "0" });
            const html = await (await page(memberId)).text();
            expect(html).toContain("Turned off for the household by Owner");
            // The switch is shown off and disabled, with nothing to post.
            const locked = html.match(
                /<button[^>]*aria-label="Your agents can delete"[^>]*>/,
            )?.[0];
            expect(locked).toContain('role="switch" aria-checked="false"');
            expect(locked).toContain("disabled");
            expect(html).not.toContain(`action="${OWN}"`);
            // The owner sees no such line: they turned it off themselves.
            const ownerHtml = await (await page(ownerId)).text();
            expect(ownerHtml).not.toContain("Turned off for the household by");
            await post(ownerId, SWITCH, { allowed: "1" });
            expect(await (await page(memberId)).text()).not.toContain(
                "Turned off for the household by",
            );
        });

        test("an own-switch post with no value is refused as a bad choice, and anyone not signed in is turned away", async () => {
            const bad = await post(memberId, OWN, { allowed: "maybe" });
            expect(bad.status).toBe(400);
            expect(await bad.text()).toContain("Choose On or Off.");
            const anonymous = await app.request(`http://test${OWN}`, {
                method: "POST",
                headers: FORM,
                body: new URLSearchParams({ allowed: "1" }).toString(),
            });
            expect([401, 403]).toContain(anonymous.status);
            expect(
                await liveSettingsStore().getMemberAgentsCanDelete(
                    householdId,
                    memberId,
                ),
            ).toBe(true);
        });

        test("a switch post with no value is refused as a bad choice", async () => {
            const res = await post(ownerId, SWITCH, { allowed: "maybe" });
            expect(res.status).toBe(400);
            expect(await res.text()).toContain("Choose Allowed or Off.");
        });

        test("the activity list shows the summary, then the app and when, newest first", async () => {
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

            expect(html).toContain("Recent changes");
            expect(html).toContain("Deleted grocery line Eggs");
            // The owner reads whose agent each one was.
            expect(html).toContain(">Grok CLI for Sam · 3 hours ago<");
            expect(html).not.toContain("as Sam");
            expect(html).toContain(">Household token · Just now<");
            expect(html.indexOf("Deleted grocery line Milk")).toBeLessThan(
                html.indexOf("Deleted grocery line Eggs"),
            );
            expect(html.match(/>Undo</g)).toHaveLength(2);
        });

        test("a change only the owner may undo says so once, even when the agent acted as the owner", async () => {
            await agentClears({ name: "Owners", as: ownerId });
            await agentClears({ name: "Token", as: null });
            await agentClears({ name: "Sams", as: memberId });

            const html = await (await page(otherId)).text();

            expect(html.match(/>The owner can undo</g)).toHaveLength(2);
            expect(html).toContain(">Sam or the owner can undo<");
            expect(html).not.toContain("Owner or the owner");
            expect(html).not.toContain(">Undo<");
        });

        test("?app= narrows Recent changes to that app, on the same page, and nothing else", async () => {
            await agentClears({
                name: "Eggs",
                connection: "Grok CLI",
                as: ownerId,
            });
            await agentClears({
                name: "Milk",
                connection: "Claude",
                as: ownerId,
            });
            await agentClears({
                name: "Beans",
                connection: "Grok CLI",
                as: memberId,
            });
            const filtered = (userId: string, app: string) =>
                app === ""
                    ? page(userId)
                    : app.startsWith("raw:")
                      ? appPage(userId, app.slice(4))
                      : appPage(userId, encodeURIComponent(app));

            const claude = await (await filtered(ownerId, "Claude")).text();
            expect(claude).toContain("Deleted grocery line Milk");
            expect(claude).not.toContain("Deleted grocery line Eggs");
            expect(claude).toContain(
                'href="/settings/ai-connections#recent-changes">Show all<',
            );
            // The switches and the rest of the page are as ever.
            expect(claude).toContain("Any agent can delete");

            const all = await (await filtered(ownerId, "")).text();
            expect(all).toContain("Deleted grocery line Milk");
            expect(all).toContain("Deleted grocery line Eggs");
            expect(all).not.toContain("Show all");

            // A member's Grok CLI is theirs: the owner's Grok CLI, of the same name, stays out.
            const member = await (await filtered(memberId, "Grok CLI")).text();
            expect(member).toContain("Deleted grocery line Beans");
            expect(member).not.toContain("Deleted grocery line Eggs");
            expect(member).not.toContain("Deleted grocery line Milk");
            // And the owner's own Grok CLI does not show Sam's.
            const ownerGrok = await (
                await filtered(ownerId, "Grok CLI")
            ).text();
            expect(ownerGrok).toContain("Deleted grocery line Eggs");
            expect(ownerGrok).not.toContain("Deleted grocery line Beans");

            // A malformed escape is just a name nobody has.
            const broken = await appPage(ownerId, "%E0%A4%A");
            expect(broken.status).toBe(200);
            expect(await broken.text()).toContain("No changes by");
            // An app nobody has, and hostile or junk values: still the page, never an error.
            const unknown = await (await filtered(ownerId, "Nobody")).text();
            expect(unknown).toContain(
                "No changes by Nobody among the latest 50",
            );
            const hostile = await appPage(
                ownerId,
                encodeURIComponent('"><img src=x onerror=1>'),
            );
            expect(hostile.status).toBe(200);
            const hostileHtml = await hostile.text();
            expect(hostileHtml).not.toContain("<img src=x");
            expect(hostileHtml).toContain(
                "No changes by &quot;&gt;&lt;img src=x",
            );
            for (const junk of [
                "raw:%00",
                "raw:a%0Ab",
                `raw:${"a".repeat(500)}`,
                "raw:",
            ]) {
                const res = await filtered(ownerId, junk);
                expect(res.status).toBe(200);
                const junkHtml = await res.text();
                // No filter at all: every change is listed.
                expect(junkHtml, junk).toContain("Deleted grocery line Milk");
                expect(junkHtml).toContain("Deleted grocery line Eggs");
            }
            // An app given by repeated params still resolves to one value.
            const twice = await app.request(
                "http://test/settings/ai-connections?app=Claude&app=Grok%20CLI",
                { headers: { cookie: cookie(ownerId) } },
            );
            expect(twice.status).toBe(200);
        });

        test("each row says whose agent it was, per role, and the viewer's own say nothing extra", async () => {
            await agentClears({ name: "Mine", as: memberId });
            await agentClears({ name: "Alexs", as: otherId });
            await agentClears({ name: "Owners", as: ownerId });
            await agentClears({
                name: "Token",
                as: null,
                connection: "household token",
            });
            const subtitles = (html: string) =>
                [
                    ...html.matchAll(
                        /<span class="fd-item-row__subtitle">([^<]*ago|[^<]*now)</g,
                    ),
                ].map((m) => m[1]);

            // Sam: his own row plain; everyone else's named.
            const sam = subtitles(await (await page(memberId)).text());
            expect(sam).toContain("Claude · Just now");
            expect(sam).toContain("Claude for Alex · Just now");
            expect(sam).toContain("Claude for Owner · Just now");
            expect(sam).toContain("Household token · Just now");
            // The owner: Sam's and Alex's named, the owner's own plain.
            const owner = subtitles(await (await page(ownerId)).text());
            expect(owner).toContain("Claude for Sam · Just now");
            expect(owner).toContain("Claude for Alex · Just now");
            expect(owner).toContain("Claude · Just now");
            expect(owner).toContain("Household token · Just now");
            expect(owner.filter((l) => l === "Claude · Just now")).toHaveLength(
                1,
            );
        });

        test("a connected app's Changes are the member's own agent's: another member's same-named app stays out", async () => {
            await agentClears({
                name: "Mine",
                as: memberId,
                connection: "Claude",
            });
            await agentClears({
                name: "Alexs",
                as: otherId,
                connection: "Claude",
            });
            await agentClears({
                name: "Owners",
                as: ownerId,
                connection: "Claude",
            });
            await agentClears({
                name: "Token",
                as: null,
                connection: "household token",
            });
            const sam = await (await appPage(memberId, "Claude")).text();
            expect(sam).toContain("Deleted grocery line Mine");
            for (const other of ["Alexs", "Owners", "Token"]) {
                expect(sam).not.toContain(`Deleted grocery line ${other}`);
            }
            expect(sam).not.toContain("Claude for ");
            const owner = await (await appPage(ownerId, "Claude")).text();
            expect(owner).toContain("Deleted grocery line Owners");
            for (const other of ["Mine", "Alexs", "Token"]) {
                expect(owner).not.toContain(`Deleted grocery line ${other}`);
            }
        });

        test("a filtered view does not claim an app has no changes when the latest 50 hide them", async () => {
            await agentClears({
                name: "Old",
                as: memberId,
                connection: "Claude",
                ago: 60 * 60 * 1000,
            });
            for (let i = 0; i < AI_ACTIVITY_LIMIT; i++) {
                await agentClears({
                    name: `G${i}`,
                    as: memberId,
                    connection: "Grok",
                });
            }
            const filtered = await (await appPage(memberId, "Claude")).text();
            // Nothing of Claude's within the 50 shown: said so, not "no changes".
            expect(filtered).toContain(
                "No changes by Claude among the latest 50",
            );
            expect(filtered).not.toContain("Deleted grocery line Old");
            // The queries are as ever: the unfiltered list is still the 50 newest.
            const all = await (await page(memberId)).text();
            expect(all.match(/id="agent-action-/g)).toHaveLength(
                AI_ACTIVITY_LIMIT,
            );
            expect(all).not.toContain("Deleted grocery line Old");
            expect(all).not.toContain("among the latest");
            // With a Claude change inside the window the line says what it holds.
            await agentClears({
                name: "New",
                as: memberId,
                connection: "Claude",
            });
            const within = await (await appPage(memberId, "Claude")).text();
            expect(within).toContain("Deleted grocery line New");
            expect(within).toContain("Changes by Claude among the latest 50");
        });

        test("a member cannot turn their own switch on while the household switch is off; the owner's own stays theirs", async () => {
            const settings = liveSettingsStore();
            await settings.setMemberAgentsCanDelete(
                householdId,
                memberId,
                false,
            );
            await post(ownerId, SWITCH, { allowed: "0" });
            const refused = await post(memberId, OWN, { allowed: "1" });
            expect(refused.status).toBe(400);
            expect(await refused.text()).toContain(
                "Agents cannot delete while the household switch is off.",
            );
            expect(
                await settings.getMemberAgentsCanDelete(householdId, memberId),
            ).toBe(false);
            // Turning it Off is still fine, and so is the owner's own switch.
            expect((await post(memberId, OWN, { allowed: "0" })).status).toBe(
                303,
            );
            expect((await post(ownerId, OWN, { allowed: "1" })).status).toBe(
                303,
            );
            expect(
                await settings.getMemberAgentsCanDelete(householdId, ownerId),
            ).toBe(true);
            // With the household switch back on, the member's own turns on.
            await post(ownerId, SWITCH, { allowed: "1" });
            expect((await post(memberId, OWN, { allowed: "1" })).status).toBe(
                303,
            );
            expect(
                await settings.getMemberAgentsCanDelete(householdId, memberId),
            ).toBe(true);
        });

        test("signed out, a filtered page is the login redirect, not the changes", async () => {
            await agentClears({ name: "Milk", connection: "Claude" });
            const res = await app.request(
                "http://test/settings/ai-connections?app=Claude",
            );
            const html = await res.text();
            expect(html).not.toContain("Deleted grocery line Milk");
            expect(html).not.toContain("Recent changes");
        });

        test("the activity list is empty-stated when agents have done nothing", async () => {
            const html = await (await page(ownerId)).text();
            expect(html).toContain("Recent changes");
            expect(html).toContain("No changes yet");
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
            expect(html).not.toContain(">Undo<");
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
            expect(html).not.toContain(">Undo<");
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
            expect(html).not.toContain(">Undo<");

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

        test("an undo always goes back to AI connections, whatever back says", async () => {
            const first = await agentClears({ name: "Milk" });
            const second = await agentClears({ name: "Eggs" });

            const fromToday = await post(ownerId, undoPath(first.actionId), {
                back: "/",
            });
            const elsewhere = await post(ownerId, undoPath(second.actionId), {
                back: "https://evil.example/",
            });

            expect(fromToday.headers.get("location")).toBe(
                "/settings/ai-connections",
            );
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

        test("Today shows no agent change; Undo stays in Settings › AI connections until it is undone", async () => {
            const { actionId } = await agentClears({ name: "Milk" });

            const html = await (await today(ownerId)).text();
            expect(html).not.toContain('data-notice="agent.action"');
            expect(html).not.toContain("Deleted grocery line Milk");
            expect(html).not.toContain(`action="${undoPath(actionId)}"`);

            const settings = await (await page(ownerId)).text();
            expect(settings).toContain("Deleted grocery line Milk");
            expect(settings).toContain(`action="${undoPath(actionId)}"`);

            expect(
                (
                    await post(ownerId, undoPath(actionId), {
                        back: "/settings/ai-connections",
                    })
                ).status,
            ).toBe(303);
            expect(await lineCount()).toBe(1);
        });

        test("no one's Today shows an agent change, whoever it is theirs to undo", async () => {
            await agentClears({ name: "Old", ago: AGENT_UNDO_TTL_MS + 60_000 });
            await agentClears({ name: "Sams", as: memberId });

            for (const userId of [ownerId, otherId, memberId]) {
                const html = await (await today(userId)).text();
                expect(html).not.toContain('data-notice="agent.action"');
                expect(html).not.toContain("(by Claude)");
            }
        });
    },
);
