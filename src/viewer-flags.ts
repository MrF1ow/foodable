import {
    FLAGS,
    buildFlagContext,
    createMemoryFlags,
    defaultFlags,
    getFlags,
    type FlagContext,
    type FlagName,
    type FlagReader,
} from "./flags.js";
import type { AuthContext } from "./auth-context.js";

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
