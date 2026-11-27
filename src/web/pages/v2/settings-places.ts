/**
 * Settings › Household › Fridge places: the places the household keeps things
 * in (Fridge, Freezer, Pantry), one row each with its item count, and "Add a
 * place" as an inline row, like Stores. A row's ⋯ removes the place: a confirm
 * dialog says how many items go with it. There is no rename (agents cannot
 * rename a place either).
 *
 * Owners and admins edit; everyone else reads. Every write posts and comes
 * back here with a 303 and no toast.
 */
import type { AppChromeBase } from "../../attention.js";
import { addRow } from "../../components/v2/add-row.js";
import { emptyState } from "../../components/v2/empty-state.js";
import { esc, join, raw, type Html } from "../../components/v2/html.js";
import { itemRow } from "../../components/v2/item-row.js";
import { listGroup } from "../../components/v2/list-group.js";
import { menu } from "../../components/v2/menu.js";
import { sheet, sheetSection } from "../../components/v2/sheet.js";
import { APP_PATHS } from "../../route-map.js";
import { renderHouseholdLayout } from "./settings-household-layout.js";
import { settingsErrorBanner } from "./settings-shared.js";

export const PLACES_PATH = APP_PATHS.settingsPlaces;

export const PLACES_ADD_ID = "fd-places-add";

/** The id of one place's remove dialog. */
export function placeRemoveSheetId(placeId: string): string {
    return `fd-place-remove-${placeId}`;
}

export type PlaceSummary = {
    id: string;
    name: string;
    /** Items filed under the place; they go with it. */
    itemCount: number;
};

export type SettingsPlacesV2View = {
    chrome: AppChromeBase;
    places: PlaceSummary[];
    /** Owners and admins edit; members only read. */
    canManage: boolean;
    error?: string;
    /** The add row, or a place's remove dialog, to render open (it comes back with its error). */
    open?: string;
};

function itemsLabel(count: number): string {
    return count === 0 ? "Empty" : `${count} ${count === 1 ? "item" : "items"}`;
}

/** What the dialog says goes with the place. */
function removeMessage(place: PlaceSummary): string {
    if (place.itemCount === 0) {
        return `${place.name} is empty. It will be removed from the Fridge.`;
    }
    const noun = place.itemCount === 1 ? "item" : "items";
    const verb = place.itemCount === 1 ? "is" : "are";
    return `${place.itemCount} ${noun} ${verb} in ${place.name}. ${place.itemCount === 1 ? "It goes" : "They go"} with the place, and the stock is adjusted to match.`;
}

function placeRow(place: PlaceSummary, canManage: boolean): Html {
    return itemRow({
        title: place.name,
        subtitle: itemsLabel(place.itemCount),
        ...(canManage
            ? {
                  trailing: {
                      kind: "control" as const,
                      html: menu({
                          label: `Actions for ${place.name}`,
                          anchor: "more",
                          items: [
                              {
                                  kind: "opens",
                                  label: "Remove",
                                  sheetId: placeRemoveSheetId(place.id),
                                  danger: true,
                              },
                          ],
                      }),
                  },
              }
            : {}),
    });
}

function removeSheet(place: PlaceSummary, open: boolean): string {
    const id = placeRemoveSheetId(place.id);
    const formId = `${id}-form`;
    return String(
        sheet({
            id,
            placement: "dialog",
            header: { kind: "title", title: `Remove ${place.name}?` },
            body: sheetSection({
                kind: "custom",
                content: raw(
                    `<form id="${formId}" method="post" action="${PLACES_PATH}/${encodeURIComponent(place.id)}/remove"><p class="fd-sheet__text">${esc(removeMessage(place))}</p></form>`,
                ),
            }),
            actions: {
                kind: "destructive",
                danger: { label: "Remove", type: "submit", form: formId },
            },
            openOnLoad: open,
        }),
    );
}

export function renderSettingsPlacesV2Body(view: SettingsPlacesV2View): string {
    const rows: Html[] = view.places.map((place) =>
        placeRow(place, view.canManage),
    );
    if (view.canManage) {
        rows.push(
            addRow({
                id: PLACES_ADD_ID,
                label: "Add a place",
                action: `${PLACES_PATH}/add`,
                name: "name",
                fieldLabel: "Place name",
                maxlength: 80,
                open: view.open === PLACES_ADD_ID,
                error: view.open === PLACES_ADD_ID ? view.error : undefined,
            }),
        );
    }
    const openRemove = view.places.find(
        (place) => view.open === placeRemoveSheetId(place.id),
    );
    const sheets = view.canManage
        ? view.places
              .map((place) => removeSheet(place, place === openRemove))
              .join("")
        : "";
    return `${String(
        join([
            // An add row that comes back open shows the refusal under its field.
            settingsErrorBanner(
                view.open === PLACES_ADD_ID ? undefined : view.error,
            ),
            rows.length > 0
                ? listGroup({ rows, label: "Fridge places" })
                : emptyState({
                      title: "No places yet",
                      body: "Ask an owner or an admin to add one.",
                  }),
        ]),
    )}${sheets}`;
}

export function renderSettingsPlacesV2Page(view: SettingsPlacesV2View): string {
    return renderHouseholdLayout({
        chrome: view.chrome,
        title: "Fridge places",
        className: "fd-places-page",
        body: renderSettingsPlacesV2Body(view),
    });
}
