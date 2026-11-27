import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import {
    placeRemoveSheetId,
    renderSettingsPlacesV2Page,
    type SettingsPlacesV2View,
} from "./settings-places.js";

const chrome = {
    theme: "light" as const,
    flags: FIXTURE_APP_CHROME_FLAGS,
};

function view(over: Partial<SettingsPlacesV2View> = {}): SettingsPlacesV2View {
    return {
        chrome,
        places: [
            { id: "p1", name: "Fridge", itemCount: 12 },
            { id: "p2", name: "Freezer", itemCount: 1 },
            { id: "p3", name: "Pantry", itemCount: 0 },
        ],
        canManage: true,
        ...over,
    };
}

describe("settings fridge places page", () => {
    test("lists each place with its item count, in the Household section, no chevron", () => {
        const html = renderSettingsPlacesV2Page(view());
        expect(html).toContain('data-fd-settings-page="household"');
        expect(html).toContain("<title>Fridge places</title>");
        expect(html).toContain(">12 items<");
        expect(html).toContain(">1 item<");
        expect(html).toContain(">Empty<");
        // A row that opens a menu or a dialog goes nowhere, so it has no chevron.
        expect(html).not.toContain("fd-item-row__chevron");
        expect(html).toMatch(
            /fd-settings-detail[\s\S]*?aria-label="Back" href="\/settings\/household"/,
        );
    });

    test("an owner or admin gets an add row and a remove dialog per place that names the count", () => {
        const html = renderSettingsPlacesV2Page(view());
        expect(html).toContain('id="fd-places-add"');
        expect(html).toContain('action="/settings/household/places/add"');
        expect(html).toContain('name="name"');
        for (const id of ["p1", "p2", "p3"]) {
            expect(html).toContain(`id="${placeRemoveSheetId(id)}"`);
            expect(html).toContain(
                `action="/settings/household/places/${id}/remove"`,
            );
        }
        expect(html).toContain("Remove Fridge?");
        expect(html).toContain("12 items are in Fridge.");
        expect(html).toContain("They go with the place");
        expect(html).toContain("1 item is in Freezer.");
        expect(html).toContain("It goes with the place");
        expect(html).toContain("Pantry is empty.");
        // The Remove choice sits in the row's menu, in the danger tone.
        expect(html).toContain("fd-menu__item--danger");
        // No rename: agents cannot rename a place either.
        expect(html).not.toContain("Rename");
    });

    test("a member reads the list: no add row, no menu, no dialog", () => {
        const html = renderSettingsPlacesV2Page(view({ canManage: false }));
        expect(html).toContain("Freezer");
        expect(html).not.toContain("fd-places-add");
        expect(html).not.toContain("/remove");
        expect(html).not.toContain("data-fd-menu-trigger");
        expect(html).not.toContain(placeRemoveSheetId("p2"));
    });

    test("no places: an owner gets the add row, a member is told whom to ask", () => {
        const owner = renderSettingsPlacesV2Page(view({ places: [] }));
        expect(owner).toContain('id="fd-places-add"');
        const member = renderSettingsPlacesV2Page(
            view({ places: [], canManage: false }),
        );
        expect(member).toContain("No places yet");
        expect(member).toContain("Ask an owner or an admin to add one.");
    });

    test("an add that failed comes back open with its error under the field, not in a banner", () => {
        const html = renderSettingsPlacesV2Page(
            view({
                open: "fd-places-add",
                error: "That location already exists.",
            }),
        );
        expect(html).toMatch(/fd-places-add[\s\S]*?<details[^>]* open/);
        expect(html.split("That location already exists.")).toHaveLength(2);
    });

    test("a removal that failed opens that place's dialog and shows the error in a banner", () => {
        const html = renderSettingsPlacesV2Page(
            view({
                open: placeRemoveSheetId("p2"),
                error: "Could not save that. Try again.",
            }),
        );
        expect(html).toContain("Could not save that. Try again.");
        const sheets = html.split("data-sheet-open-on-load");
        expect(sheets).toHaveLength(2);
        expect(sheets[0]!.slice(-300)).toContain(placeRemoveSheetId("p2"));
    });
});
