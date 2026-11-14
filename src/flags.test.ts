import { test, expect, describe, afterEach } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
    FLAGS,
    type FlagName,
    type FlagContext,
    type FlagEvaluation,
    bucket,
    buildFlagContext,
    buildBackgroundFlagContext,
    sdkContext,
    parseFoodableFlags,
    createFallbackFlags,
    createEnvFlags,
    createRailwayFlags,
    createMemoryFlags,
    allFlagsOn,
    allFlagsOff,
    defaultFlags,
    initFlags,
    getFlags,
    resetFlagsForTests,
    setFlagsForTests,
    evaluateWithParent,
    isReliable,
    UNRELIABLE_REASONS,
    type RailwayFlagsSdk,
} from "./flags.js";
import { VERSION } from "./version.js";

const TEST_REGISTRY = {
    parent: {
        type: "bool" as const,
        kind: "temporary" as const,
        unit: "user" as const,
        fallback: false,
        why: "test",
        removeWhen: "test",
    },
    child: {
        type: "bool" as const,
        kind: "temporary" as const,
        unit: "user" as const,
        parent: "parent",
        fallback: false,
        why: "test",
        removeWhen: "test",
    },
} as const;

function userCtx(
    role: "owner" | "admin" | "member",
    overrides: Partial<FlagContext> = {},
): FlagContext {
    return {
        key: "user-1",
        env: "local",
        groups: "",
        role,
        cohort: 0,
        household_id: "hh-1",
        household_cohort: 0,
        app_version: VERSION,
        ...overrides,
    };
}

function fakeSdk(impl: Partial<RailwayFlagsSdk> = {}): RailwayFlagsSdk {
    return {
        synced: false,
        init: async () => {},
        evaluateBoolean: () => ({
            value: false,
            reason: "NO_MATCH",
            trace: [],
        }),
        evaluateNumber: () => ({
            value: 0,
            reason: "NO_MATCH",
            trace: [],
        }),
        ...impl,
    } as RailwayFlagsSdk;
}

afterEach(() => {
    resetFlagsForTests();
});

describe("FLAGS registry invariants", () => {
    test("temporary flags fall back off; kill switches fall back on", () => {
        for (const [name, def] of Object.entries(FLAGS)) {
            if (def.kind === "temporary") {
                expect(def.fallback).toBe(false);
            } else {
                expect(def.fallback).toBe(true);
                expect((def as { parent?: string }).parent).toBeUndefined();
            }
            expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        }
    });

    test("no parent cycles", () => {
        for (const name of Object.keys(FLAGS)) {
            const seen = new Set<string>();
            let cur: string | undefined = name;
            while (cur) {
                expect(seen.has(cur)).toBe(false);
                seen.add(cur);
                const def = FLAGS[cur as FlagName] as {
                    parent?: string;
                    kind: string;
                };
                cur = def.parent;
                if (cur) {
                    expect(
                        (FLAGS[cur as FlagName] as { kind: string }).kind,
                    ).toBe("temporary");
                }
            }
        }
    });
});

// Static `from`, bare side-effect imports, and any import()/require() whose
// first argument is the module (comments and a second argument allowed).
// Whitespace is optional everywhere Bun accepts it to be absent.
const RAILWAY_SPEC = String.raw`["'\`]railway(?:\/[^"'\`]*)?["'\`]`;
const RAILWAY_IMPORT_RE = new RegExp(
    [
        String.raw`\bfrom\s*` + RAILWAY_SPEC,
        String.raw`\bimport\s*` + RAILWAY_SPEC,
        String.raw`\b(?:import|require)\s*\((?:\s|\/\*[\s\S]*?\*\/)*` +
            RAILWAY_SPEC,
    ].join("|"),
);

test("only src/flags.ts imports railway", async () => {
    const paths: string[] = [];
    for (const pattern of ["src/**/*.ts", "src/**/*.js", "scripts/**/*.ts"]) {
        const glob = new Bun.Glob(pattern);
        for await (const path of glob.scan(".")) {
            paths.push(path);
        }
    }
    let visitedFlagsTs = false;
    let flagsTsMatches = false;
    const offenders: string[] = [];
    for (const path of paths) {
        if (path === "src/flags.test.ts") continue;
        const text = await Bun.file(path).text();
        const matches = RAILWAY_IMPORT_RE.test(text);
        if (path === "src/flags.ts") {
            visitedFlagsTs = true;
            flagsTsMatches = matches;
            continue;
        }
        if (matches) offenders.push(path);
    }
    expect(visitedFlagsTs).toBe(true);
    expect(flagsTsMatches).toBe(true);
    expect(offenders).toEqual([]);
});

test("pinned bucket vectors", () => {
    expect(bucket("user-test-1")).toBe(62);
    expect(bucket("hh:household-abc")).toBe(18);
});

test("buildFlagContext for user members and household auth", () => {
    const owner = buildFlagContext({
        auth: { kind: "user", userId: "u-owner" },
        member: {
            householdId: "hh-a",
            userId: "u-owner",
            role: "owner",
            displayName: "O",
        },
        client: "web",
    });
    expect(owner.key).toBe("u-owner");
    expect(owner.role).toBe("owner");
    expect(owner.household_id).toBe("hh-a");
    expect(owner.household_cohort).toBe(bucket("hh-a"));
    expect(owner.client).toBe("web");
    expect(owner.app_version).toBe(VERSION);
    expect(owner.cohort).toBeGreaterThanOrEqual(0);
    expect(owner.cohort).toBeLessThan(100);

    const admin = buildFlagContext({
        auth: { kind: "user", userId: "u-admin" },
        member: {
            householdId: "hh-a",
            userId: "u-admin",
            role: "admin",
            displayName: "A",
        },
    });
    expect(admin.role).toBe("admin");

    const member = buildFlagContext({
        auth: { kind: "user", userId: "u-mem" },
        member: {
            householdId: "hh-a",
            userId: "u-mem",
            role: "member",
            displayName: "M",
        },
    });
    expect(member.role).toBe("member");

    const hh = buildFlagContext({
        auth: { kind: "household", householdId: "hh-token" },
    });
    expect(hh.key).toBe("hh:hh-token");
    expect(hh.role).toBeUndefined();
    expect(hh.household_id).toBe("hh-token");
});

test("buildBackgroundFlagContext matches household token", () => {
    const bg = buildBackgroundFlagContext("job-hh");
    const hh = buildFlagContext({
        auth: { kind: "household", householdId: "job-hh" },
    });
    expect(bg.key).toBe(hh.key);
    expect(bg.household_id).toBe("job-hh");
});

test("env attribute from RAILWAY_ENVIRONMENT_NAME", () => {
    const local = buildFlagContext({ auth: { kind: "user", userId: "u" } }, {});
    expect(local.env).toBe("local");

    const staging = buildFlagContext(
        { auth: { kind: "user", userId: "u" } },
        { RAILWAY_ENVIRONMENT_NAME: " staging " },
    );
    expect(staging.env).toBe("staging");
});

test("injected empty env map ignores process.env RAILWAY_ENVIRONMENT_NAME", () => {
    const prev = process.env.RAILWAY_ENVIRONMENT_NAME;
    process.env.RAILWAY_ENVIRONMENT_NAME = "production";
    try {
        const ctx = buildFlagContext(
            { auth: { kind: "user", userId: "u" } },
            {},
        );
        expect(ctx.env).toBe("local");
    } finally {
        if (prev === undefined) delete process.env.RAILWAY_ENVIRONMENT_NAME;
        else process.env.RAILWAY_ENVIRONMENT_NAME = prev;
    }
});

test("groups formatting", () => {
    const empty = buildFlagContext({ auth: { kind: "user", userId: "u" } });
    expect(empty.groups).toBe("");

    const one = buildFlagContext({
        auth: { kind: "user", userId: "u" },
        groups: ["beta"],
    });
    expect(one.groups).toBe(",beta,");

    const two = buildFlagContext({
        auth: { kind: "user", userId: "u" },
        groups: ["internal", "beta"],
    });
    expect(two.groups).toBe(",beta,internal,");
});

test("sdkContext omits client", () => {
    const ctx = buildFlagContext({
        auth: { kind: "user", userId: "u" },
        client: "mcp-inspector",
    });
    expect(ctx.client).toBe("mcp-inspector");
    expect(sdkContext(ctx).client).toBeUndefined();
});

describe("parseFoodableFlags", () => {
    test("modes and whitespace", () => {
        const { rules } = parseFoodableFlags(
            " mcp-share-links:internal ,  off-lookups:off  ",
        );
        expect(rules.get("mcp-share-links")).toBe("internal");
        expect(rules.get("off-lookups")).toBe("off");
    });

    test("unknown name and mode", () => {
        const { warnings } = parseFoodableFlags("usuals-tab:all,no-such:bogus");
        expect(warnings.length).toBeGreaterThanOrEqual(2);
        const { rules } = parseFoodableFlags("usuals-tab:all");
        expect(rules.size).toBe(0);
    });

    test("unknown mode on known flag warns once", () => {
        const warn = console.warn;
        const lines: string[] = [];
        console.warn = (msg: string) => lines.push(String(msg));
        try {
            parseFoodableFlags(
                "mcp-share-links:sideways,mcp-share-links:sideways",
            );
        } finally {
            console.warn = warn;
        }
        const modeWarnings = lines.filter((l) => l.includes("sideways"));
        expect(modeWarnings.length).toBe(1);
        expect(parseFoodableFlags("mcp-share-links:sideways").rules.size).toBe(
            0,
        );
    });

    test("empty flag name is malformed", () => {
        const { warnings } = parseFoodableFlags(":all,:off");
        expect(warnings.length).toBeGreaterThanOrEqual(2);
        expect(parseFoodableFlags(":all,:off").rules.size).toBe(0);
    });

    test("duplicate last wins", () => {
        const { warnings } = parseFoodableFlags(
            "mcp-share-links:off,mcp-share-links:all",
        );
        expect(warnings.some((w) => w.includes("duplicate"))).toBe(true);
        const { rules } = parseFoodableFlags(
            "mcp-share-links:off,mcp-share-links:all",
        );
        expect(rules.get("mcp-share-links")).toBe("all");
    });

    test("empty string", () => {
        const { rules } = parseFoodableFlags("");
        expect(rules.size).toBe(0);
    });
});

test("env reader internal vs all vs default", () => {
    const rules = parseFoodableFlags(
        "mcp-share-links:internal,off-lookups:off",
    ).rules;
    const reader = createEnvFlags(rules);

    expect(reader.isEnabled("mcp-share-links", userCtx("owner"))).toBe(true);
    expect(reader.isEnabled("mcp-share-links", userCtx("member"))).toBe(false);
    expect(reader.evaluate("mcp-share-links", userCtx("owner")).reason).toBe(
        "ENV_INTERNAL",
    );

    const hh = buildFlagContext({
        auth: { kind: "household", householdId: "hh-1" },
    });
    expect(reader.isEnabled("mcp-share-links", hh)).toBe(false);

    const hhRules = parseFoodableFlags("restock-runner:internal").rules;
    const hhReader = createEnvFlags(hhRules);
    expect(hhReader.isEnabled("restock-runner", hh)).toBe(true);

    expect(reader.isEnabled("off-lookups", hh)).toBe(false);
    expect(reader.evaluate("off-lookups", hh).reason).toBe("ENV_OFF");

    expect(reader.evaluate("restock-runner", hh).reason).toBe("DEFAULT");
    expect(reader.isEnabled("restock-runner", hh)).toBe(true);
});

test("kill switch via env off", () => {
    const reader = createEnvFlags(parseFoodableFlags("off-lookups:off").rules);
    expect(
        reader.isEnabled("off-lookups", buildBackgroundFlagContext("hh-1")),
    ).toBe(false);
});

test("parent flag blocks child", () => {
    const reader = createMemoryFlags(
        { parent: false, child: true },
        { registry: { ...TEST_REGISTRY } },
    );
    const ctx = userCtx("owner");
    const childEval = reader.evaluate("child" as FlagName, ctx);
    expect(childEval.value).toBe(false);
    expect(childEval.reason).toBe("PARENT_OFF");
});

test("evaluateWithParent test registry", () => {
    const reader = createMemoryFlags(
        { parent: true, child: true },
        { registry: { ...TEST_REGISTRY } },
    );
    expect(reader.evaluate("child" as FlagName, userCtx("owner")).value).toBe(
        true,
    );
});

test("evaluateWithParent unreliable parent reasons", () => {
    const ctx = userCtx("owner");
    const reg = { ...TEST_REGISTRY };
    const readLeaf = (flag: FlagName, _ctx: FlagContext): FlagEvaluation => {
        if ((flag as string) === "parent") {
            return {
                flag,
                value: false,
                reason: "STALE",
                source: "railway",
            };
        }
        return {
            flag,
            value: true,
            reason: "MEMORY",
            source: "memory",
        };
    };
    expect(
        evaluateWithParent(reg, readLeaf, "child" as FlagName, ctx).reason,
    ).toBe("STALE");

    const readConflict = (flag: FlagName, _ctx: FlagContext) =>
        (flag as string) === "parent"
            ? {
                  flag,
                  value: false,
                  reason: "CONFLICT",
                  source: "railway" as const,
              }
            : {
                  flag,
                  value: true,
                  reason: "MEMORY",
                  source: "memory" as const,
              };
    expect(
        evaluateWithParent(reg, readConflict, "child" as FlagName, ctx).reason,
    ).toBe("CONFLICT");

    const readOff = (flag: FlagName, _ctx: FlagContext) =>
        (flag as string) === "parent"
            ? {
                  flag,
                  value: false,
                  reason: "NO_MATCH",
                  source: "railway" as const,
              }
            : {
                  flag,
                  value: true,
                  reason: "MEMORY",
                  source: "memory" as const,
              };
    expect(
        evaluateWithParent(reg, readOff, "child" as FlagName, ctx).reason,
    ).toBe("PARENT_OFF");
});

test("evaluateWithParent detects registry cycles at runtime", () => {
    const cyclic = {
        a: {
            type: "bool" as const,
            kind: "temporary" as const,
            unit: "user" as const,
            parent: "b",
            fallback: false,
            why: "test",
            removeWhen: "test",
        },
        b: {
            type: "bool" as const,
            kind: "temporary" as const,
            unit: "user" as const,
            parent: "a",
            fallback: false,
            why: "test",
            removeWhen: "test",
        },
    };
    const reader = createMemoryFlags(
        { a: true, b: true },
        { registry: cyclic },
    );
    const evalA = reader.evaluate("a" as FlagName, userCtx("owner"));
    expect(evalA.reason).toBe("ERROR");
    expect(evalA.value).toBe(false);
});

test("isReliable and UNRELIABLE_REASONS", () => {
    expect(UNRELIABLE_REASONS.has("STALE")).toBe(true);
    expect(isReliable({ reason: "NO_MATCH" })).toBe(true);
    expect(isReliable({ reason: "STALE" })).toBe(false);
});

describe("Railway reader fake SDK", () => {
    test("NOT_READY before init", () => {
        const sdk = fakeSdk({});
        const reader = createRailwayFlags(sdk);
        const ctx = userCtx("owner");
        expect(reader.evaluate("off-lookups", ctx).reason).toBe("NOT_READY");
        expect(reader.evaluate("off-lookups", ctx).value).toBe(true);
    });

    test("preserves SDK reasons", () => {
        const sdk = fakeSdk({
            evaluateBoolean: (_n, _c, fb) => ({
                value: fb ?? false,
                reason: "STALE",
                trace: [],
            }),
        });
        const reader = createRailwayFlags(sdk);
        reader.markInitDone();
        expect(
            reader.evaluate("mcp-share-links", userCtx("owner")).reason,
        ).toBe("STALE");

        const sdk2 = fakeSdk({
            evaluateBoolean: () => ({
                value: false,
                reason: "CONFLICT",
                trace: [],
            }),
        });
        const r2 = createRailwayFlags(sdk2);
        r2.markInitDone();
        expect(r2.evaluate("mcp-share-links", userCtx("owner")).reason).toBe(
            "CONFLICT",
        );

        const sdk3 = fakeSdk({
            evaluateBoolean: () => ({
                value: true,
                reason: "TARGETING_MATCH",
                trace: [],
            }),
        });
        const r3 = createRailwayFlags(sdk3);
        r3.markInitDone();
        expect(r3.evaluate("mcp-share-links", userCtx("owner")).reason).toBe(
            "TARGETING_MATCH",
        );
    });

    test("ERROR when evaluateBoolean throws", () => {
        const sdk = fakeSdk({
            evaluateBoolean: () => {
                throw new Error("boom");
            },
        });
        const reader = createRailwayFlags(sdk);
        reader.markInitDone();
        expect(
            reader.evaluate("mcp-share-links", userCtx("owner")),
        ).toMatchObject({
            value: false,
            reason: "ERROR",
            source: "railway",
        });
    });

    test("init receives token explicitly", async () => {
        let captured: unknown;
        const sdk = fakeSdk({
            init: async (opts) => {
                captured = opts;
            },
            synced: true,
        });
        await initFlags({
            env: {
                RAILWAY_TOKEN: "proj.tok",
                FOODABLE_FLAGS: "mcp-share-links:all",
            },
            sdk,
            timeoutMs: 100,
        });
        expect(captured).toEqual({
            token: "proj.tok",
            authType: "project-token",
            timeoutMs: 100,
        });
    });

    test("init throw does not propagate", async () => {
        const sdk = fakeSdk({
            init: async () => {
                throw new Error("bad token");
            },
        });
        await expect(
            initFlags({
                env: { RAILWAY_TOKEN: "bad" },
                sdk,
                timeoutMs: 50,
            }),
        ).resolves.toBeDefined();
    });

    test("rejected init logs without token and leaves NOT_READY", async () => {
        const secret = "proj.super-secret-token-value";
        let evalCalls = 0;
        const errSpy = console.error;
        const logs: string[] = [];
        console.error = (msg: string) => logs.push(String(msg));
        const sdk = fakeSdk({
            init: async () => {
                throw new Error(`auth failed for ${secret}`);
            },
            evaluateBoolean: () => {
                evalCalls++;
                return { value: true, reason: "TARGETING_MATCH", trace: [] };
            },
        });
        try {
            await initFlags({
                env: { RAILWAY_TOKEN: secret },
                sdk,
                timeoutMs: 50,
            });
            const ctx = userCtx("owner");
            expect(getFlags().evaluate("mcp-share-links", ctx).reason).toBe(
                "NOT_READY",
            );
            expect(evalCalls).toBe(0);
            const line = logs.find((l) => l.includes("init failed"));
            expect(line).toBeDefined();
            expect(line).not.toContain(secret);
        } finally {
            console.error = errSpy;
        }
    });

    test("init never settling times out and flips after late sync", async () => {
        let resolveInit: (() => void) | undefined;
        const initPromise = new Promise<void>((resolve) => {
            resolveInit = resolve;
        });
        const sdk = fakeSdk({
            init: () => initPromise,
            synced: true,
            evaluateBoolean: () => ({
                value: true,
                reason: "TARGETING_MATCH",
                trace: [],
            }),
        });
        const t0 = Date.now();
        await initFlags({
            env: { RAILWAY_TOKEN: "tok" },
            sdk,
            timeoutMs: 20,
        });
        expect(Date.now() - t0).toBeLessThan(1000);
        const ctx = userCtx("owner");
        expect(getFlags().evaluate("mcp-share-links", ctx).reason).toBe(
            "NOT_READY",
        );
        resolveInit?.();
        await initPromise;
        await new Promise((r) => setTimeout(r, 0));
        expect(getFlags().evaluate("mcp-share-links", ctx).reason).toBe(
            "TARGETING_MATCH",
        );
    });
});

describe("initFlags source selection", () => {
    test("token wins over FOODABLE_FLAGS", async () => {
        let initCalls = 0;
        const sdk = fakeSdk({
            init: async () => {
                initCalls++;
            },
            synced: true,
        });
        await initFlags({
            env: {
                RAILWAY_TOKEN: "tok",
                FOODABLE_FLAGS: "mcp-share-links:all",
                RAILWAY_API_TOKEN: "api-should-not-matter",
            },
            sdk,
        });
        expect(initCalls).toBe(1);
        expect(
            getFlags().evaluate("mcp-share-links", userCtx("member")).source,
        ).toBe("railway");
    });

    test("FOODABLE_FLAGS without token", async () => {
        let initCalls = 0;
        const sdk: RailwayFlagsSdk = {
            synced: false,
            init: async () => {
                initCalls++;
            },
            evaluateBoolean: () => ({
                value: false,
                reason: "NO_MATCH",
                trace: [],
            }),
            evaluateNumber: () => ({
                value: 0,
                reason: "NO_MATCH",
                trace: [],
            }),
        };
        await initFlags({
            env: {
                FOODABLE_FLAGS: "mcp-share-links:all",
                RAILWAY_API_TOKEN: "ignored",
            },
            sdk,
        });
        expect(initCalls).toBe(0);
        expect(getFlags().isEnabled("mcp-share-links", userCtx("member"))).toBe(
            true,
        );
        expect(
            getFlags().evaluate("mcp-share-links", userCtx("member")).source,
        ).toBe("env");
    });

    test("a retired flag in FOODABLE_FLAGS warns once and boots", async () => {
        const warn = console.warn;
        const lines: string[] = [];
        console.warn = (msg: string) => lines.push(String(msg));
        try {
            await initFlags({
                env: { FOODABLE_FLAGS: "ui-v2:all,mcp-share-links:all" },
            });
        } finally {
            console.warn = warn;
        }
        expect(
            lines.filter((l) => l.includes('unknown flag "ui-v2"')),
        ).toHaveLength(1);
        expect(getFlags().isEnabled("mcp-share-links", userCtx("member"))).toBe(
            true,
        );
    });

    test("fallback when nothing set", async () => {
        let initCalls = 0;
        const sdk = fakeSdk({
            init: async () => {
                initCalls++;
            },
        });
        await initFlags({ env: {}, sdk });
        expect(initCalls).toBe(0);
        expect(getFlags().isEnabled("mcp-share-links", userCtx("owner"))).toBe(
            false,
        );
        expect(getFlags().isEnabled("off-lookups", userCtx("owner"))).toBe(
            true,
        );
        expect(
            getFlags().evaluate("mcp-share-links", userCtx("owner")).source,
        ).toBe("fallback");
    });

    test("idempotent second call", async () => {
        const first = await initFlags({ env: {} });
        const second = await initFlags({ env: { RAILWAY_TOKEN: "x" } });
        expect(second).toBe(first);
    });

    test("concurrent calls share one init", async () => {
        let initCalls = 0;
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const sdk = fakeSdk({
            init: async () => {
                initCalls++;
                await gate;
            },
            synced: true,
        });
        const a = initFlags({
            env: { RAILWAY_TOKEN: "tok" },
            sdk,
            timeoutMs: 5000,
        });
        const b = initFlags({
            env: { RAILWAY_TOKEN: "tok" },
            sdk,
            timeoutMs: 5000,
        });
        release();
        const [ra, rb] = await Promise.all([a, b]);
        expect(initCalls).toBe(1);
        expect(rb).toBe(ra);
    });
});

test("getFlags before init uses fallback", () => {
    resetFlagsForTests();
    const reader = getFlags();
    expect(reader.evaluate("restock-runner", userCtx("owner")).source).toBe(
        "fallback",
    );
});

test("setFlagsForTests override", () => {
    const mem = createMemoryFlags({ "mcp-share-links": true });
    setFlagsForTests(mem);
    expect(getFlags().isEnabled("mcp-share-links", userCtx("owner"))).toBe(
        true,
    );
    setFlagsForTests(null);
});

test("createFallbackFlags", () => {
    const reader = createFallbackFlags();
    expect(reader.isEnabled("mcp-share-links", userCtx("owner"))).toBe(false);
    expect(reader.isEnabled("off-lookups", userCtx("owner"))).toBe(true);
    expect(reader.evaluate("mcp-share-links", userCtx("owner")).reason).toBe(
        "DEFAULT",
    );
});

test("memory flags and all-on / all-off helpers", () => {
    const on = createMemoryFlags(allFlagsOn());
    expect(on.isEnabled("mcp-share-links", userCtx("member"))).toBe(true);
    expect(on.isEnabled("off-lookups", userCtx("member"))).toBe(true);

    const off = createMemoryFlags(allFlagsOff());
    expect(off.isEnabled("mcp-share-links", userCtx("member"))).toBe(false);
    expect(off.isEnabled("off-lookups", userCtx("member"))).toBe(false);

    const defaults = defaultFlags();
    expect(defaults["mcp-share-links"]).toBe(false);
    expect(defaults["off-lookups"]).toBe(true);

    const dynamic = createMemoryFlags({
        "mcp-share-links": (ctx) => ctx.role === "owner",
    });
    expect(dynamic.isEnabled("mcp-share-links", userCtx("owner"))).toBe(true);
    expect(dynamic.isEnabled("mcp-share-links", userCtx("member"))).toBe(false);
});

test("destructured isEnabled from getFlags", async () => {
    await initFlags({ env: {} });
    const { isEnabled } = getFlags();
    expect(isEnabled("mcp-share-links", userCtx("owner"))).toBe(false);
});

describe("round-2 QA fixes", () => {
    test("import pattern catches every form Bun accepts", () => {
        const q = '"';
        const hits = [
            `import { flags } from ${q}railway${q};`,
            `import{flags}from${q}railway${q}`,
            `import ${q}railway${q};`,
            `export { flags } from ${q}railway/iac${q};`,
            `const r = require(${q}railway${q});`,
            "const m = await import(`railway`);",
            `await import(/* webpackIgnore: true */ ${q}railway${q});`,
            `await import(${q}railway${q}, { with: { type: "json" } });`,
        ];
        for (const src of hits) expect(RAILWAY_IMPORT_RE.test(src)).toBe(true);
        const misses = [
            `import { x } from ${q}railway-extra${q};`,
            `const s = ${q}railway${q};`,
            `// the railway SDK`,
        ];
        for (const src of misses) {
            expect(RAILWAY_IMPORT_RE.test(src)).toBe(false);
        }
    });

    test("cycle answers off even when the fallback is true", () => {
        const cyclic = {
            a: {
                type: "bool" as const,
                kind: "temporary" as const,
                unit: "user" as const,
                parent: "b",
                fallback: false,
                why: "test",
                removeWhen: "test",
            },
            b: {
                type: "bool" as const,
                kind: "kill-switch" as const,
                unit: "user" as const,
                parent: "a",
                fallback: true,
                why: "test",
                removeWhen: "test",
            },
        };
        const reader = createMemoryFlags(
            { a: true, b: true },
            { registry: cyclic },
        );
        for (const name of ["a", "b"]) {
            const result = reader.evaluate(name as FlagName, userCtx("owner"));
            expect(result.value).toBe(false);
            expect(result.reason).toBe("ERROR");
        }
    });

    test("a synchronous init throw does not reject initFlags", async () => {
        const errSpy = console.error;
        console.error = () => {};
        try {
            const sdk = fakeSdk({
                init: () => {
                    throw new Error("sync boom");
                },
            });
            const reader = await initFlags({
                env: { RAILWAY_TOKEN: "proj.sync-throw-token" },
                sdk,
                timeoutMs: 20,
            });
            expect(
                reader.evaluate("mcp-share-links", userCtx("owner")).reason,
            ).toBe("NOT_READY");
        } finally {
            console.error = errSpy;
        }
    });

    test("short tokens are not redacted out of ordinary words", async () => {
        const errSpy = console.error;
        const logs: string[] = [];
        console.error = (msg: string) => logs.push(String(msg));
        try {
            await initFlags({
                env: { RAILWAY_TOKEN: "a" },
                sdk: fakeSdk({
                    init: async () => {
                        throw new Error("authentication failed");
                    },
                }),
                timeoutMs: 20,
            });
            expect(logs).toContain(
                "[flags] init failed: authentication failed",
            );
        } finally {
            console.error = errSpy;
        }
    });

    test("an init from before a reset cannot publish over newer state", async () => {
        let resolveInit: (() => void) | undefined;
        const slow = new Promise<void>((resolve) => {
            resolveInit = resolve;
        });
        let evalCalls = 0;
        const sdk = fakeSdk({
            init: () => slow,
            synced: true,
            evaluateBoolean: () => {
                evalCalls++;
                return { value: true, reason: "TARGETING_MATCH", trace: [] };
            },
        });
        const logSpy = console.log;
        console.log = () => {};
        try {
            const stale = initFlags({
                env: { RAILWAY_TOKEN: "proj.reset-race-token" },
                sdk,
                timeoutMs: 5_000,
            });
            resetFlagsForTests();
            const fresh = await initFlags({ env: {} });
            resolveInit?.();
            await stale;
            await Bun.sleep(0);

            const ctx = userCtx("owner");
            expect(getFlags()).toBe(fresh);
            expect(getFlags().evaluate("mcp-share-links", ctx).source).toBe(
                "fallback",
            );
            expect(await initFlags({ env: {} })).toBe(fresh);
            expect(evalCalls).toBe(0);
        } finally {
            console.log = logSpy;
        }
    });
});

describe("flag descriptions name the tools they gate", () => {
    test("every gatedTool flag's why mentions each tool it gates", async () => {
        const dir = join(import.meta.dir, "mcp", "tools");
        const gated: { flag: string; tool: string }[] = [];
        for (const file of readdirSync(dir)) {
            if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
            const source = readFileSync(join(dir, file), "utf8");
            for (const m of source.matchAll(
                /gatedTool\(\s*server,\s*ctx,\s*"([^"]+)",\s*"([^"]+)"/g,
            )) {
                gated.push({ flag: m[1]!, tool: m[2]! });
            }
        }
        expect(gated.length).toBeGreaterThan(0);
        for (const { flag, tool } of gated) {
            const def = (FLAGS as Record<string, { why: string }>)[flag];
            expect(def, flag).toBeDefined();
            expect(def!.why, `${flag} why names ${tool}`).toContain(tool);
        }
    });
});
