/**
 * Destructive agent changes and how the household gets them back.
 *
 * An agent may delete, clear or overwrite without asking first. The price is
 * that every such change is recorded, with the rows as they were, and can be
 * undone for 24 hours. One household switch turns the whole thing off.
 *
 * `withAgentAction` is the one guard a destructive tool goes through: it
 * checks the switch, runs the write, and records the entry plus a snapshot in
 * the same transaction. `undoAgentAction` replays the snapshot. The snapshot
 * is a generic before-image of rows (`{ table, op, row }`), so no tool needs
 * its own undo code: it names the rows it is about to change and the module can
 * put them back. `captureCascade` names a row and records everything deleting
 * it would take with it or clear.
 *
 * Undo does not depend on the order a tool recorded its changes in. It puts
 * `deleted` rows back parents first, then restores `updated` rows, then
 * removes `inserted` rows children first, using the order of
 * `AGENT_SNAPSHOT_TABLES`. It never overwrites or removes data it did not
 * itself change: an updated row gets back only the columns the action changed
 * (a jsonb object key by key), and only while they still hold what the write
 * left, so a column or a key a person changed since is left alone; an inserted
 * row is only removed while it is still exactly what the write left (a person
 * who renamed or hid it since keeps it) and nothing points at it. A fridge
 * item whose food or amount the action changed is not put back once stock
 * movements have been written for it since, and a row that names a food (its
 * `food_id`, or a food's `generic_food_id` or `usual_product_id`) is not put
 * back onto a food that was merged away or deleted since the action began; a
 * food that was already archived then is exactly what the row pointed at, so
 * the row goes back. `updated_at` is the one
 * column never compared or restored: it is bookkeeping that every edit moves.
 * Anything else is a conflict the household is told about.
 *
 * The put-back runs as the member the agent acted as (or as the household for
 * the household token), whoever clicked Undo, so the tables whose policy is
 * "your own rows" take the rows back. What the module cannot see it cannot
 * capture: rows owned by another member that a policy hides from the acting
 * session, and tables that are not undoable at all (`recipe_favourites` is
 * one: a recipe delete cascades into every member's favourites). A tool whose
 * write can reach such rows must say so in the entry's summary (the cascade
 * report lists the tables), so the household is not told the whole action can
 * be undone when it cannot.
 */
import { FoodsInputError, findFoodById, type FoodsStore } from "./foods.js";
import type { SettingsStore } from "./settings.js";
import type { StockStore } from "./stock.js";

/** How long the household can undo an agent action. */
export const AGENT_UNDO_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Whose a table's rows are. `household` rows are the household's; `member`
 * rows belong to one person (their `user_id`), so a tool whose write cascades
 * into them from another member's session may not see them all.
 */
export type AgentTableScope = "household" | "member";

/**
 * The tables an undo may touch, the columns that identify one of their rows,
 * and whose rows they are. The order is the undo order: a table comes after
 * every table it has a foreign key to (a live test checks it against the
 * catalog), so rows are put back parents first and removed children first.
 * This map is the only source of table and key-column names for undo:
 * anything off it is refused when recorded and again when read back, so no
 * SQL is ever built from a name a snapshot carries.
 */
export const AGENT_TABLES = {
    households: { key: ["id"], scope: "household" },
    grocery_stores: { key: ["id"], scope: "household" },
    foods: { key: ["id"], scope: "household" },
    grocery_sections: { key: ["id"], scope: "household" },
    fridge_locations: { key: ["id"], scope: "household" },
    fridge_items: { key: ["id"], scope: "household" },
    grocery_lines: { key: ["id"], scope: "household" },
    stock_movements: { key: ["id"], scope: "household" },
    recipes: { key: ["id"], scope: "household" },
    recipe_ingredients: { key: ["id"], scope: "household" },
    recipe_plans: { key: ["id"], scope: "household" },
    recipe_imports: { key: ["recipe_id"], scope: "household" },
    recipe_portions: { key: ["recipe_id", "user_id"], scope: "member" },
    meals: { key: ["id"], scope: "member" },
    meal_items: { key: ["id"], scope: "member" },
    water_log: { key: ["id"], scope: "member" },
    weight_log: { key: ["id"], scope: "member" },
    store_rules: { key: ["id"], scope: "household" },
    person_rules: { key: ["id"], scope: "member" },
    member_allergens: { key: ["id"], scope: "member" },
    member_dislikes: { key: ["id"], scope: "member" },
    food_barcodes: { key: ["household_id", "barcode"], scope: "household" },
    food_aliases: { key: ["household_id", "alias"], scope: "household" },
    notice_dismissals: { key: ["id"], scope: "household" },
    nutrition_goals: { key: ["user_id"], scope: "member" },
    nutrition_goal_days: { key: ["id"], scope: "member" },
} as const satisfies Record<
    string,
    { key: readonly [string, ...string[]]; scope: AgentTableScope }
>;

export type AgentSnapshotTable = keyof typeof AGENT_TABLES;

/** Each undoable table's key columns. */
export const AGENT_TABLE_KEYS = Object.fromEntries(
    Object.entries(AGENT_TABLES).map(([table, spec]) => [table, spec.key]),
) as { [T in AgentSnapshotTable]: (typeof AGENT_TABLES)[T]["key"] };

/** Every undoable table, parents before the tables that point at them. */
export const AGENT_SNAPSHOT_TABLES = Object.keys(
    AGENT_TABLES,
) as AgentSnapshotTable[];

export function isAgentSnapshotTable(
    value: unknown,
): value is AgentSnapshotTable {
    return typeof value === "string" && Object.hasOwn(AGENT_TABLES, value);
}

/**
 * A column that moves on every edit and says nothing about the data. It is
 * never compared and never restored, so an unrelated edit since (which bumps
 * it) cannot block an undo.
 */
const BOOKKEEPING_COLUMNS: readonly string[] = ["updated_at"];

/** The key columns of one row: `{ id }`, or `{ household_id, alias }`. */
export type AgentRowKey = Record<string, string>;

export type AgentSnapshotOp = "deleted" | "updated" | "inserted";

/** One row as the database holds it: column name to JSON value. */
export type AgentSnapshotRow = Record<string, unknown>;

export type AgentSnapshotChange = {
    table: AgentSnapshotTable;
    op: AgentSnapshotOp;
    /**
     * The whole row before the change for `deleted` and `updated`; the key
     * columns alone for `inserted`.
     */
    row: AgentSnapshotRow;
    /**
     * For `updated` and `inserted`: the row as the write left it. Undo
     * restores an updated row's before-image, and removes an inserted row,
     * only while the row still equals this, so a change made since is never
     * overwritten or deleted.
     */
    after?: AgentSnapshotRow;
};

/**
 * A stock movement the action itself wrote. Undo writes the opposite movement
 * for each, so the ledger goes back to where the action found it, whatever
 * other movements and drift it holds.
 */
export type AgentLedgerEntry = {
    id: string;
    food_id: string;
    fridge_item_id: string | null;
    delta: number;
    unit: string;
};

export type AgentSnapshot = {
    v: 1;
    changes: AgentSnapshotChange[];
    ledger?: AgentLedgerEntry[];
};

const SNAPSHOT_OPS: readonly string[] = ["deleted", "updated", "inserted"];

function keyColumns(table: AgentSnapshotTable): readonly string[] {
    return AGENT_TABLE_KEYS[table];
}

function hasKey(table: AgentSnapshotTable, row: AgentSnapshotRow): boolean {
    return keyColumns(table).every((column) => {
        const value = row[column];
        return typeof value === "string" && value !== "";
    });
}

/** The key columns of a row; throws when one is missing. */
export function agentRowKey(
    table: AgentSnapshotTable,
    row: AgentSnapshotRow,
): AgentRowKey {
    assertTable(table);
    const key: AgentRowKey = {};
    for (const column of keyColumns(table)) {
        const value = row[column];
        if (typeof value !== "string" || value === "") {
            throw new TypeError(
                `A ${table} snapshot row needs its key column ${column}`,
            );
        }
        key[column] = value;
    }
    return key;
}

/** A key as one comparable string. */
export function agentKeyString(
    table: AgentSnapshotTable,
    key: AgentRowKey,
): string {
    return JSON.stringify(keyColumns(table).map((column) => key[column]));
}

/** A key made only of the table's key columns; anything else is refused. */
function checkedKey(
    table: AgentSnapshotTable,
    key: Record<string, unknown>,
): AgentRowKey {
    const columns = keyColumns(table);
    for (const name of Object.keys(key)) {
        if (!columns.includes(name)) {
            throw new TypeError(
                `${name} is not a key column of ${table} (${columns.join(", ")})`,
            );
        }
    }
    return agentRowKey(table, key);
}

function idOnly(table: AgentSnapshotTable, how: string): void {
    const columns = keyColumns(table);
    if (columns.length !== 1 || columns[0] !== "id") {
        throw new TypeError(
            `${table} is keyed by ${columns.join(", ")}, not by id: use ${how}`,
        );
    }
}

/** A snapshot from storage, or null when it is missing or not one of ours. */
export function parseAgentSnapshot(raw: unknown): AgentSnapshot | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const value = raw as { v?: unknown; changes?: unknown; ledger?: unknown };
    if (value.v !== 1 || !Array.isArray(value.changes)) return null;
    const changes: AgentSnapshotChange[] = [];
    for (const item of value.changes) {
        if (!item || typeof item !== "object") return null;
        const change = item as {
            table?: unknown;
            op?: unknown;
            row?: unknown;
            after?: unknown;
        };
        if (!isAgentSnapshotTable(change.table)) return null;
        if (
            typeof change.op !== "string" ||
            !SNAPSHOT_OPS.includes(change.op)
        ) {
            return null;
        }
        if (
            !change.row ||
            typeof change.row !== "object" ||
            Array.isArray(change.row) ||
            !hasKey(change.table, change.row as AgentSnapshotRow)
        ) {
            return null;
        }
        const parsed: AgentSnapshotChange = {
            table: change.table,
            op: change.op as AgentSnapshotOp,
            row: change.row as AgentSnapshotRow,
        };
        if (change.after !== undefined) {
            if (
                !change.after ||
                typeof change.after !== "object" ||
                Array.isArray(change.after) ||
                !hasKey(change.table, change.after as AgentSnapshotRow)
            ) {
                return null;
            }
            parsed.after = change.after as AgentSnapshotRow;
        }
        changes.push(parsed);
    }
    const snapshot: AgentSnapshot = { v: 1, changes };
    if (value.ledger !== undefined) {
        const ledger = parseLedger(value.ledger);
        if (!ledger) return null;
        snapshot.ledger = ledger;
    }
    return snapshot;
}

function parseLedger(raw: unknown): AgentLedgerEntry[] | null {
    if (!Array.isArray(raw)) return null;
    const entries: AgentLedgerEntry[] = [];
    for (const item of raw) {
        if (!item || typeof item !== "object") return null;
        const entry = item as Record<string, unknown>;
        if (
            typeof entry.id !== "string" ||
            typeof entry.food_id !== "string" ||
            (entry.fridge_item_id !== null &&
                typeof entry.fridge_item_id !== "string") ||
            typeof entry.delta !== "number" ||
            !Number.isFinite(entry.delta) ||
            typeof entry.unit !== "string"
        ) {
            return null;
        }
        entries.push({
            id: entry.id,
            food_id: entry.food_id,
            fridge_item_id: entry.fridge_item_id,
            delta: entry.delta,
            unit: entry.unit,
        });
    }
    return entries;
}

export type AgentActionActor = {
    householdId: string;
    /** The user the agent acted as; null for the household token. */
    memberId: string | null;
    /** What the agent connected through, e.g. "household token" or a client name. */
    connection: string;
};

/** The stored row, camelCase. `snapshot` is null once purged or when not undoable. */
export type AgentActionRecord = {
    id: string;
    householdId: string;
    memberId: string | null;
    connection: string;
    tool: string;
    summary: string;
    destructive: boolean;
    snapshot: AgentSnapshot | null;
    undoable: boolean;
    createdAt: string;
    undoExpiresAt: string;
    undoneAt: string | null;
    undoneBy: string | null;
};

/** The record as the activity list shows it: no snapshot, plus `canUndo`. */
export type AgentActionEntry = {
    id: string;
    householdId: string;
    memberId: string | null;
    connection: string;
    tool: string;
    summary: string;
    createdAt: string;
    undoExpiresAt: string;
    undoneAt: string | null;
    canUndo: boolean;
};

export class AgentActionsDisabledError extends Error {
    readonly code = "agent_actions_disabled" as const;

    constructor() {
        super(
            "The household has turned destructive agent changes off: " +
                "Settings › AI connections › Agents may make destructive changes is Off. " +
                "Nothing was changed. Tell the person to turn it on if they want you to do this.",
        );
        this.name = "AgentActionsDisabledError";
    }
}

/** Why a put-back could not happen. */
export type AgentUndoConflict =
    | { kind: "unique" }
    | { kind: "missing_reference"; referencedTable: string | null }
    /** Something still points at the row; `by` says what and how many, when known. */
    | { kind: "in_use"; by?: AgentRowReference[] }
    | { kind: "gone" }
    /** The row was changed after the agent changed it. */
    | { kind: "changed" }
    /** Stock movements were written for the fridge item after the agent changed it. */
    | { kind: "used" }
    /** The table now refuses the row as it was (a constraint or a required column). */
    | { kind: "refused" }
    /** The database does not let the account the put-back runs as write the row. */
    | { kind: "forbidden" };

/** How many rows of `table` point at a row. */
export type AgentRowReference = { table: string; count: number };

/**
 * Thrown by a store when a row cannot go back as it was. It rolls the whole
 * undo back; `undoAgentAction` turns it into a `conflict` result.
 */
export class AgentUndoConflictError extends Error {
    constructor(
        readonly conflict: AgentUndoConflict,
        readonly table: AgentSnapshotTable,
        readonly row: AgentSnapshotRow,
    ) {
        super(describeUndoConflict(conflict, table, row));
        this.name = "AgentUndoConflictError";
    }
}

const TABLE_LABELS: Record<AgentSnapshotTable, string> = {
    households: "household",
    stock_movements: "stock movement",
    recipe_imports: "recipe import",
    recipe_portions: "recipe portion",
    food_barcodes: "barcode",
    food_aliases: "food alias",
    notice_dismissals: "dismissed notice",
    nutrition_goals: "nutrition goal",
    nutrition_goal_days: "nutrition goal day",
    foods: "food",
    grocery_stores: "grocery store",
    grocery_sections: "grocery section",
    grocery_lines: "grocery line",
    fridge_locations: "fridge location",
    fridge_items: "fridge item",
    recipes: "recipe",
    recipe_ingredients: "recipe ingredient",
    recipe_plans: "planned recipe",
    meals: "meal",
    meal_items: "meal item",
    water_log: "water entry",
    weight_log: "weight entry",
    store_rules: "store rule",
    person_rules: "person rule",
    member_allergens: "allergen",
    member_dislikes: "dislike",
};

const NAME_KEYS = [
    "name",
    "display_name",
    "description",
    "label",
    "body",
    "allergen",
] as const;

/** A table's name in plain words, for tables on the list or off it. */
function tableLabel(table: string): string {
    return isAgentSnapshotTable(table)
        ? TABLE_LABELS[table]
        : table.replaceAll("_", " ");
}

function counted(label: string, count: number): string {
    if (count === 1) return `1 ${label}`;
    const plural = label.endsWith("y")
        ? `${label.slice(0, -1)}ies`
        : `${label}s`;
    return `${count} ${plural}`;
}

function rowName(row: AgentSnapshotRow): string | null {
    for (const key of NAME_KEYS) {
        const value = row[key];
        if (typeof value === "string" && value.trim()) return value.trim();
    }
    return null;
}

/** Plain words for a put-back that cannot happen. */
export function describeUndoConflict(
    conflict: AgentUndoConflict,
    table: AgentSnapshotTable,
    row: AgentSnapshotRow,
): string {
    const label = TABLE_LABELS[table];
    const name = rowName(row);
    switch (conflict.kind) {
        case "unique":
            return name
                ? `A ${label} named ${name} already exists.`
                : `A ${label} like this already exists.`;
        case "missing_reference": {
            const referenced = conflict.referencedTable;
            if (referenced === "foods") {
                return name
                    ? `The food ${name} was merged, archived or deleted since.`
                    : "The food was merged, archived or deleted since.";
            }
            const what = isAgentSnapshotTable(referenced)
                ? TABLE_LABELS[referenced]
                : referenced === "users"
                  ? "member"
                  : "item";
            return `The ${what} this ${label} belonged to was deleted since.`;
        }
        case "in_use": {
            const by = conflict.by ?? [];
            if (by.length === 0) {
                return name
                    ? `The ${label} ${name} is used by something else now, so it can't be removed.`
                    : `This ${label} is used by something else now, so it can't be removed.`;
            }
            const what = by
                .map((ref) => counted(tableLabel(ref.table), ref.count))
                .join(" and ");
            const total = by.reduce((sum, ref) => sum + ref.count, 0);
            return (
                `${name ? `The ${label} ${name}` : `This ${label}`} is used by ${what} now; ` +
                `change or remove ${total === 1 ? "it" : "them"} first, or keep the ${label}.`
            );
        }
        case "changed":
            return name
                ? `The ${label} ${name} was changed since, so its earlier values can't be put back.`
                : `This ${label} was changed since, so its earlier values can't be put back.`;
        case "used":
            return name
                ? `The ${label} ${name} was used since, so its earlier values can't be put back.`
                : `This ${label} was used since, so its earlier values can't be put back.`;
        case "refused":
            return name
                ? `The ${label} ${name} can't be put back as it was: the database no longer accepts it.`
                : `This ${label} can't be put back as it was: the database no longer accepts it.`;
        case "forbidden":
            return name
                ? `The ${label} ${name} can't be put back from here: the database doesn't let this account write it.`
                : `This ${label} can't be put back from here: the database doesn't let this account write it.`;
        case "gone":
            return name
                ? `The ${label} ${name} was removed since, so its earlier values can't be put back.`
                : `This ${label} was removed since, so its earlier values can't be put back.`;
    }
}

/** What deleting some rows would take with it (`deleted`) or clear (`updated`). */
export type AgentCascadeRow = {
    table: AgentSnapshotTable;
    op: "deleted" | "updated";
    row: AgentSnapshotRow;
};

export type AgentCascade = {
    rows: AgentCascadeRow[];
    /**
     * Tables the delete can reach that undo does not cover (not on the list,
     * or private to a member). Whatever is in them is not recorded.
     */
    uncaptured: string[];
};

/** What `captureCascade` recorded, and what it could not. */
export type CascadeReport = { captured: number; uncaptured: string[] };

export type SnapshotRecorder = {
    /** These rows were deleted: pass them as they were before the delete. */
    deleted(table: AgentSnapshotTable, rows: AgentSnapshotRow[]): void;
    /** These rows were changed: pass them as they were before the change. */
    updated(table: AgentSnapshotTable, beforeRows: AgentSnapshotRow[]): void;
    /** These rows were created by this action (tables keyed by `id`). */
    inserted(table: AgentSnapshotTable, ids: string[]): void;
    /** These rows were created by this action, named by their key columns. */
    insertedKeys(table: AgentSnapshotTable, keys: AgentRowKey[]): void;
    /**
     * Reads the rows with these ids as they are now, and records them as
     * `deleted` or `updated`. Call it before the write. Returns how many rows
     * it found; an id with no row is skipped. Only for tables keyed by `id`.
     */
    captureByIds(
        table: AgentSnapshotTable,
        ids: string[],
        op: "deleted" | "updated",
    ): Promise<number>;
    /**
     * The same for any table, naming each row by its key columns (and nothing
     * else: no other column may filter). A key with no row is skipped.
     */
    captureByKeys(
        table: AgentSnapshotTable,
        keys: AgentRowKey[],
        op: "deleted" | "updated",
    ): Promise<number>;
    /**
     * Records these rows as `deleted`, and every row their delete would take
     * with it (`on delete cascade`, followed down) or clear (`on delete set
     * null`, recorded as `updated`), among the rows this session can see.
     * Call it before the write. `uncaptured` names the tables the delete can
     * reach that undo cannot restore: say so in the summary.
     */
    captureCascade(
        table: AgentSnapshotTable,
        keys: AgentRowKey[],
    ): Promise<CascadeReport>;
};

/**
 * What a transaction of this module can do. The live adapter runs these as
 * SQL in one Postgres transaction; the memory store runs them over maps. Rows
 * are named by their key columns (`agentRowKey`).
 */
export type AgentActionsTx = {
    /**
     * The rows with these keys as they are now; keys with no row are left out.
     * With `lock`, they are held until the transaction ends (`for update`), so
     * what an undo checks is still true when it acts.
     */
    readRows(
        table: AgentSnapshotTable,
        keys: AgentRowKey[],
        opts?: { lock?: boolean },
    ): Promise<AgentSnapshotRow[]>;
    /**
     * Puts a row back, writing only the columns the snapshot row has, so any
     * other column takes its default. Throws AgentUndoConflictError when the
     * table no longer takes the row.
     */
    insertRow(table: AgentSnapshotTable, row: AgentSnapshotRow): Promise<void>;
    /**
     * Writes the patch over the row with this key and nothing else; false when
     * that row is gone.
     */
    replaceColumns(
        table: AgentSnapshotTable,
        key: AgentRowKey,
        patch: RestorePatch,
    ): Promise<boolean>;
    /** Deletes the row; nothing happens when it is already gone. */
    deleteRow(table: AgentSnapshotTable, key: AgentRowKey): Promise<void>;
    /**
     * The rows, grouped by table, that point at this row and would block its
     * delete, take their rows with it or lose their reference to it. The row
     * is locked while they are counted. The stock ledger's own audit links
     * (`stock_movements`, which only clear themselves) are not listed.
     */
    referencingRows(
        table: AgentSnapshotTable,
        key: AgentRowKey,
    ): Promise<AgentRowReference[]>;
    /** What deleting these rows would cascade into or clear. */
    cascadeRows(
        table: AgentSnapshotTable,
        keys: AgentRowKey[],
    ): Promise<AgentCascade>;
    /**
     * From here on the transaction runs as this member, or as the household
     * when `memberId` is null, so row policies see them and not whoever
     * started it.
     */
    actAs(actor: {
        householdId: string;
        memberId: string | null;
    }): Promise<void>;
    /**
     * Of these stock movement ids, the ones this transaction wrote. A movement
     * another request committed while the write ran is someone else's, and
     * undo must not reverse it.
     */
    movementsWrittenHere(ids: string[]): Promise<Set<string>>;
    insertAction(record: AgentActionRecord): Promise<void>;
    /** The household's action with its row locked until the transaction ends. */
    lockAction(
        householdId: string,
        actionId: string,
    ): Promise<AgentActionRecord | null>;
    markUndone(actionId: string, userId: string, at: Date): Promise<void>;
    isOwner(householdId: string, userId: string): Promise<boolean>;
};

export type AgentActionsStore = {
    /** Runs `fn` in one transaction: all of it, or none of it. */
    atomically<T>(fn: (tx: AgentActionsTx) => Promise<T>): Promise<T>;
    /** Newest first. */
    list(householdId: string, limit: number): Promise<AgentActionRecord[]>;
    /** Nulls the snapshots whose window ended before `now`; returns how many. */
    purgeSnapshots(now: Date): Promise<number>;
};

export type AgentActionDeps = {
    store: AgentActionsStore;
    settings: Pick<SettingsStore, "getAgentDestructiveAllowed">;
    /**
     * Needed by a write that records fridge items: the stock movements it
     * writes are recorded with it, so undo can write the opposite ones.
     */
    stock?: Pick<StockStore, "listMovements">;
    now?: () => Date;
};

export type AgentUndoDeps = {
    store: AgentActionsStore;
    stock: Pick<StockStore, "insertMovement" | "listMovements">;
    foods: FoodsStore;
};

export type AgentActionMeta<T> = {
    tool: string;
    summary: string | ((result: T) => string);
    /** False keeps the entry but takes no snapshot, for a change that cannot be put back. */
    undoable?: boolean;
};

const SUMMARY_MAX = 300;

function jsonRow(row: AgentSnapshotRow): AgentSnapshotRow {
    return JSON.parse(JSON.stringify(row)) as AgentSnapshotRow;
}

function assertTable(table: unknown): asserts table is AgentSnapshotTable {
    if (!isAgentSnapshotTable(table)) {
        throw new TypeError(`${String(table)} is not an undoable table`);
    }
}

/**
 * What the guard needs to know about the stock ledger: the movements each food
 * already had when the write began, so what the write added can be told apart
 * afterwards, and the fridge items it created.
 */
type LedgerWatch = {
    stock: Pick<StockStore, "listMovements">;
    householdId: string;
    before: Map<string, Set<string>>;
    /** Foods of recorded fridge rows that have no baseline yet. */
    need: Set<string>;
    inserted: Set<string>;
};

function createLedgerWatch(
    deps: Pick<AgentActionDeps, "stock">,
    householdId: string,
): LedgerWatch | null {
    return deps.stock
        ? {
              stock: deps.stock,
              householdId,
              before: new Map(),
              need: new Set(),
              inserted: new Set(),
          }
        : null;
}

const NO_LEDGER =
    "withAgentAction needs deps.stock to record fridge items: the stock movements an action writes are part of its undo";

function createRecorder(
    tx: Pick<AgentActionsTx, "readRows" | "cascadeRows">,
    watch: LedgerWatch | null,
): {
    recorder: SnapshotRecorder;
    changes: AgentSnapshotChange[];
} {
    const changes: AgentSnapshotChange[] = [];
    // A row recorded twice with the same op keeps its first before-image:
    // that is the state to go back to.
    const seen = new Set<string>();
    const needsBaseline = (row: AgentSnapshotRow) => {
        const food = row.food_id;
        if (typeof food !== "string") return;
        if (!watch) throw new TypeError(NO_LEDGER);
        if (!watch.before.has(food)) watch.need.add(food);
    };
    const push = (
        table: AgentSnapshotTable,
        op: AgentSnapshotOp,
        rows: AgentSnapshotRow[],
    ): number => {
        assertTable(table);
        let added = 0;
        for (const row of rows) {
            const key = agentRowKey(table, row);
            const id = `${op}:${table}:${agentKeyString(table, key)}`;
            if (seen.has(id)) continue;
            seen.add(id);
            changes.push({ table, op, row: jsonRow(row) });
            added++;
            if (table === "fridge_items" && op !== "inserted") {
                needsBaseline(row);
            }
        }
        return added;
    };
    // The movements a food has before the write, read when its fridge rows
    // are captured (which is before the write).
    const baseline = async (rows: AgentSnapshotRow[]) => {
        if (!watch) return;
        for (const row of rows) {
            const food = row.food_id;
            if (typeof food !== "string" || watch.before.has(food)) continue;
            const movements = await watch.stock.listMovements(
                watch.householdId,
                food,
            );
            watch.before.set(food, new Set(movements.map((m) => m.id)));
            watch.need.delete(food);
        }
    };
    const insertedRows = (table: AgentSnapshotTable, keys: AgentRowKey[]) => {
        const checked = keys.map((key) => checkedKey(table, key));
        push(table, "inserted", checked);
        if (table === "fridge_items") {
            if (!watch) throw new TypeError(NO_LEDGER);
            for (const key of checked) watch.inserted.add(key.id!);
        }
    };
    const captureFound = async (
        table: AgentSnapshotTable,
        keys: AgentRowKey[],
        op: "deleted" | "updated",
    ) => {
        const unique = new Map<string, AgentRowKey>();
        for (const key of keys) {
            const checked = checkedKey(table, key);
            unique.set(agentKeyString(table, checked), checked);
        }
        if (unique.size === 0) return [];
        const found = await tx.readRows(table, [...unique.values()]);
        push(table, op, found);
        if (table === "fridge_items") await baseline(found);
        return found;
    };
    const recorder: SnapshotRecorder = {
        deleted: (table, rows) => void push(table, "deleted", rows),
        updated: (table, rows) => void push(table, "updated", rows),
        inserted(table, ids) {
            assertTable(table);
            idOnly(table, "insertedKeys");
            insertedRows(
                table,
                ids.map((id) => ({ id })),
            );
        },
        insertedKeys(table, keys) {
            assertTable(table);
            insertedRows(table, keys);
        },
        async captureByIds(table, ids, op) {
            assertTable(table);
            idOnly(table, "captureByKeys");
            return (
                await captureFound(
                    table,
                    ids.map((id) => ({ id })),
                    op,
                )
            ).length;
        },
        async captureByKeys(table, keys, op) {
            assertTable(table);
            return (await captureFound(table, keys, op)).length;
        },
        async captureCascade(table, keys) {
            assertTable(table);
            const roots = await captureFound(table, keys, "deleted");
            if (roots.length === 0) return { captured: 0, uncaptured: [] };
            const cascade = await tx.cascadeRows(
                table,
                roots.map((row) => agentRowKey(table, row)),
            );
            let captured = roots.length;
            for (const reached of cascade.rows) {
                captured += push(reached.table, reached.op, [reached.row]);
                if (
                    reached.table === "fridge_items" &&
                    reached.op === "deleted"
                ) {
                    await baseline([reached.row]);
                }
            }
            return { captured, uncaptured: [...cascade.uncaptured] };
        },
    };
    return { recorder, changes };
}

/**
 * Reads every `updated` and `inserted` row again, as the write left it, and
 * keeps it beside the change. A row the write removed was recorded as updated
 * under the wrong op. An inserted row the write itself removed again has no
 * after-image: there is nothing of it left for undo to remove or to guard.
 */
async function recordAfterImages(
    tx: Pick<AgentActionsTx, "readRows">,
    changes: AgentSnapshotChange[],
): Promise<void> {
    for (const table of AGENT_SNAPSHOT_TABLES) {
        for (const op of ["updated", "inserted"] as const) {
            const wanted = changes.filter(
                (change) => change.table === table && change.op === op,
            );
            if (wanted.length === 0) continue;
            const found = await tx.readRows(
                table,
                wanted.map((change) => agentRowKey(table, change.row)),
            );
            const byKey = new Map(
                found.map((row) => [
                    agentKeyString(table, agentRowKey(table, row)),
                    row,
                ]),
            );
            for (const change of wanted) {
                const after = byKey.get(
                    agentKeyString(table, agentRowKey(table, change.row)),
                );
                if (after) {
                    change.after = jsonRow(after);
                } else if (op === "updated") {
                    throw new TypeError(
                        `A ${table} row was recorded as updated but the write removed it: record it as deleted`,
                    );
                }
            }
        }
    }
}

/**
 * The stock movements the write added: for each food whose fridge rows were
 * captured, the movements it has now that it did not have before, and for the
 * fridge items the write created, the movements that name them.
 */
async function collectLedger(
    tx: Pick<AgentActionsTx, "readRows" | "movementsWrittenHere">,
    watch: LedgerWatch | null,
): Promise<AgentLedgerEntry[]> {
    if (!watch) return [];
    if (watch.need.size > 0) {
        throw new TypeError(
            "A fridge item was recorded with deleted() or updated() before the write: use captureByIds or captureByKeys, so its stock movements can be told from the ones the write adds",
        );
    }
    const entries = new Map<string, AgentLedgerEntry>();
    const add = (movement: {
        id: string;
        foodId: string;
        fridgeItemId: string | null;
        delta: number;
        unit: string;
    }) =>
        entries.set(movement.id, {
            id: movement.id,
            food_id: movement.foodId,
            fridge_item_id: movement.fridgeItemId,
            delta: movement.delta,
            unit: movement.unit,
        });
    for (const [food, ids] of watch.before) {
        for (const movement of await watch.stock.listMovements(
            watch.householdId,
            food,
        )) {
            if (!ids.has(movement.id)) add(movement);
        }
    }
    if (watch.inserted.size > 0) {
        const items = await tx.readRows(
            "fridge_items",
            [...watch.inserted].map((id) => ({ id })),
        );
        const foods = new Set(
            items.flatMap((item) =>
                typeof item.food_id === "string" ? [item.food_id] : [],
            ),
        );
        for (const food of foods) {
            for (const movement of await watch.stock.listMovements(
                watch.householdId,
                food,
            )) {
                if (
                    movement.fridgeItemId &&
                    watch.inserted.has(movement.fridgeItemId)
                ) {
                    add(movement);
                }
            }
        }
    }
    if (entries.size === 0) return [];
    const own = await tx.movementsWrittenHere([...entries.keys()]);
    return [...entries.values()].filter((entry) => own.has(entry.id));
}

function clock(deps: { now?: () => Date }): Date {
    return (deps.now ?? (() => new Date()))();
}

/**
 * The guard every destructive agent tool goes through. In one transaction it
 * checks the household switch (nothing is written when it is Off), runs
 * `write`, and records the entry and snapshot. When `write` throws, the write
 * rolls back and nothing is recorded.
 */
export async function withAgentAction<T>(
    deps: AgentActionDeps,
    actor: AgentActionActor,
    meta: AgentActionMeta<T>,
    write: (rec: SnapshotRecorder) => Promise<T>,
): Promise<{ result: T; action: AgentActionEntry }> {
    const now = clock(deps);
    return deps.store.atomically(async (tx) => {
        // Read inside the transaction, so a switch turned Off a moment ago is
        // seen, and still before the write runs.
        if (
            !(await deps.settings.getAgentDestructiveAllowed(actor.householdId))
        ) {
            throw new AgentActionsDisabledError();
        }
        const watch = createLedgerWatch(deps, actor.householdId);
        const { recorder, changes } = createRecorder(tx, watch);
        const result = await write(recorder);
        const undoable = meta.undoable !== false && changes.length > 0;
        let ledger: AgentLedgerEntry[] = [];
        if (undoable) {
            await recordAfterImages(tx, changes);
            ledger = await collectLedger(tx, watch);
        }
        const summary = (
            typeof meta.summary === "function"
                ? meta.summary(result)
                : meta.summary
        )
            .trim()
            .slice(0, SUMMARY_MAX);
        const record: AgentActionRecord = {
            id: crypto.randomUUID(),
            householdId: actor.householdId,
            memberId: actor.memberId,
            connection: actor.connection,
            tool: meta.tool,
            summary: summary || meta.tool,
            destructive: true,
            snapshot: undoable
                ? {
                      v: 1,
                      changes,
                      ...(ledger.length > 0 ? { ledger } : {}),
                  }
                : null,
            undoable,
            createdAt: now.toISOString(),
            undoExpiresAt: new Date(
                now.getTime() + AGENT_UNDO_TTL_MS,
            ).toISOString(),
            undoneAt: null,
            undoneBy: null,
        };
        await tx.insertAction(record);
        return { result, action: agentActionEntry(record, now) };
    });
}

export type AgentUndoStatus =
    | "undone"
    | "already_undone"
    | "expired"
    | "not_found"
    | "not_undoable"
    | "conflict";

export type AgentUndoResult = { status: AgentUndoStatus; message: string };

export type UndoAgentActionInput = {
    householdId: string;
    /** Who is undoing: the owner, or the member the agent acted as. */
    userId: string;
    actionId: string;
    now: Date;
};

class UndoRefused extends Error {
    constructor(readonly result: AgentUndoResult) {
        super(result.message);
    }
}

/**
 * The order an undo replays a snapshot in, whatever order a tool recorded it:
 * `deleted` rows go back parents first, then `updated` rows are restored (they
 * may point at a row that just came back, or away from one about to go), then
 * `inserted` rows are removed children first. "Parents first" is the order of
 * `AGENT_SNAPSHOT_TABLES`; inside one table the recorded order is kept (and
 * reversed for removals).
 */
export function orderForUndo(
    changes: readonly AgentSnapshotChange[],
): AgentSnapshotChange[] {
    const rank = (change: AgentSnapshotChange) =>
        AGENT_SNAPSHOT_TABLES.indexOf(change.table);
    const indexed = changes.map((change, index) => ({ change, index }));
    const only = (op: AgentSnapshotOp) =>
        indexed.filter((entry) => entry.change.op === op);
    const forwards = (
        a: (typeof indexed)[number],
        b: (typeof indexed)[number],
    ) => rank(a.change) - rank(b.change) || a.index - b.index;
    const backwards = (
        a: (typeof indexed)[number],
        b: (typeof indexed)[number],
    ) => rank(b.change) - rank(a.change) || b.index - a.index;
    return [
        ...only("deleted").sort(forwards),
        ...only("updated").sort(forwards),
        ...only("inserted").sort(backwards),
    ].map((entry) => entry.change);
}

/**
 * Puts an action's rows back, all or nothing. Call it at the top level of a
 * request: a conflict rolls the transaction back, and inside an outer
 * transaction that would roll the outer one back too.
 */
export async function undoAgentAction(
    deps: AgentUndoDeps,
    input: UndoAgentActionInput,
): Promise<AgentUndoResult> {
    try {
        return await deps.store.atomically(async (tx) => {
            const record = await tx.lockAction(
                input.householdId,
                input.actionId,
            );
            if (
                !record ||
                !(await mayUndo(tx, record, input.householdId, input.userId))
            ) {
                throw new UndoRefused({
                    status: "not_found",
                    message: "That change was not found.",
                });
            }
            if (record.undoneAt) {
                throw new UndoRefused({
                    status: "already_undone",
                    message: "That change was already undone.",
                });
            }
            if (input.now.getTime() >= Date.parse(record.undoExpiresAt)) {
                throw new UndoRefused({
                    status: "expired",
                    message: "The 24 hours to undo that change have passed.",
                });
            }
            if (!record.undoable || !record.snapshot) {
                throw new UndoRefused({
                    status: "not_undoable",
                    message: "That change can't be undone.",
                });
            }
            // Who may undo is settled; what the rows can take back is the
            // acting member's to say, not the clicker's.
            await tx.actAs({
                householdId: record.householdId,
                memberId: record.memberId,
            });
            const undoer: Undoer = {
                deps,
                tx,
                record,
                input,
                restoredItems: new Map(),
                foodRefs: new Map(),
            };
            for (const change of orderForUndo(record.snapshot.changes)) {
                await replayChange(undoer, change);
            }
            // Only once every row is back: a food the action itself archived
            // is live again by now.
            await refuseArchivedFoods(undoer);
            await compensateLedger(undoer);
            await tx.markUndone(record.id, input.userId, input.now);
            return {
                status: "undone" as const,
                message: `Undone: ${record.summary}`,
            };
        });
    } catch (err) {
        if (err instanceof UndoRefused) return err.result;
        if (err instanceof AgentUndoConflictError) {
            return { status: "conflict", message: err.message };
        }
        throw err;
    }
}

async function mayUndo(
    tx: AgentActionsTx,
    record: AgentActionRecord,
    householdId: string,
    userId: string,
): Promise<boolean> {
    if (record.householdId !== householdId) return false;
    if (record.memberId !== null && record.memberId === userId) return true;
    return tx.isOwner(householdId, userId);
}

type Undoer = {
    deps: AgentUndoDeps;
    tx: AgentActionsTx;
    record: AgentActionRecord;
    input: UndoAgentActionInput;
    /** A fridge item this undo put back, by food: the item a movement can name. */
    restoredItems: Map<string, string>;
    /** Foods the rows this undo wrote name, by id, with the table of the first. */
    foodRefs: Map<string, AgentSnapshotTable>;
};

/** Rows compared as JSON, so key order and number formatting do not matter. */
function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        return `{${entries
            .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
            .join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

/** One key of a jsonb object column that an action changed. */
export type KeyChange = {
    key: string;
    before: unknown;
    after: unknown;
    hadBefore: boolean;
    hadAfter: boolean;
};

/** One column an action changed, as it was and as the write left it. */
export type ColumnChange =
    | { kind: "value"; column: string; before: unknown; after: unknown }
    /** A jsonb object column where only these keys changed. */
    | { kind: "keys"; column: string; keys: KeyChange[] };

/**
 * The columns where the before-image and the after-image differ: what the
 * action changed. Key columns and bookkeeping columns are left out. An object
 * column is compared key by key, so one preference set by the action does not
 * claim the others.
 */
export function changedColumns(
    table: AgentSnapshotTable,
    before: AgentSnapshotRow,
    after: AgentSnapshotRow,
): ColumnChange[] {
    const keys = new Set<string>(keyColumns(table));
    const names = [
        ...new Set([...Object.keys(before), ...Object.keys(after)]),
    ].sort();
    const changes: ColumnChange[] = [];
    for (const column of names) {
        if (keys.has(column) || BOOKKEEPING_COLUMNS.includes(column)) continue;
        const was = before[column];
        const now = after[column];
        if (canonical(was) === canonical(now)) continue;
        if (isPlainObject(was) && isPlainObject(now)) {
            const objectKeys = [
                ...new Set([...Object.keys(was), ...Object.keys(now)]),
            ].sort();
            const changed: KeyChange[] = [];
            for (const key of objectKeys) {
                const hadBefore = Object.hasOwn(was, key);
                const hadAfter = Object.hasOwn(now, key);
                if (
                    hadBefore === hadAfter &&
                    canonical(was[key]) === canonical(now[key])
                ) {
                    continue;
                }
                changed.push({
                    key,
                    before: was[key],
                    after: now[key],
                    hadBefore,
                    hadAfter,
                });
            }
            changes.push({ kind: "keys", column, keys: changed });
        } else {
            changes.push({ kind: "value", column, before: was, after: now });
        }
    }
    return changes;
}

/** True while every changed column still holds what the write left. */
function stillAsTheWriteLeftIt(
    current: AgentSnapshotRow,
    changes: readonly ColumnChange[],
): boolean {
    for (const change of changes) {
        const now = current[change.column];
        if (change.kind === "value") {
            if (canonical(now) !== canonical(change.after)) return false;
            continue;
        }
        if (!isPlainObject(now)) return false;
        for (const key of change.keys) {
            const has = Object.hasOwn(now, key.key);
            if (has !== key.hadAfter) return false;
            if (has && canonical(now[key.key]) !== canonical(key.after)) {
                return false;
            }
        }
    }
    return true;
}

/**
 * What to write to put an updated row back: whole columns, and for an object
 * column the keys to set and the keys the action added, to remove.
 */
export type RestorePatch = {
    set: Record<string, unknown>;
    json: Record<string, { set: Record<string, unknown>; remove: string[] }>;
};

export function restorePatch(changes: readonly ColumnChange[]): RestorePatch {
    const patch: RestorePatch = { set: {}, json: {} };
    for (const change of changes) {
        if (change.kind === "value") {
            patch.set[change.column] = change.before ?? null;
            continue;
        }
        const entry: { set: Record<string, unknown>; remove: string[] } = {
            set: {},
            remove: [],
        };
        for (const key of change.keys) {
            if (key.hadBefore) entry.set[key.key] = key.before;
            else entry.remove.push(key.key);
        }
        patch.json[change.column] = entry;
    }
    return patch;
}

/** The row with the patch applied: what a store does to the stored row. */
export function applyRestorePatch(
    row: AgentSnapshotRow,
    patch: RestorePatch,
): AgentSnapshotRow {
    const next = jsonRow(row);
    for (const [column, value] of Object.entries(patch.set)) {
        next[column] = value;
    }
    for (const [column, change] of Object.entries(patch.json)) {
        const base = isPlainObject(next[column])
            ? { ...(next[column] as Record<string, unknown>) }
            : {};
        for (const key of change.remove) delete base[key];
        Object.assign(base, change.set);
        next[column] = base;
    }
    return jsonRow(next);
}

/** A row as an edit leaves it, minus the column every edit moves. */
function withoutBookkeeping(row: AgentSnapshotRow): AgentSnapshotRow {
    const copy = jsonRow(row);
    for (const column of BOOKKEEPING_COLUMNS) delete copy[column];
    return copy;
}

/** True while the row is still exactly what the write left (`updated_at` aside). */
function unchangedSince(
    current: AgentSnapshotRow,
    after: AgentSnapshotRow,
): boolean {
    return (
        canonical(withoutBookkeeping(current)) ===
        canonical(withoutBookkeeping(after))
    );
}

/** The columns of a fridge item whose change moves its stock. */
const STOCK_COLUMNS: readonly string[] = ["food_id", "amount"];

/**
 * Refuses to put a fridge item's food or amount back once stock movements
 * have been written for it after the action. Such a movement sits on the food
 * the item has now; moving the item back would leave it behind, and both
 * foods' ledgers would stop matching their fridge. The movements the action
 * wrote itself, or moved to another food, are on its snapshot and are not
 * "since"; the ones that were already there are older than the action.
 */
async function refuseWhenUsedSince(
    undoer: Undoer,
    current: AgentSnapshotRow,
    changed: readonly ColumnChange[],
): Promise<void> {
    const { deps, tx, record } = undoer;
    if (
        !changed.some(
            (change) =>
                change.kind === "value" &&
                STOCK_COLUMNS.includes(change.column),
        )
    ) {
        return;
    }
    const foodId = current.food_id;
    const itemId = current.id;
    if (typeof foodId !== "string" || typeof itemId !== "string") return;
    const known = new Set<string>(
        (record.snapshot?.ledger ?? []).map((entry) => entry.id),
    );
    for (const change of record.snapshot?.changes ?? []) {
        if (change.table === "stock_movements") {
            known.add(String(change.row.id));
        }
    }
    const startedAt = Date.parse(record.createdAt);
    const movements = await deps.stock.listMovements(
        record.householdId,
        foodId,
        record.createdAt,
    );
    if (
        !movements.some(
            (movement) =>
                movement.fridgeItemId === itemId &&
                !known.has(movement.id) &&
                Date.parse(movement.createdAt) > startedAt,
        )
    ) {
        return;
    }
    const [food] = await tx.readRows("foods", [{ id: foodId }]);
    const name = typeof food?.name === "string" ? food.name : null;
    throw new AgentUndoConflictError(
        { kind: "used" },
        "fridge_items",
        name ? { ...current, name } : current,
    );
}

/** The columns that point at a food. */
const FOOD_REFERENCE_COLUMNS: readonly string[] = [
    "food_id",
    "generic_food_id",
    "usual_product_id",
];

/** Notes that a row this undo wrote names a food. */
function noteFoodReference(
    undoer: Undoer,
    table: AgentSnapshotTable,
    foodId: unknown,
): void {
    if (typeof foodId === "string" && !undoer.foodRefs.has(foodId)) {
        undoer.foodRefs.set(foodId, table);
    }
}

/** A timestamp column as milliseconds: NaN when it is not a time. */
function instantOf(value: unknown): number {
    if (value instanceof Date) return value.getTime();
    return typeof value === "string" ? Date.parse(value) : Number.NaN;
}

/**
 * Refuses an undo that would leave a row on a food that was archived after the
 * action began: the food was merged into another since, and the rows that
 * named it went with the merge. The put-back itself cannot tell, since an
 * archived food is still a row the foreign key accepts. A food that was
 * already archived when the action began is what the row pointed at then
 * (archiving a food in Settings leaves the rows that name it alone), so
 * putting it back is exact.
 */
async function refuseArchivedFoods(undoer: Undoer): Promise<void> {
    if (undoer.foodRefs.size === 0) return;
    const ids = [...undoer.foodRefs.keys()];
    const found = await undoer.tx.readRows(
        "foods",
        ids.map((id) => ({ id })),
        { lock: true },
    );
    const startedAt = Date.parse(undoer.record.createdAt);
    for (const food of found) {
        if (food.archived_at == null) continue;
        // Not provably before the action means after it.
        if (instantOf(food.archived_at) <= startedAt) continue;
        const id = String(food.id);
        throw new AgentUndoConflictError(
            { kind: "missing_reference", referencedTable: "foods" },
            undoer.foodRefs.get(id)!,
            { id },
        );
    }
}

async function replayChange(
    undoer: Undoer,
    change: AgentSnapshotChange,
): Promise<void> {
    const { tx } = undoer;
    const { table, row } = change;
    const key = agentRowKey(table, row);
    switch (change.op) {
        case "deleted": {
            await tx.insertRow(table, row);
            for (const column of FOOD_REFERENCE_COLUMNS) {
                noteFoodReference(undoer, table, row[column]);
            }
            if (
                table === "fridge_items" &&
                typeof row.food_id === "string" &&
                !undoer.restoredItems.has(row.food_id)
            ) {
                undoer.restoredItems.set(row.food_id, key.id!);
            }
            return;
        }
        case "updated": {
            const [current] = await tx.readRows(table, [key], { lock: true });
            if (!current) {
                throw new AgentUndoConflictError({ kind: "gone" }, table, row);
            }
            // Only the columns the action changed are this undo's to put
            // back, and only while they still hold what the write left.
            const changed = change.after
                ? changedColumns(table, row, change.after)
                : null;
            if (!changed || !stillAsTheWriteLeftIt(current, changed)) {
                throw new AgentUndoConflictError(
                    { kind: "changed" },
                    table,
                    current,
                );
            }
            if (table === "fridge_items") {
                await refuseWhenUsedSince(undoer, current, changed);
            }
            if (!(await tx.replaceColumns(table, key, restorePatch(changed)))) {
                throw new AgentUndoConflictError({ kind: "gone" }, table, row);
            }
            for (const column of changed) {
                if (
                    column.kind === "value" &&
                    FOOD_REFERENCE_COLUMNS.includes(column.column)
                ) {
                    noteFoodReference(undoer, table, column.before);
                }
            }
            return;
        }
        case "inserted": {
            const [current] = await tx.readRows(table, [key], { lock: true });
            if (!current) return;
            // A row a person edited since is theirs now, not the agent's to
            // remove.
            if (change.after && !unchangedSince(current, change.after)) {
                throw new AgentUndoConflictError(
                    { kind: "changed" },
                    table,
                    current,
                );
            }
            // Never lean on a cascade or a set-null: whatever was added to
            // this row, or pointed at it, since would go with it.
            const by = await tx.referencingRows(table, key);
            if (by.length > 0) {
                throw new AgentUndoConflictError(
                    { kind: "in_use", by },
                    table,
                    current,
                );
            }
            await tx.deleteRow(table, key);
            return;
        }
    }
}

function roundDelta(amount: number): number {
    return Math.round(amount * 1e6) / 1e6;
}

/**
 * Writes the opposite of every stock movement the action itself wrote, one
 * `adjust` per food and unit, so the ledger goes back to where the action
 * found it. It never looks at the fridge: what the stock and the ledger
 * disagreed on before the action (items from before the ledger, a location
 * deleted with its items) is not this undo's to settle. An item that went
 * away with no movement of its own comes back with none. The movement names
 * an item only while that item exists, since a foreign key would refuse the
 * id of a row just deleted.
 */
async function compensateLedger(undoer: Undoer): Promise<void> {
    const { deps, tx, record, input } = undoer;
    const entries = record.snapshot?.ledger ?? [];
    const groups = new Map<
        string,
        { foodId: string; unit: string; total: number; itemIds: string[] }
    >();
    for (const entry of entries) {
        const key = JSON.stringify([entry.food_id, entry.unit]);
        const group = groups.get(key) ?? {
            foodId: entry.food_id,
            unit: entry.unit,
            total: 0,
            itemIds: [],
        };
        group.total += entry.delta;
        if (entry.fridge_item_id) group.itemIds.push(entry.fridge_item_id);
        groups.set(key, group);
    }
    for (const group of groups.values()) {
        const delta = roundDelta(-group.total);
        if (delta === 0) continue;
        try {
            await findFoodById(deps.foods, record.householdId, group.foodId);
        } catch (err) {
            if (!(err instanceof FoodsInputError)) throw err;
            throw new AgentUndoConflictError(
                { kind: "missing_reference", referencedTable: "foods" },
                "stock_movements",
                { id: group.foodId },
            );
        }
        const items =
            group.itemIds.length > 0
                ? await tx.readRows(
                      "fridge_items",
                      [...new Set(group.itemIds)].map((id) => ({ id })),
                  )
                : [];
        await deps.stock.insertMovement({
            id: crypto.randomUUID(),
            householdId: record.householdId,
            foodId: group.foodId,
            fridgeItemId:
                items.length > 0
                    ? String(items[0]!.id)
                    : (undoer.restoredItems.get(group.foodId) ?? null),
            delta,
            unit: group.unit,
            reason: "adjust",
            groceryLineId: null,
            recipeId: null,
            mealId: null,
            actorUserId: input.userId,
            createdAt: input.now.toISOString(),
        });
    }
}

export function agentActionEntry(
    record: AgentActionRecord,
    now: Date,
): AgentActionEntry {
    return {
        id: record.id,
        householdId: record.householdId,
        memberId: record.memberId,
        connection: record.connection,
        tool: record.tool,
        summary: record.summary,
        createdAt: record.createdAt,
        undoExpiresAt: record.undoExpiresAt,
        undoneAt: record.undoneAt,
        canUndo:
            record.undoable &&
            record.snapshot !== null &&
            record.undoneAt === null &&
            now.getTime() < Date.parse(record.undoExpiresAt),
    };
}

/** The household's activity, newest first. */
export async function listAgentActions(
    deps: Pick<AgentActionDeps, "store" | "now">,
    householdId: string,
    opts: { limit: number; now?: Date },
): Promise<AgentActionEntry[]> {
    const now = opts.now ?? clock(deps);
    const records = await deps.store.list(householdId, opts.limit);
    return records.map((record) => agentActionEntry(record, now));
}

/** Drops snapshots whose 24 hours are over; the entries stay as history. */
export async function purgeExpiredAgentSnapshots(
    deps: Pick<AgentActionDeps, "store">,
    now: Date,
): Promise<number> {
    return deps.store.purgeSnapshots(now);
}

/** The sentence a destructive tool appends to its result; empty when there is nothing to undo. */
export function agentUndoHint(entry: AgentActionEntry): string {
    return entry.canUndo
        ? "The household can undo this for 24 hours in Settings › AI connections."
        : "";
}

function iso(value: unknown): string {
    return new Date(String(value)).toISOString();
}

function isoOrNull(value: unknown): string | null {
    return value == null ? null : iso(value);
}

function idOrNull(value: unknown): string | null {
    return value == null ? null : String(value);
}

/** A database row to the record; the snapshot is kept only when it is a valid one. */
export function agentActionFromRow(row: {
    id: unknown;
    household_id: unknown;
    member_id: unknown;
    connection: unknown;
    tool: unknown;
    summary: unknown;
    destructive: unknown;
    snapshot: unknown;
    undoable: unknown;
    created_at: unknown;
    undo_expires_at: unknown;
    undone_at: unknown;
    undone_by: unknown;
}): AgentActionRecord {
    return {
        id: String(row.id),
        householdId: String(row.household_id),
        memberId: idOrNull(row.member_id),
        connection: String(row.connection),
        tool: String(row.tool),
        summary: String(row.summary),
        destructive: row.destructive !== false,
        snapshot: parseAgentSnapshot(row.snapshot),
        undoable: row.undoable !== false,
        createdAt: iso(row.created_at),
        undoExpiresAt: iso(row.undo_expires_at),
        undoneAt: isoOrNull(row.undone_at),
        undoneBy: idOrNull(row.undone_by),
    };
}

/** One table's rows, for a memory store that stands a real store in for it. */
export type AgentRowTable = {
    get(key: AgentRowKey): Promise<AgentSnapshotRow | null>;
    insert(row: AgentSnapshotRow): Promise<void>;
    replace(row: AgentSnapshotRow): Promise<boolean>;
    remove(key: AgentRowKey): Promise<void>;
};

/** What the memory store does to a row that points at a deleted row. */
export type MemoryReferenceAction = "restrict" | "cascade" | "set null";

export type MemoryAgentActionsStore = AgentActionsStore & {
    /** Puts a row in a table, replacing the row with the same key. */
    __seed(table: AgentSnapshotTable, row: AgentSnapshotRow): void;
    /** Removes a row by its id, or by its key columns for a composite key. */
    __remove(table: AgentSnapshotTable, key: string | AgentRowKey): void;
    __rows(table: AgentSnapshotTable): AgentSnapshotRow[];
    __records(): AgentActionRecord[];
    /** Who each undo ran as, in order: a member's id, or null for the household. */
    __actedAs(): (string | null)[];
    /** Two rows of this table may not share these column values. */
    __unique(table: AgentSnapshotTable, columns: string[]): void;
    /**
     * A row's `column` must match the `targetColumn` of a row of `target`
     * (default: the target's first key column), as a foreign key does.
     * `onDelete` says what deleting the target does to such a row: it blocks
     * the delete (`restrict`, the default), would take the row with it
     * (`cascade`), or clears the column (`set null`).
     */
    __reference(
        table: AgentSnapshotTable,
        column: string,
        target: AgentSnapshotTable,
        onDelete?: MemoryReferenceAction,
        targetColumn?: string,
    ): void;
    /** Hands a table to another store (a memory fridge store, say). */
    __attach(table: AgentSnapshotTable, access: AgentRowTable): void;
    __setOwner(householdId: string, userId: string): void;
};

type MemoryState = {
    actions: AgentActionRecord[];
    tables: Map<AgentSnapshotTable, Map<string, AgentSnapshotRow>>;
};

/**
 * The ledger's audit links only clear themselves when the row they name goes;
 * they never stop an undo (the ledger correction handles them).
 */
const AUDIT_LINK_TABLE = "stock_movements";

export function createMemoryAgentActionsStore(): MemoryAgentActionsStore {
    let state: MemoryState = { actions: [], tables: new Map() };
    const owners = new Map<string, string>();
    const uniques = new Map<AgentSnapshotTable, string[][]>();
    const references: {
        table: AgentSnapshotTable;
        column: string;
        target: AgentSnapshotTable;
        targetColumn: string;
        onDelete: MemoryReferenceAction;
    }[] = [];
    const attached = new Map<AgentSnapshotTable, AgentRowTable>();
    const acted: (string | null)[] = [];

    const table = (name: AgentSnapshotTable) => {
        let map = state.tables.get(name);
        if (!map) {
            map = new Map();
            state.tables.set(name, map);
        }
        return map;
    };
    const rowKey = (name: AgentSnapshotTable, row: AgentSnapshotRow) =>
        agentKeyString(name, agentRowKey(name, row));
    const asKey = (name: AgentSnapshotTable, key: string | AgentRowKey) =>
        typeof key === "string" ? { id: key } : key;

    /** The rows of a table that carry a value in a column. */
    const withValue = (
        name: AgentSnapshotTable,
        column: string,
        value: unknown,
    ) => [...table(name).values()].filter((other) => other[column] === value);
    const pointingAt = (
        ref: (typeof references)[number],
        parent: AgentSnapshotRow,
    ) => {
        const value = parent[ref.targetColumn];
        return value == null ? [] : withValue(ref.table, ref.column, value);
    };
    const targetExists = async (
        ref: (typeof references)[number],
        value: unknown,
    ) => {
        const access = attached.get(ref.target);
        const columns = keyColumns(ref.target);
        if (access) {
            // An attached store can only be asked by key; any other column
            // cannot be checked, so it is taken to be there.
            return columns.length === 1 && columns[0] === ref.targetColumn
                ? (await access.get({ [ref.targetColumn]: String(value) })) !==
                      null
                : true;
        }
        return withValue(ref.target, ref.targetColumn, value).length > 0;
    };
    const parentRow = async (name: AgentSnapshotTable, key: AgentRowKey) => {
        const access = attached.get(name);
        return access
            ? access.get(key)
            : (table(name).get(agentKeyString(name, key)) ?? null);
    };

    const tx: AgentActionsTx = {
        async readRows(name, keys) {
            const found: AgentSnapshotRow[] = [];
            for (const key of keys) {
                const row = await parentRow(name, key);
                if (row) found.push(jsonRow(row));
            }
            return found;
        },
        async insertRow(name, row) {
            const access = attached.get(name);
            if (access) {
                await access.insert(jsonRow(row));
                return;
            }
            const rows = table(name);
            const conflicts = (columns: string[]) =>
                [...rows.values()].some((other) =>
                    columns.every((column) => other[column] === row[column]),
                );
            if (
                rows.has(rowKey(name, row)) ||
                (uniques.get(name) ?? []).some(conflicts)
            ) {
                throw new AgentUndoConflictError({ kind: "unique" }, name, row);
            }
            for (const ref of references) {
                if (ref.table !== name) continue;
                const value = row[ref.column];
                if (value != null && !(await targetExists(ref, value))) {
                    throw new AgentUndoConflictError(
                        {
                            kind: "missing_reference",
                            referencedTable: ref.target,
                        },
                        name,
                        row,
                    );
                }
            }
            rows.set(rowKey(name, row), jsonRow(row));
        },
        async replaceColumns(name, key, patch) {
            const current = await parentRow(name, key);
            if (!current) return false;
            const next = applyRestorePatch(current, patch);
            const access = attached.get(name);
            if (access) return access.replace(next);
            table(name).set(rowKey(name, current), next);
            return true;
        },
        async deleteRow(name, key) {
            const access = attached.get(name);
            if (access) {
                await access.remove(key);
                return;
            }
            const row = table(name).get(agentKeyString(name, key));
            if (!row) return;
            for (const ref of references) {
                if (ref.target !== name || ref.onDelete === "set null") {
                    continue;
                }
                if (pointingAt(ref, row).length > 0) {
                    throw new AgentUndoConflictError(
                        { kind: "in_use" },
                        name,
                        row,
                    );
                }
            }
            for (const ref of references) {
                if (ref.target !== name || ref.onDelete !== "set null") {
                    continue;
                }
                for (const other of pointingAt(ref, row)) {
                    other[ref.column] = null;
                }
            }
            table(name).delete(agentKeyString(name, key));
        },
        async referencingRows(name, key) {
            const row = await parentRow(name, key);
            if (!row) return [];
            const counts = new Map<string, number>();
            for (const ref of references) {
                if (ref.target !== name) continue;
                // The ledger's audit links clear themselves; they never block.
                if (
                    ref.onDelete === "set null" &&
                    ref.table === AUDIT_LINK_TABLE
                ) {
                    continue;
                }
                const count = pointingAt(ref, row).length;
                if (count > 0) {
                    counts.set(ref.table, (counts.get(ref.table) ?? 0) + count);
                }
            }
            return [...counts]
                .sort(([a], [b]) => (a < b ? -1 : 1))
                .map(([referencing, count]) => ({ table: referencing, count }));
        },
        // A table handed to another store (`__attach`) cannot list its rows,
        // so it is never walked as a child.
        async cascadeRows(name, keys) {
            const reached = new Map<string, AgentCascadeRow>();
            const queue: {
                table: AgentSnapshotTable;
                row: AgentSnapshotRow;
            }[] = [];
            for (const key of keys) {
                const row = await parentRow(name, key);
                if (row) queue.push({ table: name, row });
            }
            const roots = new Set(
                queue.map(
                    (entry) =>
                        `${entry.table}:${rowKey(entry.table, entry.row)}`,
                ),
            );
            while (queue.length > 0) {
                const parent = queue.shift()!;
                for (const ref of references) {
                    if (
                        ref.target !== parent.table ||
                        ref.onDelete === "restrict"
                    ) {
                        continue;
                    }
                    const op =
                        ref.onDelete === "cascade" ? "deleted" : "updated";
                    for (const child of pointingAt(ref, parent.row)) {
                        const id = `${ref.table}:${rowKey(ref.table, child)}`;
                        if (roots.has(id)) continue;
                        const known = reached.get(id);
                        if (
                            known &&
                            (known.op === "deleted" || op === "updated")
                        ) {
                            continue;
                        }
                        reached.set(id, {
                            table: ref.table,
                            op,
                            row: jsonRow(child),
                        });
                        if (op === "deleted") {
                            queue.push({ table: ref.table, row: child });
                        }
                    }
                }
            }
            return { rows: [...reached.values()], uncaptured: [] };
        },
        async actAs(actor) {
            acted.push(actor.memberId);
        },
        // One process, one writer at a time: every movement seen during the
        // write is the write's own.
        async movementsWrittenHere(ids) {
            return new Set(ids);
        },
        async insertAction(record) {
            state.actions.push(structuredClone(record));
        },
        async lockAction(householdId, actionId) {
            const found = state.actions.find(
                (row) => row.id === actionId && row.householdId === householdId,
            );
            return found ? structuredClone(found) : null;
        },
        async markUndone(actionId, userId, at) {
            const found = state.actions.find((row) => row.id === actionId);
            if (!found) return;
            found.undoneAt = at.toISOString();
            found.undoneBy = userId;
        },
        async isOwner(householdId, userId) {
            return owners.get(householdId) === userId;
        },
    };

    return {
        async atomically(fn) {
            const before = {
                actions: structuredClone(state.actions),
                tables: new Map(
                    [...state.tables].map(([name, rows]) => [
                        name,
                        new Map(
                            [...rows].map(([id, row]) => [id, jsonRow(row)]),
                        ),
                    ]),
                ),
            };
            const actedBefore = acted.length;
            try {
                return await fn(tx);
            } catch (err) {
                state = before;
                acted.length = actedBefore;
                throw err;
            }
        },
        async list(householdId, limit) {
            return state.actions
                .map((record, index) => ({ record, index }))
                .filter(({ record }) => record.householdId === householdId)
                .sort(
                    (a, b) =>
                        Date.parse(b.record.createdAt) -
                            Date.parse(a.record.createdAt) || b.index - a.index,
                )
                .slice(0, limit)
                .map(({ record }) => structuredClone(record));
        },
        async purgeSnapshots(now) {
            let purged = 0;
            for (const record of state.actions) {
                if (
                    record.snapshot !== null &&
                    Date.parse(record.undoExpiresAt) < now.getTime()
                ) {
                    record.snapshot = null;
                    purged++;
                }
            }
            return purged;
        },
        __seed(name, row) {
            table(name).set(rowKey(name, row), jsonRow(row));
        },
        __remove(name, key) {
            table(name).delete(agentKeyString(name, asKey(name, key)));
        },
        __rows(name) {
            return [...table(name).values()].map(jsonRow);
        },
        __records() {
            return state.actions.map((record) => structuredClone(record));
        },
        __actedAs() {
            return [...acted];
        },
        __unique(name, columns) {
            uniques.set(name, [...(uniques.get(name) ?? []), columns]);
        },
        __reference(name, column, target, onDelete = "restrict", targetColumn) {
            references.push({
                table: name,
                column,
                target,
                targetColumn: targetColumn ?? keyColumns(target)[0]!,
                onDelete,
            });
        },
        __attach(name, access) {
            attached.set(name, access);
        },
        __setOwner(householdId, userId) {
            owners.set(householdId, userId);
        },
    };
}

const PURGE_INTERVAL_MS = 15 * 60 * 1000;
const PURGE_FIRST_RUN_MS = 60 * 1000;

// Per instance by design: overlap guard for the snapshot purge; the update is idempotent, so instances may both run it.
let purgeRunning = false;

/**
 * Start the periodic snapshot purge. Call once at server startup, as the
 * system. It runs shortly after boot and then every 15 minutes: reads already
 * treat an expired action as not undoable, so the purge only makes sure no
 * deleted row's contents are kept past the window.
 */
export function startAgentActionPurge(
    deps: Pick<AgentActionDeps, "store">,
): void {
    const sweep = () => {
        if (purgeRunning) return;
        purgeRunning = true;
        purgeExpiredAgentSnapshots(deps, new Date())
            .catch((err) => {
                console.error(
                    "[agent-actions] snapshot purge:",
                    err instanceof Error ? err.message : String(err),
                );
            })
            .finally(() => {
                purgeRunning = false;
            });
    };
    setTimeout(sweep, PURGE_FIRST_RUN_MS).unref?.();
    setInterval(sweep, PURGE_INTERVAL_MS).unref?.();
}
