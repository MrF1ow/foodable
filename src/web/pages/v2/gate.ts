// The pages a signed-in person meets outside the app shell: create household,
// no household yet, not allowed (a refusal to someone who is in the household)
// and not found. Each is the design's Brand hero with a line under the name,
// then one column of fields, a caption and a button, all built from the shared
// components. `renderGatePage` in `shell.ts` wraps the body in a document.

import { brandHero } from "../../components/v2/brand-hero.js";
import { button } from "../../components/v2/button.js";
import { field } from "../../components/v2/field.js";
import { esc, join, raw, type Html } from "../../components/v2/html.js";

const NAME = "Foodable";

/** Log out is a full load: the session cookie goes and the page starts over. */
function logOut(): Html {
    return button({
        label: "Log out",
        href: "/logout",
        attrs: { "data-turbo": "false" },
    });
}

function column(content: Html | string): Html {
    return raw(`<div class="fd-auth__content">${content}</div>`);
}

function caption(text: string): string {
    return `<p class="fd-auth__caption">${esc(text)}</p>`;
}

/** First sign-in with no household: name it and yourself. */
export function createHouseholdGate(error?: string): Html {
    const form = `<form method="POST" action="/create-household" class="fd-auth__form">${join(
        [
            field({
                id: "household_name",
                name: "household_name",
                label: "Household name",
                labelHidden: true,
                placeholder: "Household name",
                required: true,
                maxlength: 80,
            }),
            field({
                id: "display_name",
                name: "display_name",
                label: "Your name",
                labelHidden: true,
                placeholder: "Your name",
                required: true,
                maxlength: 80,
            }),
            error
                ? `<p class="fd-auth__error" role="alert">${esc(error)}</p>`
                : "",
            button({
                label: "Create household",
                variant: "primary",
                type: "submit",
            }),
        ],
    )}</form>`;
    return join([
        brandHero({ title: NAME, tagline: "Name your household" }),
        // Someone signed in with the wrong account has a way out.
        column(join([form, logOut()])),
    ]);
}

/** Signed in, but not in a household. */
export function noHouseholdGate(): Html {
    return join([
        brandHero({ title: NAME, tagline: "No household yet" }),
        column(join([caption("Ask the owner for an invite code"), logOut()])),
    ]);
}

/** A refusal to someone who is in the household: they stay signed in and go
 * back to Today. The refusal's own words are the caption. */
export function notAllowedGate(
    message = "You don't have access to this page.",
): Html {
    return join([
        brandHero({ title: NAME, tagline: "Not allowed" }),
        column(
            join([
                caption(message),
                button({ label: "Go to Today", variant: "primary", href: "/" }),
            ]),
        ),
    ]);
}

/** A page, store or pair that is not there (or was deleted). */
export function notFoundGate(what = "Page"): Html {
    return join([
        brandHero({ title: NAME, tagline: `${what} not found` }),
        column(
            join([
                caption("It may have moved or been deleted"),
                button({ label: "Go to Today", variant: "primary", href: "/" }),
            ]),
        ),
    ]);
}
