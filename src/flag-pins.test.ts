import { describe, expect, test } from "bun:test";
import {
    PIN_TTL_MS,
    createMemoryFlagPinStore,
    snapshotSubjectKey,
    type MemoryFlagPinStore,
    type SnapshotSubject,
} from "./domain/flag-pins.js";
import {
    FLAGS,
    UNRELIABLE_REASONS,
    createEnvFlags,
    createFallbackFlags,
    createMemoryFlags,
    createRailwayFlags,
    isReliable,
    type EpochFlagReader,
    type FlagContext,
    type RailwayFlagsSdk,
} from "./flags.js";
import { currentActor, type Actor } from "./db/actor.js";
import { createFlagPinRuntime, systemFlagPinStore } from "./flag-pins.js";
import { loadViewerFlags } from "./viewer-flags.js";
import { VERSION } from "./version.js";

const REGISTRY = {
    "t-user": { kind: "temporary", unit: "user", fallback: false },
    "t-hh": { kind: "temporary", unit: "household", fallback: false },
    "k-user": { kind: "kill-switch", unit: "user", fallback: true },
    "k-hh": { kind: "kill-switch", unit: "household", fallback: true },
} as const;

const USER = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const HOUSEHOLD = "33333333-3333-4333-8333-333333333333";
const HH_SNAPSHOT: SnapshotSubject = { kind: "household", id: HOUSEHOLD };
const USER_SNAPSHOT: SnapshotSubject = { kind: "user", id: USER };

function ctxFor(overrides: Partial<FlagContext> = {}): FlagContext {
    return {
        key: USER,
        household_id: HOUSEHOLD,
        env: "local",
        groups: "",
        cohort: 0,
        household_cohort: 0,
        app_version: VERSION,
        ...overrides,
    };
}

type Live = { value: boolean; reason: string };

/** A Railway-sourced reader whose answers and epoch the test steers. */
function fakeRailway() {
    const state = {
        live: new Map<string, Live>(),
        epoch: { value: 0, reliable: true },
    };
    const reader: EpochFlagReader = {
        evaluate(flag, _ctx) {
            const l = state.live.get(flag) ?? {
                value: false,
                reason: "NO_MATCH",
            };
            return {
                flag,
                value: l.value,
                reason: l.reason,
                source: "railway",
            };
        },
        isEnabled(flag, ctx) {
            return reader.evaluate(flag, ctx).value;
        },
        epoch: () => state.epoch,
    };
    return {
        reader,
        set(flag: string, value: boolean, reason = "TARGETING_MATCH") {
            state.live.set(flag, { value, reason });
        },
        setEpoch(value: number, reliable = true) {
            state.epoch = { value, reliable };
        },
    };
}

function setup(clock = { t: 1_000_000 }) {
    const store: MemoryFlagPinStore = createMemoryFlagPinStore({
        now: () => clock.t,
    });
    const sleeps: number[] = [];
    const runtime = createFlagPinRuntime({
        store,
        registry: REGISTRY,
        now: () => clock.t,
        sleep: async (ms) => void sleeps.push(ms),
    });
    const railway = fakeRailway();
    const read = async (flag: string, ctx = ctxFor()) => {
        const [e] = await runtime.evaluateAll(ctx, railway.reader, [flag]);
        return e!;
    };
    return { store, runtime, railway, read, clock, sleeps };
}

const userSubject = { kind: "user", id: USER } as const;

describe("temporary flags", () => {
    test("a fresh reliable read serves the value and writes a pin", async () => {
        const { store, railway, read, clock } = setup();
        railway.set("t-user", true);
        railway.setEpoch(3);
        const e = await read("t-user");
        expect(e.value).toBe(true);
        expect(e.reason).toBe("TARGETING_MATCH");
        const pin = store.pins.get(`user:${USER}`)?.get("t-user");
        expect(pin).toEqual({
            flag: "t-user",
            value: true,
            reason: "TARGETING_MATCH",
            epoch: 3,
            assignedAt: clock.t,
            expiresAt: clock.t + PIN_TTL_MS,
        });
        expect(store.calls.upsertPin).toBe(1);
    });

    test("a long reason is truncated to 64 characters", async () => {
        const { store, railway, read } = setup();
        railway.set("t-user", true, "R".repeat(100));
        await read("t-user");
        expect(store.pins.get(`user:${USER}`)?.get("t-user")?.reason).toBe(
            "R".repeat(64),
        );
    });

    test("Railway STALE with a live pin serves the pin and writes nothing", async () => {
        const { store, railway, read } = setup();
        railway.set("t-user", true);
        await read("t-user");
        expect(store.calls.upsertPin).toBe(1);

        railway.set("t-user", false, "STALE");
        const e = await read("t-user");
        expect(e.value).toBe(true);
        expect(e.reason).toBe("PINNED");
        expect(e.source).toBe("railway");
        expect(isReliable(e)).toBe(true);
        expect(store.calls.upsertPin).toBe(1);
    });

    test("STALE without a pin serves the fallback and writes nothing", async () => {
        const { store, railway, read } = setup();
        railway.set("t-user", true, "STALE");
        const e = await read("t-user");
        expect(e.value).toBe(false);
        expect(e.reason).toBe("STALE");
        expect(store.calls.upsertPin).toBe(0);
        expect(store.pins.size).toBe(0);
    });

    test("an epoch bump re-evaluates the pin with the new epoch", async () => {
        const { store, railway, read } = setup();
        railway.set("t-user", true);
        await read("t-user");

        railway.set("t-user", false);
        railway.setEpoch(1);
        const e = await read("t-user");
        expect(e.value).toBe(false);
        expect(e.reason).toBe("TARGETING_MATCH");
        const pin = store.pins.get(`user:${USER}`)?.get("t-user");
        expect(pin?.value).toBe(false);
        expect(pin?.epoch).toBe(1);
        expect(store.calls.upsertPin).toBe(2);
    });

    test("a pin is re-evaluated after 12 hours", async () => {
        const { store, railway, read, clock } = setup();
        railway.set("t-user", true);
        await read("t-user");

        railway.set("t-user", false);
        clock.t += PIN_TTL_MS - 1;
        expect((await read("t-user")).value).toBe(true);

        clock.t += 1;
        const e = await read("t-user");
        expect(e.value).toBe(false);
        expect(e.reason).toBe("TARGETING_MATCH");
        expect(store.calls.upsertPin).toBe(2);
    });

    test("the live value changing within 12 hours does not move the pin", async () => {
        const { store, railway, read } = setup();
        railway.set("t-user", true);
        await read("t-user");
        railway.set("t-user", false);
        const e = await read("t-user");
        expect(e.value).toBe(true);
        expect(e.reason).toBe("PINNED");
        expect(store.calls.upsertPin).toBe(1);
    });

    test("an unknown epoch serves a live pin and never writes", async () => {
        const { store, railway, read } = setup();
        railway.set("t-user", true);
        await read("t-user");

        railway.setEpoch(9, false);
        railway.set("t-user", false);
        const e = await read("t-user");
        expect(e.value).toBe(true);
        expect(e.reason).toBe("PINNED");
        expect(store.calls.upsertPin).toBe(1);
    });

    test("an unknown epoch serves a pin from another epoch and keeps it", async () => {
        const { store, railway, read } = setup();
        railway.set("t-user", true);
        await read("t-user");
        const before = store.pins.get(`user:${USER}`)?.get("t-user");
        expect(before?.epoch).toBe(0);

        // Railway now says epoch 9 but the read is unreliable: the epoch-0 pin
        // can be neither checked nor replaced.
        railway.setEpoch(9, false);
        railway.set("t-user", false);
        const e = await read("t-user");
        expect(e.value).toBe(true);
        expect(e.reason).toBe("PINNED");
        expect(store.calls.upsertPin).toBe(1);
        expect(store.pins.get(`user:${USER}`)?.get("t-user")).toEqual(before!);
    });

    test("a household-unit flag pins per household and is shared", async () => {
        const { store, railway, read } = setup();
        railway.set("t-hh", true);
        const a = await read("t-hh", ctxFor({ key: USER }));
        railway.set("t-hh", false);
        const b = await read("t-hh", ctxFor({ key: USER_B }));
        expect(a.value).toBe(true);
        expect(b.value).toBe(true);
        expect(b.reason).toBe("PINNED");
        expect(store.pins.has(`household:${HOUSEHOLD}`)).toBe(true);
        expect(store.pins.has(`user:${USER}`)).toBe(false);
        expect(store.calls.upsertPin).toBe(1);
        // Another household starts from the live value.
        const other = await read(
            "t-hh",
            ctxFor({ household_id: "44444444-4444-4444-8444-444444444444" }),
        );
        expect(other.value).toBe(false);
        expect(other.reason).toBe("TARGETING_MATCH");
    });

    test("a household-token caller never pins a user-unit flag", async () => {
        const { store, railway, read } = setup();
        railway.set("t-user", true);
        const ctx = ctxFor({ key: `hh:${HOUSEHOLD}` });
        const e = await read("t-user", ctx);
        expect(e.value).toBe(true);
        expect(e.reason).toBe("TARGETING_MATCH");
        expect(store.calls.loadPins).toBe(0);
        expect(store.calls.upsertPin).toBe(0);

        // Unreliable and no subject: the fallback, not a pin.
        railway.set("t-user", true, "STALE");
        const stale = await read("t-user", ctx);
        expect(stale.value).toBe(false);
        // A household-unit flag still pins for the same caller.
        railway.set("t-hh", true);
        await read("t-hh", ctx);
        expect(store.pins.has(`household:${HOUSEHOLD}`)).toBe(true);
    });

    test("a caller with no household never pins a household-unit flag", async () => {
        const { store, railway, read } = setup();
        railway.set("t-hh", true);
        const ctx = ctxFor();
        delete ctx.household_id;
        const e = await read("t-hh", ctx);
        expect(e.value).toBe(true);
        expect(store.calls.upsertPin).toBe(0);
    });

    test("never writes a pin from an unreliable reason or an unknown epoch", async () => {
        for (const reason of UNRELIABLE_REASONS) {
            const { store, railway, read } = setup();
            railway.set("t-user", true, reason);
            railway.set("t-hh", true, reason);
            const user = await read("t-user");
            const hh = await read("t-hh");
            expect(user.value).toBe(false);
            expect(hh.value).toBe(false);
            expect(store.calls.upsertPin).toBe(0);
            expect(store.pins.size).toBe(0);
        }
        const { store, railway, read } = setup();
        railway.set("t-user", true);
        railway.setEpoch(0, false);
        const e = await read("t-user");
        expect(e.value).toBe(false);
        expect(store.calls.upsertPin).toBe(0);
    });

    test("a pin that failed to load is neither read nor written", async () => {
        const { store, railway, runtime } = setup();
        store.loadPins = async () => {
            throw new Error("db down");
        };
        const err = console.error;
        const logged: string[] = [];
        console.error = (...a: unknown[]) => void logged.push(a.join(" "));
        try {
            railway.set("t-user", true);
            const [e] = await runtime.evaluateAll(ctxFor(), railway.reader, [
                "t-user",
            ]);
            expect(e!.value).toBe(true);
            expect(store.calls.upsertPin).toBe(0);
            expect(logged.some((l) => l.startsWith("[flags]"))).toBe(true);
        } finally {
            console.error = err;
        }
    });

    test("a failed pin load is retried with backoff and recovers", async () => {
        const { store, railway, runtime, sleeps } = setup();
        const loadPins = store.loadPins.bind(store);
        let failures = 2;
        let attempts = 0;
        store.loadPins = async (subject) => {
            attempts++;
            if (failures-- > 0) throw new Error("db blip");
            return loadPins(subject);
        };
        railway.set("t-user", true);
        const [e] = await runtime.evaluateAll(ctxFor(), railway.reader, [
            "t-user",
        ]);
        expect(attempts).toBe(3);
        expect(sleeps).toEqual([50, 200]);
        expect(e!.value).toBe(true);
        expect(store.calls.upsertPin).toBe(1);
    });

    test("retries are capped, then the subject cools down", async () => {
        const { store, railway, runtime, clock, sleeps } = setup();
        let attempts = 0;
        store.loadPins = async () => {
            attempts++;
            throw new Error("db down");
        };
        const err = console.error;
        console.error = () => {};
        try {
            railway.set("t-user", true);
            const readUser = () =>
                runtime.evaluateAll(ctxFor(), railway.reader, ["t-user"]);
            await readUser();
            expect(attempts).toBe(3);
            expect(sleeps).toEqual([50, 200]);

            // Within the cooldown: no query at all, live value, no pin.
            clock.t += 9_999;
            const [e] = await readUser();
            expect(attempts).toBe(3);
            expect(e!.value).toBe(true);
            expect(store.calls.upsertPin).toBe(0);

            // After it: one more capped round.
            clock.t += 2;
            await readUser();
            expect(attempts).toBe(6);
        } finally {
            console.error = err;
        }
    });

    test("a failed pin write is logged, not thrown", async () => {
        const { store, railway, read } = setup();
        store.upsertPin = async () => {
            throw new Error("db down");
        };
        const err = console.error;
        const logged: string[] = [];
        console.error = (...a: unknown[]) => void logged.push(a.join(" "));
        try {
            railway.set("t-user", true);
            const e = await read("t-user");
            expect(e.value).toBe(true);
            await new Promise((r) => setTimeout(r, 0));
            expect(logged.some((l) => l.includes("saving pin t-user"))).toBe(
                true,
            );
        } finally {
            console.error = err;
        }
    });
});

describe("cache", () => {
    test("a second read for the same subject makes no second query", async () => {
        const { store, railway, runtime } = setup();
        railway.set("t-user", true);
        const names = ["t-user", "t-hh"];
        await runtime.evaluateAll(ctxFor(), railway.reader, names);
        await runtime.evaluateAll(ctxFor(), railway.reader, names);
        // One query for the user subject, one for the household subject.
        expect(store.calls.loadPins).toBe(2);
        expect(runtime.cachedSubjects()).toBe(2);
    });

    test("the cache is capped", async () => {
        const { store, railway } = setup();
        const runtime = createFlagPinRuntime({
            store,
            registry: REGISTRY,
            maxSubjects: 2,
        });
        for (const key of [
            USER,
            USER_B,
            "55555555-5555-4555-8555-555555555555",
        ]) {
            await runtime.evaluateAll(ctxFor({ key }), railway.reader, [
                "t-user",
            ]);
        }
        expect(runtime.cachedSubjects()).toBe(2);
    });

    test("the cap evicts the least recently used subject", async () => {
        const { store, railway } = setup();
        const runtime = createFlagPinRuntime({
            store,
            registry: REGISTRY,
            maxSubjects: 2,
        });
        const third = "55555555-5555-4555-8555-555555555555";
        const readAs = (key: string) =>
            runtime.evaluateAll(ctxFor({ key }), railway.reader, ["t-user"]);
        await readAs(USER);
        await readAs(USER_B);
        await readAs(USER); // USER is now the most recent, USER_B the oldest.
        await readAs(third); // Evicts USER_B.
        expect(store.calls.loadPins).toBe(3);

        await readAs(USER); // Still cached: no query.
        expect(store.calls.loadPins).toBe(3);
        await readAs(USER_B); // Was evicted: queried again.
        expect(store.calls.loadPins).toBe(4);
    });

    test("a request that loaded pins before clearPins does not write one back", async () => {
        const { store, railway, runtime } = setup();
        railway.set("t-user", true);
        // Hold the pin load open so clearPins lands mid-request.
        let release!: () => void;
        const gate = new Promise<void>((r) => (release = r));
        const loadPins = store.loadPins.bind(store);
        store.loadPins = async (subject) => {
            const pins = await loadPins(subject);
            await gate;
            return pins;
        };
        const inFlight = runtime.evaluateAll(ctxFor(), railway.reader, [
            "t-user",
        ]);
        await Promise.resolve();
        await runtime.clearPins(userSubject);
        release();
        const [e] = await inFlight;
        expect(e!.value).toBe(true);
        expect(store.calls.upsertPin).toBe(0);
        expect(store.pins.size).toBe(0);
    });

    test("clearPins removes rows and cache, so the next read re-pins", async () => {
        const { store, railway, read, runtime } = setup();
        railway.set("t-user", true);
        await read("t-user");
        expect(store.pins.size).toBe(1);

        railway.set("t-user", false);
        await runtime.clearPins(userSubject);
        expect(store.pins.size).toBe(0);
        expect(runtime.cachedSubjects()).toBe(0);

        const e = await read("t-user");
        expect(e.value).toBe(false);
        expect(e.reason).toBe("TARGETING_MATCH");
        expect(store.pins.get(`user:${USER}`)?.get("t-user")?.value).toBe(
            false,
        );
    });

    test("sweep deletes expired rows and prunes idle subjects", async () => {
        const { store, railway, read, runtime, clock } = setup();
        railway.set("t-user", true);
        await read("t-user");
        clock.t += PIN_TTL_MS + 1;
        const removed = await runtime.sweepExpiredPins();
        expect(removed).toBe(1);
        expect(store.pins.size).toBe(0);
        expect(runtime.cachedSubjects()).toBe(0);
    });
});

describe("kill switches", () => {
    test("a reliable value is remembered and served when STALE", async () => {
        const { store, railway, read } = setup();
        railway.set("k-hh", false);
        expect((await read("k-hh")).value).toBe(false);

        railway.set("k-hh", true, "STALE");
        const e = await read("k-hh");
        expect(e.value).toBe(false);
        expect(e.reason).toBe("LAST_KNOWN");
        expect(isReliable(e)).toBe(true);
        expect(store.pins.size).toBe(0);
    });

    test("a fresh process with only a snapshot serves the snapshot", async () => {
        const { store, railway, read } = setup();
        await store.saveSnapshot("k-hh", false, HH_SNAPSHOT);
        railway.set("k-hh", true, "STALE");
        const e = await read("k-hh");
        expect(e.value).toBe(false);
        expect(e.reason).toBe("LAST_KNOWN");
    });

    test("with nothing known the registry fallback (on) is served", async () => {
        const { store, railway, read } = setup();
        railway.set("k-hh", false, "STALE");
        const e = await read("k-hh");
        expect(e.value).toBe(true);
        expect(e.reason).toBe("STALE");
        expect(store.calls.saveSnapshot).toBe(0);
    });

    test("the snapshot is written only when the value changes", async () => {
        const { store, railway, read } = setup();
        railway.set("k-hh", true);
        await read("k-hh");
        expect(store.calls.saveSnapshot).toBe(1);
        expect(
            store.snapshots.get(snapshotSubjectKey(HH_SNAPSHOT))?.get("k-hh"),
        ).toBe(true);
        await read("k-hh");
        await read("k-hh");
        expect(store.calls.saveSnapshot).toBe(1);

        railway.set("k-hh", false);
        await read("k-hh");
        expect(store.calls.saveSnapshot).toBe(2);
        expect(
            store.snapshots.get(snapshotSubjectKey(HH_SNAPSHOT))?.get("k-hh"),
        ).toBe(false);
    });

    test("a value equal to the loaded snapshot is not written again", async () => {
        const { store, railway, read } = setup();
        store.snapshots.set(
            snapshotSubjectKey(HH_SNAPSHOT),
            new Map([["k-hh", true]]),
        );
        railway.set("k-hh", true);
        await read("k-hh");
        expect(store.calls.saveSnapshot).toBe(0);
    });

    test("an unreliable read never writes the snapshot", async () => {
        for (const reason of UNRELIABLE_REASONS) {
            const { store, railway, read } = setup();
            railway.set("k-user", false, reason);
            await read("k-user");
            expect(store.calls.saveSnapshot).toBe(0);
        }
    });

    test("a failed snapshot load means no snapshot, not a thrown request", async () => {
        const { store, railway, read } = setup();
        store.loadSnapshot = async () => {
            throw new Error("db down");
        };
        const err = console.error;
        console.error = () => {};
        try {
            railway.set("k-hh", false, "STALE");
            expect((await read("k-hh")).value).toBe(true);
        } finally {
            console.error = err;
        }
    });

    test("alternating households keep separate snapshots and last-known values", async () => {
        const HH_A = "44444444-4444-4444-8444-444444444444";
        const HH_B = "55555555-5555-4555-8555-555555555555";
        const { store, railway, read } = setup();
        railway.set("k-hh", false);
        await read("k-hh", ctxFor({ household_id: HH_A }));
        railway.set("k-hh", true);
        await read("k-hh", ctxFor({ household_id: HH_B }));
        expect(
            (
                await store.loadSnapshot({
                    kind: "household",
                    id: HH_A,
                })
            ).get("k-hh"),
        ).toBe(false);
        expect(
            (
                await store.loadSnapshot({
                    kind: "household",
                    id: HH_B,
                })
            ).get("k-hh"),
        ).toBe(true);

        railway.set("k-hh", false, "STALE");
        const a = await read("k-hh", ctxFor({ household_id: HH_A }));
        const b = await read("k-hh", ctxFor({ household_id: HH_B }));
        expect(a.value).toBe(false);
        expect(b.value).toBe(true);
        expect(a.reason).toBe("LAST_KNOWN");
        expect(b.reason).toBe("LAST_KNOWN");
    });

    test("a user-unit kill switch snapshots per user", async () => {
        const { store, railway, read } = setup();
        railway.set("k-user", false);
        await read("k-user", ctxFor({ key: USER }));
        railway.set("k-user", true);
        await read("k-user", ctxFor({ key: USER_B }));
        expect((await store.loadSnapshot(USER_SNAPSHOT)).get("k-user")).toBe(
            false,
        );
        expect(
            (
                await store.loadSnapshot({
                    kind: "user",
                    id: USER_B,
                })
            ).get("k-user"),
        ).toBe(true);
    });

    test("a failed snapshot load is retried, capped and cooled down", async () => {
        const { store, railway, read, clock } = setup();
        let attempts = 0;
        store.loadSnapshot = async () => {
            attempts++;
            throw new Error("db down");
        };
        const err = console.error;
        console.error = () => {};
        try {
            railway.set("k-hh", false, "STALE");
            await read("k-hh");
            expect(attempts).toBe(3);
            await read("k-hh");
            expect(attempts).toBe(3);
            clock.t += 10_001;
            await read("k-hh");
            expect(attempts).toBe(6);
        } finally {
            console.error = err;
        }
    });
});

describe("non-Railway readers", () => {
    test("env, fallback and memory readers never pin and never query", async () => {
        const readers = [
            createFallbackFlags(),
            createEnvFlags(new Map([["mcp-share-links", "all" as const]])),
            createMemoryFlags({ "mcp-share-links": true }),
        ];
        for (const reader of readers) {
            const store = createMemoryFlagPinStore();
            const runtime = createFlagPinRuntime({ store });
            const flags = await loadViewerFlags(ctxFor(), reader, runtime);
            expect(Object.keys(flags).length).toBe(Object.keys(FLAGS).length);
            expect(store.calls).toEqual({
                loadPins: 0,
                upsertPin: 0,
                clearPins: 0,
                sweepExpired: 0,
                loadSnapshot: 0,
                saveSnapshot: 0,
            });
        }
    });

    test("a non-Railway source passes through the sticky layer untouched", async () => {
        const store = createMemoryFlagPinStore();
        const runtime = createFlagPinRuntime({ store, registry: REGISTRY });
        const reader: EpochFlagReader = {
            evaluate: (flag) => ({
                flag,
                value: true,
                reason: "ENV_ALL",
                source: "env",
            }),
            isEnabled: () => true,
            epoch: () => ({ value: 0, reliable: true }),
        };
        const [t, k] = await runtime.evaluateAll(ctxFor(), reader, [
            "t-user",
            "k-hh",
        ]);
        expect(t!.reason).toBe("ENV_ALL");
        expect(k!.reason).toBe("ENV_ALL");
        expect(store.calls.upsertPin).toBe(0);
        expect(store.calls.saveSnapshot).toBe(0);
    });
});

describe("loadViewerFlags with the Railway reader", () => {
    function sdkWith(opts: {
        value: boolean;
        reason: string;
        epoch?: { value: number; reason: string };
    }): RailwayFlagsSdk {
        return {
            synced: true,
            init: async () => {},
            evaluateBoolean: (_n, _c, fb) => ({
                value: opts.reason === "STALE" ? (fb ?? false) : opts.value,
                reason: opts.reason,
                trace: [],
            }),
            evaluateNumber: () => ({
                value: opts.epoch?.value ?? 0,
                reason: opts.epoch?.reason ?? "NO_MATCH",
                trace: [],
            }),
        } as RailwayFlagsSdk;
    }

    test("pins mcp-share-links and keeps it when the SDK goes stale", async () => {
        const store = createMemoryFlagPinStore();
        const runtime = createFlagPinRuntime({ store });
        const ctx = ctxFor();

        const live = createRailwayFlags(
            sdkWith({ value: true, reason: "TARGETING_MATCH" }),
        );
        live.markInitDone();
        expect((await loadViewerFlags(ctx, live, runtime)).mcpShareLinks).toBe(
            true,
        );
        expect(
            store.pins.get(`user:${USER}`)?.get("mcp-share-links")?.value,
        ).toBe(true);

        const stale = createRailwayFlags(
            sdkWith({ value: false, reason: "STALE" }),
        );
        stale.markInitDone();
        const flags = await loadViewerFlags(ctx, stale, runtime);
        expect(flags.mcpShareLinks).toBe(true);
        // Kill switches stayed on.
        expect(flags.offLookups).toBe(true);
    });

    test("a leftover pin and snapshot for a retired flag are inert", async () => {
        const store = createMemoryFlagPinStore();
        const runtime = createFlagPinRuntime({ store });
        const now = Date.now();
        store.pins.set(
            `user:${USER}`,
            new Map([
                [
                    "ui-v2",
                    {
                        flag: "ui-v2",
                        value: true,
                        reason: "TARGETING_MATCH",
                        epoch: 1,
                        assignedAt: now,
                        expiresAt: now + 60_000,
                    },
                ],
            ]),
        );
        store.snapshots.set(
            snapshotSubjectKey({ kind: "global", id: "" }),
            new Map([["ui-v2", true]]),
        );
        const live = createRailwayFlags(
            sdkWith({ value: true, reason: "TARGETING_MATCH" }),
        );
        live.markInitDone();
        const flags = await loadViewerFlags(ctxFor(), live, runtime);
        expect(flags.mcpShareLinks).toBe(true);
        expect("uiV2" in flags).toBe(false);
    });

    test("before the SDK is ready nothing is pinned and the fallbacks serve", async () => {
        const store = createMemoryFlagPinStore();
        const runtime = createFlagPinRuntime({ store });
        const reader = createRailwayFlags(
            sdkWith({ value: true, reason: "TARGETING_MATCH" }),
        );
        const flags = await loadViewerFlags(ctxFor(), reader, runtime);
        expect(flags.mcpShareLinks).toBe(false);
        expect(flags.offLookups).toBe(true);
        expect(store.calls.upsertPin).toBe(0);
        expect(store.calls.saveSnapshot).toBe(0);
    });

    test("flags-epoch comes from the numeric flag", () => {
        const make = (epoch: { value: number; reason: string }) => {
            const r = createRailwayFlags(
                sdkWith({ value: true, reason: "NO_MATCH", epoch }),
            );
            r.markInitDone();
            return r.epoch(ctxFor());
        };
        expect(make({ value: 4, reason: "NO_MATCH" })).toEqual({
            value: 4,
            reliable: true,
        });
        // Not created in Railway yet: epoch 0, known.
        expect(make({ value: 0, reason: "NOT_FOUND" })).toEqual({
            value: 0,
            reliable: true,
        });
        expect(make({ value: 7, reason: "STALE" }).reliable).toBe(false);
        const warn = console.warn;
        console.warn = () => {};
        try {
            expect(make({ value: -1, reason: "NO_MATCH" }).reliable).toBe(
                false,
            );
            expect(make({ value: 1.5, reason: "NO_MATCH" }).reliable).toBe(
                false,
            );
        } finally {
            console.warn = warn;
        }
        const notReady = createRailwayFlags(
            sdkWith({ value: true, reason: "NO_MATCH" }),
        );
        expect(notReady.epoch(ctxFor()).reliable).toBe(false);
    });
});

describe("systemFlagPinStore", () => {
    test("every store call runs as the system", async () => {
        const seen: Record<string, Actor | undefined> = {};
        const note = (name: string) => {
            seen[name] = currentActor();
        };
        const wrapped = systemFlagPinStore({
            loadPins: async () => (note("loadPins"), []),
            upsertPin: async () => note("upsertPin"),
            clearPins: async () => note("clearPins"),
            sweepExpired: async () => (note("sweepExpired"), 0),
            loadSnapshot: async () => (note("loadSnapshot"), new Map()),
            saveSnapshot: async () => note("saveSnapshot"),
        });
        const subject = { kind: "user", id: "u1" } as const;
        await wrapped.loadPins(subject);
        await wrapped.upsertPin(subject, {
            flag: "f",
            value: true,
            reason: "rollout",
            epoch: 1,
            assignedAt: 0,
            expiresAt: 1,
        });
        await wrapped.clearPins(subject);
        await wrapped.sweepExpired(0);
        await wrapped.loadSnapshot();
        await wrapped.saveSnapshot("f", true);

        expect(Object.keys(seen).sort()).toEqual([
            "clearPins",
            "loadPins",
            "loadSnapshot",
            "saveSnapshot",
            "sweepExpired",
            "upsertPin",
        ]);
        for (const actor of Object.values(seen)) {
            expect(actor?.kind).toBe("system");
        }
        expect(currentActor()).toBeUndefined();
    });
});
