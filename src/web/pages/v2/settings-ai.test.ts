import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import type { AiConnection } from "../../../db/tokens.js";
import {
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
    flags: { ...FIXTURE_APP_CHROME_FLAGS, uiV2: true },
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
