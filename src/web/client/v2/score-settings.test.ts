import { expect, test } from "bun:test";

type Listener = (event: unknown) => void;

function listeners() {
    const map: Record<string, Listener[]> = {};
    return {
        add(type: string, fn: Listener) {
            (map[type] ??= []).push(fn);
        },
        fire(type: string, event: unknown) {
            for (const fn of map[type] ?? []) fn(event);
        },
    };
}

const PRESETS = {
    balanced: { nutrition: 40, processing: 25, additives: 20, environment: 15 },
    planet: { nutrition: 25, processing: 15, additives: 10, environment: 50 },
};

async function setup() {
    const parts = ["nutrition", "processing", "additives", "environment"];
    const props = new Map<string, string>();
    const sliders = parts.map((part, i) => ({
        name: `weight_${part}`,
        value: String(PRESETS.balanced[part as keyof typeof PRESETS.balanced]),
        classList: { contains: (c: string) => c === "fd-scoreset__range" },
        style: {
            setProperty: (k: string, v: string) => props.set(`${i}${k}`, v),
        },
    }));
    const outputs = parts.map(() => ({ textContent: "" }));
    const total = { textContent: "" };
    const custom = { checked: false };
    const l = listeners();
    const form = {
        getAttribute: () => JSON.stringify(PRESETS),
        addEventListener: l.add,
        querySelectorAll: (sel: string) =>
            sel === ".fd-scoreset__range"
                ? sliders
                : sel === "[data-fd-score-share]"
                  ? outputs
                  : [],
        querySelector: (sel: string) =>
            sel === "[data-fd-score-total]"
                ? total
                : sel === 'input[name="preset"][value="custom"]'
                  ? custom
                  : null,
    };
    const page = {
        querySelectorAll: (sel: string) =>
            sel === "[data-fd-score-form]" ? [form] : [],
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
    const src = await Bun.file("./src/web/client/v2/score-settings.js").text();
    new Function("window", "document", "WeakSet", src)(
        window,
        undefined,
        WeakSet,
    );
    return {
        sliders,
        outputs,
        total,
        custom,
        props,
        fire: l.fire,
        rerun: () => hook!(page),
    };
}

test("each slider shows its share of the total and the track fills to its value", async () => {
    const { outputs, total, props } = await setup();
    expect(outputs.map((o) => o.textContent)).toEqual([
        "40%",
        "25%",
        "20%",
        "15%",
    ]);
    expect(total.textContent).toBe("100%");
    expect(props.get("0--fd-fill")).toBe("40%");
});

test("moving a slider selects Custom and re-shares the total", async () => {
    const { sliders, outputs, custom, fire } = await setup();
    sliders[0]!.value = "0";
    sliders[1]!.value = "50";
    sliders[2]!.value = "50";
    sliders[3]!.value = "0";
    fire("input", { target: sliders[1] });
    expect(custom.checked).toBe(true);
    expect(outputs.map((o) => o.textContent)).toEqual([
        "0%",
        "50%",
        "50%",
        "0%",
    ]);
});

test("choosing a preset moves the sliders to its weights; Custom leaves them", async () => {
    const { sliders, outputs, fire } = await setup();
    fire("change", { target: { name: "preset", value: "planet" } });
    expect(sliders.map((s) => s.value)).toEqual(["25", "15", "10", "50"]);
    expect(outputs[3]!.textContent).toBe("50%");
    fire("change", { target: { name: "preset", value: "custom" } });
    expect(sliders.map((s) => s.value)).toEqual(["25", "15", "10", "50"]);
});

test("all-zero sliders show 0% rather than dividing by zero, and a re-run does not double-bind", async () => {
    const { sliders, outputs, total, fire, rerun } = await setup();
    rerun();
    for (const s of sliders) s.value = "0";
    fire("input", { target: sliders[0] });
    expect(outputs.map((o) => o.textContent)).toEqual(["0%", "0%", "0%", "0%"]);
    expect(total.textContent).toBe("0%");
});
