/**
 * Confirming in place: a destructive action never posts on its first tap. The
 * button that names it only arms it, and the idle buttons of its row give way
 * to Cancel and the same verb with its count ("Clear 3"); Cancel puts the row
 * back. The same two steps as a menu's `destructive` item
 * (`src/web/components/v2/menu.ts`), for a dock or a sheet's action row.
 *
 * The row (a `data-fd-confirm` container) holds the arm button
 * (`data-fd-confirm-arm`), whatever else is idle beside it
 * (`data-fd-confirm-idle`), and the two buttons made here, hidden until the
 * script arms the row (`src/web/client/v2/kitchen.js`). With no script the
 * verb button stays hidden, so nothing posts by accident.
 */
import { button } from "./button.js";
import type { Html } from "./html.js";
import { join } from "./html.js";

/** Attributes that make a button the arm of its row. */
export const CONFIRM_ARM_ATTRS: Readonly<Record<string, string>> = {
    "data-fd-confirm-arm": "",
};

/** Attributes for a button that goes away while the row is armed. */
export const CONFIRM_IDLE_ATTRS: Readonly<Record<string, string>> = {
    "data-fd-confirm-idle": "",
};

/** Cancel and the verb, hidden until the row is armed. */
export function confirmButtons(opts: {
    /** The verb with its count: "Clear 3". */
    label: string;
    /** The id of the form the verb posts. */
    form: string;
}): Html {
    return join(
        [
            button({
                label: "Cancel",
                attrs: { "data-fd-confirm-cancel": "", hidden: "" },
            }),
            button({
                label: opts.label,
                variant: "danger",
                type: "submit",
                attrs: {
                    form: opts.form,
                    "data-fd-confirm-go": "",
                    hidden: "",
                },
            }),
        ],
        "\n",
    );
}
