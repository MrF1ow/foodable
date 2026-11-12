import { expect, test } from "bun:test";

type Listener = (event: { target: { name?: string } }) => void;

async function setup(opts: { slots: string; checked: string }) {
    const slot = { value: "dinner" };
    const button = { disabled: true };
    let checked = opts.checked;
    const changeListeners: Listener[] = [];
    const dialog = {
        addEventListener: (type: string, fn: Listener) => {
            if (type === "change") changeListeners.push(fn);
        },
        querySelector: (sel: string) =>
            sel === 'input[name="search_meal_type"]:checked'
                ? { value: checked }
                : null,
    };
    const form = {
        getAttribute: (name: string) =>
            name === "data-fd-copy-yesterday-slots" ? opts.slots : null,
        closest: (sel: string) => (sel === "dialog" ? dialog : null),
        querySelector: (sel: string) =>
            sel === 'input[name="slot"]'
                ? slot
                : sel === "[data-fd-copy-yesterday-button]"
                  ? button
                  : null,
    };
    const page = {
        querySelectorAll: (sel: string) =>
            sel === "[data-fd-copy-yesterday]" ? [form] : [],
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
    const src = await Bun.file("./src/web/client/v2/copy-yesterday.js").text();
    new Function("window", "document", "WeakSet", src)(
        window,
        { querySelectorAll: () => [] },
        WeakSet,
    );
    return {
        slot,
        button,
        listeners: changeListeners,
        pick: (value: string) => {
            checked = value;
            changeListeners.forEach((fn) =>
                fn({ target: { name: "search_meal_type" } }),
            );
        },
        rerun: () => hook!(page),
    };
}

test("on load the slot is the checked meal and the tile follows the hints", async () => {
    const t = await setup({ slots: "breakfast dinner", checked: "dinner" });
    expect(t.slot.value).toBe("dinner");
    expect(t.button.disabled).toBe(false);
});

test("a slot yesterday did not fill (or today already has) disables the tile", async () => {
    const t = await setup({ slots: "breakfast", checked: "lunch" });
    expect(t.slot.value).toBe("lunch");
    expect(t.button.disabled).toBe(true);
});

test("choosing another meal in the sheet re-points the tile", async () => {
    const t = await setup({ slots: "breakfast", checked: "lunch" });
    t.pick("breakfast");
    expect(t.slot.value).toBe("breakfast");
    expect(t.button.disabled).toBe(false);
    t.pick("snack");
    expect(t.slot.value).toBe("snack");
    expect(t.button.disabled).toBe(true);
});

test("other inputs changing in the sheet are ignored", async () => {
    const t = await setup({ slots: "breakfast", checked: "lunch" });
    t.listeners[0]!({ target: { name: "q" } });
    expect(t.button.disabled).toBe(true);
});

test("running again on the same form does not bind twice", async () => {
    const t = await setup({ slots: "breakfast", checked: "lunch" });
    t.rerun();
    expect(t.listeners).toHaveLength(1);
});
