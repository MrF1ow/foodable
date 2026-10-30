import { test, expect } from "bun:test";
import { APP_JS_SOURCES, getAppJs } from "./widgets.js";
import { TOASTS } from "./copy/toasts.js";
import { THEME_COLOR, THEME_NAV_COLOR } from "./tokens.js";
import { comingSoonPage } from "./web/shell.js";
import { renderFridgePage } from "./web/pages/fridge.js";
import { renderGroceryPage } from "./web/pages/grocery.js";
import { renderNutritionPage } from "./web/pages/nutrition.js";
import { renderRecipesPage } from "./web/pages/recipes.js";
import type { HouseholdMember } from "./household.js";

function scriptBodies(html: string): string[] {
    return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
        .map((m) => (m[2] ?? "").trim())
        .filter((body) => body.length > 0);
}

test("getAppJs bundles Turbo and concatenates client IIFEs", async () => {
    expect([...APP_JS_SOURCES]).toEqual([
        "./src/web/client/shell.js",
        "./src/web/client/toast.js",
        "./src/web/client/food-picker.js",
        "./src/web/client/nutrition-log.js",
        "./src/web/client/grocery.js",
        "./src/web/client/dialog-fill.js",
        "./src/web/client/modal.js",
        "./src/web/client/arrange.js",
    ]);
    const js = await getAppJs();
    expect(js).toContain("Turbo");
    expect(js).toContain("FoodableApp.onLoad");
    expect((js.match(/^\(function \(\) \{/gm) ?? []).length).toBe(8);
    for (const path of APP_JS_SOURCES) {
        let src = (await Bun.file(path).text()).trim();
        if (path.endsWith("shell.js")) {
            src = src
                .replace(
                    "const THEME_PAGE_BG = null;",
                    `const THEME_PAGE_BG = ${JSON.stringify(THEME_COLOR)};`,
                )
                .replace(
                    "const THEME_NAV_BG = null;",
                    `const THEME_NAV_BG = ${JSON.stringify(THEME_NAV_COLOR)};`,
                );
        }
        if (path.endsWith("toast.js")) {
            src = src.replace(
                "const TOAST_CATALOG = null;",
                `const TOAST_CATALOG = ${JSON.stringify(TOASTS)};`,
            );
        }
        expect(js).toContain(`(function () {\n${src}\n})();`);
    }
    expect(js).toContain(JSON.stringify(THEME_NAV_COLOR));
    expect(js).toContain('classList.add("fx")');
    expect(() =>
        new Bun.Transpiler({ loader: "js" }).transformSync(js),
    ).not.toThrow();
});

test("getAppJs client IIFEs evaluate without ReferenceError when stubbed", async () => {
    const js = await getAppJs();
    const turboEnd = js.indexOf("(function () {");
    expect(turboEnd).toBeGreaterThan(0);
    const clientJs = js.slice(turboEnd);
    const html = {
        classList: { add() {} },
    };
    const document = {
        documentElement: html,
        body: { style: {} },
        querySelectorAll: () => [],
        addEventListener() {},
        querySelector: () => null,
    };
    const window = {
        FoodableApp: undefined,
        addEventListener() {},
        matchMedia: () => ({ matches: false }),
        requestAnimationFrame: () => 0,
        scrollY: 0,
        pageYOffset: 0,
        scrollTo() {},
    };
    class HTMLElement {}
    class HTMLFormElement extends HTMLElement {}
    class HTMLIFrameElement extends HTMLElement {}
    expect(() =>
        new Function(
            "document",
            "window",
            "Element",
            "HTMLElement",
            "HTMLFormElement",
            "HTMLIFrameElement",
            clientJs,
        )(
            document,
            window,
            HTMLElement,
            HTMLElement,
            HTMLFormElement,
            HTMLIFrameElement,
        ),
    ).not.toThrow();
});

test("no app page HTML contains a script with a body except widget frames", async () => {
    const fridge = renderFridgePage({
        locations: [
            {
                id: "loc-1",
                householdId: "hh-1",
                name: "Pantry",
                sortOrder: 0,
            },
            {
                id: "loc-2",
                householdId: "hh-1",
                name: "Fridge",
                sortOrder: 1,
            },
        ],
        items: [],
        chrome: { theme: "light" },
    });
    const grocery = renderGroceryPage({
        chrome: { theme: "light" },
        stores: [
            {
                id: "st-1",
                householdId: "hh-1",
                name: "Safeway",
                sortOrder: 0,
                rules: [],
                sections: [
                    {
                        id: "sec-other",
                        householdId: "hh-1",
                        storeId: "st-1",
                        name: "Other",
                        sortOrder: 8,
                        hidden: false,
                        isOther: true,
                        lines: [],
                    },
                ],
            },
        ],
    });
    const recipes = renderRecipesPage({
        chrome: { theme: "light" },
        recipes: [],
        members: [],
        viewerId: "11111111-1111-4111-8111-111111111111",
    });
    const member: HouseholdMember = {
        householdId: "hh-1",
        userId: "11111111-1111-4111-8111-111111111111",
        role: "owner",
        displayName: "Alice",
    };
    const nutrition = await renderNutritionPage({
        access: {
            ok: true,
            mode: "self",
            viewer: member,
            subject: member,
        },
        members: [member],
        summary: { locale: "en" },
        goals: { locale: "en" },
        trends: { locale: "en" },
        weight: { locale: "en" },
        chrome: { theme: "light" },
        cardOrder: [
            "nutrition-summary",
            "goal-progress",
            "trends",
            "weight-trends",
        ],
    });
    for (const html of [
        comingSoonPage("fridge"),
        fridge,
        grocery,
        recipes,
        nutrition,
    ]) {
        expect(html).toMatch(
            /<script src="\/app\.js\?v=[a-f0-9]{12}" defer data-turbo-track="reload"><\/script>/,
        );
        expect(scriptBodies(html)).toEqual([]);
    }
    expect(nutrition).toContain("widget-frame");
    expect(nutrition).not.toContain("srcdoc");
    expect(nutrition).toContain('src="/app/widgets/');
    expect(nutrition).not.toContain("&lt;script&gt;");
});

test("the Fridge page ships the picker logic once", async () => {
    const html = renderFridgePage({
        locations: [
            {
                id: "loc-1",
                householdId: "hh-1",
                name: "Pantry",
                sortOrder: 0,
            },
            {
                id: "loc-2",
                householdId: "hh-1",
                name: "Fridge",
                sortOrder: 1,
            },
        ],
        items: [],
        chrome: { theme: "light" },
    });
    expect((html.match(/data-food-picker/g) ?? []).length).toBe(1);
    expect(html).not.toContain("/api/foods/search");
    const picker = (
        await Bun.file("./src/web/client/food-picker.js").text()
    ).trim();
    const js = await getAppJs();
    expect(js.split(picker).length - 1).toBe(1);
});

type FridgeListener = (event: { source?: FakeNode | null }) => void;

type FakeNode = {
    tag: string;
    tagName: string;
    id: string;
    className: string;
    attrs: Record<string, string>;
    children: FakeNode[];
    parent: FakeNode | null;
    textContent: string;
    value: string;
    type: string;
    checked: boolean;
    disabled: boolean;
    open: boolean;
    listeners: Record<string, FridgeListener[]>;
    getAttribute(name: string): string | null;
    setAttribute(name: string, value: string): void;
    hasAttribute(name: string): boolean;
    addEventListener(type: string, fn: FridgeListener): void;
    querySelector(sel: string): FakeNode | null;
    querySelectorAll(sel: string): FakeNode[];
    showModal(): void;
    remove(): void;
    click(): void;
    closest(sel: string): FakeNode | null;
    getElementById?(id: string): FakeNode | null;
};

function matchesFridgeSel(node: FakeNode, sel: string): boolean {
    const parts =
        sel.match(
            /[a-zA-Z][\w-]*|#[\w-]+|\.[\w-]+|\[[\w-]+(?:=(?:'[^']*'|"[^"]*"))?\]/g,
        ) ?? [];
    if (parts.length === 0) return false;
    for (const part of parts) {
        if (part.startsWith("#")) {
            if (node.id !== part.slice(1)) return false;
        } else if (part.startsWith(".")) {
            if (!node.className.split(/\s+/).includes(part.slice(1))) {
                return false;
            }
        } else if (part.startsWith("[")) {
            const body = part.slice(1, -1);
            const eq = body.indexOf("=");
            if (eq === -1) {
                if (!node.hasAttribute(body)) return false;
            } else {
                let raw = body.slice(eq + 1);
                if (
                    (raw.startsWith("'") && raw.endsWith("'")) ||
                    (raw.startsWith('"') && raw.endsWith('"'))
                ) {
                    raw = raw.slice(1, -1);
                }
                if (node.getAttribute(body.slice(0, eq)) !== raw) return false;
            }
        } else if (node.tag !== part.toUpperCase()) {
            return false;
        }
    }
    return true;
}

function walkFridge(node: FakeNode, visit: (node: FakeNode) => void) {
    for (const child of node.children) {
        visit(child);
        walkFridge(child, visit);
    }
}

function queryFridge(node: FakeNode, sel: string): FakeNode[] {
    const sels = sel
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    const found: FakeNode[] = [];
    walkFridge(node, (child) => {
        if (sels.some((part) => matchesFridgeSel(child, part)))
            found.push(child);
    });
    return found;
}

function fakeNode(
    tag: string,
    attrs: Record<string, string>,
    children: FakeNode[] = [],
    text = "",
): FakeNode {
    const node = {
        tag: tag.toUpperCase(),
        tagName: tag.toUpperCase(),
        id: attrs.id ?? "",
        className: attrs.class ?? "",
        attrs: { ...attrs },
        children,
        parent: null,
        textContent: text,
        value: attrs.value ?? "",
        type: attrs.type ?? "",
        checked: false,
        disabled: false,
        open: false,
        listeners: {},
    } as FakeNode;
    Object.defineProperty(node, "attributes", {
        get() {
            return Object.entries(node.attrs).map(([name, value]) => ({
                name,
                value,
            }));
        },
    });
    node.getAttribute = (name) =>
        Object.prototype.hasOwnProperty.call(node.attrs, name)
            ? node.attrs[name]!
            : null;
    node.setAttribute = (name, value) => {
        node.attrs[name] = value;
        if (name === "id") node.id = value;
        if (name === "class") node.className = value;
    };
    node.hasAttribute = (name) =>
        Object.prototype.hasOwnProperty.call(node.attrs, name);
    node.addEventListener = (type, fn) => {
        (node.listeners[type] ??= []).push(fn);
    };
    node.querySelectorAll = (sel) => queryFridge(node, sel);
    node.querySelector = (sel) => queryFridge(node, sel)[0] ?? null;
    node.showModal = () => {
        node.open = true;
    };
    node.remove = () => {
        const parent = node.parent;
        if (!parent) return;
        parent.children = parent.children.filter((child) => child !== node);
        node.parent = null;
    };
    node.click = () => {
        for (const fn of node.listeners.click ?? []) fn({ source: node });
    };
    node.closest = (sel) => {
        for (let at: FakeNode | null = node; at; at = at.parent) {
            if (matchesFridgeSel(at, sel)) return at;
        }
        return null;
    };
    for (const child of children) child.parent = node;
    return node;
}

test("clicking a fridge row trigger fills the shared dialog", async () => {
    const hostile = `"><img src=x onerror=alert(1)>`;
    const amount = fakeNode("input", { name: "qty_amount", value: "" });
    const unit = fakeNode("select", { name: "qty_unit" });
    const location = fakeNode("select", { name: "location_id" });
    const expires = fakeNode("input", { name: "expires_on", value: "" });
    const foodForm = fakeNode(
        "form",
        { class: "fridge-item-edit", action: "" },
        [amount, unit, location, expires],
    );
    const foodTitle = fakeNode("h2", { class: "modal-title" }, [], "Edit item");
    const foodBanner = fakeNode("p", { class: "error-banner" }, [], "Nope");
    const foodDialog = fakeNode(
        "dialog",
        { id: "fridge-edit-food", class: "modal" },
        [foodTitle, foodBanner, foodForm],
    );
    const supplyAmount = fakeNode("input", { name: "qty_amount", value: "" });
    const supplyUnit = fakeNode("select", { name: "qty_unit" });
    const supplyLocation = fakeNode("select", { name: "location_id" });
    const supplyExpires = fakeNode("input", { name: "expires_on", value: "" });
    const supplyForm = fakeNode(
        "form",
        { class: "fridge-item-edit", action: "" },
        [supplyAmount, supplyUnit, supplyLocation, supplyExpires],
    );
    const supplyTitle = fakeNode(
        "h2",
        { class: "modal-title" },
        [],
        "Edit item",
    );
    const supplyDialog = fakeNode(
        "dialog",
        { id: "fridge-edit-supply", class: "modal" },
        [supplyTitle, supplyForm],
    );
    const deleteMessage = fakeNode(
        "p",
        { class: "modal-message" },
        [],
        "Remove this item from the fridge?",
    );
    const deleteForm = fakeNode(
        "form",
        { class: "modal-confirm", action: "" },
        [deleteMessage],
    );
    const deleteDialog = fakeNode(
        "dialog",
        { id: "fridge-delete-item", class: "modal" },
        [deleteForm],
    );
    const editButton = fakeNode("button", {
        command: "show-modal",
        commandfor: "fridge-edit-food",
        "data-fill-action": "/fridge/items/it-1",
        "data-fill-title": `Edit ${hostile}`,
        "data-fill-field-qty_amount": "6",
        "data-fill-field-qty_unit": "each",
        "data-fill-field-location_id": "loc-1",
        "data-fill-field-expires_on": "2026-11-02",
    });
    const deleteButton = fakeNode("button", {
        command: "show-modal",
        commandfor: "fridge-delete-item",
        "data-fill-action": "/fridge/items/it-1/delete",
        "data-fill-message": "Remove Eggs from the fridge?",
    });
    const supplyButton = fakeNode("button", {
        command: "show-modal",
        commandfor: "fridge-edit-supply",
        "data-fill-action": "/fridge/items/it-sup",
        "data-fill-title": "Edit Paper towels",
        "data-fill-field-qty_amount": "3",
        "data-fill-field-qty_unit": "roll",
        "data-fill-field-location_id": "loc-2",
        "data-fill-field-expires_on": "",
    });
    const document = fakeNode("document", {}, [
        foodDialog,
        supplyDialog,
        deleteDialog,
        editButton,
        deleteButton,
        supplyButton,
    ]);
    document.getElementById = (id) =>
        queryFridge(document, `#${id}`)[0] ?? null;
    const hooks: Array<(root: FakeNode) => void> = [];
    const window = {
        FoodableApp: {
            onLoad(fn: (root: FakeNode) => void) {
                hooks.push(fn);
                fn(document);
            },
            reinit(root: FakeNode) {
                for (const fn of hooks) fn(root);
            },
        },
    };
    const src = await Bun.file("./src/web/client/dialog-fill.js").text();
    new Function("document", "window", src)(document, window);

    editButton.click();
    expect(foodDialog.open).toBe(true);
    expect(foodForm.getAttribute("action")).toBe("/fridge/items/it-1");
    expect(amount.value).toBe("6");
    expect(unit.value).toBe("each");
    expect(location.value).toBe("loc-1");
    expect(expires.value).toBe("2026-11-02");
    expect(foodTitle.textContent).toBe(`Edit ${hostile}`);
    expect(foodDialog.querySelector(".error-banner")).toBeNull();

    deleteButton.click();
    expect(deleteDialog.open).toBe(true);
    expect(deleteForm.getAttribute("action")).toBe("/fridge/items/it-1/delete");
    expect(deleteMessage.textContent).toBe("Remove Eggs from the fridge?");

    supplyButton.click();
    expect(supplyDialog.open).toBe(true);
    expect(supplyForm.getAttribute("action")).toBe("/fridge/items/it-sup");
    expect(supplyAmount.value).toBe("3");
    expect(supplyUnit.value).toBe("roll");
    expect(supplyLocation.value).toBe("loc-2");
    expect(supplyExpires.value).toBe("");
    expect(supplyTitle.textContent).toBe("Edit Paper towels");

    editButton.setAttribute("data-fill-field-qty_amount", "9");
    for (const fn of foodDialog.listeners.command ?? []) {
        fn({ source: editButton });
    }
    expect(amount.value).toBe("9");
    expect(foodForm.getAttribute("action")).toBe("/fridge/items/it-1");

    const close = fakeNode("button", { command: "close" });
    for (const fn of foodDialog.listeners.command ?? []) fn({ source: close });
    expect(amount.value).toBe("9");
    expect(foodTitle.textContent).toBe(`Edit ${hostile}`);

    expect(editButton.listeners.click?.length).toBe(1);
    expect(foodDialog.listeners.command?.length).toBe(1);
    window.FoodableApp.reinit(document);
    expect(editButton.listeners.click?.length).toBe(1);
    expect(foodDialog.listeners.command?.length).toBe(1);

    const kept = fakeNode("p", { class: "error-banner" }, [], "Kept");
    foodDialog.children.push(kept);
    kept.parent = foodDialog;
    for (const fn of foodDialog.listeners.command ?? []) {
        fn({ source: editButton });
    }
    expect(foodDialog.querySelector(".error-banner")?.textContent).toBe("Kept");
    editButton.setAttribute("data-fill-action", "/fridge/items/it-2");
    for (const fn of foodDialog.listeners.command ?? []) {
        fn({ source: editButton });
    }
    expect(foodDialog.querySelector(".error-banner")).toBeNull();
    expect(foodForm.getAttribute("action")).toBe("/fridge/items/it-2");
});

test("dialog fill checks boxes and falls back to the first select option", async () => {
    const milk = fakeNode("input", {
        type: "checkbox",
        name: "allergens",
        value: "milk",
    });
    const egg = fakeNode("input", {
        type: "checkbox",
        name: "allergens",
        value: "egg",
    });
    const archived = fakeNode("input", {
        type: "checkbox",
        name: "archived",
        value: "1",
    });
    const unit = fakeNode("select", { name: "qty_unit", value: "g" });
    const options = ["g", "ml"];
    let index = 0;
    (unit as { options?: { value: string }[] }).options = options.map(
        (value) => ({ value }),
    );
    Object.defineProperty(unit, "value", {
        get: () => (index >= 0 ? options[index]! : ""),
        set: (value: string) => {
            index = options.indexOf(value);
        },
    });
    Object.defineProperty(unit, "selectedIndex", {
        get: () => index,
        set: (value: number) => {
            index = value;
        },
    });
    const submit = fakeNode("button", { type: "submit" });
    submit.disabled = true;
    const form = fakeNode("form", { action: "" }, [
        milk,
        egg,
        archived,
        unit,
        submit,
    ]);
    const dialog = fakeNode("dialog", { id: "food-edit", class: "modal" }, [
        form,
    ]);
    const button = fakeNode("button", {
        command: "show-modal",
        commandfor: "food-edit",
        "data-fill-action": "/settings/foods/f1",
        "data-fill-field-allergens": "milk",
        "data-fill-field-archived": "true",
        "data-fill-field-qty_unit": "nope",
    });
    const document = fakeNode("document", {}, [dialog, button]);
    document.getElementById = (id) =>
        queryFridge(document, `#${id}`)[0] ?? null;
    const window = {
        FoodableApp: {
            onLoad(fn: (root: FakeNode) => void) {
                fn(document);
            },
        },
    };
    const src = await Bun.file("./src/web/client/dialog-fill.js").text();
    new Function("document", "window", src)(document, window);
    button.click();
    expect(milk.checked).toBe(true);
    expect(egg.checked).toBe(false);
    expect(archived.checked).toBe(true);
    expect(unit.value).toBe("g");
    expect(submit.disabled).toBe(false);
    expect(form.getAttribute("action")).toBe("/settings/foods/f1");
});

test("dialog fill copies text, class, and html slots", async () => {
    const label = fakeNode(
        "button",
        { type: "submit", "data-fill-slot": "label" },
        [],
        "Old",
    );
    label.disabled = true;
    const body = fakeNode("div", { "data-fill-slot": "body" });
    const banner = fakeNode("p", { class: "error-banner" }, [], "Nope");
    const transient = fakeNode("p", { "data-fill-transient": "" }, [], "Warn");
    const amount = fakeNode("input", { name: "qty_amount", value: "" });
    const form = fakeNode("form", { action: "" }, [label, amount]);
    const dialog = fakeNode("dialog", { id: "shared", class: "modal" }, [
        banner,
        transient,
        form,
        body,
    ]);
    const events: string[] = [];
    (dialog as { dispatchEvent?: (event: Event) => boolean }).dispatchEvent = (
        event,
    ) => {
        events.push(event.type);
        return true;
    };
    const button = fakeNode("button", {
        command: "show-modal",
        commandfor: "shared",
        "data-fill-action": "/grocery/lines",
        "data-fill-field-qty_amount": "2",
        "data-fill-text-label": "Hello",
        "data-fill-class-label": "btn-primary",
        "data-fill-html-body": "<p>One</p>",
    });
    const document = fakeNode("document", {}, [dialog, button]);
    document.getElementById = (id) =>
        queryFridge(document, `#${id}`)[0] ?? null;
    const window = {
        FoodableApp: {
            onLoad(fn: (root: FakeNode) => void) {
                fn(document);
            },
        },
    };
    const src = await Bun.file("./src/web/client/dialog-fill.js").text();
    new Function("document", "window", src)(document, window);
    button.click();
    expect(dialog.open).toBe(true);
    expect(form.getAttribute("action")).toBe("/grocery/lines");
    expect(amount.value).toBe("2");
    expect(label.textContent).toBe("Hello");
    expect(label.getAttribute("class")).toBe("btn-primary");
    expect((body as { innerHTML?: string }).innerHTML).toBe("<p>One</p>");
    expect(body.getAttribute("data-filled-html")).toBe("<p>One</p>");
    expect(dialog.querySelector(".error-banner")).toBeNull();
    expect(dialog.querySelector("[data-fill-transient]")).toBeNull();
    expect(label.disabled).toBe(false);
    expect(events).toEqual(["foodable:dialog-fill"]);

    const kept = fakeNode("p", { class: "error-banner" }, [], "Kept");
    dialog.children.push(kept);
    kept.parent = dialog;
    button.click();
    expect(dialog.querySelector(".error-banner")?.textContent).toBe("Kept");
    expect((body as { innerHTML?: string }).innerHTML).toBe("<p>One</p>");

    button.setAttribute("data-fill-html-body", "<p>Two</p>");
    button.setAttribute("data-fill-class-label", "");
    button.click();
    expect(dialog.querySelector(".error-banner")).toBeNull();
    expect((body as { innerHTML?: string }).innerHTML).toBe("<p>Two</p>");
    expect(body.getAttribute("data-filled-html")).toBe("<p>Two</p>");
    expect(label.getAttribute("class")).toBe("");
});

test("dialog fill keeps a same-target allergen retry", async () => {
    const pickerName = fakeNode("input", { name: "food_name", value: "" });
    const pickerStore = fakeNode("input", { name: "store_id", value: "s1" });
    const picker = fakeNode("form", { action: "/grocery/lines" }, [
        pickerStore,
        pickerName,
    ]);
    const retryName = fakeNode("input", {
        name: "food_name",
        value: "Peanut butter",
    });
    const retry = fakeNode("div", { "data-fill-transient": "" }, [
        fakeNode("p", { class: "allergen-warning" }, [], "Contains peanuts"),
        fakeNode("form", { action: "/grocery/lines" }, [retryName]),
    ]);
    const banner = fakeNode("p", { class: "error-banner" }, [], "Allergen");
    const dialog = fakeNode("dialog", { id: "shared", class: "modal" }, [
        banner,
        retry,
        picker,
    ]);
    const same = fakeNode("button", {
        command: "show-modal",
        commandfor: "shared",
        "data-fill-field-store_id": "s1",
        "data-fill-field-food_name": "",
    });
    const other = fakeNode("button", {
        command: "show-modal",
        commandfor: "shared",
        "data-fill-field-store_id": "s2",
        "data-fill-field-food_name": "",
    });
    const document = fakeNode("document", {}, [dialog, same, other]);
    document.getElementById = (id) =>
        queryFridge(document, `#${id}`)[0] ?? null;
    const window = {
        FoodableApp: {
            onLoad(fn: (root: FakeNode) => void) {
                fn(document);
            },
        },
    };
    const src = await Bun.file("./src/web/client/dialog-fill.js").text();
    new Function("document", "window", src)(document, window);

    same.click();
    expect(dialog.querySelector("[data-fill-transient]")).not.toBeNull();
    expect(dialog.querySelector(".error-banner")?.textContent).toBe("Allergen");
    expect(retryName.value).toBe("Peanut butter");

    other.click();
    expect(dialog.querySelector("[data-fill-transient]")).toBeNull();
    expect(dialog.querySelector(".error-banner")).toBeNull();
    expect(pickerStore.value).toBe("s2");
});
