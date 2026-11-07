import { Hono } from "hono";
import { formText } from "../form.js";
import { requireMember, requireSiteUser, siteMember } from "../middleware.js";
import { renderNeedsAttentionInventoryPage } from "../loaders.js";

export const needsAttentionRoutes = new Hono();

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
        // toast: none
        return c.redirect("/needs-attention", 303);
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
