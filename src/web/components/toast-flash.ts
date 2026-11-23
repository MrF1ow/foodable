import type { ToastKey } from "../../copy/toasts.js";
import { truncateToastParam } from "../truncate-toast-param.js";
import type { ToastParams } from "./toast.js";

export type ToastFlashChoice = {
    key: ToastKey;
    params: ToastParams;
};

/**
 * POST /recipes/:id/cook/confirm. A clean cook says nothing: the recipe page
 * already shows it. Only trouble speaks: a kitchen that changed since the
 * preview outranks ingredients that were short or could not be counted. The
 * serving a cook logged shows on Today, so neither toast names its slot.
 */
export function cookSheetToastFlash(opts: {
    shortNames: string[];
    unmeasuredNames: string[];
    changedNames: string[];
}): ToastFlashChoice | null {
    if (opts.changedNames.length > 0) {
        return {
            key: "recipes.cooked.changed",
            params: { names: truncateToastParam(opts.changedNames.join(", ")) },
        };
    }
    const short = [...new Set([...opts.shortNames, ...opts.unmeasuredNames])];
    if (short.length > 0) {
        return {
            key: "recipes.cooked.short",
            params: { names: truncateToastParam(short.join(", ")) },
        };
    }
    return null;
}
