import { FIXTURE_APP_CHROME_FLAGS } from "./test-support/chrome-flags.js";
import { test, expect } from "bun:test";
import { APP_JS_SOURCES, getAppJs } from "./widgets.js";
import { TOASTS } from "./copy/toasts.js";
import { THEME_COLOR } from "./tokens.js";
import { ENTRANCE_FX_SCRIPT, renderAppShell } from "./web/shell.js";
import {
    buildPreviewKitchenFridgeView,
    renderKitchenFridgeV2Page,
} from "./web/pages/v2/kitchen-fridge.js";
import {
    buildPreviewKitchenGroceriesView,
    renderKitchenGroceriesV2Page,
} from "./web/pages/v2/kitchen-groceries.js";
import { renderRecipesListV2Page } from "./web/pages/v2/recipes-list.js";
import {
    buildPreviewTodayPageData,
    renderTodayV2Page,
} from "./web/pages/v2/today.js";

const PAGE_CHROME = {
    theme: "light" as const,
    flags: FIXTURE_APP_CHROME_FLAGS,
    identity: {
        viewerName: "Alice",
        viewerRole: "owner" as const,
        householdName: "Test household",
        memberCount: 1,
    },
};

// A bare tab page: the shell around one heading, with no tab content.
function shellPage(
    active: "fridge" | "household" = "fridge",
    theme: "system" | "light" | "dark" = "system",
): string {
    const title = active === "fridge" ? "Fridge" : "Settings";
    return renderAppShell({
        title,
        active,
        theme,
        body: `<h1>${title}</h1>`,
        flags: FIXTURE_APP_CHROME_FLAGS,
    });
}

/** Inline script bodies, read with an HTML parser rather than a tag regex. */
function scriptBodies(html: string): string[] {
    const bodies: string[] = [];
    let current = "";
    new HTMLRewriter()
        .on("script", {
            element(el) {
                current = "";
                el.onEndTag(() => {
                    bodies.push(current.trim());
                });
            },
            text(chunk) {
                current += chunk.text;
            },
        })
        .transform(html);
    return bodies.filter((body) => body.length > 0);
}

test("getAppJs bundles Turbo and concatenates client IIFEs", async () => {
    expect([...APP_JS_SOURCES]).toEqual([
        "./src/web/client/shell.js",
        "./src/web/client/toast.js",
        "./src/web/client/food-picker.js",
        "./src/web/client/modal.js",
        "./src/web/client/copy-prompt.js",
        "./src/web/client/busy-submit.js",
        "./src/web/client/sw-register.js",
    ]);
    const js = await getAppJs();
    expect(js).toContain("Turbo");
    expect(js).toContain("FoodableApp.onLoad");
    expect((js.match(/^\(function \(\) \{/gm) ?? []).length).toBe(7);
    expect(js).toContain("data-busy-form");
    // The old bottom nav is gone with its click handler and login guard.
    expect(js).not.toContain("nav.bottom-nav");
    // No page renders a data-fill trigger, so the dialog filler is gone.
    expect(js).not.toContain("data-fill-");
    expect(js).not.toContain("foodable:dialog-fill");
    for (const path of APP_JS_SOURCES) {
        let src = (await Bun.file(path).text()).trim();
        if (path.endsWith("shell.js")) {
            src = src.replace(
                "const THEME_PAGE_BG = null;",
                () => `const THEME_PAGE_BG = ${JSON.stringify(THEME_COLOR)};`,
            );
        }
        if (path.endsWith("toast.js")) {
            src = src.replace(
                "const TOAST_CATALOG = null;",
                () => `const TOAST_CATALOG = ${JSON.stringify(TOASTS)};`,
            );
        }
        expect(js).toContain(`(function () {\n${src}\n})();`);
    }
    expect(js).toContain(JSON.stringify(THEME_COLOR));
    // The nav surface colour is no longer a chrome colour: shell.js has none.
    expect(js).not.toContain("THEME_NAV_BG");
    // html.fx is set before first paint by the head script, not by shell.js:
    // shell.js only ends the entrance (fx-enter) and never adds a class.
    expect(js).not.toContain('classList.add("fx")');
    expect(js).toContain('classList.remove("fx-enter")');
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

test("no app page HTML contains a script with a body but the one that sets html.fx", () => {
    const today = renderTodayV2Page(
        buildPreviewTodayPageData(PAGE_CHROME as never, "2026-11-10"),
    );
    const fridge = renderKitchenFridgeV2Page(
        buildPreviewKitchenFridgeView(PAGE_CHROME as never, "2026-11-10"),
    );
    const grocery = renderKitchenGroceriesV2Page(
        buildPreviewKitchenGroceriesView(PAGE_CHROME as never),
    );
    const recipes = renderRecipesListV2Page({
        chrome: PAGE_CHROME,
        query: "",
        filter: "",
        totalCount: 0,
        cards: [],
    } as never);
    for (const html of [shellPage(), today, fridge, grocery, recipes]) {
        expect(html).toMatch(
            /<script src="\/app\.js\?v=[a-f0-9]{12}" defer data-turbo-track="reload"><\/script>/,
        );
        // The one inline script is the head's: it sets html.fx before first
        // paint, the same text on every page.
        expect(scriptBodies(html)).toEqual([
            ENTRANCE_FX_SCRIPT.slice("<script>".length, -"</script>".length),
        ]);
    }
});

test("the Groceries page ships the picker logic once", async () => {
    const html = renderKitchenGroceriesV2Page(
        buildPreviewKitchenGroceriesView(PAGE_CHROME as never),
    );
    expect((html.match(/data-food-picker/g) ?? []).length).toBe(1);
    expect(html).not.toContain("/api/foods/search");
    const picker = (
        await Bun.file("./src/web/client/food-picker.js").text()
    ).trim();
    const js = await getAppJs();
    expect(js.split(picker).length - 1).toBe(1);
});
