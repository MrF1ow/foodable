import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import type { AiConnection } from "../../../db/tokens.js";
import type { AgentActionEntry } from "../../../domain/agent-actions.js";
import {
    activityWhen,
    agentActivityRows,
    AI_DESTRUCTIVE_HELP,
    aiUndoPath,
    parseAiUndoBack,
    renderSettingsAiV2Body,
    renderSettingsAiV2Page,
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
    attention: { count: 0, tabs: {} },
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
    extra: { error?: string; timezone?: string; openClient?: string } = {},
) {
    return renderSettingsAiV2Page({
        chrome,
        connections,
        destructive: { allowed: true, canChange: true },
        activity: [],
        now: NOW,
        timezone: extra.timezone ?? "UTC",
        mcpUrl: MCP_URL,
        error: extra.error,
        openClient: extra.openClient,
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
        expect(html).toContain("Connected Oct 3");
        expect(html).toContain("Last used today");
        expect(html).toContain("Grok CLI");
        expect(html).toContain("Connected Nov 1");
        expect(html).toContain("Last used 2 days ago");
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
        expect(html).toContain("Not used yet");
        expect(html).toContain(`name="client" value="${UNKNOWN_APP_MARKER}"`);
    });

    test("a registered client with no name falls back to Unknown app", () => {
        const html = render([connection({ clientName: null })]);
        expect(html).toContain("Unknown app");
        expect(html).toContain(`name="client" value="${CLAUDE}"`);
    });

    test("Disconnect opens a confirm sheet that posts the client id only", () => {
        const html = render([connection()]);
        expect(html).toContain('action="/settings/ai-connections/disconnect"');
        expect(html).toContain("Disconnect Claude?");
        expect(html).toContain('name="client"');
        // The member is never a form field: the route reads the session.
        expect(html).not.toMatch(/name="(user|user_id)"/);
        expect(html).toContain('commandfor="fd-ai-disconnect-0"');
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
            // Each Disconnect button is named for its app, exactly.
            expect(await buttonLabels(html)).toEqual([
                `Disconnect ${payload}`,
                `Disconnect x ${payload}`,
                "Copy address",
                "Agents may make destructive changes",
                "Close",
                "Close",
            ]);
        }
    });

    test("Disconnect buttons read Disconnect and name their app for screen readers", async () => {
        const html = render([connection()]);
        expect(html).toMatch(
            /<button type="button" class="fd-settings-ai__disconnect" commandfor="fd-ai-disconnect-0" command="show-modal" aria-label="Disconnect Claude">Disconnect<\/button>/,
        );
    });

    test("openClient opens that app's confirm sheet on load", () => {
        const two = [
            connection(),
            connection({
                clientId: null,
                clientName: null,
            }),
        ];
        const none = render(two);
        expect(none).not.toContain("data-sheet-open-on-load");
        const first = render(two, { openClient: CLAUDE });
        expect(first).toMatch(
            /<dialog[^>]*id="fd-ai-disconnect-0"[^>]*data-sheet-open-on-load/,
        );
        expect(first.match(/data-sheet-open-on-load/g)).toHaveLength(1);
        const unknown = render(two, { openClient: UNKNOWN_APP_MARKER });
        expect(unknown).toMatch(
            /<dialog[^>]*id="fd-ai-disconnect-1"[^>]*data-sheet-open-on-load/,
        );
    });

    test("the app icon is not the settings menu's icon class", () => {
        const html = render([connection()]);
        expect(html).toContain("fd-settings-ai__icon");
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

    test("empty state says nothing is connected and how to connect", () => {
        const html = render([]);
        expect(html).toContain("No AI apps connected yet.");
        expect(html).not.toContain("Disconnect");
        expect(html).toContain(MCP_URL);
        expect(html).toContain("remote MCP server");
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

    test("shows an error under the header", () => {
        expect(render([], { error: "Nope." })).toContain("Nope.");
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

function withActivity(
    activity: ReturnType<typeof rows>,
    destructive = { allowed: true, canChange: true },
) {
    return renderSettingsAiV2Body({
        chrome,
        connections: [],
        destructive,
        activity,
        now: NOW,
        timezone: "UTC",
        mcpUrl: MCP_URL,
    });
}

describe("the destructive switch", () => {
    test("the owner gets a switch that posts the opposite value", () => {
        const on = withActivity([]);
        expect(on).toContain("Agents may make destructive changes");
        expect(on).toContain('action="/settings/ai-connections/destructive"');
        expect(on).toContain('name="allowed" value="0"');
        expect(on).toContain('role="switch" aria-checked="true"');
        expect(on).toContain('data-turbo="false"');
        expect(on).toContain(AI_DESTRUCTIVE_HELP);
        const off = withActivity([], { allowed: false, canChange: true });
        expect(off).toContain('name="allowed" value="1"');
        expect(off).toContain('aria-checked="false"');
    });

    test("anyone else gets the value as text, no form", () => {
        const html = withActivity([], { allowed: false, canChange: false });
        expect(html).toContain("Agents may make destructive changes");
        expect(html).not.toContain("/settings/ai-connections/destructive");
        expect(html).not.toContain('role="switch"');
        expect(html).toContain("Only the household owner can change this.");
    });
});

describe("agentActivityRows", () => {
    test("names the connection and who it acted as, with the time in the member's zone", () => {
        const [row] = rows([action()]);
        expect(row).toMatchObject({
            summary: "Cleared 20 grocery lines",
            connection: "Claude",
            actingAs: "as Sam",
            state: { kind: "undo" },
        });
        expect(row?.when).toBe("2 hours ago · Nov 12, 1:00 PM");
        expect(
            rows([action({ memberId: null, connection: "household token" })])[0]
                ?.actingAs,
        ).toBe("");
        expect(
            agentActivityRows([action()], {
                viewerUserId: OWNER_ID,
                isOwner: true,
                names: new Map(),
                now: NOW,
                timezone: "UTC",
            })[0]?.actingAs,
        ).toBe("as a former member");
    });

    test("Undo only where the viewer may use it and the change can still be put back", () => {
        expect(rows([action()], OWNER_ID)[0]?.state).toEqual({ kind: "undo" });
        expect(rows([action()], SAM_ID)[0]?.state).toEqual({ kind: "undo" });
        expect(rows([action()], "member-alex")[0]?.state).toEqual({
            kind: "other",
            who: "Sam",
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
    test("is empty-stated", () => {
        const html = withActivity([]);
        expect(html).toContain("Agent activity");
        expect(html).toContain("Nothing yet.");
    });

    test("renders each state: Undo form, Undone, Can no longer be undone, who else can", () => {
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
        expect(html).toContain(
            '<input type="hidden" name="back" value="/settings/ai-connections" />',
        );
        expect(html.match(/class="fd-settings-ai__undo"/g)).toHaveLength(1);
        expect(html).toContain(">Undone<");
        expect(html).toContain(">Can no longer be undone<");
        expect(html).toContain("Claude · as Sam");
        expect(html).toContain('<time datetime="2026-11-12T13:00:00.000Z">');
        const other = withActivity(rows([action()], "member-alex"));
        expect(other).not.toContain('class="fd-settings-ai__undo"');
        expect(other).toContain("Sam or the owner can undo");
    });

    test("a household token change another member sees says only the owner can undo it", () => {
        const html = withActivity(
            rows([action({ memberId: null })], "member-alex"),
        );
        expect(html).toContain(">The owner can undo<");
        expect(html).not.toContain("the owner or the owner");
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

describe("activityWhen and parseAiUndoBack", () => {
    test("relative then absolute", () => {
        const at = (iso: string) => activityWhen(new Date(iso), NOW, "UTC");
        expect(at("2026-11-12T14:59:40.000Z")).toStartWith("Just now");
        expect(at("2026-11-12T14:30:00.000Z")).toStartWith("30 min ago");
        expect(at("2026-11-12T13:00:00.000Z")).toStartWith("2 hours ago");
        expect(at("2026-11-11T12:00:00.000Z")).toStartWith("Yesterday");
        expect(at("2026-11-09T12:00:00.000Z")).toStartWith("3 days ago");
        expect(
            activityWhen(
                new Date("2026-11-12T13:04:00.000Z"),
                NOW,
                "America/New_York",
            ),
        ).toBe("1 hour ago · Nov 12, 8:04 AM");
    });

    test("only our own pages are a way back", () => {
        expect(parseAiUndoBack("/")).toBe("/");
        expect(parseAiUndoBack("/settings/ai-connections")).toBe(
            "/settings/ai-connections",
        );
        expect(parseAiUndoBack("https://evil.example/")).toBe(
            "/settings/ai-connections",
        );
        expect(parseAiUndoBack(undefined)).toBe("/settings/ai-connections");
    });
});
