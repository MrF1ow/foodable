import {
    GROCERY_DEFAULT_STORE_KEY,
    SettingsInputError,
} from "../domain/settings.js";
import type {
    StoreDeletionPlan,
    StoreManagementStore,
} from "../domain/grocery-stores.js";
import { cleanupDismissalsForSubjectTx } from "./notice-dismissals.js";
import { maybeOne, pgError, rows, run } from "./sql.js";

const CHANGED = "The list changed. Try again.";

export function liveStoreManagement(): StoreManagementStore {
    return {
        async storeLineCount(householdId, storeId) {
            return run(async (tx) => {
                try {
                    const data = await maybeOne<{ n: unknown }>(
                        tx,
                        tx`
                            select count(*)::int as n
                            from public.grocery_lines
                            where household_id = ${householdId}
                              and store_id = ${storeId}
                        `,
                        "count store lines",
                    );
                    return Number(data?.n ?? 0);
                } catch (err) {
                    throw pgError("count store lines", err);
                }
            });
        },
        async applyStoreDeletion(householdId, plan: StoreDeletionPlan) {
            return run(async (tx) => {
                try {
                    // The row lock makes a concurrent insert of a line for this
                    // store wait (its foreign key takes a conflicting lock).
                    const store = await maybeOne<{ id: unknown }>(
                        tx,
                        tx`
                            select id
                            from public.grocery_stores
                            where id = ${plan.storeId}
                              and household_id = ${householdId}
                            for update
                        `,
                        "lock grocery store",
                    );
                    if (!store) throw new SettingsInputError("Unknown store.");
                    if (plan.moveTo !== null) {
                        const target = await maybeOne<{ id: unknown }>(
                            tx,
                            tx`
                                select id
                                from public.grocery_stores
                                where id = ${plan.moveTo}
                                  and household_id = ${householdId}
                                for share
                            `,
                            "check destination store",
                        );
                        if (!target) {
                            throw new SettingsInputError("Unknown store.");
                        }
                    }
                    for (const move of plan.moves) {
                        const moved = await rows(
                            tx,
                            tx`
                                update public.grocery_lines
                                set store_id = ${plan.moveTo},
                                    section_id = ${move.sectionId},
                                    updated_at = now()
                                where id = ${move.lineId}
                                  and household_id = ${householdId}
                                  and store_id = ${plan.storeId}
                                returning id
                            `,
                        );
                        if (moved.length !== 1) {
                            throw new SettingsInputError(CHANGED);
                        }
                    }
                    for (const lineId of plan.deleteLineIds) {
                        const removed = await rows(
                            tx,
                            tx`
                                delete from public.grocery_lines
                                where id = ${lineId}
                                  and household_id = ${householdId}
                                  and store_id = ${plan.storeId}
                                returning id
                            `,
                        );
                        if (removed.length !== 1) {
                            throw new SettingsInputError(CHANGED);
                        }
                        await cleanupDismissalsForSubjectTx(
                            tx,
                            householdId,
                            "grocery_line",
                            lineId,
                        );
                    }
                    // A line added after the plan was read would be deleted by
                    // the store's cascade; refuse and roll back instead.
                    const left = await maybeOne<{ n: unknown }>(
                        tx,
                        tx`
                            select count(*)::int as n
                            from public.grocery_lines
                            where store_id = ${plan.storeId}
                        `,
                        "recount store lines",
                    );
                    if (Number(left?.n ?? 0) > 0) {
                        throw new SettingsInputError(CHANGED);
                    }
                    await tx`
                        delete from public.grocery_stores
                        where id = ${plan.storeId}
                          and household_id = ${householdId}
                    `;
                    // Equality-guarded, so a default changed meanwhile survives.
                    await tx`
                        update public.households
                        set household_preferences =
                            household_preferences - ${GROCERY_DEFAULT_STORE_KEY}::text
                        where id = ${householdId}
                          and household_preferences ->> ${GROCERY_DEFAULT_STORE_KEY}::text
                              = ${plan.storeId}
                    `;
                } catch (err) {
                    if (err instanceof SettingsInputError) throw err;
                    throw pgError("delete grocery store", err);
                }
            });
        },
        async writeStoreOrder(householdId, orderedIds) {
            return run(async (tx) => {
                try {
                    const locked = await rows<{ id: string }>(
                        tx,
                        tx`
                            select id
                            from public.grocery_stores
                            where household_id = ${householdId}
                            for update
                        `,
                    );
                    const have = new Set(locked.map((row) => String(row.id)));
                    if (
                        have.size !== orderedIds.length ||
                        orderedIds.some((id) => !have.has(id))
                    ) {
                        throw new SettingsInputError(
                            "The stores changed. Try again.",
                        );
                    }
                    for (const [index, id] of orderedIds.entries()) {
                        await tx`
                            update public.grocery_stores
                            set sort_order = ${index}
                            where id = ${id}
                              and household_id = ${householdId}
                        `;
                    }
                } catch (err) {
                    if (err instanceof SettingsInputError) throw err;
                    throw pgError("reorder grocery stores", err);
                }
            });
        },
    };
}
