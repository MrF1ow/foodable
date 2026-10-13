export function formText(
    body: Record<string, string | File | (string | File)[]>,
    key: string,
): string {
    const value = body[key];
    if (Array.isArray(value)) {
        const first = value.find((item) => typeof item === "string");
        return typeof first === "string" ? first : "";
    }
    return typeof value === "string" ? value : "";
}

export function formAmount(
    body: Record<string, string | File | (string | File)[]>,
    key: string,
): number {
    return Number(formText(body, key));
}

/** A number field the user may leave blank: blank is undefined, anything
 * else is passed through Number (so junk becomes NaN for the caller to
 * reject). */
export function formOptionalNumber(
    body: Record<string, string | File | (string | File)[]>,
    key: string,
): number | undefined {
    const raw = formText(body, key).trim();
    return raw === "" ? undefined : Number(raw);
}

function asStringList(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.filter((item): item is string => typeof item === "string");
    }
    if (typeof value === "string") return [value];
    return [];
}

export type MealFormItem = {
    food_id?: string;
    name?: string;
    amount?: string;
    unit?: string;
};

export function formMealItems(
    body: Record<string, string | File | (string | File)[]>,
): MealFormItem[] {
    const foodIds = asStringList(body.item_food_id);
    const names = asStringList(body.item_name);
    const amounts = asStringList(body.item_amount);
    const units = asStringList(body.item_unit);
    const n = Math.max(
        foodIds.length,
        names.length,
        amounts.length,
        units.length,
    );
    const items: MealFormItem[] = [];
    for (let i = 0; i < n; i++) {
        const food_id = foodIds[i]?.trim() || undefined;
        const name = names[i]?.trim() || undefined;
        if (!food_id && !name) continue;
        items.push({
            food_id,
            name,
            amount: amounts[i],
            unit: units[i],
        });
    }
    return items;
}
