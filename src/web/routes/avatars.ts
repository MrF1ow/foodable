import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createHash } from "node:crypto";
import { deleteAvatar, getAvatar, setAvatar } from "../../db/avatars.js";
import { AVATAR_MAX_BYTES, validateAvatar } from "../../domain/avatar.js";
import { getBaseUrl } from "../../url.js";
import { viewerFlagsFor } from "../attention.js";
import { formText } from "../form.js";
import { renderSettingsAccountV2Route } from "../loaders.js";
import { requireMember, requireSiteUser, siteMember } from "../middleware.js";
import { redirectWithToast } from "../components/toast.js";
import { settingsBackHref } from "../settings-back.js";

export const avatarRoutes = new Hono();

/** A whole request above this is refused before it is buffered: the picture
 *  limit plus room for the multipart framing. */
const UPLOAD_BODY_LIMIT = 96 * 1024;

const TOO_LARGE_MESSAGE = `Pictures must be ${AVATAR_MAX_BYTES / 1024} KB or smaller. Pick a smaller one, or one your browser can shrink for you.`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function picturesOn(c: Context): Promise<boolean> {
    const flags = await viewerFlagsFor(siteMember(c));
    return flags.uiProfilePictures;
}

function notFound(c: Context): Response {
    return c.text("Not found", 404);
}

// Serves a member's picture to the members of their household. Anyone else,
// and any id without a picture, gets the same 404, so the answer does not say
// who exists. The stored bytes were checked by magic number, but only the
// header: they could still be a polyglot, so the response carries its own
// policy that never lets it render as a document.
avatarRoutes.get("/avatars/:userId", requireSiteUser, async (c) => {
    const viewer = c.get("member");
    if (!viewer) return notFound(c);
    if (!(await picturesOn(c))) return notFound(c);
    const target = c.req.param("userId");
    if (!UUID.test(target)) return notFound(c);
    // Scoped to the viewer's household, so another household's id finds nothing.
    const avatar = await getAvatar(viewer.householdId, target);
    if (!avatar) return notFound(c);

    const etag = `"${createHash("sha256")
        .update(avatar.bytes)
        .digest("base64url")
        .slice(0, 22)}"`;
    const headers = {
        "Content-Type": avatar.contentType,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Disposition": "inline",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        ETag: etag,
    };
    if (c.req.header("if-none-match") === etag) {
        return new Response(null, { status: 304, headers });
    }
    return new Response(avatar.bytes as Uint8Array<ArrayBuffer>, {
        status: 200,
        headers,
    });
});

function accountUrl(backHref: string): string {
    return backHref === "/"
        ? "/settings/account"
        : `/settings/account?from=${encodeURIComponent(backHref)}`;
}

async function refuse(
    c: Context,
    userId: string,
    backHref: string,
    message: string,
    status: 413 | 422,
): Promise<Response> {
    const page = await renderSettingsAccountV2Route(userId, {
        backHref,
        error: message,
    });
    return c.html(page.html, page.status === 200 ? status : page.status);
}

// Self only: the picture always belongs to the signed-in member. The limit
// sits in front of the body parser so an oversized upload is dropped before it
// is buffered; it answers with the Settings page rather than JSON.
avatarRoutes.post(
    "/settings/account/photo",
    requireMember,
    async (c, next) => {
        if (!(await picturesOn(c))) return notFound(c);
        return next();
    },
    bodyLimit({
        maxSize: UPLOAD_BODY_LIMIT,
        onError: async (c) =>
            refuse(
                c,
                c.get("userId"),
                settingsBackHref({
                    referer: c.req.header("referer"),
                    origin: getBaseUrl(c),
                }),
                TOO_LARGE_MESSAGE,
                413,
            ),
    }),
    async (c) => {
        const userId = c.get("userId");
        const member = siteMember(c);
        const body = await c.req.parseBody();
        const backHref = settingsBackHref({
            from: formText(body, "from"),
            referer: undefined,
            origin: getBaseUrl(c),
        });
        const file = body.photo;
        if (!(file instanceof File)) {
            return refuse(
                c,
                userId,
                backHref,
                "Choose a picture to upload.",
                422,
            );
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        const check = validateAvatar(bytes);
        if (!check.ok) {
            return refuse(c, userId, backHref, check.message, 422);
        }
        await setAvatar(member.householdId, userId, check.contentType, bytes);
        return redirectWithToast(
            c,
            accountUrl(backHref),
            "settings.profile.saved",
        );
    },
);

avatarRoutes.post(
    "/settings/account/photo/remove",
    requireMember,
    async (c) => {
        if (!(await picturesOn(c))) return notFound(c);
        const body = await c.req.parseBody();
        const backHref = settingsBackHref({
            from: formText(body, "from"),
            referer: undefined,
            origin: getBaseUrl(c),
        });
        const member = siteMember(c);
        await deleteAvatar(member.householdId, c.get("userId"));
        return redirectWithToast(
            c,
            accountUrl(backHref),
            "settings.profile.saved",
        );
    },
);
