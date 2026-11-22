import { describe, expect, test } from "bun:test";
import {
    CdpRouter,
    colorSchemeOf,
    layoutOf,
    navigationError,
    parseDevToolsUrl,
    parseMeasuredHeight,
    shotBase,
    TALL_HEIGHT,
    windowsFor,
    withTimeout,
} from "./app-preview-shots";

describe("the shot window", () => {
    test("a plain page is a phone window and a desktop window", () => {
        expect(windowsFor(layoutOf("today-light"))).toEqual({
            phone: { width: 390, height: 844 },
            desktop: { width: 1440, height: 960 },
        });
    });

    test.each([
        "nutrition-light",
        "nutrition-agent-notice-dark",
        "settings-light",
        "settings-goals-saved-dark",
        "settings-ai-connections-light",
        "settings-score-light",
        "settings-household-v2-member-dark",
        "trends-v2-light",
        "help-light",
        "recipes-dark",
        "recipe-light",
    ])("%s is shot in a tall window", (name) => {
        expect(layoutOf(name)).toBe("tall");
        expect(windowsFor("tall")).toEqual({
            phone: { width: 390, height: TALL_HEIGHT },
            desktop: { width: 1440, height: TALL_HEIGHT },
        });
        expect(TALL_HEIGHT).toBe(5400);
    });

    test("the dev gallery is measured, then shot at its own height", () => {
        expect(layoutOf("dev-gallery-v2-light")).toBe("measured");
        expect(windowsFor("measured", { phone: 7000, desktop: 4200 })).toEqual({
            phone: { width: 390, height: 7000 },
            desktop: { width: 1440, height: 4200 },
        });
    });

    test("a measured page without its heights is an error", () => {
        expect(() => windowsFor("measured")).toThrow();
    });

    test("names that only look like a tall page stay fixed", () => {
        expect(layoutOf("settings-profile-light")).toBe("fixed");
        expect(layoutOf("recipes-empty-light")).toBe("fixed");
        expect(layoutOf("recipe-cook-dark")).toBe("fixed");
        expect(layoutOf("dev-gallery-light")).toBe("fixed");
    });
});

describe("the colour scheme", () => {
    test("follows the -dark suffix", () => {
        expect(colorSchemeOf("today-dark")).toBe("dark");
        expect(colorSchemeOf("today-light")).toBe("light");
        expect(colorSchemeOf("today")).toBe("light");
        expect(colorSchemeOf("dark-room-light")).toBe("light");
    });

    test("shotBase drops only a trailing theme suffix", () => {
        expect(shotBase("settings-dark")).toBe("settings");
        expect(shotBase("dark-room-light")).toBe("dark-room");
        expect(shotBase("light-dark-x")).toBe("light-dark-x");
    });
});

describe("parseDevToolsUrl", () => {
    test("reads the endpoint out of Chromium's stderr", () => {
        const text =
            "[1122/081319:ERROR:foo] noise\n" +
            "DevTools listening on ws://127.0.0.1:41233/devtools/browser/ab-12\n";
        expect(parseDevToolsUrl(text)).toBe(
            "ws://127.0.0.1:41233/devtools/browser/ab-12",
        );
    });

    test("is null until the line is complete", () => {
        expect(parseDevToolsUrl("DevTools listening on")).toBeNull();
        expect(parseDevToolsUrl("nothing here")).toBeNull();
    });
});

describe("parseMeasuredHeight", () => {
    test("reads a whole number", () => {
        expect(parseMeasuredHeight("6931")).toBe(6931);
    });

    test.each([null, undefined, "", "12px", "-3", "1.5", 40])(
        "%p is not a height",
        (v) => {
            expect(parseMeasuredHeight(v)).toBeNull();
        },
    );
});

describe("CdpRouter", () => {
    function pair() {
        const sent: Record<string, unknown>[] = [];
        const router = new CdpRouter((frame) => sent.push(JSON.parse(frame)));
        return { router, sent };
    }

    test("a reply resolves the command with its id, whatever the order", async () => {
        const { router, sent } = pair();
        const a = router.call("A.one");
        const b = router.call("B.two", { x: 1 }, "sess");
        expect(sent).toEqual([
            { id: 1, method: "A.one", params: {} },
            { id: 2, method: "B.two", params: { x: 1 }, sessionId: "sess" },
        ]);
        router.receive(JSON.stringify({ id: 2, result: { v: "b" } }));
        router.receive(JSON.stringify({ id: 1, result: { v: "a" } }));
        expect(await a).toEqual({ v: "a" });
        expect(await b).toEqual({ v: "b" });
    });

    test("an error reply rejects, naming the method", async () => {
        const { router } = pair();
        const p = router.call("Page.navigate");
        router.receive(
            JSON.stringify({ id: 1, error: { code: -32000, message: "nope" } }),
        );
        await expect(p).rejects.toThrow("Page.navigate: nope");
    });

    test("an event resolves the waiter that matches it, once", async () => {
        const { router } = pair();
        const mine = router.waitFor(
            (e) => e.method === "Done" && e.sessionId === "s2",
        );
        router.receive(
            JSON.stringify({ method: "Done", params: {}, sessionId: "s1" }),
        );
        router.receive(
            JSON.stringify({
                method: "Done",
                params: { n: 1 },
                sessionId: "s2",
            }),
        );
        expect(await mine).toEqual({
            method: "Done",
            params: { n: 1 },
            sessionId: "s2",
        });
    });

    test("close fails what is waiting and what comes after", async () => {
        const { router } = pair();
        const p = router.call("A.one");
        router.close(new Error("chromium exited"));
        await expect(p).rejects.toThrow("chromium exited");
        await expect(router.call("A.two")).rejects.toThrow("chromium exited");
    });

    test("close also fails a waiter, and a waiter registered after it", async () => {
        const { router } = pair();
        const w = router.waitFor((e) => e.method === "Never");
        router.close(new Error("chromium exited"));
        await expect(w).rejects.toThrow("chromium exited");
        await expect(router.waitFor(() => true)).rejects.toThrow(
            "chromium exited",
        );
    });

    test("garbage and replies nobody asked for are ignored", () => {
        const { router } = pair();
        router.receive("not json");
        router.receive(JSON.stringify({ id: 99, result: {} }));
    });
});

describe("withTimeout", () => {
    test("passes a result through", async () => {
        expect(await withTimeout(Promise.resolve(3), 1000, "x")).toBe(3);
    });

    test("rejects naming what hung", async () => {
        await expect(
            withTimeout(new Promise(() => {}), 10, "today.html"),
        ).rejects.toThrow("today.html: no answer");
    });
});

describe("navigationError", () => {
    test("a navigation that failed names its reason", () => {
        expect(
            navigationError({
                frameId: "F",
                errorText: "net::ERR_CONNECTION_REFUSED",
            }),
        ).toBe("net::ERR_CONNECTION_REFUSED");
    });

    test.each([{ frameId: "F" }, { errorText: "" }, {}, null, undefined])(
        "%p is a navigation that worked",
        (reply) => {
            expect(navigationError(reply)).toBeNull();
        },
    );
});
