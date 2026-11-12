/**
 * The one-tap notices of the new app: acting on a usual running low or on what
 * a planned recipe is missing, and dismissing any of the three (those and the
 * weigh-in reminder). Both routes only adapt: the write is `actOnNotice` /
 * `dismissNotice`, which look the notice up again for this household and do
 * nothing for one that is no longer open. Opening the weigh-in sheet needs no
 * route (the sheet is on the page).
 */
import { Hono } from "hono";
import { liveFoodsStore } from "../../db/foods.js";
import { liveFridgeStore } from "../../db/fridge.js";
import { liveGroceryStore } from "../../db/grocery.js";
import { liveNoticeDismissalsStore } from "../../db/notice-dismissals.js";
import { liveRecipePlansStore } from "../../db/plans.js";
import { liveRecipesStore } from "../../db/recipes.js";
import { householdClock } from "../../db/restock.js";
import { liveSettingsStore } from "../../db/settings.js";
import { liveWeighInStore } from "../../db/weigh-ins.js";
import { GroceryInputError } from "../../domain/grocery.js";
import {
    assertDismissibleCode,
    NoticeDismissError,
} from "../../domain/notice-dismissals.js";
import type { NoticeSubjectKind } from "../../domain/notice-dismissals.js";
import {
    actOnNotice,
    isActionableNoticeCode,
    type NoticeActionDeps,
} from "../../domain/notice-actions.js";
import { dismissNotice } from "../../domain/notices-for.js";
import { NOTICE_CODES, type NoticeCode } from "../../domain/notices.js";
import { redirectWithToast } from "../components/toast.js";
import { formText } from "../form.js";
import { gatedRoute } from "../gated.js";
import { requireMember, siteMember } from "../middleware.js";
import { parseNoticeBack } from "../pages/v2/notice-strip.js";

export const noticeActionRoutes = new Hono();

function noticeActionDeps(): NoticeActionDeps {
    return {
        foods: liveFoodsStore(),
        fridge: liveFridgeStore(),
        recipes: liveRecipesStore(),
        dismissals: liveNoticeDismissalsStore(),
        grocery: liveGroceryStore(),
        plans: liveRecipePlansStore(),
        weighIns: liveWeighInStore(),
        settings: liveSettingsStore(),
    };
}

function noticeCodeOf(value: string): NoticeCode | null {
    return (NOTICE_CODES as readonly string[]).includes(value)
        ? (value as NoticeCode)
        : null;
}

/**
 * Runs the one-tap action of the open notice about `subject_id` (a food).
 * A tap on a notice that was already acted on, dismissed or no longer applies
 * writes nothing and says so.
 */
noticeActionRoutes.post(
    "/notices/:code/act",
    requireMember,
    gatedRoute("ui-v2", { notFound: true }),
    async (c) => {
        const member = siteMember(c);
        const code = c.req.param("code");
        if (!isActionableNoticeCode(code)) {
            return c.text("Not found", 404);
        }
        const body = await c.req.parseBody();
        const back = parseNoticeBack(formText(body, "back"));
        const clock = await householdClock(member.householdId);
        try {
            const result = await actOnNotice(
                noticeActionDeps(),
                member.householdId,
                { code, subjectId: formText(body, "subject_id") },
                clock,
            );
            if (result.status === "gone") {
                return redirectWithToast(c, back, "notice.gone");
            }
            if (result.checkNames.length > 0) {
                return redirectWithToast(c, back, "notice.added.check", {
                    name: result.name,
                });
            }
            return redirectWithToast(c, back, "notice.added", {
                name: result.name,
            });
        } catch (err) {
            if (!(err instanceof GroceryInputError)) throw err;
            return redirectWithToast(c, back, "notice.error", {
                message: err.message,
            });
        }
    },
);

/**
 * Dismisses an open notice in place, with the key the notice itself carries
 * (code, subject, and the plan or day the dismissal is held for), and returns
 * to the page it was on. Nothing else about the notice changes.
 */
noticeActionRoutes.post(
    "/notices/dismiss",
    requireMember,
    gatedRoute("ui-v2", { notFound: true }),
    async (c) => {
        const member = siteMember(c);
        const body = await c.req.parseBody();
        const back = parseNoticeBack(formText(body, "back"));
        const code = noticeCodeOf(formText(body, "code"));
        if (!code) return redirectWithToast(c, back, "notice.gone");
        try {
            assertDismissibleCode(code);
        } catch (err) {
            // A notice that never can be dismissed is not "taken care of":
            // say what the person can do instead.
            if (!(err instanceof NoticeDismissError)) throw err;
            return redirectWithToast(c, back, "notice.error", {
                message: err.message,
            });
        }
        const clock = await householdClock(member.householdId);
        try {
            await dismissNotice(
                noticeActionDeps(),
                member.householdId,
                member.userId,
                {
                    code,
                    subjectKind: formText(
                        body,
                        "subject_kind",
                    ) as NoticeSubjectKind,
                    subjectId: formText(body, "subject_id"),
                    relatedId: formText(body, "related_id") || undefined,
                },
                { ...clock, actionable: true },
            );
        } catch (err) {
            if (!(err instanceof NoticeDismissError)) throw err;
            return redirectWithToast(c, back, "notice.gone");
        }
        // toast: none
        return c.redirect(back, 303);
    },
);
