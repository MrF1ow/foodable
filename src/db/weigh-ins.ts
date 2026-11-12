import type {
    LatestWeighIn,
    WeighInStore,
} from "../domain/notices-actionable.js";
import { rows, run } from "./sql.js";

export function liveWeighInStore(): WeighInStore {
    return {
        async latestWeighIns(householdId) {
            return run(async (tx) => {
                // The inner join leaves out members who never logged weight.
                // to_char pins the instant to a UTC ISO string whatever the
                // driver would do with a timestamptz.
                const data = await rows<Record<string, unknown>>(
                    tx,
                    tx`
                        select
                            m.user_id,
                            m.display_name,
                            to_char(
                                max(w.logged_at) at time zone 'UTC',
                                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                            ) as last_logged_at
                        from public.household_members m
                        join public.weight_log w on w.user_id = m.user_id
                        where m.household_id = ${householdId}::uuid
                        group by m.user_id, m.display_name
                        order by m.display_name, m.user_id
                    `,
                );
                return data.map((row): LatestWeighIn => ({
                    userId: String(row.user_id),
                    displayName: String(row.display_name),
                    lastLoggedAt: String(row.last_logged_at),
                }));
            });
        },
    };
}
