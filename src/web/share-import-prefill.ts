import type { ReadShareResult } from "../domain/share.js";
import { recipeSource } from "../domain/recipe-link.js";
import type { RecipeSourceKind } from "../domain/recipe-import.js";
import { IMPORT_RECIPE_MODAL_ID } from "./pages/recipes.js";

export type ShareImportPrefill = {
    openModalId: string;
    importUrl?: string;
    importError?: string;
    importPasteStep?: boolean;
    importPasteText?: string;
    importTextOrigin?: "shared";
    importSourceKind?: RecipeSourceKind;
    importSourceLabel?: string;
    importTextOnly?: boolean;
};

const NOTHING_MESSAGE =
    "Nothing to import came through. Paste the link or the recipe.";

export function shareImportPrefill(share: ReadShareResult): ShareImportPrefill {
    const base = {
        openModalId: IMPORT_RECIPE_MODAL_ID,
        importTextOrigin: "shared" as const,
    };

    if (share.link && share.text) {
        const info = recipeSource(new URL(share.link));
        return {
            ...base,
            importUrl: share.link,
            importPasteStep: true,
            importPasteText: share.text,
            importSourceKind: info.kind,
            importSourceLabel: info.label,
        };
    }

    if (share.link && !share.text) {
        const info = recipeSource(new URL(share.link));
        return {
            ...base,
            importUrl: share.link,
            importSourceKind: info.kind,
            importSourceLabel: info.label,
        };
    }

    if (!share.link && share.text) {
        return {
            ...base,
            importPasteStep: true,
            importPasteText: share.text,
            importTextOnly: true,
            importSourceKind: "text",
            importSourceLabel: "Recipe text",
        };
    }

    return {
        ...base,
        importError: NOTHING_MESSAGE,
    };
}
