import { Hono } from "hono";
import { formText } from "../form.js";
import { requireMember, requireSiteUser, siteMember } from "../middleware.js";
import { renderNeedsAttentionInventoryPage } from "../loaders.js";

export const needsAttentionRoutes = new Hono();

const DISMISS_RETURN_ALLOWLIST = new Set(["/grocery", "/needs-attention"]);

function dismissReturnTo(raw: string | undefined): string {
    if (raw && DISMISS_RETURN_ALLOWLIST.has(raw)) return raw;
    return "/needs-attention";
}

needsAttentionRoutes.get("/needs-attention", requireSiteUser, async (c) => {
    const page = await renderNeedsAttentionInventoryPage(
        c.get("userId"),
        undefined,
        c.req.query("show") === "dismissed",
    );
    return c.html(page.html, page.status);
});

needsAttentionRoutes.post(
    "/needs-attention/dismiss",
    requireSiteUser,
    requireMember,
    async (c) => {
        const member = siteMember(c);
        const body = await c.req.parseBody();
        const code = formText(body, "code");
        const subjectKind = formText(body, "subject_kind");
        const subjectId = formText(body, "subject_id");
        const relatedId = formText(body, "related_id") || undefined;
        const page = await renderNeedsAttentionInventoryPage(
            c.get("userId"),
            undefined,
            false,
            { code, subjectKind, subjectId, relatedId, member },
        );
        if (page.status !== 303) {
            return c.html(page.html, page.status);
        }
        const returnTo = dismissReturnTo(formText(body, "return_to"));
        // toast: none
        return c.redirect(returnTo, 303);
    },
);

needsAttentionRoutes.post(
    "/needs-attention/undo",
    requireSiteUser,
    requireMember,
    async (c) => {
        const member = siteMember(c);
        const body = await c.req.parseBody();
        const dismissalId = formText(body, "dismissal_id");
        const page = await renderNeedsAttentionInventoryPage(
            c.get("userId"),
            undefined,
            true,
            { undoDismissalId: dismissalId, member },
        );
        if (page.status !== 303) {
            return c.html(page.html, page.status);
        }
        // toast: none
        return c.redirect("/needs-attention?show=dismissed", 303);
    },
);
