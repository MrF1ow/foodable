import type { AppChromeBase } from "../../attention.js";
import type { AiConnection } from "../../../db/tokens.js";
import {
    AGENT_DESTRUCTIVE_SETTING,
    AGENT_PERSONAL_SETTING,
    type AgentActionEntry,
} from "../../../domain/agent-actions.js";
import { mayUndoAgentAction } from "../../../domain/notices-agent.js";
import { dateInTz } from "../../../domain/tz.js";
import { esc, join, raw, type Html } from "../../components/v2/html.js";
import { icon } from "../../components/v2/icon.js";
import { itemRow } from "../../components/v2/item-row.js";
import { listGroup } from "../../components/v2/list-group.js";
import { menu, type MenuItem } from "../../components/v2/menu.js";
import { sectionHeader } from "../../components/v2/section-header.js";
import { emptyState } from "../../components/v2/empty-state.js";
import { renderHouseholdLayout } from "./settings-household-layout.js";
import { settingsErrorBanner } from "./settings-shared.js";
import { formatGoalSince } from "./settings-goals-label.js";

/**
 * What the Disconnect form posts for tokens with no recorded app. A real app's
 * id is a uuid or the deploy-wide id, never this word.
 */
export const UNKNOWN_APP_MARKER = "unknown";

export const AI_DISCONNECT_PATH = "/settings/ai-connections/disconnect";
export const AI_DESTRUCTIVE_PATH = "/settings/ai-connections/destructive";
/** The person's own "Your agents can delete" switch. */
export const AI_AGENT_DELETE_PATH = "/settings/ai-connections/agent-delete";
export const AI_WIDGETS_PATH = "/settings/ai-connections/widgets";
export const AI_PAGE_PATH = "/settings/ai-connections";

/** How many agent actions the activity list shows. */
export const AI_ACTIVITY_LIMIT = 50;

/** Where Undo posts for one agent action. */
export function aiUndoPath(actionId: string): string {
    return `${AI_PAGE_PATH}/actions/${actionId}/undo`;
}

/** One line of the activity list, ready to render. */
export type AgentActivityRow = {
    id: string;
    summary: string;
    connection: string;
    /** The user the agent acted as; null for the household token. */
    memberId: string | null;
    /**
     * Whose agent it was, as this viewer reads it: their own, the household
     * token's, or another member's (`name` null once that member has left).
     */
    actor:
        | { kind: "viewer" }
        | { kind: "household" }
        | { kind: "member"; name: string | null };
    /** How long ago it happened: "2 hours ago", "Yesterday", "3 days ago". */
    when: string;
    createdAt: string;
    state:
        | { kind: "undo" }
        | { kind: "undone" }
        | { kind: "expired" }
        /** Undoable, but not by this viewer: `who` is the one member who also may, or null when only the owner may. */
        | { kind: "other"; who: string | null };
};

export type SettingsAiV2View = {
    chrome: AppChromeBase;
    connections: readonly AiConnection[];
    /** The household switch, the owner's off for everyone's agents; only the owner may change it. */
    destructive: { allowed: boolean; canChange: boolean };
    /**
     * This person's own switch for the agents they connected. `householdOffBy`
     * is the owner's name while the household switch is off and this person
     * cannot change it (so their own row reads Off, with no switch); null otherwise. A
     * view without it (the dev preview's fixtures) shows the switch off.
     */
    personal?: { canDelete: boolean; householdOffBy: string | null };
    /** This member's `widgets_enabled`: the cards agents show in chat. */
    showCards: boolean;
    /** Newest first. */
    activity: readonly AgentActivityRow[];
    /**
     * Narrows Recent changes to one app: the name its changes are recorded
     * under (`appFilterKey`). Null or missing shows every change.
     */
    appFilter?: string | null;
    now: Date;
    /** The member's timezone: "today" and the dates are theirs. */
    timezone: string;
    /** The address an agent adds as its remote MCP server. */
    mcpUrl: string;
    error?: string;
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

/** "2 hours ago", "Yesterday", "3 days ago": the days counted in the member's timezone. */
export function activityWhen(at: Date, now: Date, timezone: string): string {
    return ago(at, now, timezone);
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
        /** Who may undo anyone's change (the owner): a change made as one of them is the owner's, named once. */
        undoAnyIds?: ReadonlySet<string>;
        now: Date;
        timezone: string;
    },
): AgentActivityRow[] {
    const viewer = { userId: opts.viewerUserId, isOwner: opts.isOwner };
    const viewerId = opts.viewerUserId.toLowerCase();
    return entries.map((entry) => {
        // The household token and a member who is the owner act as the owner,
        // and a member who has left cannot undo anything: each is the owner's.
        const name =
            entry.memberId == null || opts.undoAnyIds?.has(entry.memberId)
                ? undefined
                : opts.names.get(entry.memberId);
        let state: AgentActivityRow["state"];
        if (entry.undoneAt) state = { kind: "undone" };
        else if (!entry.canUndo) state = { kind: "expired" };
        else if (mayUndoAgentAction(entry, viewer)) state = { kind: "undo" };
        else state = { kind: "other", who: name ?? null };
        const actor: AgentActivityRow["actor"] =
            entry.memberId == null
                ? { kind: "household" }
                : entry.memberId.toLowerCase() === viewerId
                  ? { kind: "viewer" }
                  : {
                        kind: "member",
                        name: opts.names.get(entry.memberId) ?? null,
                    };
        return {
            id: entry.id,
            summary: entry.summary,
            connection: entry.connection,
            memberId: entry.memberId,
            actor,
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

function sinceText(first: Date, now: Date, timezone: string): string {
    const today = dateInTz(now, timezone);
    return `since ${formatGoalSince(dateInTz(first, timezone), today)}`;
}

function appName(connection: AiConnection): string {
    return connection.clientName?.trim() || "Unknown app";
}

/** A lone UTF-16 surrogate (half an emoji, as an 80-unit cut can leave). */
const LONE_SURROGATE =
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** The longest app name the MCP actor records. */
const RECORDED_APP_NAME_MAX = 80;

/**
 * The name an app's changes are recorded under, as the MCP actor records it
 * for its connection: its client name, else its client id, cut to 80
 * characters; "OAuth app" when it has neither (an empty name counts as none).
 */
export function appFilterKey(connection: AiConnection): string {
    const client = connection.clientName ?? connection.clientId;
    // Postgres stores half an emoji left by the cut as U+FFFD, so the key does too.
    return client
        ? client
              .slice(0, RECORDED_APP_NAME_MAX)
              .replace(LONE_SURROGATE, "\uFFFD")
        : "OAuth app";
}

const APP_FILTER_MAX = 200;
/** Control and invisible format characters (bidi overrides, zero-width): none of them is a name. */
const UNPRINTABLE_CHARACTER = /[\p{Cc}\p{Cf}]/u;

/**
 * The app a `?app=` filter names, as the key its changes are recorded under:
 * an app of the viewer's own, given by client id, resolves to its key; any
 * other text stays as typed (no change then matches it). Empty, overlong or
 * control-character text is no filter at all.
 */
export function resolveAppFilter(
    value: string | undefined,
    connections: readonly AiConnection[],
): string | null {
    // An app of the viewer's own, linked by its client id, resolves first,
    // whatever its recorded name holds (spaces, emoji, format characters).
    const byId = value
        ? connections.find((c) => c.clientId === value)
        : undefined;
    if (byId) return appFilterKey(byId);
    const text = value?.trim() ?? "";
    if (
        text === "" ||
        text.length > APP_FILTER_MAX ||
        UNPRINTABLE_CHARACTER.test(text)
    ) {
        return null;
    }
    return text;
}

const RECENT_CHANGES_ID = "recent-changes";

/**
 * The page's own address, narrowed to one app's changes and landing on them.
 * An app is named by its client id when it has one (`resolveAppFilter` maps it
 * back to the recorded name); a name never makes the link throw.
 */
function changesHref(connection: AiConnection): string {
    const value = (connection.clientId ?? appFilterKey(connection)).replace(
        LONE_SURROGATE,
        "\uFFFD",
    );
    return `${AI_PAGE_PATH}?app=${encodeURIComponent(value)}#${RECENT_CHANGES_ID}`;
}

/** What the Disconnect form posts for this app. */
function postedClient(connection: AiConnection): string {
    return connection.clientId ?? UNKNOWN_APP_MARKER;
}

/** One connected app: its use, and a ⋯ whose Disconnect confirms in place. */
function connectionRow(connection: AiConnection, view: SettingsAiV2View): Html {
    const name = appName(connection);
    return itemRow({
        title: name,
        subtitle: `${lastUsedText(connection.lastUsedAt, view.now, view.timezone)} · ${sinceText(connection.firstConnectedAt, view.now, view.timezone)}`,
        lead: { kind: "icon", name: "code" },
        trailing: {
            kind: "control",
            html: menu({
                label: `Actions for ${name}`,
                anchor: "more",
                items: [
                    {
                        kind: "link",
                        label: "Changes",
                        href: changesHref(connection),
                    },
                    {
                        kind: "destructive",
                        label: "Disconnect",
                        action: AI_DISCONNECT_PATH,
                        fields: { client: postedClient(connection) },
                    },
                ],
            }),
        },
    });
}

/** A switch row of the Agents group; the form posts the opposite value. */
function agentSwitchRow(opts: {
    action: string;
    field: string;
    on: boolean;
    title: string;
    sub: string;
}): Html {
    return itemRow({
        title: opts.title,
        subtitle: opts.sub,
        trailing: {
            kind: "toggle",
            on: opts.on,
            label: opts.title,
            form: {
                action: opts.action,
                fields: { [opts.field]: opts.on ? "0" : "1" },
            },
        },
    });
}

/** The switch the household's Off holds in place: shown, switched off, nothing to press. */
function agentLockedRow(opts: {
    id: string;
    title: string;
    sub: string;
}): Html {
    return itemRow({
        id: opts.id,
        title: opts.title,
        subtitle: opts.sub,
        trailing: {
            kind: "toggle",
            on: false,
            label: opts.title,
            disabled: true,
        },
    });
}

export const AI_SHOW_CARDS_TITLE = "Show cards in chat";
/** The owner's household-wide off. */
export const AI_DESTRUCTIVE_TITLE = AGENT_DESTRUCTIVE_SETTING;
/** Each person's own switch. */
export const AI_PERSONAL_TITLE = AGENT_PERSONAL_SETTING;
export const AI_HOUSEHOLD_LABEL = "Household · owner only";

/** What a person's own switch says under its title. */
export function personalSwitchSub(on: boolean): string {
    return on
        ? "Only what you can delete yourself"
        : "Off by default · only what you can delete";
}

function agentsSection(view: SettingsAiV2View): Html {
    const { allowed, canChange } = view.destructive;
    const { canDelete, householdOffBy } = view.personal ?? {
        canDelete: false,
        householdOffBy: null,
    };
    const cards = agentSwitchRow({
        action: AI_WIDGETS_PATH,
        field: "enabled",
        on: view.showCards,
        title: AI_SHOW_CARDS_TITLE,
        sub: "Goals and meals as widgets",
    });
    // Whose switch is whose: this one is the person's own; the owner's
    // household switch under it can turn every person's off at once.
    const own =
        householdOffBy != null
            ? agentLockedRow({
                  id: "agent-own-switch",
                  title: AI_PERSONAL_TITLE,
                  sub: `Turned off for the household by ${householdOffBy.trim() || "the owner"}`,
              })
            : agentSwitchRow({
                  action: AI_AGENT_DELETE_PATH,
                  field: "allowed",
                  on: canDelete,
                  title: AI_PERSONAL_TITLE,
                  sub: personalSwitchSub(canDelete),
              });
    const household = canChange
        ? join([
              sectionHeader({ label: AI_HOUSEHOLD_LABEL, rule: false }),
              listGroup({
                  label: "Household",
                  data: { "fd-ai-household": "" },
                  rows: [
                      agentSwitchRow({
                          action: AI_DESTRUCTIVE_PATH,
                          field: "allowed",
                          on: allowed,
                          title: AI_DESTRUCTIVE_TITLE,
                          sub: "Off stops every member's agents",
                      }),
                  ],
              }),
          ])
        : "";
    return join([
        sectionHeader({ label: "Agents", rule: false }),
        listGroup({
            label: "Agents",
            data: { "fd-ai-agents": "" },
            rows: [cards, own],
        }),
        household,
    ]);
}

/** What a row's ⋯ holds: Undo where the viewer may use it, else the reason there is none. */
function activityMenuItems(row: AgentActivityRow): MenuItem[] {
    switch (row.state.kind) {
        case "undo":
            return [
                { kind: "post", label: "Undo", action: aiUndoPath(row.id) },
            ];
        case "undone":
            return [{ kind: "note", label: "Undone" }];
        case "expired":
            return [{ kind: "note", label: "Can no longer be undone" }];
        case "other":
            return [
                {
                    kind: "note",
                    label:
                        row.state.who === null
                            ? "The owner can undo"
                            : `${row.state.who} or the owner can undo`,
                },
            ];
    }
}

/** The longest member name the line under a change spells out. */
const ACTED_FOR_NAME_MAX = 16;

/** `text` cut to `max` characters, with an ellipsis where it was cut. */
function cutText(text: string, max: number): string {
    const chars = Array.from(text.trim());
    return chars.length <= max
        ? chars.join("")
        : `${chars.slice(0, max - 1).join("")}…`;
}

/**
 * The line under a change: the app and when, naming whose agent it was when
 * that is not the viewer's own: "Claude for Sam · 2 hours ago", or
 * "Claude · household token · 2 hours ago" for the shared token.
 */
function activitySubtitle(row: AgentActivityRow): string {
    switch (row.actor.kind) {
        case "viewer":
            return `${row.connection} · ${row.when}`;
        case "household":
            // The shared token's own label is already "household token".
            return row.connection.toLowerCase() === "household token"
                ? `Household token · ${row.when}`
                : `${row.connection} · household token · ${row.when}`;
        case "member":
            return `${row.connection} for ${
                row.actor.name === null
                    ? "a former member"
                    : cutText(row.actor.name, ACTED_FOR_NAME_MAX)
            } · ${row.when}`;
    }
}

/** A change: what, then the app and when. Every row has a ⋯, which says why when there is no Undo. */
function activityRow(row: AgentActivityRow): Html {
    return itemRow({
        title: row.summary,
        subtitle: activitySubtitle(row),
        trailing: {
            kind: "control",
            html: menu({
                label: `Actions for ${row.summary}`,
                anchor: "more",
                items: activityMenuItems(row),
            }),
        },
        id: `agent-action-${row.id}`,
    });
}

/** The longest app name the filtered view spells out. */
const APP_NAME_SHOWN_MAX = 32;

function activitySection(view: SettingsAiV2View): Html {
    const app = view.appFilter ?? null;
    // An app's changes are the viewer's own agent's under that name: another
    // member's app can share it.
    const shown =
        app === null
            ? view.activity
            : view.activity.filter(
                  (row) =>
                      row.actor.kind === "viewer" && row.connection === app,
              );
    return join([
        sectionHeader({
            label: "Recent changes",
            rule: false,
            id: RECENT_CHANGES_ID,
            // A filtered list says whose, and has the way back to every change.
            count: app ?? undefined,
            action:
                app === null
                    ? undefined
                    : {
                          label: "Show all",
                          href: `${AI_PAGE_PATH}#${RECENT_CHANGES_ID}`,
                      },
        }),
        // The list is the latest 50 changes of everyone's; a filter narrows
        // those, so it never claims the app has no others.
        app === null || shown.length === 0
            ? ""
            : raw(
                  `<p class="fd-settings-ai__scope">${esc(`Changes by ${cutText(app, APP_NAME_SHOWN_MAX)} among the latest ${AI_ACTIVITY_LIMIT}`)}</p>`,
              ),
        shown.length === 0
            ? emptyState({
                  title:
                      app === null
                          ? "No changes yet"
                          : `No changes by ${cutText(app, APP_NAME_SHOWN_MAX)} among the latest ${AI_ACTIVITY_LIMIT}`,
              })
            : listGroup({
                  label: "Recent agent changes",
                  data: { "fd-ai-activity": "" },
                  rows: shown.map(activityRow),
              }),
    ]);
}

/** The address an agent adds, with its copy button (client/v2/copy-address.js). */
function connectAddress(view: SettingsAiV2View): Html {
    return raw(
        `<div class="fd-settings-ai__address" data-fd-copy-address><code id="fd-ai-mcp-url" data-fd-copy-source>${esc(view.mcpUrl)}</code><button type="button" class="fd-settings-ai__copy" data-fd-copy-trigger aria-label="Copy address">${icon("copy")}</button></div><p class="fd-visually-hidden" role="status" aria-live="polite" data-fd-copy-status></p>`,
    );
}

export function renderSettingsAiV2Body(view: SettingsAiV2View): string {
    const connections =
        view.connections.length === 0
            ? emptyState({ title: "No AI apps connected yet" })
            : listGroup({
                  label: "Connected apps",
                  rows: view.connections.map((c) => connectionRow(c, view)),
              });
    return String(
        join([
            settingsErrorBanner(view.error),
            connections,
            agentsSection(view),
            sectionHeader({ label: "Connect a new agent", rule: false }),
            connectAddress(view),
            activitySection(view),
        ]),
    );
}

export function renderSettingsAiV2Page(view: SettingsAiV2View): string {
    // The household layout draws a row's ⋯ as the bare glyph, as the frames do.
    return renderHouseholdLayout({
        chrome: view.chrome,
        page: "ai",
        title: "AI connections",
        body: renderSettingsAiV2Body(view),
    });
}
