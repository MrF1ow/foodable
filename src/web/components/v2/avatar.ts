/**
 * The member avatar: the round `.fd-avatar` with the member's initials, or,
 * when the profile-pictures flag is on and the member has set one, their
 * picture over the initials. Every place the app draws a member's circle goes
 * through here, so the picture URL and its escaping live in one place.
 */
import { initialsOf } from "../../initials.js";
import { cls, esc, raw, type Html } from "./html.js";

export type MemberAvatarOpts = {
    /** The member's display name; the initials come from it. */
    name: string;
    /** Initials already worked out by the caller; used instead of `name`'s. */
    initials?: string;
    /** Whose picture to ask for. Without it only initials are drawn. */
    userId?: string;
    /** When the picture last changed (a Date or epoch ms); null or undefined
     *  when the member has none. Part of the URL so a new picture is fetched. */
    version?: Date | number | null;
    /** The profile-pictures flag. Off draws initials whatever else is given. */
    enabled: boolean;
    /** Extra classes for the circle (size and spacing of the call site). */
    className?: string;
};

/** The URL a member's picture is served from; `version` busts the cache. */
export function avatarUrl(userId: string, version: Date | number): string {
    const v = version instanceof Date ? version.getTime() : version;
    return `/avatars/${encodeURIComponent(userId)}?v=${Math.trunc(v)}`;
}

export function memberAvatar(opts: MemberAvatarOpts): Html {
    const initials = esc(opts.initials ?? initialsOf(opts.name));
    const hasPicture =
        opts.enabled &&
        opts.userId !== undefined &&
        opts.version !== null &&
        opts.version !== undefined;
    if (!hasPicture) {
        return raw(
            `<span class="${cls("fd-avatar", opts.className)}" aria-hidden="true">${initials}</span>`,
        );
    }
    // The initials stay in the markup under the image: if the picture is gone
    // or fails to load, the circle still says who it is.
    const src = avatarUrl(opts.userId!, opts.version!);
    return raw(
        `<span class="${cls("fd-avatar", opts.className, "fd-avatar--photo")}" aria-hidden="true">${initials}<img class="fd-avatar__img" src="${esc(src)}" alt="" loading="lazy" decoding="async"></span>`,
    );
}
