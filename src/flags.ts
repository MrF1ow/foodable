import { createHash } from "node:crypto";
import { flags as railwayFlags } from "railway";
import type { AuthContext } from "./auth-context.js";
import { rateLimitKey } from "./auth-context.js";
import type { HouseholdMember } from "./household.js";
import { VERSION } from "./version.js";

export type FlagKind = "temporary" | "kill-switch";
export type FlagUnit = "user" | "household";

type FlagDef = {
    type: "bool";
    kind: FlagKind;
    unit: FlagUnit;
    parent?: string;
    fallback: boolean;
    why: string;
    removeWhen: string;
};

// Kill switches are global: no per-subject rules in Railway. Their last-known
// value (src/flag-pins.ts, flag_snapshot) is one value per flag.
export const FLAGS = {
    "ui-v2": {
        type: "bool",
        kind: "temporary",
        unit: "user",
        fallback: false,
        why: "The new mobile-first shell (UI-3).",
        removeWhen:
            "Every ui-v2 page flag is at everyone for one release, and the old shell is deleted.",
    },
    "off-lookups": {
        type: "bool",
        kind: "kill-switch",
        unit: "household",
        fallback: true,
        why: "Open Food Facts lookups in lookupBarcode and searchFoodsByName.",
        removeWhen: "never (kill switch)",
    },
    "recipe-link-reader": {
        type: "bool",
        kind: "kill-switch",
        unit: "household",
        fallback: true,
        why: "Reading recipes from links (recipeImportFetcher).",
        removeWhen: "never (kill switch)",
    },
    "barcode-camera": {
        type: "bool",
        kind: "kill-switch",
        unit: "user",
        fallback: true,
        why: "The in-app barcode camera.",
        removeWhen: "never (kill switch)",
    },
    "restock-runner": {
        type: "bool",
        kind: "kill-switch",
        unit: "household",
        fallback: true,
        why: "The background restock runner.",
        removeWhen: "never (kill switch)",
    },
} as const satisfies Record<string, FlagDef>;

export type FlagName = keyof typeof FLAGS;

export type FlagContext = {
    key: string;
    household_id?: string;
    env: string;
    groups: string;
    role?: "owner" | "admin" | "member";
    cohort: number;
    household_cohort?: number;
    client?: string;
    app_version: string;
};

export type FlagSource = "railway" | "env" | "fallback" | "memory";
export type FlagEvaluation = {
    flag: FlagName;
    value: boolean;
    reason: string;
    source: FlagSource;
};

export interface FlagReader {
    evaluate(flag: FlagName, ctx: FlagContext): FlagEvaluation;
    isEnabled(flag: FlagName, ctx: FlagContext): boolean;
}

/**
 * The global numeric Railway flag that rolls sticky pins back (STG-5). Bumping
 * it makes every pin written under another epoch re-evaluate on its next
 * reliable read. Not a boolean feature flag, so it stays out of `FLAGS` and
 * never reaches `ViewerFlags`.
 */
export const FLAGS_EPOCH = "flags-epoch";

/** `reliable: false` means the epoch could not be read; `value` is then 0. */
export type EpochRead = { value: number; reliable: boolean };

/** A reader that can also read the epoch: only the Railway reader. */
export interface EpochFlagReader extends FlagReader {
    epoch(ctx: FlagContext): EpochRead;
}

export function hasEpoch(reader: FlagReader): reader is EpochFlagReader {
    return typeof (reader as Partial<EpochFlagReader>).epoch === "function";
}

/** First four bytes of SHA-256(s), big-endian uint32, mod 100 — stable across runtimes. */
export function bucket(s: string): number {
    const digest = createHash("sha256").update(s, "utf8").digest();
    return digest.readUInt32BE(0) % 100;
}

function formatGroups(groups?: readonly string[]): string {
    if (!groups?.length) return "";
    const sorted = [...groups].sort();
    for (const name of sorted) {
        if (name.includes(",")) {
            console.warn(
                `[flags] skipping group name containing comma: ${name}`,
            );
        }
    }
    const safe = sorted.filter((name) => !name.includes(","));
    if (!safe.length) return "";
    return `,${safe.join(",")},`;
}

function resolveEnvName(env?: Record<string, string | undefined>): string {
    const source = env ?? process.env;
    const raw = source.RAILWAY_ENVIRONMENT_NAME;
    const trimmed = raw?.trim();
    return trimmed ? trimmed : "local";
}

function resolveHouseholdId(
    auth: AuthContext,
    member?: HouseholdMember | null,
    householdId?: string | null,
): string | undefined {
    if (member?.householdId) return member.householdId;
    if (householdId) return householdId;
    if (auth.kind === "household") return auth.householdId;
    return undefined;
}

export function buildFlagContext(
    input: {
        auth: AuthContext;
        member?: HouseholdMember | null;
        householdId?: string | null;
        groups?: readonly string[];
        client?: string;
    },
    env?: Record<string, string | undefined>,
): FlagContext {
    const key = rateLimitKey(input.auth);
    const household_id = resolveHouseholdId(
        input.auth,
        input.member,
        input.householdId,
    );
    const ctx: FlagContext = {
        key,
        env: resolveEnvName(env),
        groups: formatGroups(input.groups),
        cohort: bucket(key),
        app_version: VERSION,
    };
    if (household_id !== undefined) {
        ctx.household_id = household_id;
        ctx.household_cohort = bucket(household_id);
    }
    if (input.member?.role !== undefined) {
        ctx.role = input.member.role;
    }
    if (input.client !== undefined) {
        ctx.client = input.client;
    }
    return ctx;
}

export function buildBackgroundFlagContext(
    householdId: string,
    env?: Record<string, string | undefined>,
): FlagContext {
    return buildFlagContext(
        {
            auth: { kind: "household", householdId },
            householdId,
        },
        env,
    );
}

/** SDK context: flat attributes only; `client` is logs-only and never sent. */
export function sdkContext(
    ctx: FlagContext,
): Record<string, string | number | boolean> {
    const out: Record<string, string | number | boolean> = {
        key: ctx.key,
        env: ctx.env,
        groups: ctx.groups,
        cohort: ctx.cohort,
        app_version: ctx.app_version,
    };
    if (ctx.household_id !== undefined) out.household_id = ctx.household_id;
    if (ctx.household_cohort !== undefined) {
        out.household_cohort = ctx.household_cohort;
    }
    if (ctx.role !== undefined) out.role = ctx.role;
    return out;
}

export type FoodableFlagMode = "all" | "off" | "internal";

export function parseFoodableFlags(
    raw: string,
    registry: Record<string, FlagDef> = FLAGS,
): { rules: Map<string, FoodableFlagMode>; warnings: string[] } {
    const warnings: string[] = [];
    const rules = new Map<string, FoodableFlagMode>();
    const warnOnce = (msg: string) => {
        if (warnings.includes(msg)) return;
        warnings.push(msg);
        console.warn(msg);
    };

    const trimmed = raw.trim();
    if (!trimmed) return { rules, warnings };

    for (const item of trimmed.split(",")) {
        const piece = item.trim();
        if (!piece) continue;
        const colon = piece.indexOf(":");
        if (colon < 0) {
            warnOnce(
                `[flags] FOODABLE_FLAGS: ignoring malformed entry "${piece}"`,
            );
            continue;
        }
        const name = piece.slice(0, colon).trim();
        const modeRaw = piece
            .slice(colon + 1)
            .trim()
            .toLowerCase();
        if (!name) {
            warnOnce(
                `[flags] FOODABLE_FLAGS: ignoring malformed entry "${piece}"`,
            );
            continue;
        }
        if (!(name in registry)) {
            warnOnce(
                `[flags] FOODABLE_FLAGS: unknown flag "${name}", ignoring`,
            );
            continue;
        }
        if (modeRaw !== "all" && modeRaw !== "off" && modeRaw !== "internal") {
            warnOnce(
                `[flags] FOODABLE_FLAGS: unknown mode "${modeRaw}" for ${name}, ignoring`,
            );
            continue;
        }
        if (rules.has(name)) {
            warnOnce(`[flags] FOODABLE_FLAGS: duplicate "${name}", last wins`);
        }
        rules.set(name, modeRaw);
    }
    return { rules, warnings };
}

function evaluateInternal(
    def: FlagDef,
    ctx: FlagContext,
): { value: boolean; reason: string } {
    if (def.unit === "user") {
        const on = ctx.role === "owner";
        return { value: on, reason: "ENV_INTERNAL" };
    }
    const on = ctx.household_id !== undefined;
    return { value: on, reason: "ENV_INTERNAL" };
}

type FlagRegistry = Record<string, Pick<FlagDef, "parent" | "fallback">>;

export const UNRELIABLE_REASONS: ReadonlySet<string> = new Set([
    "STALE",
    "NOT_READY",
    "ERROR",
    "NOT_FOUND",
    "CONFLICT",
    "TYPE_MISMATCH",
    "NO_KEY",
]);

export function isReliable(
    evaluation: Pick<FlagEvaluation, "reason">,
): boolean {
    return !UNRELIABLE_REASONS.has(evaluation.reason);
}

export function evaluateWithParent(
    registry: FlagRegistry,
    readLeaf: (flag: FlagName, ctx: FlagContext) => FlagEvaluation,
    flag: FlagName,
    ctx: FlagContext,
    visited?: Set<string>,
): FlagEvaluation {
    const chain = visited ?? new Set<string>();
    if (chain.has(flag)) {
        // A cycle is a registry bug: answer off, never the fallback, so a
        // kill switch caught in one cannot read as an "on" parent.
        return { flag, value: false, reason: "ERROR", source: "fallback" };
    }
    chain.add(flag);

    const def = registry[flag as string] as FlagDef | undefined;
    if (def?.parent) {
        const parentResult = evaluateWithParent(
            registry,
            readLeaf,
            def.parent as FlagName,
            ctx,
            chain,
        );
        if (!isReliable(parentResult) || !parentResult.value) {
            if (!isReliable(parentResult)) {
                return {
                    flag,
                    value: false,
                    reason: parentResult.reason,
                    source: parentResult.source,
                };
            }
            return {
                flag,
                value: false,
                reason: "PARENT_OFF",
                source: parentResult.source,
            };
        }
    }
    return readLeaf(flag, ctx);
}

function wrapReader(
    registry: FlagRegistry,
    readLeaf: (flag: FlagName, ctx: FlagContext) => FlagEvaluation,
): FlagReader {
    const evaluateFn = (flag: FlagName, ctx: FlagContext): FlagEvaluation => {
        // STG-7: evaluation metrics counter attaches at this choke point.
        // STG-5: sticky pins and kill-switch last-known values wrap this
        // reader from outside (src/flag-pins.ts) and only persist when
        // isReliable(evaluation) — see UNRELIABLE_REASONS.
        return evaluateWithParent(registry, readLeaf, flag, ctx);
    };
    return {
        evaluate: evaluateFn,
        isEnabled(flag, ctx) {
            return evaluateFn(flag, ctx).value;
        },
    };
}

export function createFallbackFlags(
    registry: Record<string, FlagDef> = FLAGS,
): FlagReader {
    return wrapReader(registry, (flag, _ctx) => {
        const def = registry[flag as string];
        if (!def) throw new Error(`Unknown flag: ${flag}`);
        return {
            flag,
            value: def.fallback,
            reason: "DEFAULT",
            source: "fallback",
        };
    });
}

export function createEnvFlags(
    rules: Map<string, FoodableFlagMode>,
    registry: Record<string, FlagDef> = FLAGS,
): FlagReader {
    return wrapReader(registry, (flag, ctx) => {
        const def = registry[flag as string];
        if (!def) throw new Error(`Unknown flag: ${flag}`);
        const mode = rules.get(flag);
        if (mode === "all") {
            return { flag, value: true, reason: "ENV_ALL", source: "env" };
        }
        if (mode === "off") {
            return { flag, value: false, reason: "ENV_OFF", source: "env" };
        }
        if (mode === "internal") {
            const { value, reason } = evaluateInternal(def, ctx);
            return { flag, value, reason, source: "env" };
        }
        return {
            flag,
            value: def.fallback,
            reason: "DEFAULT",
            source: "env",
        };
    });
}

export type RailwayFlagsSdk = Pick<
    typeof railwayFlags,
    "init" | "evaluateBoolean" | "evaluateNumber"
> & {
    synced: boolean;
};

// Pins store the epoch in a Postgres integer.
const MAX_EPOCH = 2_147_483_647;

export function createRailwayFlags(
    sdk: RailwayFlagsSdk,
    registry: Record<string, FlagDef> = FLAGS,
): EpochFlagReader & { markInitDone: () => void } {
    let initDone = false;
    let warnedBadEpoch = false;
    return {
        markInitDone() {
            initDone = true;
        },
        epoch(ctx) {
            const unknown: EpochRead = { value: 0, reliable: false };
            if (!initDone) return unknown;
            try {
                const result = sdk.evaluateNumber(
                    FLAGS_EPOCH,
                    sdkContext(ctx),
                    0,
                );
                // The flag does not exist in Railway yet: epoch 0, known.
                if (result.reason === "NOT_FOUND") {
                    return { value: 0, reliable: true };
                }
                if (UNRELIABLE_REASONS.has(result.reason)) return unknown;
                const v = result.value;
                if (!Number.isInteger(v) || v < 0 || v > MAX_EPOCH) {
                    if (!warnedBadEpoch) {
                        warnedBadEpoch = true;
                        console.warn(
                            `[flags] ${FLAGS_EPOCH} must be an integer from 0 to ${MAX_EPOCH}, got ${String(v)}; pins keep serving`,
                        );
                    }
                    return unknown;
                }
                return { value: v, reliable: true };
            } catch {
                return unknown;
            }
        },
        ...wrapReader(registry, (flag, ctx) => {
            const def = registry[flag as string];
            if (!def) throw new Error(`Unknown flag: ${flag}`);
            if (!initDone) {
                return {
                    flag,
                    value: def.fallback,
                    reason: "NOT_READY",
                    source: "railway",
                };
            }
            try {
                const result = sdk.evaluateBoolean(
                    flag,
                    sdkContext(ctx),
                    def.fallback,
                );
                return {
                    flag,
                    value: result.value,
                    reason: result.reason,
                    source: "railway",
                };
            } catch {
                return {
                    flag,
                    value: def.fallback,
                    reason: "ERROR",
                    source: "railway",
                };
            }
        }),
    };
}

export function createMemoryFlags(
    values: Partial<
        Record<string, boolean | ((ctx: FlagContext) => boolean)>
    > = {},
    opts?: { registry?: Record<string, FlagDef> },
): FlagReader {
    const registry: Record<string, FlagDef> =
        opts?.registry ?? (FLAGS as Record<string, FlagDef>);
    return wrapReader(registry, (flag, ctx) => {
        const def = registry[flag as string];
        if (!def) throw new Error(`Unknown flag: ${flag}`);
        const entry = values[flag];
        let value: boolean;
        if (entry === undefined) {
            value = def.fallback;
        } else if (typeof entry === "function") {
            value = entry(ctx);
        } else {
            value = entry;
        }
        return {
            flag: flag as FlagName,
            value,
            reason: "MEMORY",
            source: "memory",
        };
    });
}

/** Every flag forced on — for STG-8 "all on" renders. */
export function allFlagsOn(
    registry: Record<string, FlagDef> = FLAGS,
): Partial<Record<FlagName, boolean>> {
    return Object.fromEntries(
        Object.keys(registry).map((name) => [name, true]),
    ) as Partial<Record<FlagName, boolean>>;
}

/** Every flag forced off — for STG-8 "all off" renders (kill switches included). */
export function allFlagsOff(
    registry: Record<string, FlagDef> = FLAGS,
): Partial<Record<FlagName, boolean>> {
    return Object.fromEntries(
        Object.keys(registry).map((name) => [name, false]),
    ) as Partial<Record<FlagName, boolean>>;
}

/** Registry fallbacks only — today's app without Railway or overrides. */
export function defaultFlags(
    registry: Record<string, FlagDef> = FLAGS,
): Partial<Record<FlagName, boolean>> {
    return Object.fromEntries(
        Object.entries(registry).map(([name, def]) => [name, def.fallback]),
    ) as Partial<Record<FlagName, boolean>>;
}

function railwayToken(
    env: Record<string, string | undefined>,
): string | undefined {
    const t = env.RAILWAY_TOKEN?.trim();
    return t ? t : undefined;
}

export function flagsBootLine(args: {
    source: FlagSource;
    synced?: boolean;
    foodableFlags?: string;
}): string {
    if (args.source === "railway") {
        return `[flags] source=railway synced=${args.synced === true}`;
    }
    if (args.source === "env") {
        return `[flags] source=env FOODABLE_FLAGS=${args.foodableFlags ?? ""}`;
    }
    return "[flags] source=fallback (no RAILWAY_TOKEN): temporary flags off, kill switches on";
}

let activeReader: FlagReader | null = null;
let initCompleted = false;
let initInFlight: Promise<FlagReader> | null = null;
let testReaderOverride: FlagReader | null = null;
// Bumped by resetFlagsForTests so an init still running from before a reset
// cannot publish its reader (or mark it ready) over the newer state.
let initGeneration = 0;

function stripTokenFromMessage(message: string, token?: string): string {
    let out = message;
    // Short tokens are not real project tokens; redacting them would mangle
    // ordinary words in the message ("bad" in "bad token").
    if (token && token.length >= 8) {
        out = out.split(token).join("[redacted]");
    }
    return out.replace(/\bproj\.[A-Za-z0-9._-]+\b/g, "[redacted]");
}

export function resetFlagsForTests(): void {
    activeReader = null;
    initCompleted = false;
    initInFlight = null;
    testReaderOverride = null;
    initGeneration += 1;
}

export function setFlagsForTests(reader: FlagReader | null): void {
    testReaderOverride = reader;
}

export function getFlags(): FlagReader {
    if (testReaderOverride) return testReaderOverride;
    if (activeReader) return activeReader;
    return createFallbackFlags();
}

export function isEnabled(flag: FlagName, ctx: FlagContext): boolean {
    return getFlags().isEnabled(flag, ctx);
}

export async function initFlags(opts?: {
    timeoutMs?: number;
    env?: Record<string, string | undefined>;
    sdk?: RailwayFlagsSdk;
}): Promise<FlagReader> {
    if (initCompleted && activeReader) return activeReader;
    if (initInFlight) return initInFlight;

    const generation = initGeneration;
    const current = () => generation === initGeneration;
    const publish = (reader: FlagReader): FlagReader => {
        if (current()) {
            activeReader = reader;
            initCompleted = true;
        }
        return reader;
    };

    const inFlight = (async () => {
        const env = opts?.env ?? process.env;
        const timeoutMs = opts?.timeoutMs ?? 2000;
        const token = railwayToken(env);
        const foodableRaw = env.FOODABLE_FLAGS?.trim();

        if (token) {
            if (foodableRaw) {
                console.warn(
                    "[flags] FOODABLE_FLAGS is set but ignored while RAILWAY_TOKEN is present",
                );
            }
            const sdk = opts?.sdk ?? railwayFlags;
            const reader = createRailwayFlags(sdk);
            let synced = false;
            const initOptions = {
                token,
                authType: "project-token" as const,
                timeoutMs,
            };
            // A synchronous throw takes the same path as a rejection: boot
            // must never fail because of flags.
            let initPromise: Promise<void>;
            try {
                initPromise = sdk.init(initOptions);
            } catch (err) {
                initPromise = Promise.reject(err);
            }
            const deadlineMs = timeoutMs + 500;

            initPromise
                .then(() => {
                    if (current()) reader.markInitDone();
                })
                .catch((err: unknown) => {
                    const msg = stripTokenFromMessage(
                        err instanceof Error ? err.message : String(err),
                        token,
                    );
                    console.error(`[flags] init failed: ${msg}`);
                });

            let timer: ReturnType<typeof setTimeout> | undefined;
            const raced = await Promise.race([
                initPromise.then(
                    () => "ok" as const,
                    () => "rejected" as const,
                ),
                new Promise<"timeout">((resolve) => {
                    timer = setTimeout(() => resolve("timeout"), deadlineMs);
                    timer.unref?.();
                }),
            ]);
            if (timer !== undefined) clearTimeout(timer);

            if (raced === "ok") {
                synced = sdk.synced;
                if (current()) reader.markInitDone();
            } else if (raced === "timeout") {
                console.error("[flags] flags init timed out");
            }

            console.log(flagsBootLine({ source: "railway", synced }));
            return publish(reader);
        }

        if (foodableRaw) {
            const { rules } = parseFoodableFlags(foodableRaw);
            const reader = createEnvFlags(rules);
            console.log(
                flagsBootLine({ source: "env", foodableFlags: foodableRaw }),
            );
            return publish(reader);
        }

        const reader = createFallbackFlags();
        console.log(flagsBootLine({ source: "fallback" }));
        return publish(reader);
    })();
    initInFlight = inFlight;

    try {
        return await inFlight;
    } finally {
        if (initInFlight === inFlight) initInFlight = null;
    }
}
