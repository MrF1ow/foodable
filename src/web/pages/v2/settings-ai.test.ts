import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import type { AiConnection } from "../../../db/tokens.js";
import type { AgentActionEntry } from "../../../domain/agent-actions.js";
import {
    activityWhen,
    agentActivityRows,
    aiUndoPath,
    appFilterKey,
    renderSettingsAiV2Body,
    renderSettingsAiV2Page,
    resolveAppFilter,
    UNKNOWN_APP_MARKER,
    lastUsedText,
} from "./settings-ai.js";
import {
    buttonLabels,
    DOLLAR_PAYLOADS,
    injectedAttributes,
} from "../../components/v2/test-helpers.js";

const chrome = {
    theme: "light" as const,
    flags: FIXTURE_APP_CHROME_FLAGS,
    identity: {
        viewerName: "Ethan Flow",
        viewerRole: "owner" as const,
        householdName: "Flow",
        memberCount: 2,
    },
};

const NOW = new Date("2026-11-12T15:00:00.000Z");
const CLAUDE = "7d3f6c2e-5b1a-4e8f-9a3d-1c2b3a4d5e6f";
const MCP_URL = "https://food.example.test/mcp";

const BASE_VIEW = {
    destructive: { allowed: true, canChange: true },
    personal: { canDelete: false, householdOffBy: null },
    showCards: true,
    activity: [],
};

function connection(over: Partial<AiConnection> = {}): AiConnection {
    return {
        clientId: CLAUDE,
        clientName: "Claude",
        firstConnectedAt: new Date("2026-10-03T12:00:00.000Z"),
        lastUsedAt: new Date("2026-11-12T09:00:00.000Z"),
        ...over,
    };
}

function render(
    connections: AiConnection[],
    extra: { error?: string; timezone?: string } = {},
) {
    return renderSettingsAiV2Page({
        chrome,
        connections,
        destructive: { allowed: true, canChange: true },
        personal: { canDelete: false, householdOffBy: null },
        showCards: true,
        activity: [],
        now: NOW,
        timezone: extra.timezone ?? "UTC",
        mcpUrl: MCP_URL,
        error: extra.error,
    });
}

function body(connections: AiConnection[], mcpUrl = MCP_URL) {
    return renderSettingsAiV2Body({
        chrome,
        ...BASE_VIEW,
        connections,
        now: NOW,
        timezone: "UTC",
        mcpUrl,
    });
}

describe("lastUsedText", () => {
    const at = (iso: string) => lastUsedText(new Date(iso), NOW, "UTC");

    test("says today, yesterday and days ago, then the date", () => {
        expect(at("2026-11-12T01:00:00.000Z")).toBe("Last used today");
        expect(at("2026-11-11T23:00:00.000Z")).toBe("Last used yesterday");
        expect(at("2026-11-10T08:00:00.000Z")).toBe("Last used 2 days ago");
        expect(at("2026-11-06T08:00:00.000Z")).toBe("Last used 6 days ago");
        expect(at("2026-11-05T08:00:00.000Z")).toBe("Last used Nov 5");
        expect(at("2025-12-30T08:00:00.000Z")).toBe("Last used Dec 30, 2025");
    });

    test("a token never used says so", () => {
        expect(lastUsedText(null, NOW, "UTC")).toBe("Not used yet");
    });

    test("counts days in the member's timezone", () => {
        // 23:30 UTC on the 11th is already the 12th in Kyiv: today.
        expect(
            lastUsedText(
                new Date("2026-11-11T23:30:00.000Z"),
                NOW,
                "Europe/Kyiv",
            ),
        ).toBe("Last used today");
    });
});

describe("settings AI connections page", () => {
    test("lists each app with its name, first connection and last use", () => {
        const html = render([
            connection(),
            connection({
                clientId: "2b1c0d9e-8f7a-4b6c-8d5e-4f3a2b1c0d9e",
                clientName: "Grok CLI",
                firstConnectedAt: new Date("2026-11-01T08:00:00.000Z"),
                lastUsedAt: new Date("2026-11-10T08:00:00.000Z"),
            }),
        ]);
        expect(html).toContain('data-fd-settings-page="ai"');
        expect(html).toContain("Claude");
        // One line under the name: the last use, then since when.
        expect(html).toContain("Last used today · since Oct 3");
        expect(html).toContain("Grok CLI");
        expect(html).toContain("Last used 2 days ago · since Nov 1");
        expect(html).not.toContain("Connected Oct 3");
    });

    test("a connection with no recorded app is the Unknown app", () => {
        const html = render([
            connection({
                clientId: null,
                clientName: null,
                lastUsedAt: null,
            }),
        ]);
        expect(html).toContain("Unknown app");
        expect(html).toContain("Not used yet · since Oct 3");
        expect(html).toContain(`name="client" value="${UNKNOWN_APP_MARKER}"`);
    });

    test("a registered client with no name falls back to Unknown app", () => {
        const html = render([connection({ clientName: null })]);
        expect(html).toContain("Unknown app");
        expect(html).toContain(`name="client" value="${CLAUDE}"`);
    });

    test("each app's ⋯ holds Disconnect, which confirms in place and posts the client id only", () => {
        const html = body([connection()]);
        expect(html).toContain('action="/settings/ai-connections/disconnect"');
        expect(html).toContain("data-fd-menu-confirm");
        expect(html).toContain('aria-label="Confirm Disconnect"');
        expect(html).toContain('aria-label="Actions for Claude"');
        expect(html).toContain('name="client"');
        // The member is never a form field: the route reads the session.
        expect(html).not.toMatch(/name="(user|user_id)"/);
        // No sheet, no confirm text, and the form is a Turbo visit.
        expect(html).not.toContain("<dialog");
        expect(html).not.toContain("Disconnect Claude?");
        expect(html).not.toContain("data-turbo");
    });

    test("an app name cannot inject markup", () => {
        const html = render([
            connection({ clientName: "<img src=x onerror=1>" }),
        ]);
        expect(html).not.toContain("<img src=x");
        expect(html).toContain("&lt;img src=x");
    });

    // client_name is whatever an unauthenticated /register call said it was.
    test("an app name made of $-patterns and attributes stays inert", async () => {
        for (const payload of DOLLAR_PAYLOADS) {
            const html = renderSettingsAiV2Body({
                chrome,
                ...BASE_VIEW,
                connections: [
                    connection({ clientName: payload }),
                    connection({
                        clientId: "2b1c0d9e-8f7a-4b6c-8d5e-4f3a2b1c0d9e",
                        clientName: `x ${payload}`,
                    }),
                ],
                now: NOW,
                timezone: "UTC",
                mcpUrl: MCP_URL,
            });
            expect(await injectedAttributes(html)).toEqual([]);
            // Each ⋯ button is named for its app, exactly.
            expect(await buttonLabels(html)).toEqual([
                `Actions for ${payload}`,
                `Actions for x ${payload}`,
                "Show cards in chat",
                "Your agents can delete",
                "Any agent can delete",
                "Copy address",
            ]);
        }
    });

    test("each app's ⋯ is a round button that names its app for screen readers", () => {
        const html = render([connection()]);
        expect(html).toMatch(
            /<button[^>]*aria-label="Actions for Claude"[^>]*data-fd-menu-trigger/,
        );
        expect(html).not.toContain("fd-settings-ai__disconnect");
    });

    test("the app icon is the code glyph in the row's lead, not the settings menu's icon", () => {
        const html = render([connection()]);
        expect(html).toContain("fd-item-row__icon");
        const body = renderSettingsAiV2Body({
            chrome,
            ...BASE_VIEW,
            connections: [connection()],
            now: NOW,
            timezone: "UTC",
            mcpUrl: MCP_URL,
        });
        expect(body).not.toContain("fd-settings-menu__icon");
    });

    test("empty state says nothing is connected, with the address still there and no how-to text", () => {
        const html = render([]);
        expect(html).toContain("No AI apps connected yet");
        expect(html).not.toContain("Disconnect");
        expect(html).toContain(MCP_URL);
        expect(html).not.toContain("remote MCP server");
        expect(html).not.toContain("Agents you connect can log meals");
    });

    test("always shows the address to connect a new agent", () => {
        const html = render([connection()]);
        expect(html).toContain("Connect a new agent");
        expect(html).toContain(MCP_URL);
    });

    test("the address has a copy button that names what it copies", () => {
        const html = body([connection()]);
        const button = html.match(
            /<button[^>]*data-fd-copy-trigger[^>]*>[\s\S]*?<\/button>/,
        );
        expect(button).not.toBeNull();
        expect(button![0]).toContain('type="button"');
        expect(button![0]).toContain('aria-label="Copy address"');
        expect(button![0]).toContain("<svg");
        // The module reads the address from the code element beside it, and
        // announces the result in a live region.
        expect(html).toMatch(
            /data-fd-copy-source[^>]*>https:\/\/food\.example\.test\/mcp</,
        );
        expect(html).toMatch(
            /role="status"[^>]*aria-live="polite"[^>]*data-fd-copy-status|data-fd-copy-status[^>]*role="status"/,
        );
        // Markup only: the behaviour ships in /app.js, never inline.
        expect(html).not.toContain("<script");
        expect(html).not.toContain("onclick");
    });

    test("an address with markup characters stays inert beside the button", () => {
        const html = body([], '"><img src=x onerror=alert(1)>');
        expect(html).not.toContain("<img");
        expect(html).toContain("data-fd-copy-trigger");
    });

    test("shows an error above the list", () => {
        const html = render([connection()], { error: "Nope." });
        expect(html).toContain("Nope.");
        expect(html.indexOf("Nope.")).toBeLessThan(
            html.indexOf("Claude</span>"),
        );
    });
});

const OWNER_ID = "owner-1";
const SAM_ID = "member-sam";

function action(over: Partial<AgentActionEntry> = {}): AgentActionEntry {
    return {
        id: "a1000000-0000-4000-8000-000000000001",
        householdId: "hh-1",
        memberId: SAM_ID,
        connection: "Claude",
        tool: "clear_checked_grocery_lines",
        summary: "Cleared 20 grocery lines",
        createdAt: "2026-11-12T13:00:00.000Z",
        undoExpiresAt: "2026-11-13T13:00:00.000Z",
        undoneAt: null,
        canUndo: true,
        ...over,
    };
}

function rows(entries: AgentActionEntry[], viewerUserId = OWNER_ID) {
    return agentActivityRows(entries, {
        viewerUserId,
        isOwner: viewerUserId === OWNER_ID,
        names: new Map([
            [OWNER_ID, "Ethan"],
            [SAM_ID, "Sam"],
        ]),
        now: NOW,
        timezone: "UTC",
    });
}

type Destructive = { allowed: boolean; canChange: boolean };
type Personal = { canDelete: boolean; householdOffBy: string | null };

function withActivity(
    activity: ReturnType<typeof rows>,
    destructive: Destructive = { allowed: true, canChange: true },
    personal: Personal = { canDelete: false, householdOffBy: null },
) {
    return renderSettingsAiV2Body({
        chrome,
        connections: [],
        destructive,
        personal,
        showCards: true,
        activity,
        now: NOW,
        timezone: "UTC",
        mcpUrl: MCP_URL,
    });
}

/** The `<li>` of the row whose title is `title`. */
function rowOf(html: string, title: string): string {
    const rows =
        html.match(/<li class="fd-item-row[^"]*"[^>]*>.*?<\/li>/gs) ?? [];
    const found = rows.find((row) => row.includes(`title="${title}">`));
    if (!found) throw new Error(`no row titled ${title}`);
    return found;
}

describe("the household switch (the owner's household-wide off)", () => {
    test("the owner gets a switch that posts the opposite value, under an owner-only heading", () => {
        const on = withActivity([]);
        expect(on).toContain("Any agent can delete");
        expect(on).toContain(">Household · owner only<");
        expect(on).toContain("Off stops every member's agents");
        expect(on).toContain('action="/settings/ai-connections/destructive"');
        const row = rowOf(on, "Any agent can delete");
        expect(row).toContain('name="allowed" value="0"');
        expect(row).toContain('role="switch" aria-checked="true"');
        // A Turbo visit, like every other switch.
        expect(row).not.toContain("data-turbo");
        // The old "Off: agents can still read and add…" paragraph is gone.
        expect(on).not.toContain("Off: agents can still read");
        expect(on).not.toContain("Allow destructive changes");
        const off = withActivity([], { allowed: false, canChange: true });
        const offRow = rowOf(off, "Any agent can delete");
        expect(offRow).toContain('name="allowed" value="1"');
        expect(offRow).toContain('aria-checked="false"');
    });

    test("anyone else does not see the household switch at all, only their own", () => {
        const html = withActivity([], { allowed: true, canChange: false });
        expect(html).not.toContain("Any agent can delete");
        expect(html).not.toContain("Household · owner only");
        expect(html).not.toContain("/settings/ai-connections/destructive");
        // The member's own cards switch and their own delete switch.
        expect(html.match(/role="switch"/g)).toHaveLength(2);
    });
});

describe("a person's own switch: Your agents can delete", () => {
    const PATH = "/settings/ai-connections/agent-delete";

    test("it is off by default, says what it covers, and posts the opposite value", () => {
        const html = withActivity([], { allowed: true, canChange: false });
        const row = rowOf(html, "Your agents can delete");
        expect(row).toContain("Off by default · only what you can delete");
        expect(row).toContain(`action="${PATH}"`);
        expect(row).toContain('name="allowed" value="1"');
        expect(row).toContain('role="switch" aria-checked="false"');
        expect(row).not.toContain("disabled");
        // A form of the app's own: no Turbo opt-out, like the cards switch.
        expect(row).not.toContain("data-turbo");
        const on = withActivity(
            [],
            { allowed: true, canChange: false },
            { canDelete: true, householdOffBy: null },
        );
        const onRow = rowOf(on, "Your agents can delete");
        expect(onRow).toContain('name="allowed" value="0"');
        expect(onRow).toContain('aria-checked="true"');
        expect(onRow).toContain("Only what you can delete yourself");
        expect(onRow).not.toContain("Off by default");
    });

    test("the owner has their own switch beside the household one, own switch first", () => {
        const html = withActivity([]);
        expect(html).toContain(`action="${PATH}"`);
        expect(html.indexOf("Show cards in chat")).toBeLessThan(
            html.indexOf("Your agents can delete"),
        );
        expect(html.indexOf("Your agents can delete")).toBeLessThan(
            html.indexOf("Household · owner only"),
        );
        expect(html.indexOf("Household · owner only")).toBeLessThan(
            html.indexOf("Any agent can delete"),
        );
        expect(html.indexOf("Any agent can delete")).toBeLessThan(
            html.indexOf("Recent changes"),
        );
        // Three switches: cards, their own, the household's.
        expect(html.match(/role="switch"/g)).toHaveLength(3);
    });

    test("with the household switch off a member's own row shows the switch off and disabled, says who turned it off, and posts nothing", () => {
        const html = withActivity(
            [],
            { allowed: false, canChange: false },
            { canDelete: true, householdOffBy: "Ethan" },
        );
        const row = rowOf(html, "Your agents can delete");
        expect(row).toContain("Turned off for the household by Ethan");
        expect(row).not.toContain("Off by default");
        expect(row).toContain('role="switch" aria-checked="false"');
        expect(row).toContain("disabled");
        // Built from the item row's switch, so it sits where every switch does…
        expect(row).toMatch(/class="fd-item-row__trail fd-item-row__toggle"/);
        // …and the reason under the title is what describes it.
        const reasonId = row.match(
            /class="fd-item-row__subtitle" id="([^"]+)">Turned off for the household/,
        )?.[1];
        expect(reasonId).toBeDefined();
        expect(row).toContain(`aria-describedby="${reasonId}"`);
        expect(row).not.toContain("<form");
        expect(row).not.toContain(PATH);
        // The cards switch is the only form left in the Agents group.
        expect(html.match(/<form/g)).toHaveLength(1);
    });

    test("a missing owner name still reads", () => {
        const html = withActivity(
            [],
            { allowed: false, canChange: false },
            { canDelete: false, householdOffBy: "" },
        );
        expect(rowOf(html, "Your agents can delete")).toContain(
            "Turned off for the household by the owner",
        );
    });

    test("the owner's own switch stays live when they turned the household off", () => {
        const html = withActivity(
            [],
            { allowed: false, canChange: true },
            { canDelete: true, householdOffBy: null },
        );
        const row = rowOf(html, "Your agents can delete");
        expect(row).toContain(`action="${PATH}"`);
        expect(row).not.toContain("disabled");
    });
});

describe("the Agents group", () => {
    test("Show cards in chat sits first and posts the opposite value", () => {
        const on = withActivity([]);
        expect(on).toMatch(/fd-section-header__label">Agents</);
        expect(on).toContain("Show cards in chat");
        expect(on).toContain("Goals and meals as widgets");
        expect(on).toContain('action="/settings/ai-connections/widgets"');
        expect(on).toContain('name="enabled" value="0"');
        // Every form here takes part in Turbo (no full reload).
        const cards = on.match(
            /<form[^>]*action="\/settings\/ai-connections\/widgets"[^>]*>/,
        )?.[0];
        expect(cards).toBeDefined();
        expect(cards).not.toContain("data-turbo");
        expect(on.indexOf("Show cards in chat")).toBeLessThan(
            on.indexOf("Your agents can delete"),
        );
        const off = renderSettingsAiV2Body({
            chrome,
            connections: [],
            destructive: { allowed: true, canChange: true },
            personal: { canDelete: false, householdOffBy: null },
            showCards: false,
            activity: [],
            now: NOW,
            timezone: "UTC",
            mcpUrl: MCP_URL,
        });
        expect(off).toContain('name="enabled" value="1"');
        expect(off).toMatch(
            /aria-label="Show cards in chat"[^>]*role="switch" aria-checked="false"|role="switch" aria-checked="false"[^>]*aria-label="Show cards in chat"/,
        );
    });

    test("a member still gets the cards switch, since it is their own", () => {
        const html = withActivity([], { allowed: true, canChange: false });
        expect(html).toContain('action="/settings/ai-connections/widgets"');
    });
});

describe("agentActivityRows", () => {
    test("names the connection, with the time in the member's zone", () => {
        const [row] = rows([action()]);
        expect(row).toMatchObject({
            summary: "Cleared 20 grocery lines",
            connection: "Claude",
            state: { kind: "undo" },
        });
        expect(row?.when).toBe("2 hours ago");
    });

    test("Undo only where the viewer may use it and the change can still be put back", () => {
        expect(rows([action()], OWNER_ID)[0]?.state).toEqual({ kind: "undo" });
        expect(rows([action()], SAM_ID)[0]?.state).toEqual({ kind: "undo" });
        expect(rows([action()], "member-alex")[0]?.state).toEqual({
            kind: "other",
            who: "Sam",
        });
        // The household token, the owner's own agent and a member who left are
        // the owner's alone to undo: nobody is named.
        const other = (
            over: Partial<AgentActionEntry>,
            undoAnyIds?: string[],
        ) =>
            agentActivityRows([action(over)], {
                viewerUserId: "member-alex",
                isOwner: false,
                names: new Map([
                    [OWNER_ID, "Ethan"],
                    [SAM_ID, "Sam"],
                ]),
                undoAnyIds: new Set(undoAnyIds ?? []),
                now: NOW,
                timezone: "UTC",
            })[0]?.state;
        expect(other({ memberId: null })).toEqual({ kind: "other", who: null });
        expect(other({ memberId: OWNER_ID }, [OWNER_ID])).toEqual({
            kind: "other",
            who: null,
        });
        expect(other({ memberId: "member-gone" })).toEqual({
            kind: "other",
            who: null,
        });
        expect(
            rows([
                action({
                    undoneAt: "2026-11-12T14:00:00.000Z",
                    canUndo: false,
                }),
            ])[0]?.state,
        ).toEqual({ kind: "undone" });
        expect(rows([action({ canUndo: false })])[0]?.state).toEqual({
            kind: "expired",
        });
    });
});

describe("the activity list", () => {
    test("is empty-stated, with no footer", () => {
        const html = withActivity([]);
        expect(html).toMatch(/fd-section-header__label">Recent changes</);
        expect(html).toContain("No changes yet");
        expect(html).not.toContain("can be undone for 24 hours");
        expect(html).not.toContain("data-fd-ai-activity");
    });

    test("a list of changes has no footer or help paragraph", () => {
        const html = withActivity(rows([action()]));
        expect(html).toContain("data-fd-ai-activity");
        expect(html).not.toContain("Agent changes can be undone for 24 hours.");
        expect(html).not.toContain("fd-settings-ai__help");
    });

    test("a row is the change, then the app and when; Undo sits in its ⋯", () => {
        const html = withActivity(rows([action()]));
        expect(html).toContain("Cleared 20 grocery lines");
        // The owner is looking at Sam's agent: the line says whose.
        expect(html).toContain(">Claude for Sam · 2 hours ago<");
        expect(html).not.toContain("as Sam");
        const row = rowOf(html, "Cleared 20 grocery lines");
        expect(row).toContain(
            'aria-label="Actions for Cleared 20 grocery lines"',
        );
        expect(row).toContain(
            `action="${aiUndoPath("a1000000-0000-4000-8000-000000000001")}"`,
        );
        expect(row).toContain(">Undo<");
        // One tap, no confirm, and nothing for the route to read but the session.
        expect(row).not.toContain("data-fd-menu-confirm");
        expect(row).not.toContain('name="back"');
        expect(row).not.toContain("data-turbo");
    });

    test("every row has a ⋯: Undo where it can be undone, else a line inside it that says why", () => {
        const html = withActivity(
            rows([
                action({ id: "a1000000-0000-4000-8000-00000000000a" }),
                action({
                    id: "a1000000-0000-4000-8000-00000000000b",
                    undoneAt: "2026-11-12T14:00:00.000Z",
                    canUndo: false,
                }),
                action({
                    id: "a1000000-0000-4000-8000-00000000000c",
                    canUndo: false,
                }),
            ]),
        );
        expect(html).toContain(
            `action="${aiUndoPath("a1000000-0000-4000-8000-00000000000a")}"`,
        );
        expect(html.match(/>Undo</g)).toHaveLength(1);
        const list = html.slice(html.indexOf("data-fd-ai-activity"));
        expect(list.match(/data-fd-menu-trigger/g)).toHaveLength(3);
        // Never in the line under the title.
        expect(html).not.toContain("· Undone");
        expect(html).not.toContain("· Can no longer be undone");
        const undone = rowOf(html, "Cleared 20 grocery lines");
        expect(undone).toContain(">Claude for Sam · 2 hours ago<");
        expect(html).toMatch(
            /fd-menu__note" role="menuitem" aria-disabled="true"[^>]*><span class="fd-menu__text"><span class="fd-menu__label">Undone</,
        );
        expect(html).toMatch(
            /fd-menu__note"[^>]*><span class="fd-menu__text"><span class="fd-menu__label">Can no longer be undone</,
        );
        // Someone else's change: the reason is a line in the ⋯, naming Sam once.
        const other = withActivity(rows([action()], "member-alex"));
        expect(other).not.toContain(">Undo<");
        expect(other).toContain("data-fd-menu-trigger");
        expect(other).toContain(">Sam or the owner can undo<");
        expect(other).not.toContain("as Sam");
    });

    test("a household token change another member sees says only the owner can undo it", () => {
        const html = withActivity(
            rows([action({ memberId: null })], "member-alex"),
        );
        expect(html).toContain(">The owner can undo<");
        expect(html).not.toContain("the owner or the owner");
    });

    test("a line names whom the agent acted for when it is not the viewer's own", () => {
        const line = (
            entry: Partial<AgentActionEntry>,
            viewer: string,
            names?: [string, string][],
        ) => {
            const [row] = agentActivityRows([action(entry)], {
                viewerUserId: viewer,
                isOwner: viewer === OWNER_ID,
                names: new Map(
                    names ?? [
                        [OWNER_ID, "Ethan"],
                        [SAM_ID, "Sam"],
                    ],
                ),
                now: NOW,
                timezone: "UTC",
            });
            return String(
                rowOf(withActivity([row!]), "Cleared 20 grocery lines").match(
                    /fd-item-row__subtitle[^>]*>([^<]*)</,
                )?.[1],
            );
        };
        // Sam's own agent, to Sam: nothing added.
        expect(line({}, SAM_ID)).toBe("Claude · 2 hours ago");
        // The owner and another member read whose it was.
        expect(line({}, OWNER_ID)).toBe("Claude for Sam · 2 hours ago");
        expect(line({}, "member-alex")).toBe("Claude for Sam · 2 hours ago");
        // The owner's own agent, to the owner.
        expect(line({ memberId: OWNER_ID }, OWNER_ID)).toBe(
            "Claude · 2 hours ago",
        );
        expect(line({ memberId: OWNER_ID }, SAM_ID)).toBe(
            "Claude for Ethan · 2 hours ago",
        );
        // The household token, to everyone.
        expect(line({ memberId: null }, OWNER_ID)).toBe(
            "Claude · household token · 2 hours ago",
        );
        expect(
            line({ memberId: null, connection: "household token" }, SAM_ID),
        ).toBe("Household token · 2 hours ago");
        // A member who has left has no name to read.
        expect(line({ memberId: "gone" }, OWNER_ID)).toBe(
            "Claude for a former member · 2 hours ago",
        );
        // A long name is cut so the line stays one line at 390.
        expect(
            line({}, OWNER_ID, [
                [SAM_ID, "Maximilian-Alexander Featherstonehaugh"],
            ]),
        ).toBe("Claude for Maximilian-Alex… · 2 hours ago");
        // A name made of markup stays inert.
        expect(line({}, OWNER_ID, [[SAM_ID, "<b>Sam</b>"]])).toBe(
            "Claude for &lt;b&gt;Sam&lt;/b&gt; · 2 hours ago",
        );
    });

    test("the row carries the member it was made as", () => {
        expect(rows([action()])[0]).toMatchObject({
            memberId: SAM_ID,
            actor: { kind: "member", name: "Sam" },
        });
        expect(rows([action()], SAM_ID)[0]?.actor).toEqual({ kind: "viewer" });
        // Ids that differ only in letter case are one person.
        expect(
            rows([action({ memberId: SAM_ID.toUpperCase() })], SAM_ID)[0]
                ?.actor,
        ).toEqual({ kind: "viewer" });
        expect(rows([action({ memberId: null })])[0]).toMatchObject({
            memberId: null,
            actor: { kind: "household" },
        });
    });

    test("a summary or connection made of markup stays inert", () => {
        const html = withActivity(
            rows([
                action({
                    summary: "<img src=x onerror=alert(1)>",
                    connection: '"><script>alert(1)</script>',
                }),
            ]),
        );
        expect(html).not.toContain("<img src=x");
        expect(html).not.toContain("<script>alert");
    });
});

describe("activityWhen", () => {
    test("how long ago, counted in the member's zone", () => {
        const at = (iso: string, zone = "UTC") =>
            activityWhen(new Date(iso), NOW, zone);
        expect(at("2026-11-12T14:59:40.000Z")).toBe("Just now");
        expect(at("2026-11-12T14:30:00.000Z")).toBe("30 min ago");
        expect(at("2026-11-12T13:00:00.000Z")).toBe("2 hours ago");
        expect(at("2026-11-11T12:00:00.000Z")).toBe("Yesterday");
        expect(at("2026-11-09T12:00:00.000Z")).toBe("3 days ago");
        expect(at("2026-11-12T13:04:00.000Z", "America/New_York")).toBe(
            "1 hour ago",
        );
    });
});

describe("an app's Changes", () => {
    const GROK = "2b1c0d9e-8f7a-4b6c-8d5e-4f3a2b1c0d9e";
    const connections = [
        connection(),
        connection({ clientId: GROK, clientName: "Grok CLI" }),
        connection({ clientId: null, clientName: null }),
    ];

    test("each app's ⋯ has Changes, a link to its own changes that lands on Recent changes", () => {
        const html = body(connections);
        // An app is named by its client id, which the filter maps back to
        // the name its changes are recorded under.
        expect(html).toContain(
            `href="/settings/ai-connections?app=${CLAUDE}#recent-changes"`,
        );
        expect(html).toContain(
            `href="/settings/ai-connections?app=${GROK}#recent-changes"`,
        );
        // A token with no recorded app is recorded as "OAuth app".
        expect(html).toContain(
            'href="/settings/ai-connections?app=OAuth%20app#recent-changes"',
        );
        // A Turbo visit like any link, with Changes before Disconnect.
        expect(html).not.toContain("data-turbo");
        expect(html.indexOf(">Changes<")).toBeLessThan(
            html.indexOf(">Disconnect<"),
        );
        expect(html).toContain('id="recent-changes"');
    });

    test("an app name made of markup is inert, and the link names the app by its id", () => {
        const name = '"><script>alert(1)</script>&app=x#y';
        const html = body([connection({ clientName: name })]);
        expect(html).not.toContain("<script>alert");
        expect(html).toContain(
            `href="/settings/ai-connections?app=${CLAUDE}#recent-changes"`,
        );
    });

    test("a name cut through an emoji never breaks the page, and its link finds its changes", () => {
        // 79 units then a 2-unit emoji: the 80-unit cut keeps half of it.
        const name = `${"A".repeat(79)}\u{1F999}`;
        const app = connection({ clientName: name });
        const html = body([app]);
        expect(html).toContain(
            `href="/settings/ai-connections?app=${CLAUDE}#recent-changes"`,
        );
        expect(resolveAppFilter(CLAUDE, [app])).toBe(appFilterKey(app));
        // The key matches what Postgres stores: the half emoji as U+FFFD.
        expect(appFilterKey(app)).toBe(`${"A".repeat(79)}\uFFFD`);
        // With no client id the name is linked, its half emoji replaced.
        expect(() =>
            body([connection({ clientId: null, clientName: name })]),
        ).not.toThrow();
    });

    test("an app whose name has a space, an emoji join or a soft hyphen still finds its changes by its id", () => {
        for (const name of [
            "Claude ",
            "Cursor \u{1F469}\u200D\u{1F4BB}",
            "Ka\u00ADte",
        ]) {
            const app = connection({ clientName: name });
            expect(resolveAppFilter(CLAUDE, [app])).toBe(name);
        }
    });

    test("the key is the name its changes are recorded under", () => {
        expect(appFilterKey(connection())).toBe("Claude");
        expect(appFilterKey(connection({ clientName: null }))).toBe(CLAUDE);
        expect(
            appFilterKey(connection({ clientId: null, clientName: null })),
        ).toBe("OAuth app");
    });

    test("the key is cut to 80 characters and a name that is empty is no name, as the MCP actor records it", () => {
        const long = "A".repeat(90);
        expect(appFilterKey(connection({ clientName: long }))).toBe(
            "A".repeat(80),
        );
        expect(
            appFilterKey(connection({ clientName: null, clientId: long })),
        ).toBe("A".repeat(80));
        // An empty name wins over the id, and is no name: "OAuth app".
        expect(appFilterKey(connection({ clientName: "" }))).toBe("OAuth app");
        expect(
            appFilterKey(connection({ clientName: null, clientId: null })),
        ).toBe("OAuth app");
        // The link for an app with no id names that key.
        expect(
            body([connection({ clientId: null, clientName: "" })]),
        ).toContain(
            'href="/settings/ai-connections?app=OAuth%20app#recent-changes"',
        );
    });

    test("resolveAppFilter: a name stays, an id of the viewer's own app becomes its name, junk is no filter", () => {
        expect(resolveAppFilter("Claude", connections)).toBe("Claude");
        expect(resolveAppFilter("  Claude ", connections)).toBe("Claude");
        expect(resolveAppFilter(GROK, connections)).toBe("Grok CLI");
        // Another app's id, or a name nobody has: kept as typed, matches nothing.
        expect(resolveAppFilter("someone-else", connections)).toBe(
            "someone-else",
        );
        expect(resolveAppFilter(undefined, connections)).toBeNull();
        expect(resolveAppFilter("", connections)).toBeNull();
        expect(resolveAppFilter("   ", connections)).toBeNull();
        expect(resolveAppFilter("a".repeat(201), connections)).toBeNull();
        expect(resolveAppFilter("bad\u0000name", connections)).toBeNull();
        expect(resolveAppFilter("bad\nname", connections)).toBeNull();
        // Invisible format characters (bidi overrides, zero width) are not a name either.
        expect(resolveAppFilter("\u202Eevil", connections)).toBeNull();
        expect(resolveAppFilter("a\u200Bb", connections)).toBeNull();
    });

    function filtered(
        appFilter: string | null,
        extra: AgentActionEntry[] = [],
        viewer = SAM_ID,
    ) {
        return renderSettingsAiV2Body({
            chrome,
            connections,
            destructive: { allowed: true, canChange: viewer === OWNER_ID },
            personal: { canDelete: false, householdOffBy: null },
            showCards: true,
            activity: rows(
                [
                    action({ id: "a1000000-0000-4000-8000-00000000000a" }),
                    action({
                        id: "a1000000-0000-4000-8000-00000000000b",
                        connection: "Grok CLI",
                        summary: "Logged Chicken rice bowl",
                    }),
                    ...extra,
                ],
                viewer,
            ),
            appFilter,
            now: NOW,
            timezone: "UTC",
            mcpUrl: MCP_URL,
        });
    }

    test("a filtered Recent changes lists only that app's changes and says how to show all", () => {
        const html = filtered("Claude");
        expect(html).toContain("Cleared 20 grocery lines");
        expect(html).not.toContain("Logged Chicken rice bowl");
        const header = html.match(
            /<div class="fd-section-header" id="recent-changes">.*?<\/div>/s,
        )?.[0];
        expect(header).toContain(">Claude<");
        expect(header).toContain(
            'href="/settings/ai-connections#recent-changes">Show all<',
        );
        // Unfiltered: every change and no way back to show.
        const all = filtered(null);
        expect(all).toContain("Cleared 20 grocery lines");
        expect(all).toContain("Logged Chicken rice bowl");
        expect(all).not.toContain("Show all");
    });

    test("my app's Changes are my agent's only: another member's app of the same name, and the household token, stay out", () => {
        const others = [
            action({
                id: "a1000000-0000-4000-8000-00000000000c",
                memberId: OWNER_ID,
                summary: "Owner's Claude change",
            }),
            action({
                id: "a1000000-0000-4000-8000-00000000000d",
                memberId: null,
                summary: "Household token Claude change",
            }),
        ];
        // Sam's Claude: his own row, none of the owner's or the token's.
        const mine = filtered("Claude", others, SAM_ID);
        expect(mine).toContain("Cleared 20 grocery lines");
        expect(mine).not.toContain("Owner&#39;s Claude change");
        expect(mine).not.toContain("Owner's Claude change");
        expect(mine).not.toContain("Household token Claude change");
        // Every row left is Sam's own, so the line never says "for".
        expect(mine).not.toContain("Claude for");
        // The owner's Claude: the owner's own row, and not Sam's.
        const owners = filtered("Claude", others, OWNER_ID);
        expect(owners).toMatch(/Owner(&#39;|')s Claude change/);
        expect(owners).not.toContain("Cleared 20 grocery lines");
        expect(owners).not.toContain("Household token Claude change");
        // Unfiltered, everyone's show, each naming whose.
        const all = filtered(null, others, OWNER_ID);
        expect(all).toContain("Claude for Sam");
        expect(all).toContain("household token");
    });

    test("a filtered list says it holds the app's changes among the latest 50, even when none are shown", () => {
        const html = filtered("Claude");
        expect(html).toContain(
            '<p class="fd-settings-ai__scope">Changes by Claude among the latest 50</p>',
        );
        // Unfiltered says nothing of the kind.
        expect(filtered(null)).not.toContain("among the latest");
        const none = filtered("Gemini");
        expect(none).toContain("No changes by Gemini among the latest 50");
        expect(none).not.toContain("No changes by Gemini<");
        expect(none).not.toContain("fd-settings-ai__scope");
        // An unfiltered empty list is just empty.
        expect(withActivity([])).toContain("No changes yet");
        expect(withActivity([])).not.toContain("among the latest");
    });

    test("a long filter name is cut in the empty state and the scope line, and stays in one piece", () => {
        const long = "N".repeat(150);
        const none = filtered(long);
        expect(none).toContain(
            `No changes by ${"N".repeat(31)}… among the latest 50`,
        );
        const title = none.match(/fd-empty-state__title">([^<]*)</)?.[1];
        expect(title).not.toContain("N".repeat(40));
    });

    test("an app with no changes, or an unknown or hostile one, shows an empty list that is still escaped", () => {
        expect(filtered("Grok CLI")).not.toContain("Cleared 20 grocery lines");
        const none = filtered("Nobody");
        expect(none).toContain("No changes by Nobody among the latest 50");
        expect(none).toContain("Show all");
        expect(none).not.toContain("data-fd-ai-activity");
        const hostile = '<img src=x onerror=1>"';
        const html = filtered(hostile);
        expect(html).not.toContain("<img src=x");
        expect(html).toContain("No changes by &lt;img src=x");
    });
});
