/**
 * The screenshot driver behind `bun run preview:app --shots`: one headless
 * Chromium for the whole run, driven over the DevTools protocol, with a
 * private browser context (cookies, storage, cache) per shot. It replaces a
 * cold-started Chromium per PNG, which stacked up load when renders overlapped.
 *
 * No dependency: Bun's own WebSocket talks to the `--remote-debugging-port`
 * endpoint the browser prints on stderr. The pure parts (layout rules, the
 * command/reply router, the endpoint parser) are unit-tested; the browser
 * itself is exercised by `bun run preview:app --shots` and `preview-diff`.
 */
import { mkdirSync, rmSync } from "node:fs";

/** The Chromium binary a shot run drives, or null when none is installed. */
export function findChromium(): string | null {
    // Prefer the real binary. PATH `google-chrome` is often a wrapper that
    // pins --user-data-dir to the GUI profile and hangs headless shots.
    for (const bin of [
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "google-chrome-stable",
        "chromium",
        "chromium-browser",
    ]) {
        if (bin.startsWith("/")) {
            try {
                if (Bun.file(bin).size > 0) return bin;
            } catch {
                // missing
            }
            continue;
        }
        const path = Bun.which(bin);
        if (path) return path;
    }
    return null;
}

/** A page's window: fixed, a tall fixed one, or measured from the page. */
export type ShotLayout = "fixed" | "tall" | "measured";

export type Viewport = { width: number; height: number };

export type ColorScheme = "light" | "dark";

/** Pages that grow with their content and are measured before they are shot. */
const MEASURED_PREFIX = "dev-gallery-v2";

/** Long pages: a tall window so the shot captures every block. */
const TALL_EXACT = new Set([
    "nutrition",
    "nutrition-agent-notice",
    "settings",
    "settings-account",
    "settings-household-v2",
    "settings-household-v2-member",
    "settings-saved",
    "help",
    "recipes",
    "recipe",
]);
const TALL_PREFIXES = [
    "trends-v2",
    "settings-goals",
    "settings-ai",
    "settings-score",
];

/** The tall window's height: part of every long page's no-change diff. */
export const TALL_HEIGHT = 5400;

export const PHONE_WIDTH = 390;
export const DESKTOP_WIDTH = 1440;
/** Virtual-time budgets: what the page may run before it is shot. */
export const PAGE_BUDGET_MS = 3000;
export const MODAL_BUDGET_MS = 4000;

/** `name` without its `-light` / `-dark` suffix. */
export function shotBase(name: string): string {
    return name.replace(/-(?:light|dark)$/, "");
}

export function colorSchemeOf(name: string): ColorScheme {
    return name.endsWith("-dark") ? "dark" : "light";
}

export function layoutOf(name: string): ShotLayout {
    const base = shotBase(name);
    if (base.startsWith(MEASURED_PREFIX)) return "measured";
    if (TALL_EXACT.has(base) || TALL_PREFIXES.some((p) => base.startsWith(p))) {
        return "tall";
    }
    return "fixed";
}

/**
 * The phone and desktop windows for a page. `measured` is the page's own
 * height for each width, and is only read for a `measured` layout.
 */
export function windowsFor(
    layout: ShotLayout,
    measured?: { phone: number; desktop: number },
): { phone: Viewport; desktop: Viewport } {
    if (layout === "measured") {
        if (!measured) throw new Error("a measured page needs its heights");
        return {
            phone: { width: PHONE_WIDTH, height: measured.phone },
            desktop: { width: DESKTOP_WIDTH, height: measured.desktop },
        };
    }
    if (layout === "tall") {
        return {
            phone: { width: PHONE_WIDTH, height: TALL_HEIGHT },
            desktop: { width: DESKTOP_WIDTH, height: TALL_HEIGHT },
        };
    }
    return {
        phone: { width: PHONE_WIDTH, height: 844 },
        desktop: { width: DESKTOP_WIDTH, height: 960 },
    };
}

/** The `ws://` endpoint in Chromium's "DevTools listening on …" stderr line. */
export function parseDevToolsUrl(text: string): string | null {
    const found = /DevTools listening on (ws:\/\/\S+)/.exec(text);
    return found ? found[1]! : null;
}

/** The measured height the probe page stamps on its root element. */
export function parseMeasuredHeight(value: unknown): number | null {
    if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
    return Number(value);
}

type CdpReply = {
    id?: number;
    method?: string;
    params?: Record<string, unknown>;
    result?: Record<string, unknown>;
    error?: { code: number; message: string };
    sessionId?: string;
};

export type CdpEvent = {
    method: string;
    params: Record<string, unknown>;
    sessionId?: string;
};

/**
 * Matches replies to commands by id and fans events out to waiters. It knows
 * nothing about sockets: `send` writes a frame, `receive` is fed each one.
 */
export class CdpRouter {
    private nextId = 1;
    private pending = new Map<
        number,
        {
            resolve: (r: Record<string, unknown>) => void;
            reject: (e: Error) => void;
            method: string;
        }
    >();
    private waiters: {
        match: (e: CdpEvent) => boolean;
        resolve: (e: CdpEvent) => void;
        reject: (e: Error) => void;
    }[] = [];
    private closed: Error | null = null;

    constructor(private readonly send: (frame: string) => void) {}

    call(
        method: string,
        params: Record<string, unknown> = {},
        sessionId?: string,
    ): Promise<Record<string, unknown>> {
        if (this.closed) return Promise.reject(this.closed);
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject, method });
            this.send(
                JSON.stringify({
                    id,
                    method,
                    params,
                    ...(sessionId ? { sessionId } : {}),
                }),
            );
        });
    }

    /**
     * Resolves with the next event `match` accepts. Register it before the
     * command that causes the event, or the event can be missed.
     */
    waitFor(match: (e: CdpEvent) => boolean): Promise<CdpEvent> {
        if (this.closed) return Promise.reject(this.closed);
        return new Promise((resolve, reject) => {
            this.waiters.push({ match, resolve, reject });
        });
    }

    receive(frame: string): void {
        let msg: CdpReply;
        try {
            msg = JSON.parse(frame) as CdpReply;
        } catch {
            return;
        }
        if (typeof msg.id === "number") {
            const p = this.pending.get(msg.id);
            if (!p) return;
            this.pending.delete(msg.id);
            if (msg.error) {
                p.reject(new Error(`${p.method}: ${msg.error.message}`));
            } else {
                p.resolve(msg.result ?? {});
            }
            return;
        }
        if (typeof msg.method === "string") {
            const event: CdpEvent = {
                method: msg.method,
                params: msg.params ?? {},
                sessionId: msg.sessionId,
            };
            const rest: typeof this.waiters = [];
            for (const w of this.waiters) {
                if (w.match(event)) w.resolve(event);
                else rest.push(w);
            }
            this.waiters = rest;
        }
    }

    /** Fails every command and event wait still pending, and every later one. */
    close(reason: Error): void {
        this.closed = reason;
        for (const p of this.pending.values()) p.reject(reason);
        this.pending.clear();
        for (const w of this.waiters) w.reject(reason);
        this.waiters = [];
    }
}

/** Rejects when `work` takes longer than `ms`. */
export function withTimeout<T>(
    work: Promise<T>,
    ms: number,
    what: string,
): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
            () => reject(new Error(`${what}: no answer in ${ms / 1000}s`)),
            ms,
        );
    });
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

const SHOT_TIMEOUT_MS = 60_000;

export type Browser = {
    /** Opens `url` in a fresh context at `viewport` and returns the PNG. */
    screenshot(opts: {
        url: string;
        viewport: Viewport;
        scheme: ColorScheme | null;
        budgetMs: number;
    }): Promise<Uint8Array>;
    /** Opens `url` in a fresh context and reads `data-fd-height` once the page settles. */
    measure(opts: {
        url: string;
        viewport: Viewport;
        budgetMs: number;
    }): Promise<number>;
    close(): Promise<void>;
};

/**
 * Flags that keep a headless run's memory down without moving a pixel: one
 * renderer process, and none of the background services (extensions,
 * component updates, translate, media router) a screenshot never uses. Against
 * the base flags alone, a full `preview:app --shots` run peaked at 962 MB of
 * Chromium PSS instead of 1490 MB (327 MB instead of 849 MB on average), with
 * every PNG byte-identical. `check:nav` uses them too.
 */
export const LEAN_CHROMIUM_FLAGS = [
    "--renderer-process-limit=1",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-component-update",
    "--no-first-run",
    "--mute-audio",
    "--disable-features=Translate,MediaRouter,OptimizationHints,BackForwardCache",
];

const CHROMIUM_FLAGS = [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    ...LEAN_CHROMIUM_FLAGS,
    "--hide-scrollbars",
    "--force-prefers-reduced-motion",
    // The one-shot --screenshot path runs every compositor stage before it
    // draws. Capturing over the protocol without it leaves the blurred phone
    // nav pill a shade off in about one shot in sixteen.
    "--run-all-compositor-stages-before-draw",
];

/** Starts one Chromium and connects to it. Always `close()` it. */
export async function launchBrowser(
    chromium: string,
    userDataDir: string,
): Promise<Browser> {
    rmSync(userDataDir, { recursive: true, force: true });
    mkdirSync(userDataDir, { recursive: true });
    const proc = Bun.spawn(
        [
            chromium,
            ...CHROMIUM_FLAGS,
            `--user-data-dir=${userDataDir}`,
            "--remote-debugging-port=0",
            "about:blank",
        ],
        {
            // The env is passed explicitly: a TZ set on process.env at
            // runtime (the pinned preview time zone) does not reach a child
            // otherwise, and Chromium would format dates in the host zone.
            env: { ...process.env },
            stdout: "ignore",
            stderr: "pipe",
            stdin: "ignore",
        },
    );
    let ws: WebSocket | null = null;
    let done = false;
    const stop = async () => {
        if (done) return;
        done = true;
        try {
            ws?.close();
        } catch {
            // already closed
        }
        // Ask first, then by PID: only the process this run started.
        proc.kill("SIGTERM");
        const exited = await Promise.race([
            proc.exited.then(() => true),
            Bun.sleep(3000).then(() => false),
        ]);
        if (!exited) {
            proc.kill("SIGKILL");
            await proc.exited;
        }
        rmSync(userDataDir, { recursive: true, force: true });
    };
    try {
        const url = await withTimeout(readEndpoint(proc), 30_000, "chromium");
        const opened = new WebSocket(url);
        ws = opened;
        const router = new CdpRouter((frame) => opened.send(frame));
        opened.addEventListener("message", (e) =>
            router.receive(String(e.data)),
        );
        opened.addEventListener("close", () =>
            router.close(new Error("the browser connection closed")),
        );
        await withTimeout(
            new Promise<void>((resolve, reject) => {
                opened.addEventListener("open", () => resolve());
                opened.addEventListener("error", () =>
                    reject(new Error("could not connect to chromium")),
                );
            }),
            30_000,
            "chromium websocket",
        );
        void proc.exited.then(() => {
            router.close(new Error("chromium exited"));
        });
        return {
            screenshot: (o) =>
                withTimeout(
                    inContext(
                        router,
                        o.viewport,
                        async (session) => {
                            await settle(router, session, o);
                            const shot = await router.call(
                                "Page.captureScreenshot",
                                { format: "png" },
                                session,
                            );
                            return Buffer.from(String(shot.data), "base64");
                        },
                        o.scheme,
                    ),
                    SHOT_TIMEOUT_MS,
                    o.url,
                ),
            measure: (o) =>
                withTimeout(
                    inContext(
                        router,
                        o.viewport,
                        async (session) => {
                            await settle(router, session, o);
                            const r = await router.call(
                                "Runtime.evaluate",
                                {
                                    expression:
                                        'document.documentElement.getAttribute("data-fd-height")',
                                    returnByValue: true,
                                },
                                session,
                            );
                            const value = (r.result as { value?: unknown })
                                ?.value;
                            const height = parseMeasuredHeight(value);
                            if (height === null) {
                                throw new Error(
                                    `${o.url}: could not measure the page`,
                                );
                            }
                            return height;
                        },
                        null,
                    ),
                    SHOT_TIMEOUT_MS,
                    o.url,
                ),
            close: stop,
        };
    } catch (e) {
        await stop();
        throw e;
    }
}

async function readEndpoint(proc: ReturnType<typeof Bun.spawn>) {
    const stderr = proc.stderr as ReadableStream<Uint8Array>;
    const decoder = new TextDecoder();
    let seen = "";
    for await (const chunk of stderr) {
        seen += decoder.decode(chunk, { stream: true });
        const url = parseDevToolsUrl(seen);
        if (url) {
            // Keep draining so Chromium never blocks on a full stderr pipe.
            void (async () => {
                for await (const _ of stderr) void _;
            })().catch(() => {});
            return url;
        }
    }
    throw new Error(`chromium exited before it listened: ${seen.trim()}`);
}

/** Runs `work` on a fresh page in its own context, then disposes the context. */
async function inContext<T>(
    router: CdpRouter,
    viewport: Viewport,
    work: (session: string) => Promise<T>,
    scheme: ColorScheme | null,
): Promise<T> {
    const { browserContextId } = (await router.call(
        "Target.createBrowserContext",
        { disposeOnDetach: true },
    )) as { browserContextId: string };
    try {
        const { targetId } = (await router.call("Target.createTarget", {
            url: "about:blank",
            browserContextId,
            width: viewport.width,
            height: viewport.height,
        })) as { targetId: string };
        const { sessionId } = (await router.call("Target.attachToTarget", {
            targetId,
            flatten: true,
        })) as { sessionId: string };
        await router.call("Page.enable", {}, sessionId);
        await router.call(
            "Emulation.setDeviceMetricsOverride",
            {
                width: viewport.width,
                height: viewport.height,
                deviceScaleFactor: 1,
                mobile: false,
            },
            sessionId,
        );
        await router.call(
            "Emulation.setEmulatedMedia",
            {
                features: [
                    { name: "prefers-reduced-motion", value: "reduce" },
                    ...(scheme
                        ? [{ name: "prefers-color-scheme", value: scheme }]
                        : []),
                ],
            },
            sessionId,
        );
        return await work(sessionId);
    } finally {
        await router
            .call("Target.disposeBrowserContext", { browserContextId })
            .catch(() => {});
    }
}

/**
 * The reason a `Page.navigate` reply reports a failed navigation (a refused
 * connection, a bad URL), or null when it succeeded. A failed navigation lands
 * on Chromium's error page, which would otherwise be shot as if it were the app.
 */
export function navigationError(result: unknown): string | null {
    const text = (result as { errorText?: unknown } | null)?.errorText;
    return typeof text === "string" && text !== "" ? text : null;
}

/**
 * Navigates, then lets the page run for its virtual-time budget. The policy is
 * set after the navigation commits: set before it, the budget runs out on
 * about:blank and the page stalls half loaded.
 */
async function settle(
    router: CdpRouter,
    session: string,
    o: { url: string; budgetMs: number },
) {
    const failure = navigationError(
        await router.call("Page.navigate", { url: o.url }, session),
    );
    if (failure) throw new Error(`navigating to ${o.url} failed: ${failure}`);
    const expired = router.waitFor(
        (e) =>
            e.method === "Emulation.virtualTimeBudgetExpired" &&
            e.sessionId === session,
    );
    // If the policy call below throws first, a later close() rejects this
    // waiter with nobody awaiting it: keep that from being unhandled.
    expired.catch(() => {});
    await router.call(
        "Emulation.setVirtualTimePolicy",
        { policy: "pauseIfNetworkFetchesPending", budget: o.budgetMs },
        session,
    );
    await expired;
}
