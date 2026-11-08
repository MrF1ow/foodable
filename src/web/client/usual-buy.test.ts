import { expect, test } from "bun:test";
import { newFood } from "../../domain/foods.js";
import { renderUsualProductsPickerPage } from "../pages/usual-products.js";

type Field = { value: string };

function radio(
    form: {
        hasAttribute(name: string): boolean;
        querySelector(s: string): Field | null;
    },
    attrs: Record<string, string>,
) {
    return {
        form,
        matches: (selector: string) =>
            selector === 'input[type="radio"][name="product_food_id"]',
        getAttribute: (name: string) => attrs[name] ?? null,
    };
}

test("usual-buy.js swaps Usually buy and at to the selected radio's own values", async () => {
    const fields: Record<string, Field> = {
        usual_amount: { value: "50" },
        usual_unit: { value: "lb" },
        usual_store_id: { value: "sams" },
    };
    const form = {
        hasAttribute: (name: string) => name === "data-usual-buy-follow",
        querySelector: (selector: string) =>
            fields[selector.replace(/^\[name="(.+)"\]$/, "$1")] ?? null,
    };
    let onChange: ((event: { target: unknown }) => void) | undefined;
    const document = {
        addEventListener(
            type: string,
            fn: (event: { target: unknown }) => void,
        ) {
            if (type === "change") onChange = fn;
        },
    };
    const src = await Bun.file("./src/web/client/usual-buy.js").text();
    new Function("document", src)(document);

    // None: the plain food has nothing of its own, so the fields clear.
    onChange!({
        target: radio(form, {
            "data-usual-amount": "",
            "data-usual-unit": "",
            "data-usual-store": "",
        }),
    });
    expect(fields.usual_amount!.value).toBe("");
    expect(fields.usual_unit!.value).toBe("");
    expect(fields.usual_store_id!.value).toBe("");

    // Back to the product: its own values return.
    onChange!({
        target: radio(form, {
            "data-usual-amount": "50",
            "data-usual-unit": "lb",
            "data-usual-store": "sams",
        }),
    });
    expect(fields.usual_amount!.value).toBe("50");
    expect(fields.usual_unit!.value).toBe("lb");
    expect(fields.usual_store_id!.value).toBe("sams");

    // A radio outside the picker form is ignored.
    const other = { ...form, hasAttribute: () => false };
    onChange!({ target: radio(other, { "data-usual-amount": "1" }) });
    expect(fields.usual_amount!.value).toBe("50");
});

test("picker radios carry each row's own usual store and amount", () => {
    const flour = newFood({
        householdId: "hh",
        kind: "food",
        name: "All-purpose flour",
    });
    const almonds = {
        ...newFood({
            householdId: "hh",
            kind: "food",
            name: "Almonds",
            genericFoodId: flour.id,
        }),
        usualStoreId: "sams",
        usualAmount: { amount: 50, unit: "lb" },
    };
    const html = renderUsualProductsPickerPage({
        chrome: { theme: null, attention: { count: 0, tabs: {} } },
        food: { ...flour, usualProductId: almonds.id },
        products: [almonds],
        usualProductId: almonds.id,
        prefillStoreId: "sams",
        prefillAmount: { amount: 50, unit: "lb" },
        stores: [
            { id: "sams", householdId: "hh", name: "Sam's Club", sortOrder: 0 },
        ],
        from: "/kitchen/usuals",
    } as never);
    expect(html).toContain("data-usual-buy-follow");
    // None carries the plain food's own (empty) values, not the product's.
    expect(html).toMatch(
        /name="product_food_id" value="" data-usual-amount="" data-usual-unit="" data-usual-store=""/,
    );
    expect(html).toContain(
        `value="${almonds.id}" data-usual-amount="50" data-usual-unit="lb" data-usual-store="sams" checked`,
    );
});
