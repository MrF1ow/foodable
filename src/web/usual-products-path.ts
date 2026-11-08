import type { Food } from "../domain/foods.js";
import { APP_PATHS, canonicalAppPath } from "./route-map.js";
import { isSafeAppBackPath } from "./settings-back.js";

/** Plain food id for the usual-product picker (products link to their parent). */
export function plainFoodIdForUsualPicker(
    foodId: string,
    row: Pick<Food, "genericFoodId"> | null | undefined,
): string {
    return row?.genericFoodId ?? foodId;
}

export function safeReturnPath(
    from: string | undefined,
    fallback: string,
): string {
    const trimmed = from?.trim();
    if (trimmed) {
        const canon = canonicalAppPath(trimmed);
        if (isSafeAppBackPath(canon)) return canon;
    }
    return fallback;
}

export function usualProductsPickerHref(foodId: string, from?: string): string {
    let href = `${APP_PATHS.kitchenUsuals}/${encodeURIComponent(foodId)}`;
    if (from && isSafeAppBackPath(from)) {
        href += `?from=${encodeURIComponent(from)}`;
    }
    return href;
}
