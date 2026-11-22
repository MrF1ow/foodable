/**
 * The design's Avatar (FigCraft 171937): a 32 px circle with the person's
 * initials. Decorative unless it has a `label`, then an image with that name.
 *
 * The live member avatar (`avatar.ts`, `.fd-avatar`, with its picture) is
 * untouched; this is the design's circle under `fd-avatar-initials`.
 *
 * Styles: `public/app/v2/badges.css`.
 */
import { initialsOf } from "../../initials.js";
import { cls, esc, raw, type Html } from "./html.js";

export type AvatarInitialsOptions = {
    /** The person's name; the initials come from it. */
    name?: string;
    /** Initials already worked out; used instead of `name`'s. Empty is absent. */
    initials?: string;
    /** An accessible name; without one the circle is decorative. */
    label?: string;
    className?: string;
};

export function avatarInitials(opts: AvatarInitialsOptions): Html {
    const given = opts.initials?.trim();
    const initials = given
        ? given
        : opts.name != null
          ? initialsOf(opts.name)
          : null;
    if (initials == null) {
        throw new Error("avatarInitials: needs a name or initials");
    }
    const a11y =
        opts.label != null
            ? `role="img" aria-label="${esc(opts.label)}"`
            : `aria-hidden="true"`;
    return raw(
        `<span class="${cls("fd-avatar-initials", opts.className)}" ${a11y}>${esc(initials)}</span>`,
    );
}
