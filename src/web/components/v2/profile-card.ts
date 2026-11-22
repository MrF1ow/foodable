/**
 * The design's Profile card (FigCraft 381535): the person's name and email
 * beside their initials, over a row of key / value fields (household,
 * members, role).
 *
 * Styles: `public/app/v2/cards.css`.
 */
import { valueText } from "./card.js";
import { avatarInitials } from "./avatar-initials.js";
import { cls, esc, raw, type Html } from "./html.js";

export type ProfileCardOptions = {
    name: string;
    email?: string;
    /** Initials already worked out; default from `name`. */
    initials?: string;
    fields: readonly { key: string; value: string | number | null }[];
    className?: string;
};

export function profileCard(opts: ProfileCardOptions): Html {
    const email =
        opts.email != null
            ? `<span class="fd-profile-card__email">${esc(opts.email)}</span>`
            : "";
    const fields =
        opts.fields.length > 0
            ? `<dl class="fd-profile-card__fields">${opts.fields
                  .map(
                      (f) =>
                          `<div class="fd-profile-card__field"><dt class="fd-profile-card__key">${esc(f.key)}</dt><dd class="fd-profile-card__val">${valueText(f.value)}</dd></div>`,
                  )
                  .join("")}</dl>`
            : "";
    const avatar = avatarInitials({
        name: opts.name,
        initials: opts.initials,
    });
    return raw(
        `<div class="${cls("fd-profile-card", opts.className)}"><div class="fd-profile-card__who"><span class="fd-profile-card__id"><span class="fd-profile-card__name">${esc(opts.name)}</span>${email}</span>${avatar}</div>${fields}</div>`,
    );
}
