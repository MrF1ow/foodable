import type { AppChromeBase } from "../../attention.js";
import type { AiConnection } from "../../../db/tokens.js";
import { dateInTz } from "../../../domain/tz.js";
import { esc } from "../../components/v2/html.js";
import { iconCopy } from "../../components/v2/icons.js";
import { confirmSheet, sheetTrigger } from "../../components/v2/sheet.js";
import {
    renderSettingsV2Page,
    settingsErrorBanner,
    settingsMenuIcon,
    settingsPageHeader,
} from "./settings-shared.js";
import { formatGoalSince } from "./settings-goals-label.js";

/**
 * What the Disconnect form posts for tokens with no recorded app. A real app's
 * id is a uuid or the deploy-wide id, never this word.
 */
export const UNKNOWN_APP_MARKER = "unknown";

export const AI_DISCONNECT_PATH = "/settings/ai-connections/disconnect";

export type SettingsAiV2View = {
    chrome: AppChromeBase;
    connections: readonly AiConnection[];
    now: Date;
    /** The member's timezone: "today" and the dates are theirs. */
    timezone: string;
    /** The address an agent adds as its remote MCP server. */
    mcpUrl: string;
    error?: string;
    /**
     * Open this app's Disconnect sheet on load: the id the form posts (the
     * app's client id, or `UNKNOWN_APP_MARKER`).
     */
    openClient?: string;
};

const MS_PER_DAY = 86_400_000;

/** Whole calendar days from `from` to `to` (both "YYYY-MM-DD"). */
function daysBetween(from: string, to: string): number {
    return Math.round(
        (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
            MS_PER_DAY,
    );
}

/**
 * "Last used today", "yesterday", "N days ago" for the first week, then the
 * date; "Not used yet" when no use was ever recorded.
 */
export function lastUsedText(
    lastUsedAt: Date | null,
    now: Date,
    timezone: string,
): string {
    if (!lastUsedAt) return "Not used yet";
    const today = dateInTz(now, timezone);
    const day = dateInTz(lastUsedAt, timezone);
    const ago = daysBetween(day, today);
    if (ago <= 0) return "Last used today";
    if (ago === 1) return "Last used yesterday";
    if (ago <= 6) return `Last used ${ago} days ago`;
    return `Last used ${formatGoalSince(day, today)}`;
}

function connectedText(first: Date, now: Date, timezone: string): string {
    const today = dateInTz(now, timezone);
    return `Connected ${formatGoalSince(dateInTz(first, timezone), today)}`;
}

function appName(connection: AiConnection): string {
    return connection.clientName?.trim() || "Unknown app";
}

function sheetId(index: number): string {
    return `fd-ai-disconnect-${index}`;
}

/** What the Disconnect form posts for this app. */
function postedClient(connection: AiConnection): string {
    return connection.clientId ?? UNKNOWN_APP_MARKER;
}

function connectionRow(
    connection: AiConnection,
    index: number,
    view: SettingsAiV2View,
): string {
    const name = appName(connection);
    const trigger = sheetTrigger({
        target: sheetId(index),
        label: "Disconnect",
        className: "fd-settings-ai__disconnect",
        ariaLabel: `Disconnect ${name}`,
    });
    return `<li class="fd-settings-ai__row"><span class="fd-settings-ai__logo" aria-hidden="true">${settingsMenuIcon("code", "fd-settings-ai__icon")}</span><div class="fd-settings-ai__text"><p class="fd-settings-ai__name">${esc(name)}</p><p class="fd-settings-ai__meta">${esc(lastUsedText(connection.lastUsedAt, view.now, view.timezone))}</p><p class="fd-settings-ai__meta">${esc(connectedText(connection.firstConnectedAt, view.now, view.timezone))}</p></div>${trigger}</li>`;
}

function disconnectSheet(
    connection: AiConnection,
    index: number,
    view: SettingsAiV2View,
): string {
    const name = appName(connection);
    return confirmSheet({
        id: sheetId(index),
        title: `Disconnect ${name}?`,
        message: `${name} will stop working with your account right away. You can connect it again later.`,
        action: AI_DISCONNECT_PATH,
        confirmLabel: "Disconnect",
        hiddenFields: { client: postedClient(connection) },
        openOnLoad: view.openClient === postedClient(connection),
        turboFalse: true,
    });
}

export function renderSettingsAiV2Body(view: SettingsAiV2View): string {
    const list =
        view.connections.length === 0
            ? `<p class="fd-settings-ai__empty">No AI apps connected yet.</p>`
            : `<ul class="fd-settings-ai__list">${view.connections.map((c, i) => connectionRow(c, i, view)).join("")}</ul>`;
    const sheets = view.connections
        .map((c, i) => disconnectSheet(c, i, view))
        .join("");
    return `${settingsPageHeader("AI connections")}${String(settingsErrorBanner(view.error))}<p class="fd-settings-ai__lead">Agents you connect can log meals, read your fridge and plan groceries for this household.</p>${list}<h2 class="fd-settings-goals-card__title fd-settings-ai__connect-title">Connect a new agent</h2><div class="fd-settings-ai__address" data-fd-copy-address><code id="fd-ai-mcp-url" data-fd-copy-source>${esc(view.mcpUrl)}</code><button type="button" class="fd-settings-ai__copy" data-fd-copy-trigger aria-label="Copy address">${String(iconCopy())}</button></div><p class="fd-visually-hidden" role="status" aria-live="polite" data-fd-copy-status></p><p class="fd-settings-ai__help">Add this address as a remote MCP server in your agent, then sign in when it asks.</p>${sheets}`;
}

export function renderSettingsAiV2Page(view: SettingsAiV2View): string {
    return renderSettingsV2Page({
        chrome: view.chrome,
        page: "ai",
        title: "AI connections",
        body: renderSettingsAiV2Body(view),
    });
}
