/**
 * Kitchen › Usuals › Add a usual. Three ways in, one sheet: a scanned barcode
 * resolves here and asks "What is it?", a search result or a scanned plain
 * food is added as it is, and Type it takes a name and its macros. The logic
 * is `src/domain/usual-add.ts`; these routes read the form, call it and put
 * the answer back in the sheet.
 *
 * Success is a 303 to Usuals (the store chip kept) with a toast. A refusal
 * re-renders the page at 400 with the sheet open on the step it came from, the
 * values kept and the message under the input it names.
 */
import { Hono } from "hono";
import { liveFoodsStore } from "../../db/foods.js";
import { liveSettingsStore } from "../../db/settings.js";
import {
    FoodsInputError,
    findOrCreateFoodByBarcodeResult,
    type UsualPurchasePatch,
} from "../../domain/foods.js";
import {
    addUsualByHand,
    addUsualFromProduct,
    removeUsual,
    UsualInputError,
    type UsualByHandBasis,
} from "../../domain/usual-add.js";
import { lookupBarcode, normalizeBarcode } from "../../foods.js";
import { formText } from "../form.js";
import { redirectWithToast } from "../components/toast.js";
import {
    renderUsualProductsListPage,
    type UsualAddRequest,
} from "../loaders.js";
import { requireMember, siteMember } from "../middleware.js";
import { safeReturnPath } from "../usual-products-path.js";

export const usualAddRoutes = new Hono();

const LIST = "/kitchen/usuals";

type Body = Record<string, string | File | (string | File)[]>;

/** The store chip a page was on, read back from its return path. */
function storeOf(path: string): string | undefined {
    const store = new URL(path, "http://foodable.local").searchParams.get(
        "store",
    );
    return store && store.trim() !== "" ? store : undefined;
}

function refusal(
    err: unknown,
): { message: string; field: string | null } | null {
    if (err instanceof UsualInputError) {
        return { message: err.message, field: err.field };
    }
    if (err instanceof FoodsInputError) {
        return { message: err.message, field: null };
    }
    return null;
}

async function reply(
    c: import("hono").Context,
    returnTo: string,
    add: UsualAddRequest,
    status: 200 | 400,
) {
    const page = await renderUsualProductsListPage(c.get("userId"), {
        storeFilter: storeOf(returnTo),
        add,
    });
    return c.html(page.html, page.status === 200 ? status : page.status);
}

const PURCHASE_FIELDS = ["usual_store_id", "usual_amount", "usual_unit"];

/** The store and amount the person picked, kept for a re-render. */
function purchaseValues(body: Body): Record<string, string> {
    const values: Record<string, string> = {};
    for (const name of PURCHASE_FIELDS) values[name] = formText(body, name);
    return values;
}

/**
 * Store and amount, as the sheet posts them. Each part is sent only when it was
 * picked, so a part left blank keeps what an existing usual already has (the
 * sheet is for adding: it never clears a store or an amount). Nothing picked
 * at all is `undefined`.
 */
function purchaseFromBody(body: Body): UsualPurchasePatch | undefined {
    const store = formText(body, "usual_store_id").trim();
    const amount = formText(body, "usual_amount").trim();
    const unit = formText(body, "usual_unit").trim();
    const patch: UsualPurchasePatch = {};
    if (store !== "") patch.usualStoreId = store;
    if (amount !== "" || unit !== "") {
        patch.usualAmount = {
            amount: amount === "" ? null : Number(amount),
            unit: unit === "" ? null : unit,
        };
    }
    return Object.keys(patch).length === 0 ? undefined : patch;
}

type Scan =
    | { kind: "invalid"; code: string }
    | {
          kind: "miss";
          code: string;
          lookupFailed: boolean;
          paused: boolean;
      }
    | { kind: "found"; code: string; productId: string };

/**
 * What a scanned code is: a product the household already has (checked first,
 * so a typed usual's own barcode needs no lookup), else Open Food Facts, whose
 * hit becomes a catalog row. A miss and an outage both land on Type it.
 */
async function resolveScan(householdId: string, raw: string): Promise<Scan> {
    const code = normalizeBarcode(raw);
    if (!code) return { kind: "invalid", code: raw };
    const foods = liveFoodsStore();
    const knownId = await foods.getBarcodeFoodId(householdId, code);
    const known = knownId ? await foods.getFood(householdId, knownId) : null;
    if (known && !known.archivedAt) {
        return { kind: "found", code, productId: known.id };
    }
    let hit;
    const notice: { message: string | null } = { message: null };
    try {
        hit = await lookupBarcode(code, { householdId, notice });
    } catch {
        return { kind: "miss", code, lookupFailed: true, paused: false };
    }
    if (hit == null) {
        return {
            kind: "miss",
            code,
            lookupFailed: false,
            paused: notice.message != null,
        };
    }
    // A scanned product is a product row of its own: it is never folded into
    // a food that only goes by its name; the person says what it is next.
    const { food } = await findOrCreateFoodByBarcodeResult(
        foods,
        householdId,
        code,
        async () => hit,
        { nameMatch: false },
    );
    return { kind: "found", code, productId: food.id };
}

usualAddRoutes.get(
    "/kitchen/usuals/add/barcode/:code",
    requireMember,
    async (c) => {
        const member = siteMember(c);
        const store = c.req.query("store");
        const returnTo = store
            ? `${LIST}?store=${encodeURIComponent(store)}`
            : LIST;
        let scan: Scan;
        try {
            scan = await resolveScan(member.householdId, c.req.param("code"));
        } catch (err) {
            // A refusal from the catalog (a name that is taken, say) shows in
            // the sheet instead of failing the page.
            const shown = refusal(err);
            if (!shown) throw err;
            return reply(c, returnTo, { tab: "scan", error: shown }, 400);
        }
        if (scan.kind === "found") {
            return reply(
                c,
                returnTo,
                {
                    tab: "scan",
                    scan: { ...scan, query: c.req.query("fq") ?? "" },
                },
                200,
            );
        }
        return reply(
            c,
            returnTo,
            {
                tab: scan.kind === "miss" ? "type" : "scan",
                scan,
            },
            scan.kind === "invalid" ? 400 : 200,
        );
    },
);

/** Scan → What is it? confirms here; Search adds a plain food as it is. */
usualAddRoutes.post("/kitchen/usuals/add/product", requireMember, async (c) => {
    const member = siteMember(c);
    const body = (await c.req.parseBody()) as Body;
    const returnTo = safeReturnPath(formText(body, "return_to"), LIST);
    const productId = formText(body, "product_id").trim();
    const choice = formText(body, "food_choice").trim();
    const newName = formText(body, "new_food_name");
    const fromSearch = formText(body, "via") === "search";
    try {
        await addUsualFromProduct(liveFoodsStore(), member.householdId, {
            productId,
            foodId: choice !== "" && choice !== "new" ? choice : null,
            newFoodName: choice === "new" ? newName : null,
            newFood: choice === "new",
            purchase: purchaseFromBody(body),
            stores: liveSettingsStore(),
            createdBy: c.get("userId"),
        });
    } catch (err) {
        const shown = refusal(err);
        if (!shown) throw err;
        if (fromSearch) {
            return reply(
                c,
                returnTo,
                { tab: "search", search: formText(body, "q"), error: shown },
                400,
            );
        }
        return reply(
            c,
            returnTo,
            {
                tab: "scan",
                scan: {
                    kind: "found",
                    code: formText(body, "scan_code"),
                    productId,
                    choice: choice === "" ? undefined : choice,
                    newName,
                    purchase: purchaseValues(body),
                },
                error: shown,
            },
            400,
        );
    }
    return redirectWithToast(c, returnTo, "usuals.added");
});

const TYPE_FIELDS = [
    "name",
    "basis",
    "serving_amount",
    "serving_unit",
    "calories",
    "protein_g",
    "carbs_g",
    "fat_g",
    "barcode",
    "usual_store_id",
    "usual_amount",
    "usual_unit",
] as const;

/** Type it: a name and its four macros make a food and its usual. */
usualAddRoutes.post("/kitchen/usuals/add/manual", requireMember, async (c) => {
    const member = siteMember(c);
    const body = (await c.req.parseBody()) as Body;
    const returnTo = safeReturnPath(formText(body, "return_to"), LIST);
    const basis = formText(body, "basis") as UsualByHandBasis;
    try {
        await addUsualByHand(liveFoodsStore(), member.householdId, {
            name: formText(body, "name"),
            basis,
            serving:
                basis === "per_serving"
                    ? {
                          amount: formText(body, "serving_amount"),
                          unit: formText(body, "serving_unit"),
                      }
                    : null,
            calories: formText(body, "calories"),
            proteinG: formText(body, "protein_g"),
            carbsG: formText(body, "carbs_g"),
            fatG: formText(body, "fat_g"),
            barcode: formText(body, "barcode").trim() || null,
            purchase: purchaseFromBody(body),
            stores: liveSettingsStore(),
            createdBy: c.get("userId"),
        });
    } catch (err) {
        const shown = refusal(err);
        if (!shown) throw err;
        const values: Record<string, string> = {};
        for (const name of TYPE_FIELDS) values[name] = formText(body, name);
        return reply(
            c,
            returnTo,
            { tab: "type", type: { values }, error: shown },
            400,
        );
    }
    return redirectWithToast(c, returnTo, "usuals.added");
});

/** Takes one usual off the list: its products, its stamp and its schedule. */
usualAddRoutes.post(
    "/kitchen/usuals/:foodId/remove",
    requireMember,
    async (c) => {
        const member = siteMember(c);
        const body = (await c.req.parseBody()) as Body;
        const returnTo = safeReturnPath(formText(body, "return_to"), LIST);
        try {
            await removeUsual(
                liveFoodsStore(),
                member.householdId,
                c.req.param("foodId"),
            );
        } catch (err) {
            const shown = refusal(err);
            if (!shown) throw err;
            const page = await renderUsualProductsListPage(c.get("userId"), {
                error: shown.message,
                storeFilter: storeOf(returnTo),
            });
            return c.html(page.html, 400);
        }
        return redirectWithToast(c, returnTo, "usuals.removed");
    },
);
