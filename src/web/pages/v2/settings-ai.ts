import type { AppChromeBase } from "../../attention.js";
import type { AiConnection } from "../../../db/tokens.js";
import type { AgentActionEntry } from "../../../domain/agent-actions.js";
import { mayUndoAgentAction } from "../../../domain/notices-agent.js";
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
export const AI_DESTRUCTIVE_PATH = "/settings/ai-connections/destructive";
export const AI_PAGE_PATH = "/settings/ai-connections";

/** How many agent actions the activity list shows. */
export const AI_ACTIVITY_LIMIT = 50;

/** Where Undo posts for one agent action. */
export function aiUndoPath(actionId: string): string {
    return `${AI_PAGE_PATH}/actions/${actionId}/undo`;
}

/** The pages an Undo may send the person back to. */
export const AI_UNDO_BACK_PATHS = [AI_PAGE_PATH, "/"] as const;
export type AiUndoBack = (typeof AI_UNDO_BACK_PATHS)[number];

/** A path from a form, if it is one of ours; never an address taken from the request. */
export function parseAiUndoBack(value: string | undefined): AiUndoBack {
    return AI_UNDO_BACK_PATHS.find((path) => path === value) ?? AI_PAGE_PATH;
}

/** Said under the switch, and by the tools when it is Off. */
export const AI_DESTRUCTIVE_HELP =
    "Off: agents can still read and add, but anything that deletes, clears or overwrites is refused.";

/** One line of the activity list, ready to render. */
export type AgentActivityRow = {
    id: string;
    summary: string;
    connection: string;
    /** "as Alice", or "" for the household token. */
    actingAs: string;
    /** When it happened: "2 hours ago · Nov 12, 1:04 PM". */
    when: string;
    createdAt: string;
    state:
        | { kind: "undo" }
        | { kind: "undone" }
        | { kind: "expired" }
        /** Undoable, but not by this viewer. */
        | { kind: "other"; who: string };
};

export type SettingsAiV2View = {
    chrome: AppChromeBase;
    connections: readonly AiConnection[];
    /** The household switch; only the owner may change it. */
    destructive: { allowed: boolean; canChange: boolean };
    /** Newest first. */
    activity: readonly AgentActivityRow[];
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

function ago(from: Date, now: Date, timezone: string): string {
    const minutes = Math.floor((now.getTime() - from.getTime()) / 60_000);
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    const days = Math.max(
        1,
        daysBetween(dateInTz(from, timezone), dateInTz(now, timezone)),
    );
    return days === 1 ? "Yesterday" : `${days} days ago`;
}

/** "2 hours ago · Nov 12, 1:04 PM", the clock in the member's timezone. */
export function activityWhen(at: Date, now: Date, timezone: string): string {
    const absolute = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    }).format(at);
    return `${ago(at, now, timezone)} · ${absolute}`;
}

/**
 * The activity list for one viewer: Undo only where they may use it (the
 * owner, or the member the agent acted as) and the change can still be put
 * back.
 */
export function agentActivityRows(
    entries: readonly AgentActionEntry[],
    opts: {
        viewerUserId: string;
        isOwner: boolean;
        /** Display names by user id. */
        names: ReadonlyMap<string, string>;
        now: Date;
        timezone: string;
    },
): AgentActivityRow[] {
    const viewer = { userId: opts.viewerUserId, isOwner: opts.isOwner };
    return entries.map((entry) => {
        const name =
            entry.memberId == null
                ? null
                : (opts.names.get(entry.memberId) ?? "a former member");
        let state: AgentActivityRow["state"];
        if (entry.undoneAt) state = { kind: "undone" };
        else if (!entry.canUndo) state = { kind: "expired" };
        else if (mayUndoAgentAction(entry, viewer)) state = { kind: "undo" };
        else state = { kind: "other", who: name ?? "the owner" };
        return {
            id: entry.id,
            summary: entry.summary,
            connection: entry.connection,
            actingAs: name ? `as ${name}` : "",
            when: activityWhen(
                new Date(entry.createdAt),
                opts.now,
                opts.timezone,
            ),
            createdAt: entry.createdAt,
            state,
        };
    });
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

function destructiveSection(view: SettingsAiV2View): string {
    const { allowed, canChange } = view.destructive;
    const title = "Agents may make destructive changes";
    const text = `<span class="fd-settings-ai__text"><span class="fd-settings-ai__name">${esc(title)}</span><span class="fd-settings-ai__meta">${allowed ? "Allowed" : "Off"}</span></span>`;
    const row = canChange
        ? `<li class="fd-settings-ai__row"><form method="post" action="${AI_DESTRUCTIVE_PATH}" class="fd-settings-ai__switch-form" data-turbo="false"><input type="hidden" name="allowed" value="${allowed ? "0" : "1"}" />${text}<button type="submit" class="fd-switch" role="switch" aria-checked="${allowed ? "true" : "false"}" aria-label="${esc(title)}"><span class="fd-switch__knob" aria-hidden="true"></span></button></form></li>`
        : `<li class="fd-settings-ai__row"><span class="fd-settings-ai__text"><span class="fd-settings-ai__name">${esc(title)}</span></span><span class="fd-settings-ai__status">${allowed ? "Allowed" : "Off"}</span></li>`;
    const readOnly = canChange
        ? ""
        : " Only the household owner can change this.";
    return `<h2 class="fd-settings-goals-card__title fd-settings-ai__connect-title">Agent changes</h2><ul class="fd-settings-ai__list" data-fd-ai-destructive>${row}</ul><p class="fd-settings-ai__help">${esc(AI_DESTRUCTIVE_HELP + readOnly)}</p>`;
}

function activityControl(row: AgentActivityRow, back: AiUndoBack): string {
    switch (row.state.kind) {
        case "undo":
            return `<form method="post" action="${esc(aiUndoPath(row.id))}" class="fd-settings-ai__undo-form" data-turbo="false"><input type="hidden" name="back" value="${esc(back)}" /><button type="submit" class="fd-settings-ai__undo" aria-label="Undo: ${esc(row.summary)}">Undo</button></form>`;
        case "undone":
            return `<span class="fd-settings-ai__status">Undone</span>`;
        case "other":
            return `<span class="fd-settings-ai__status">${esc(row.state.who === "the owner" ? "The owner can undo" : `${row.state.who} or the owner can undo`)}</span>`;
        case "expired":
            return `<span class="fd-settings-ai__status">Can no longer be undone</span>`;
    }
}

function activityRow(row: AgentActivityRow): string {
    const who = row.actingAs
        ? `${row.connection} · ${row.actingAs}`
        : row.connection;
    return `<li class="fd-settings-ai__row fd-settings-ai__activity-row" data-agent-action="${esc(row.id)}"><div class="fd-settings-ai__text"><p class="fd-settings-ai__name">${esc(row.summary)}</p><p class="fd-settings-ai__meta">${esc(who)}</p><p class="fd-settings-ai__meta"><time datetime="${esc(row.createdAt)}">${esc(row.when)}</time></p></div>${activityControl(row, AI_PAGE_PATH)}</li>`;
}

function activitySection(view: SettingsAiV2View): string {
    const list =
        view.activity.length === 0
            ? `<p class="fd-settings-ai__empty">Nothing yet. When an agent deletes, clears or overwrites something, it shows here and you can undo it for 24 hours.</p>`
            : `<ul class="fd-settings-ai__list" data-fd-ai-activity>${view.activity.map(activityRow).join("")}</ul>`;
    return `<h2 class="fd-settings-goals-card__title fd-settings-ai__connect-title">Agent activity</h2>${list}`;
}

export function renderSettingsAiV2Body(view: SettingsAiV2View): string {
    const list =
        view.connections.length === 0
            ? `<p class="fd-settings-ai__empty">No AI apps connected yet.</p>`
            : `<ul class="fd-settings-ai__list">${view.connections.map((c, i) => connectionRow(c, i, view)).join("")}</ul>`;
    const sheets = view.connections
        .map((c, i) => disconnectSheet(c, i, view))
        .join("");
    return `${settingsPageHeader("AI connections")}${String(settingsErrorBanner(view.error))}<p class="fd-settings-ai__lead">Agents you connect can log meals, read your fridge and plan groceries for this household.</p>${list}<h2 class="fd-settings-goals-card__title fd-settings-ai__connect-title">Connect a new agent</h2><div class="fd-settings-ai__address" data-fd-copy-address><code id="fd-ai-mcp-url" data-fd-copy-source>${esc(view.mcpUrl)}</code><button type="button" class="fd-settings-ai__copy" data-fd-copy-trigger aria-label="Copy address">${String(iconCopy())}</button></div><p class="fd-visually-hidden" role="status" aria-live="polite" data-fd-copy-status></p><p class="fd-settings-ai__help">Add this address as a remote MCP server in your agent, then sign in when it asks.</p>${destructiveSection(view)}${activitySection(view)}${sheets}`;
}

export function renderSettingsAiV2Page(view: SettingsAiV2View): string {
    return renderSettingsV2Page({
        chrome: view.chrome,
        page: "ai",
        title: "AI connections",
        body: renderSettingsAiV2Body(view),
    });
}
