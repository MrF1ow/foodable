// The bridge appends a "just ask to update your settings" footer under every
// painted widget. That copy is for chat hosts. The household web app seeds the
// data itself (window.__WIDGET_DATA__, see withWidgetData in src/widgets.ts),
// and there the footer is wrong.
//
// Same technique as macros.test.ts: evaluate the real shared source with just
// enough window/document to run initWidget once.
import { test, expect } from "bun:test";

const BRIDGE = await Bun.file("./public/widgets/src/shared/bridge.js").text();
const FOOTER = "You can enable or disable these widgets anytime";

function paintedNotes(
    seeded: unknown,
    hasHost: boolean,
    docStyle: Record<string, string> = {},
): string[] {
    const notes: string[] = [];
    const root = {
        innerHTML: "",
        appendChild(node: { textContent: string }) {
            notes.push(node.textContent);
        },
    };
    const docEl = {
        style: docStyle,
        setAttribute() {},
        getBoundingClientRect: () => ({ height: 100 }),
    };
    const document = {
        getElementById: () => root,
        documentElement: docEl,
        body: docEl,
        createElement: () => ({ textContent: "", style: { cssText: "" } }),
    };
    const window: Record<string, unknown> = {
        __WIDGET_DATA__: seeded,
        innerWidth: 400,
        addEventListener() {},
    };
    window.parent = hasHost ? { postMessage() {} } : window;
    const run = new Function(
        "window",
        "document",
        "ResizeObserver",
        "requestAnimationFrame",
        `${BRIDGE}
initWidget({ name: "t", loading: "", coerce: (d) => d, sample: { s: 1 },
    render: () => { document.getElementById("root").innerHTML = "<p>card</p>"; } });`,
    );
    run(
        window,
        document,
        class {
            observe() {}
        },
        (cb: () => void) => cb(),
    );
    return notes;
}

test("data seeded by the household app paints without the chat footer", () => {
    expect(paintedNotes({ locale: "en" }, true)).toEqual([]);
});

test("the standalone preview still shows the footer", () => {
    expect(
        paintedNotes(undefined, false).some((n) => n.startsWith(FOOTER)),
    ).toBe(true);
});

// The household app sizes its frames to the reported height, so a seeded
// widget must never scroll: a transient scrollbar narrows the layout, the
// height is measured at that width, and Chromium keeps the scrollbar.
test("a seeded widget in a frame hides overflow; chat hosts are untouched", () => {
    const seededStyle: Record<string, string> = {};
    paintedNotes({ locale: "en" }, true, seededStyle);
    expect(seededStyle.overflow).toBe("hidden");

    const chatStyle: Record<string, string> = {};
    paintedNotes(undefined, true, chatStyle);
    expect(chatStyle.overflow).toBeUndefined();

    const standaloneStyle: Record<string, string> = {};
    paintedNotes(undefined, false, standaloneStyle);
    expect(standaloneStyle.overflow).toBeUndefined();
});
