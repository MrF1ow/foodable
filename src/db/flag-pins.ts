import {
    pinFromRow,
    snapshotFromRows,
    type FlagPinStore,
    type FlagSubject,
    type Pin,
} from "../domain/flag-pins.js";
import { rows, run } from "./sql.js";

const PIN_COLS = "flag_name, value, reason, epoch, assigned_at, expires_at";

export function liveFlagPinStore(): FlagPinStore {
    return {
        async loadPins(subject: FlagSubject): Promise<Pin[]> {
            const data = await run((tx) =>
                rows<Record<string, unknown>>(
                    tx,
                    tx`
                        select ${tx.unsafe(PIN_COLS)}
                        from flag_assignments
                        where subject_kind = ${subject.kind}
                          and subject_id = ${subject.id}
                          and expires_at > now()
                    `,
                ),
            );
            return data.flatMap((row) => {
                const pin = pinFromRow(row);
                return pin ? [pin] : [];
            });
        },

        async upsertPin(subject, pin) {
            const userId = subject.kind === "user" ? subject.id : null;
            const householdId =
                subject.kind === "household" ? subject.id : null;
            const value = JSON.stringify(pin.value);
            const assignedAt = new Date(pin.assignedAt).toISOString();
            const expiresAt = new Date(pin.expiresAt).toISOString();
            await run(async (tx) => {
                await tx`
                    insert into flag_assignments (
                        subject_kind, user_id, household_id, flag_name,
                        value, reason, epoch, assigned_at, expires_at
                    )
                    values (
                        ${subject.kind}, ${userId}, ${householdId}, ${pin.flag},
                        ${value}::jsonb, ${pin.reason}, ${pin.epoch},
                        ${assignedAt}::timestamptz, ${expiresAt}::timestamptz
                    )
                    on conflict on constraint flag_assignments_subject_flag_key
                    do update set
                        value = excluded.value,
                        reason = excluded.reason,
                        epoch = excluded.epoch,
                        assigned_at = excluded.assigned_at,
                        expires_at = excluded.expires_at
                `;
            });
        },

        async clearPins(subject) {
            await run(async (tx) => {
                await tx`
                    delete from flag_assignments
                    where subject_kind = ${subject.kind}
                      and subject_id = ${subject.id}
                `;
            });
        },

        async sweepExpired(now) {
            const at = new Date(now).toISOString();
            const deleted = await run((tx) =>
                rows<{ id: string }>(
                    tx,
                    tx`
                        delete from flag_assignments
                        where expires_at <= ${at}::timestamptz
                        returning id
                    `,
                ),
            );
            return deleted.length;
        },

        async loadSnapshot() {
            const data = await run((tx) =>
                rows<Record<string, unknown>>(
                    tx,
                    tx`select flag_name, value from flag_snapshot`,
                ),
            );
            return snapshotFromRows(data);
        },

        async saveSnapshot(flag, value) {
            const json = JSON.stringify(value);
            await run(async (tx) => {
                await tx`
                    insert into flag_snapshot (flag_name, value, saved_at)
                    values (${flag}, ${json}::jsonb, now())
                    on conflict (flag_name) do update
                    set value = excluded.value, saved_at = now()
                `;
            });
        },
    };
}
