import { expect, test } from "bun:test";

type Listener = (event: unknown) => void;
type Stub = {
    listeners: Record<string, Listener[]>;
    addEventListener(type: string, fn: Listener): void;
    dispatch(type: string, event?: unknown): void;
    [key: string]: any;
};

function el(extra: Record<string, unknown> = {}): Stub {
    const listeners: Record<string, Listener[]> = {};
    return {
        listeners,
        addEventListener(type: string, fn: Listener) {
            (listeners[type] ??= []).push(fn);
        },
        dispatch(type: string, event: unknown = {}) {
            for (const fn of listeners[type] ?? []) fn(event);
        },
        ...extra,
    };
}

/** A number input that implements stepUp/stepDown like the browser (clamps at the bounds). */
function makeInput(init: {
    value: string;
    min?: string;
    max?: string;
    step?: string;
}) {
    const fired: string[] = [];
    const input = el({
        value: init.value,
        min: init.min ?? "",
        max: init.max ?? "",
        step: init.step ?? "1",
        dispatchEvent(event: { type: string }) {
            fired.push(event.type);
            return true;
        },
        stepUp() {
            move(1);
        },
        stepDown() {
            move(-1);
        },
    }) as ReturnType<typeof el> & Record<string, any>;
    function move(dir: number) {
        const step = Number(input.step);
        const next = Number(input.value || 0) + dir * step;
        // Real browsers clamp stepUp/stepDown to min and max.
        const lo = input.min === "" ? -Infinity : Number(input.min);
        const hi = input.max === "" ? Infinity : Number(input.max);
        input.value = String(Math.min(hi, Math.max(lo, next)));
    }
    return { input, fired };
}

async function setup(init: Parameters<typeof makeInput>[0]) {
    const { input, fired } = makeInput(init);
    const minus = el({
        disabled: false,
        getAttribute: (n: string) => (n === "data-fd-step" ? "-1" : null),
    });
    const plus = el({
        disabled: false,
        getAttribute: (n: string) => (n === "data-fd-step" ? "1" : null),
    });
    const props: Record<string, string> = {};
    const root = el({
        style: { setProperty: (k: string, v: string) => (props[k] = v) },
        contains: () => true,
        querySelector: (sel: string) =>
            sel === "input"
                ? input
                : sel === '[data-fd-step="-1"]'
                  ? minus
                  : sel === '[data-fd-step="1"]'
                    ? plus
                    : null,
    });
    const page = {
        querySelectorAll: (sel: string) =>
            sel === "[data-fd-stepper]" ? [root] : [],
    };
    let hook: ((scope: unknown) => void) | undefined;
    const window = {
        FoodableApp: {
            onLoad: (fn: (scope: unknown) => void) => {
                hook = fn;
                fn(page);
            },
        },
    };
    class FakeEvent {
        constructor(public type: string) {}
    }
    const src = await Bun.file("./src/web/client/v2/stepper.js").text();
    new Function("window", "document", "Event", "WeakSet", src)(
        window,
        undefined,
        FakeEvent,
        WeakSet,
    );
    const click = (button: unknown) =>
        root.dispatch("click", { target: { closest: () => button } });
    return {
        input,
        fired,
        minus,
        plus,
        props,
        click,
        rerun: () => hook!(page),
        root,
    };
}

test("plus and minus move the value by the step and fire input then change", async () => {
    const s = await setup({ value: "150", min: "0", max: "5000", step: "5" });
    s.click(s.plus);
    expect(s.input.value).toBe("155");
    expect(s.fired).toEqual(["input", "change"]);
    s.click(s.minus);
    s.click(s.minus);
    expect(s.input.value).toBe("145");
    expect(s.fired.length).toBe(6);
});

test("the value is clamped to min and max, and the buttons disable at the bounds", async () => {
    const s = await setup({ value: "1", min: "0", max: "2" });
    s.click(s.minus);
    expect(s.input.value).toBe("0");
    expect(s.minus.disabled).toBe(true);
    expect(s.plus.disabled).toBe(false);
    s.click(s.plus);
    s.click(s.plus);
    expect(s.input.value).toBe("2");
    expect(s.plus.disabled).toBe(true);
    expect(s.minus.disabled).toBe(false);
});

test("a stepUp that an engine leaves out of range is still clamped", async () => {
    const s = await setup({ value: "9", min: "0", max: "10", step: "5" });
    s.input.stepUp = () => {
        s.input.value = "14";
    };
    s.click(s.plus);
    expect(s.input.value).toBe("10");
    expect(s.plus.disabled).toBe(true);
});

test("decimal steps do not accumulate float noise", async () => {
    const s = await setup({ value: "0.1", step: "0.1" });
    s.click(s.plus);
    s.click(s.plus);
    expect(s.input.value).toBe("0.3");
    s.click(s.minus);
    expect(s.input.value).toBe("0.2");
});

test("typing a value refreshes the disabled state and the width hint", async () => {
    const s = await setup({ value: "5", min: "0", max: "10" });
    s.input.value = "10";
    s.input.dispatch("input");
    expect(s.plus.disabled).toBe(true);
    s.input.value = "1234";
    s.input.dispatch("input");
    expect(s.props["--fd-chars"]).toBe("4");
});

test("a disabled button does nothing", async () => {
    const s = await setup({ value: "0", min: "0" });
    expect(s.minus.disabled).toBe(true);
    s.click(s.minus);
    expect(s.input.value).toBe("0");
    expect(s.fired).toEqual([]);
});

test("running onLoad again does not bind a second time", async () => {
    const s = await setup({ value: "1", step: "1" });
    s.rerun();
    s.rerun();
    s.click(s.plus);
    expect(s.input.value).toBe("2");
    expect(s.fired).toEqual(["input", "change"]);
});
