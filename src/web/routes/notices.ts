/**
 * The one-tap notices of the new app: acting on a usual running low or on what
 * a planned recipe is missing, and dismissing for the household a notice the
 * inbox does not carry (what the plan is missing). Both routes only adapt: the write is `actOnNotice` /
 * `dismissNotice`, which look the notice up again for this household and do
 * nothing for one that is no longer open. Opening the weigh-in sheet needs no
 * route (the sheet is on the page).
 */
import { Hono } from "hono";
import { liveFoodsStore } from "../../db/foods.js";
import { liveFridgeStore } from "../../db/fridge.js";
import { liveGroceryStore } from "../../db/grocery.js";
import { liveNoticeDismissalsStore } from "../../db/notice-dismissals.js";
import { liveRecipePlansStore, planTransaction } from "../../db/plans.js";
import { liveRecipesStore, liveRecipeVariantsStore } from "../../db/recipes.js";
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
import { kindForNoticeCode } from "../../domain/notification-kinds.js";
import { dismissNotice } from "../../domain/notices-for.js";
import { NOTICE_CODES, type NoticeCode } from "../../domain/notices.js";
import { can } from "../../domain/permissions.js";
import { redirectWithToast } from "../components/toast.js";
import { formText } from "../form.js";
import { requireMember, siteMember } from "../middleware.js";

/** The pages an action or a dismissal may send the person back to. */
export const NOTICE_BACK_PATHS = [
    "/",
    "/kitchen/usuals",
    "/kitchen/fridge",
    "/recipes",
] as const;
export type NoticeBack =
    (typeof NOTICE_BACK_PATHS)[number] | `/?date=${string}`;

/**
 * A path from a form, if it is one of ours; never an address taken from the
 * request. Today may carry the day it is showing (`/?date=YYYY-MM-DD`, a real
 * calendar date and nothing else), so acting from another day returns there.
 */
export function parseNoticeBack(value: string | undefined): NoticeBack {
    const known = NOTICE_BACK_PATHS.find((path) => path === value);
    if (known) return known;
    const day = /^\/\?date=(\d{4}-\d{2}-\d{2})$/.exec(value ?? "")?.[1];
    return day && isCalendarDate(day) ? `/?date=${day}` : "/";
}

function isCalendarDate(value: string): boolean {
    const parsed = new Date(`${value}T00:00:00Z`);
    return (
        !Number.isNaN(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === value
    );
}

export const noticeActionRoutes = new Hono();

function noticeActionDeps(): NoticeActionDeps {
    return {
        foods: liveFoodsStore(),
        fridge: liveFridgeStore(),
        recipes: liveRecipesStore(),
        dismissals: liveNoticeDismissalsStore(),
        grocery: liveGroceryStore(),
        plans: liveRecipePlansStore(),
        variants: liveRecipeVariantsStore(),
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
noticeActionRoutes.post("/notices/:code/act", requireMember, async (c) => {
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
            {
                ...noticeActionDeps(),
                transaction: planTransaction(
                    "plan-missing",
                    member.householdId,
                ),
            },
            member.householdId,
            { code, subjectId: formText(body, "subject_id") },
            clock,
        );
        if (result.status === "gone") {
            // toast: none
            return c.redirect(back, 303);
        }
        if (result.checkNames.length > 0) {
            return redirectWithToast(c, back, "notice.added.check", {
                name: result.name,
            });
        }
        // toast: none
        return c.redirect(back, 303);
    } catch (err) {
        if (!(err instanceof GroceryInputError)) throw err;
        return redirectWithToast(c, back, "notice.error", {
            message: err.message,
        });
    }
});

/**
 * Dismisses an open notice in place, with the key the notice itself carries
 * (code, subject, and the plan or day the dismissal is held for), and returns
 * to the page it was on. Nothing else about the notice changes.
 *
 * The dismissal is for the whole household, so it takes the same permission
 * as the inbox's "dismiss for everyone". A code the inbox carries is refused:
 * the inbox is where it is dismissed, per person or for everyone.
 */
noticeActionRoutes.post("/notices/dismiss", requireMember, async (c) => {
    const member = siteMember(c);
    const body = await c.req.parseBody();
    const back = parseNoticeBack(formText(body, "back"));
    const code = noticeCodeOf(formText(body, "code"));
    if (!code) {
        // toast: none (nothing to dismiss)
        return c.redirect(back, 303);
    }
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
    if (kindForNoticeCode(code) !== null) {
        return redirectWithToast(c, back, "notice.error", {
            message: "Dismiss that one from Notifications.",
        });
    }
    const allowed = can(
        { userId: member.userId, role: member.role },
        "notification.dismiss_everyone",
    );
    if (!allowed.ok) {
        return redirectWithToast(c, back, "notice.error", {
            message: allowed.reason,
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
        // toast: none
        return c.redirect(back, 303);
    }
    // toast: none
    return c.redirect(back, 303);
});
