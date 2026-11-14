import type { AvatarContentType } from "../domain/avatar.js";
import { maybeOne, pgError, rows, run } from "./sql.js";

const MEMBER_AVATARS = "member_avatars";

export type StoredAvatar = {
    contentType: AvatarContentType;
    bytes: Uint8Array;
    updatedAt: Date;
};

/** A member's picture, or null when they have none. */
export async function getAvatar(
    householdId: string,
    userId: string,
): Promise<StoredAvatar | null> {
    return run(async (tx) => {
        try {
            // Read through the driver directly: json_agg (see rows) would
            // turn bytea into a hex string.
            const [row] = (await tx`
                select content_type, bytes, updated_at
                from ${tx.unsafe(MEMBER_AVATARS)}
                where household_id = ${householdId}
                  and user_id = ${userId}
            `) as {
                content_type: AvatarContentType;
                bytes: Uint8Array;
                updated_at: Date | string;
            }[];
            if (!row) return null;
            return {
                contentType: row.content_type,
                bytes: new Uint8Array(row.bytes),
                updatedAt: new Date(row.updated_at),
            };
        } catch (err) {
            throw pgError("get avatar", err);
        }
    });
}

/**
 * Which members have a picture, and when it last changed, in one query and
 * without the image bytes: the version a page puts in each picture's URL.
 */
export async function getAvatarVersions(
    householdId: string,
): Promise<Map<string, Date>> {
    return run(async (tx) => {
        try {
            const data = await rows<{ user_id: string; updated_at: string }>(
                tx,
                tx`
                    select user_id, updated_at
                    from ${tx.unsafe(MEMBER_AVATARS)}
                    where household_id = ${householdId}
                `,
            );
            return new Map(
                data.map((r) => [String(r.user_id), new Date(r.updated_at)]),
            );
        } catch (err) {
            throw pgError("list avatar versions", err);
        }
    });
}

/** Stores or replaces a member's picture; callers validate it first. */
export async function setAvatar(
    householdId: string,
    userId: string,
    contentType: AvatarContentType,
    bytes: Uint8Array,
): Promise<void> {
    return run(async (tx) => {
        try {
            await tx`
                insert into ${tx.unsafe(MEMBER_AVATARS)} (
                    household_id, user_id, content_type, bytes, updated_at
                )
                values (
                    ${householdId}, ${userId}, ${contentType}, ${bytes}, now()
                )
                on conflict (household_id, user_id) do update
                set content_type = excluded.content_type,
                    bytes = excluded.bytes,
                    updated_at = now()
            `;
        } catch (err) {
            throw pgError("set avatar", err);
        }
    });
}

/** Removes a member's picture; true when there was one to remove. */
export async function deleteAvatar(
    householdId: string,
    userId: string,
): Promise<boolean> {
    return run(async (tx) => {
        try {
            const gone = await maybeOne<{ user_id: string }>(
                tx,
                tx`
                    delete from ${tx.unsafe(MEMBER_AVATARS)}
                    where household_id = ${householdId}
                      and user_id = ${userId}
                    returning user_id
                `,
                "delete avatar",
            );
            return gone !== null;
        } catch (err) {
            throw pgError("delete avatar", err);
        }
    });
}
