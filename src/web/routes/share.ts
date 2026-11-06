import { Hono } from "hono";
import { readShare } from "../../domain/share.js";
import { requireSiteUser } from "../middleware.js";
import { renderRecipesListPage } from "../loaders.js";
import { shareImportPrefill } from "../share-import-prefill.js";
import { shareArrivedDisclosure } from "../components/share-arrived.js";
import { renderBarePage, type ThemePref } from "../shell.js";
import { pageHeader, panel } from "../components/ui.js";
import { getProfile } from "../../db/profiles.js";

export const shareRoutes = new Hono();

function shareQuery(c: { req: { query: (k: string) => string | undefined } }) {
    return readShare({
        title: c.req.query("title"),
        text: c.req.query("text"),
        url: c.req.query("url"),
    });
}

shareRoutes.get("/share", requireSiteUser, async (c) => {
    const share = shareQuery(c);
    const prefill = shareImportPrefill(share);
    const page = await renderRecipesListPage(c.get("userId"), {
        ...prefill,
        shareArrived: share,
        shareArrivedOpen: false,
    });
    return c.html(page.html, page.status);
});

shareRoutes.get("/share/probe", requireSiteUser, async (c) => {
    const userId = c.get("userId");
    const share = shareQuery(c);
    const profile = await getProfile(userId);
    const theme: ThemePref =
        profile?.theme === "light" || profile?.theme === "dark"
            ? profile.theme
            : "system";
    const body = `${pageHeader({
        title: "Share probe",
        sub: "Read-only view of what the share target received.",
    })}${panel({
        body: shareArrivedDisclosure(share, { open: true }),
    })}`;
    return c.html(renderBarePage("Share probe", body, theme));
});
