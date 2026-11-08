import {
    FLAGS,
    buildFlagContext,
    createMemoryFlags,
    defaultFlags,
    getFlags,
    hasEpoch,
    type FlagContext,
    type FlagName,
    type FlagReader,
} from "./flags.js";
import type { AuthContext } from "./auth-context.js";
import { getFlagPins, type FlagPinRuntime } from "./flag-pins.js";

type CapitalizeFirst<S extends string> = S extends `${infer C}${infer Rest}`
    ? `${Uppercase<C>}${Rest}`
    : S;

type CamelCaseRest<S extends string> = S extends `${infer Head}-${infer Tail}`
    ? `${CapitalizeFirst<Head>}${CamelCaseRest<Tail>}`
    : CapitalizeFirst<S>;

export type ViewerFlags = {
    [
        K in FlagName as K extends `${infer Head}-${infer Tail}`
            ? `${Head}${CamelCaseRest<Tail>}`
            : K
    ]: boolean;
};

const FLAG_NAMES = Object.keys(FLAGS) as FlagName[];

export function flagKey<N extends FlagName>(
    name: N,
): keyof ViewerFlags & string {
    return nameToCamel(name) as keyof ViewerFlags & string;
}

function nameToCamel(name: string): string {
    const parts = name.split("-");
    const [head, ...rest] = parts;
    return (
        head + rest.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("")
    );
}

export function evaluateViewerFlags(
    ctx: FlagContext,
    reader: FlagReader = getFlags(),
): ViewerFlags {
    const out = {} as Record<string, boolean>;
    for (const name of FLAG_NAMES) {
        out[flagKey(name)] = reader.isEnabled(name, ctx);
    }
    return out as ViewerFlags;
}

/**
 * The async twin of evaluateViewerFlags: applies sticky pins to temporary flags
 * and last-known values to kill switches (STG-5). Only the Railway reader pins;
 * any other reader is answered by evaluateViewerFlags with no query.
 */
export async function loadViewerFlags(
    ctx: FlagContext,
    reader: FlagReader = getFlags(),
    runtime: FlagPinRuntime | null = null,
): Promise<ViewerFlags> {
    if (!hasEpoch(reader)) return evaluateViewerFlags(ctx, reader);
    const evaluations = await (runtime ?? getFlagPins()).evaluateAll(
        ctx,
        reader,
        FLAG_NAMES,
    );
    const out = {} as Record<string, boolean>;
    FLAG_NAMES.forEach((name, i) => {
        out[flagKey(name)] = evaluations[i]!.value;
    });
    return out as ViewerFlags;
}

export function isViewerFlagOn(flags: ViewerFlags, name: FlagName): boolean {
    return flags[flagKey(name) as keyof ViewerFlags];
}

/** Registry fallbacks for fixtures and direct registerTools callers. */
export function defaultViewerFlags(
    auth: AuthContext = { kind: "user", userId: "default" },
): ViewerFlags {
    const ctx = buildFlagContext({ auth });
    return evaluateViewerFlags(ctx, createMemoryFlags(defaultFlags()));
}
