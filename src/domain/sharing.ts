import { createHash, randomBytes } from "node:crypto";

/**
 * Public read-only share links. A link grants one object to anyone holding
 * the token: a recipe, or the grocery list. The token is 32 random bytes; only
 * its SHA-256 is stored, so a leaked database does not leak working links.
 *
 * Pure: no database import. `src/db/share-links.ts` is the Postgres adapter.
 */

export const SHARE_KINDS = ["recipe", "grocery_list"] as const;
export type ShareKind = (typeof SHARE_KINDS)[number];

export const MIN_SHARE_EXPIRY_DAYS = 1;
export const MAX_SHARE_EXPIRY_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;

export class ShareLinkInputError extends Error {
    readonly code = "share_link_input" as const;

    constructor(message: string) {
        super(message);
        this.name = "ShareLinkInputError";
    }
}

/**
 * A stored link. It never carries the token or its hash: the token is shown
 * once at creation, and nothing that lists links needs the hash.
 */
export type ShareLink = {
    id: string;
    householdId: string;
    kind: ShareKind;
    /**
     * The recipe id; null for the grocery list (there is one per household).
     * Polymorphic, so no foreign key backs it: whoever loads the shared object
     * must load it scoped to `householdId` (`getRecipe(link.householdId, id)`),
     * never by id alone as the system, or a link could reach another
     * household's recipe.
     */
    targetId: string | null;
    createdBy: string | null;
    createdAt: string;
    expiresAt: string | null;
    revokedAt: string | null;
};

export type ShareLinkRow = {
    id: string;
    household_id: string;
    kind: string;
    target_id: string | null;
    token_hash: string;
    created_by: string | null;
    created_at: string | Date;
    expires_at: string | Date | null;
    revoked_at: string | Date | null;
};

export type NewShareLink = {
    householdId: string;
    kind: ShareKind;
    targetId: string | null;
    createdBy: string | null;
    tokenHash: string;
    expiresAt: string | null;
};

export type ShareLinkListOptions = {
    /** The instant "active" is judged at. Defaults to the clock. */
    now?: Date;
    /** Also return revoked and expired links. */
    includeInactive?: boolean;
};

export type ShareLinkStore = {
    create(input: NewShareLink): Promise<ShareLink>;
    /** The link whose token hashes to this value, in any state; callers judge `isLive`. */
    findByHash(tokenHash: string): Promise<ShareLink | null>;
    /** A household's links, newest first; active only unless asked otherwise. */
    listForHousehold(
        householdId: string,
        opts?: ShareLinkListOptions,
    ): Promise<ShareLink[]>;
    /**
     * Marks a link of this household revoked. Idempotent: a link already
     * revoked keeps its first timestamp. Null when the household has no such link.
     */
    revoke(
        householdId: string,
        id: string,
        now: Date,
    ): Promise<ShareLink | null>;
};

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** 32 random bytes as base64url: 43 characters, shown to the member once. */
export function mintShareToken(): string {
    return randomBytes(32).toString("base64url");
}

/** SHA-256 of the token as lowercase hex, the only form that is stored. */
export function hashToken(token: string): string {
    return createHash("sha256").update(token, "utf8").digest("hex");
}

/** A link a visitor may still use: not revoked, and not past its expiry. */
export function isLive(
    link: Pick<ShareLink, "expiresAt" | "revokedAt">,
    now: Date,
): boolean {
    if (link.revokedAt !== null) return false;
    if (link.expiresAt === null) return true;
    return Date.parse(link.expiresAt) > now.getTime();
}

/**
 * `expires_in_days` for the tools and web handlers: absent means the link
 * never expires; otherwise a whole number from 1 to 365.
 */
export function validateExpiresInDays(value: unknown): number | null {
    if (value === undefined || value === null) return null;
    if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < MIN_SHARE_EXPIRY_DAYS ||
        value > MAX_SHARE_EXPIRY_DAYS
    ) {
        throw new ShareLinkInputError(
            `expires_in_days must be a whole number from ${MIN_SHARE_EXPIRY_DAYS} to ${MAX_SHARE_EXPIRY_DAYS}, or left out for a link that never expires.`,
        );
    }
    return value;
}

function isShareKind(value: unknown): value is ShareKind {
    return (SHARE_KINDS as readonly unknown[]).includes(value);
}

/**
 * Whether an object exists in a household. `createShareLink` asks before it
 * mints, so a link can never name a missing recipe or another household's.
 * Structural on purpose: a `RecipesStore` satisfies it (`getRecipe` scoped to
 * the household), and the domain imports no store.
 */
export type ShareTargets = {
    getRecipe(householdId: string, id: string): Promise<unknown | null>;
};

export type CreateShareLinkInput = {
    householdId: string;
    kind: ShareKind;
    /** Required for a recipe, refused for the grocery list. */
    targetId?: string | null;
    createdBy: string | null;
    expiresInDays?: number | null;
};

/**
 * Validates, mints a token, stores its hash. The raw token is returned here
 * and nowhere else; the caller shows it once. A recipe target must exist in
 * the link's own household (`targets` is required so it cannot be skipped).
 */
export async function createShareLink(
    store: ShareLinkStore,
    input: CreateShareLinkInput,
    now: Date,
    targets: ShareTargets,
): Promise<{ link: ShareLink; token: string }> {
    if (!isShareKind(input.kind)) {
        throw new ShareLinkInputError(
            `kind must be one of: ${SHARE_KINDS.join(", ")}.`,
        );
    }
    const targetId = input.targetId ?? null;
    if (input.kind === "recipe" && targetId === null) {
        throw new ShareLinkInputError("A recipe link needs a recipe.");
    }
    if (input.kind === "grocery_list" && targetId !== null) {
        throw new ShareLinkInputError(
            "The grocery list link shares the whole list, so it takes no target.",
        );
    }
    if (
        input.kind === "recipe" &&
        targetId !== null &&
        !(await targets.getRecipe(input.householdId, targetId))
    ) {
        throw new ShareLinkInputError("That recipe is not in your household.");
    }
    const days = validateExpiresInDays(input.expiresInDays);
    const token = mintShareToken();
    const link = await store.create({
        householdId: input.householdId,
        kind: input.kind,
        targetId,
        createdBy: input.createdBy,
        tokenHash: hashToken(token),
        expiresAt:
            days === null
                ? null
                : new Date(now.getTime() + days * DAY_MS).toISOString(),
    });
    return { link, token };
}

/**
 * The live link a raw token names, or null. Unknown, revoked and expired all
 * come back the same, so a visitor cannot tell them apart.
 */
export async function resolveShareToken(
    store: ShareLinkStore,
    token: string,
    now: Date,
): Promise<ShareLink | null> {
    // Not a token we could have minted: no need to ask the store.
    if (!TOKEN_RE.test(token)) return null;
    // Plain index equality on the SHA-256 of a 256-bit secret, no constant-time
    // compare: timing could reveal at most a hash prefix of an unknown preimage.
    const link = await store.findByHash(hashToken(token));
    return link && isLive(link, now) ? link : null;
}

export function revokeShareLink(
    store: ShareLinkStore,
    householdId: string,
    id: string,
    now: Date,
): Promise<ShareLink | null> {
    return store.revoke(householdId, id, now);
}

// Postgres hands timestamps back as Date, or as "…+00:00" through json_agg:
// one ISO form either way.
function toIso(value: string | Date): string {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function toIsoOrNull(value: string | Date | null): string | null {
    return value === null || value === undefined ? null : toIso(value);
}

export function shareLinkFromRow(row: ShareLinkRow): ShareLink {
    if (!isShareKind(row.kind)) {
        throw new Error(`Unknown share link kind: ${String(row.kind)}`);
    }
    return {
        id: String(row.id),
        householdId: String(row.household_id),
        kind: row.kind,
        targetId: row.target_id === null ? null : String(row.target_id),
        createdBy: row.created_by === null ? null : String(row.created_by),
        createdAt: toIso(row.created_at),
        expiresAt: toIsoOrNull(row.expires_at),
        revokedAt: toIsoOrNull(row.revoked_at),
    };
}

type MemoryShareLink = ShareLink & { tokenHash: string };

export function createMemoryShareLinkStore(): ShareLinkStore {
    const rows: MemoryShareLink[] = [];
    const publicLink = ({
        tokenHash: _tokenHash,
        ...link
    }: MemoryShareLink): ShareLink => ({ ...link });
    return {
        async create(input) {
            if (rows.some((r) => r.tokenHash === input.tokenHash)) {
                throw new Error("duplicate token hash");
            }
            const row: MemoryShareLink = {
                id: crypto.randomUUID(),
                householdId: input.householdId,
                kind: input.kind,
                targetId: input.targetId,
                createdBy: input.createdBy,
                createdAt: new Date().toISOString(),
                expiresAt: input.expiresAt,
                revokedAt: null,
                tokenHash: input.tokenHash,
            };
            rows.push(row);
            return publicLink(row);
        },
        async findByHash(tokenHash) {
            const row = rows.find((r) => r.tokenHash === tokenHash);
            return row ? publicLink(row) : null;
        },
        async listForHousehold(householdId, opts) {
            const now = opts?.now ?? new Date();
            return rows
                .filter((r) => r.householdId === householdId)
                .filter((r) => opts?.includeInactive || isLive(r, now))
                .map(publicLink)
                .reverse();
        },
        async revoke(householdId, id, now) {
            const row = rows.find(
                (r) => r.householdId === householdId && r.id === id,
            );
            if (!row) return null;
            row.revokedAt ??= now.toISOString();
            return publicLink(row);
        },
    };
}

// What a share exposes. The sources are structural so a full RecipeView or
// grocery snapshot is accepted, but only the fields named here are copied:
// a new field on those types never reaches a visitor by accident.

export type ShareableRecipe = {
    name: string;
    yieldPortions: number;
    instructions: string | null;
    tags: readonly string[];
    ingredients: readonly {
        displayName: string;
        quantity: { amount: number; unit: string } | null;
        note: string | null;
        sortOrder: number;
    }[];
};

export type ShareableGroceryList = {
    stores: readonly { id: string; name: string; sortOrder: number }[];
    lines: readonly {
        storeId: string;
        displayName: string;
        quantity: { amount: number; unit: string };
        checked: boolean;
    }[];
};

export type SharedRecipe = {
    kind: "recipe";
    recipe: {
        name: string;
        portions: number;
        instructions: string | null;
        tags: string[];
        ingredients: {
            name: string;
            amount: number | null;
            unit: string | null;
            note: string | null;
        }[];
    };
};

export type SharedGroceryList = {
    kind: "grocery_list";
    list: {
        stores: {
            name: string;
            lines: {
                name: string;
                amount: number;
                unit: string;
                checked: boolean;
            }[];
        }[];
    };
};

export type ShareView = SharedRecipe | SharedGroceryList;

/** A line whose store was deleted still shows, under this heading, last. */
export const OTHER_STORE_NAME = "Other";

/**
 * Exactly what a visitor sees. A null object (the recipe was deleted after
 * it was shared) has no view; the caller answers 404, the same as for an
 * unknown token. `target_id` is polymorphic, so no foreign key does this.
 *
 * The caller must load `object` scoped to `link.householdId` (a recipe by
 * `getRecipe(link.householdId, link.targetId)`, the list from that household's
 * stores), never by id alone as the system. Grocery lines must be passed in
 * the app's own aisle/store order: lines keep the order they arrive in
 * within each store.
 */
export function shareView(
    kind: "recipe",
    object: ShareableRecipe | null | undefined,
): SharedRecipe | null;
export function shareView(
    kind: "grocery_list",
    object: ShareableGroceryList | null | undefined,
): SharedGroceryList | null;
export function shareView(
    kind: ShareKind,
    object: ShareableRecipe | ShareableGroceryList | null | undefined,
): ShareView | null;
export function shareView(
    kind: ShareKind,
    object: ShareableRecipe | ShareableGroceryList | null | undefined,
): ShareView | null {
    if (object === null || object === undefined) return null;
    if (kind === "recipe") return recipeView(object as ShareableRecipe);
    return groceryView(object as ShareableGroceryList);
}

function recipeView(recipe: ShareableRecipe): SharedRecipe {
    const ingredients = [...recipe.ingredients].sort(
        (a, b) => a.sortOrder - b.sortOrder,
    );
    return {
        kind: "recipe",
        recipe: {
            name: recipe.name,
            portions: recipe.yieldPortions,
            instructions: recipe.instructions,
            tags: [...recipe.tags],
            ingredients: ingredients.map((i) => ({
                name: i.displayName,
                amount: i.quantity ? i.quantity.amount : null,
                unit: i.quantity ? i.quantity.unit : null,
                note: i.note,
            })),
        },
    };
}

// Lines keep the order given (the app's aisle order); only stores are sorted.
function groceryView(list: ShareableGroceryList): SharedGroceryList {
    type ViewLine =
        SharedGroceryList["list"]["stores"][number]["lines"][number];
    const stores = [...list.stores].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
    );
    const byStore = new Map<string, ViewLine[]>();
    const other: ViewLine[] = [];
    for (const store of stores) byStore.set(store.id, []);
    for (const line of list.lines) {
        const viewLine: ViewLine = {
            name: line.displayName,
            amount: line.quantity.amount,
            unit: line.quantity.unit,
            checked: line.checked,
        };
        (byStore.get(line.storeId) ?? other).push(viewLine);
    }
    const grouped = stores
        .map((store) => ({ name: store.name, lines: byStore.get(store.id)! }))
        .filter((store) => store.lines.length > 0);
    if (other.length > 0) {
        grouped.push({ name: OTHER_STORE_NAME, lines: other });
    }
    return { kind: "grocery_list", list: { stores: grouped } };
}
