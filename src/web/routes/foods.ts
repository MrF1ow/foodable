import { Hono } from "hono";
import { requireMember, requireSiteUser, siteMember } from "../middleware.js";
import { searchFoodsByName } from "../../food-search.js";
import { liveFoodsStore } from "../../db/foods.js";
import {
    findOrCreateManualFood,
    FoodsInputError,
    searchFoodCatalog,
} from "../../domain/foods.js";
import {
    lookupBarcode,
    normalizeBarcode,
    type FoodResult,
} from "../../foods.js";
import { gatedRoute } from "../gated.js";
import { formText } from "../form.js";
import { redirectWithToast } from "../components/toast.js";
import { liveGroceryStore } from "../../db/grocery.js";
import { liveSettingsStore } from "../../db/settings.js";
import { addGroceryFoodById, GroceryInputError } from "../../domain/grocery.js";
import { safeReturnPath } from "../usual-products-path.js";
import { findOrCreateFoodByBarcodeResult } from "../../domain/foods.js";
import { fridgeBarcodeLookup } from "./fridge.js";
import {
    loadProductBarcodeInvalidData,
    loadProductBarcodeUnknownData,
    loadProductPageData,
    productPagePath,
    renderProductBarcodeInvalidPage,
    renderProductBarcodeUnknownPage,
    renderProductV2Page,
    PRODUCT_DEFAULT_BACK,
} from "../pages/v2/product.js";

export const foodsRoutes = new Hono();

function productBackHref(
    from: string | undefined,
    referer: string | null,
): string {
    const fromPath = from?.trim() ? safeReturnPath(from, "") : "";
    if (fromPath) return fromPath;
    if (referer) {
        try {
            const path = new URL(referer, "http://foodable.local").pathname;
            if (path.startsWith("/") && path !== "/foods") {
                const productPath = /^\/foods\/[^/]+$/.test(path);
                if (!productPath) return path;
            }
        } catch {
            /* ignore */
        }
    }
    return PRODUCT_DEFAULT_BACK;
}

foodsRoutes.get("/api/foods/search", requireMember, async (c) => {
    const query = (c.req.query("q") ?? "").trim();
    if (!query) return c.json({ foods: [] });
    const member = siteMember(c);
    let offHits: FoodResult[] = [];
    try {
        offHits = await searchFoodsByName(query, [], {
            householdId: member.householdId,
        });
    } catch {
        offHits = [];
    }
    const foods = await searchFoodCatalog(
        liveFoodsStore(),
        member.householdId,
        query,
        offHits,
    );
    return c.json({ foods });
});

foodsRoutes.get(
    "/foods/:id",
    requireSiteUser,
    gatedRoute("ui-v2", { notFound: true }),
    async (c) => {
        const backHref = productBackHref(
            c.req.query("from"),
            c.req.header("referer") ?? null,
        );
        const data = await loadProductPageData(
            c.get("userId"),
            c.req.param("id"),
            backHref,
        );
        if (!data) return c.text("Not Found", 404);
        return c.html(renderProductV2Page(data));
    },
);

foodsRoutes.post(
    "/foods/:id/add-to-grocery",
    requireMember,
    gatedRoute("ui-v2", { notFound: true }),
    async (c) => {
        const member = siteMember(c);
        const foodId = c.req.param("id");
        const foods = liveFoodsStore();
        const food = await foods.getFood(member.householdId, foodId);
        if (!food || food.archivedAt) return c.text("Not Found", 404);
        const grocery = liveGroceryStore();
        const settings = liveSettingsStore();
        try {
            await addGroceryFoodById(grocery, settings, foods, {
                householdId: member.householdId,
                foodId: food.id,
            });
        } catch (err) {
            const message =
                err instanceof GroceryInputError
                    ? err.message
                    : err instanceof Error
                      ? err.message
                      : "Could not add to the grocery list.";
            const page = await loadProductPageData(
                c.get("userId"),
                foodId,
                productBackHref(
                    c.req.query("from"),
                    c.req.header("referer") ?? null,
                ),
            );
            if (!page) return c.text("Not Found", 404);
            return c.html(
                renderProductV2Page({ ...page, error: message }),
                400,
            );
        }
        return redirectWithToast(
            c,
            productPagePath(food.id),
            "grocery.line.added",
        );
    },
);

foodsRoutes.get(
    "/foods/by-barcode/:code",
    requireMember,
    gatedRoute("ui-v2", { notFound: true }),
    async (c) => {
        const raw = c.req.param("code");
        const backHref = productBackHref(
            c.req.query("from"),
            c.req.header("referer") ?? null,
        );
        const normalized = normalizeBarcode(raw);
        if (!normalized) {
            const page = await loadProductBarcodeInvalidData(
                c.get("userId"),
                raw,
            );
            if (!page) return c.text("Not Found", 404);
            return c.html(
                renderProductBarcodeInvalidPage({ ...page, backHref }),
                400,
            );
        }
        const member = siteMember(c);
        let hit: FoodResult | null;
        try {
            hit = await lookupBarcode(normalized, {
                householdId: member.householdId,
            });
        } catch (err) {
            const message =
                err instanceof Error
                    ? err.message
                    : "Could not look up this barcode.";
            const view = await loadProductBarcodeUnknownData(
                c.get("userId"),
                normalized,
                backHref,
            );
            if (!view) return c.text("Not Found", 404);
            return c.html(
                renderProductBarcodeUnknownPage({
                    ...view,
                    lookupFailed: true,
                    error: message,
                }),
            );
        }
        if (hit == null) {
            const view = await loadProductBarcodeUnknownData(
                c.get("userId"),
                normalized,
                backHref,
            );
            if (!view) return c.text("Not Found", 404);
            return c.html(renderProductBarcodeUnknownPage(view));
        }
        const foods = liveFoodsStore();
        const { food } = await findOrCreateFoodByBarcodeResult(
            foods,
            member.householdId,
            normalized,
            (code) => fridgeBarcodeLookup(code, member.householdId),
        );
        // toast: none (scanner hand-off lands on the product page)
        return c.redirect(productPagePath(food.id), 303);
    },
);

foodsRoutes.post(
    "/foods/by-barcode/:code",
    requireMember,
    gatedRoute("ui-v2", { notFound: true }),
    async (c) => {
        const raw = c.req.param("code");
        const backHref = productBackHref(
            c.req.query("from"),
            c.req.header("referer") ?? null,
        );
        const normalized = normalizeBarcode(raw);
        if (!normalized) {
            const page = await loadProductBarcodeInvalidData(
                c.get("userId"),
                raw,
            );
            if (!page) return c.text("Not Found", 404);
            return c.html(
                renderProductBarcodeInvalidPage({ ...page, backHref }),
                400,
            );
        }
        const member = siteMember(c);
        const body = await c.req.parseBody();
        const name = formText(body, "name");
        const foods = liveFoodsStore();
        const existingId = await foods.getBarcodeFoodId(
            member.householdId,
            normalized,
        );
        if (existingId) {
            // toast: none (barcode already linked to a food)
            return c.redirect(productPagePath(existingId), 303);
        }
        try {
            const food = await findOrCreateManualFood(
                foods,
                member.householdId,
                "food",
                name,
            );
            await foods.setBarcode(member.householdId, normalized, food.id);
            // toast: none (new product page is the confirmation)
            return c.redirect(productPagePath(food.id), 303);
        } catch (err) {
            const message =
                err instanceof FoodsInputError
                    ? err.message
                    : err instanceof Error
                      ? err.message
                      : "Could not add food.";
            const view = await loadProductBarcodeUnknownData(
                c.get("userId"),
                normalized,
                backHref,
            );
            if (!view) return c.text("Not Found", 404);
            return c.html(
                renderProductBarcodeUnknownPage({ ...view, error: message }),
                400,
            );
        }
    },
);
