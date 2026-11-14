// member_avatars against real Postgres, as foodable_app: the round trip, the
// size check, the cascade from household_members and the row level security
// (any member reads their household's pictures, only the owner of a picture
// writes it).
import { afterEach, beforeEach, expect, test } from "bun:test";
import {
    deleteAvatar,
    getAvatar,
    getAvatarVersions,
    setAvatar,
} from "./avatars.js";
import { setSqlForTests } from "./sql.js";
import { asUser as actAs, seedHousehold } from "./testing/fixtures.js";
import { describeDb } from "./testing/pg.js";
import { findPgBin } from "./testing/pg-temp.js";

const pgAvailable = await findPgBin();
if (!pgAvailable) {
    if (process.env.CI) {
        throw new Error(
            "database tests require initdb (install postgresql and set PG_BIN)",
        );
    }
    console.warn("database tests skipped: no initdb (set PG_BIN)");
}

describeDb(pgAvailable !== null, "member avatars db", (getCtx) => {
    let householdId: string;
    let ownerId: string;
    let memberId: string;

    beforeEach(async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const seeded = await seedHousehold(sql);
        householdId = seeded.householdId;
        ownerId = seeded.userId;
        memberId = crypto.randomUUID();
        await sql`
            insert into public.users (id, email)
            values (${memberId}, ${`member-${memberId}@foodable.test`})
        `;
        await sql`
            insert into public.household_members (
                household_id, user_id, role, display_name
            )
            values (${householdId}, ${memberId}, ${"member"}, ${"Member"})
        `;
    });

    afterEach(() => {
        setSqlForTests(null);
    });

    // Acts as `userId` inside the seeded household unless told otherwise.
    function asUser<T>(
        userId: string,
        fn: () => Promise<T>,
        inHousehold: string = householdId,
    ): Promise<T> {
        return actAs(userId, fn, inHousehold);
    }

    const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 254, 255]);

    test("set then get returns the exact bytes", async () => {
        await asUser(ownerId, () =>
            setAvatar(householdId, ownerId, "image/png", PNG),
        );
        const got = await asUser(ownerId, () =>
            getAvatar(householdId, ownerId),
        );
        expect(got?.contentType).toBe("image/png");
        expect([...got!.bytes]).toEqual([...PNG]);
        expect(got!.updatedAt).toBeInstanceOf(Date);
    });

    test("get is null when there is no picture", async () => {
        expect(
            await asUser(ownerId, () => getAvatar(householdId, ownerId)),
        ).toBeNull();
    });

    test("a second set replaces the picture and bumps updated_at", async () => {
        const { sql } = getCtx();
        await asUser(ownerId, () =>
            setAvatar(householdId, ownerId, "image/png", PNG),
        );
        await sql`
            update public.member_avatars
            set updated_at = now() - interval '1 hour'
            where user_id = ${ownerId}
        `;
        const before = await asUser(ownerId, () =>
            getAvatar(householdId, ownerId),
        );
        const next = Uint8Array.from([0xff, 0xd8, 9, 9]);
        await asUser(ownerId, () =>
            setAvatar(householdId, ownerId, "image/jpeg", next),
        );
        const after = await asUser(ownerId, () =>
            getAvatar(householdId, ownerId),
        );
        expect(after?.contentType).toBe("image/jpeg");
        expect([...after!.bytes]).toEqual([...next]);
        expect(after!.updatedAt.getTime()).toBeGreaterThan(
            before!.updatedAt.getTime(),
        );
        const [counted] = (await sql`
            select count(*)::int as n from public.member_avatars
        `) as { n: number }[];
        expect(counted!.n).toBe(1);
    });

    test("versions maps each member with a picture to its updated_at", async () => {
        await asUser(ownerId, () =>
            setAvatar(householdId, ownerId, "image/png", PNG),
        );
        const versions = await asUser(memberId, () =>
            getAvatarVersions(householdId),
        );
        expect([...versions.keys()]).toEqual([ownerId]);
        expect(versions.get(ownerId)).toBeInstanceOf(Date);
    });

    test("delete reports whether a row was removed", async () => {
        await asUser(ownerId, () =>
            setAvatar(householdId, ownerId, "image/png", PNG),
        );
        expect(
            await asUser(ownerId, () => deleteAvatar(householdId, ownerId)),
        ).toBe(true);
        expect(
            await asUser(ownerId, () => deleteAvatar(householdId, ownerId)),
        ).toBe(false);
        expect(
            await asUser(ownerId, () => getAvatar(householdId, ownerId)),
        ).toBeNull();
    });

    test("the table refuses more than 64 KB", async () => {
        await expect(
            asUser(ownerId, () =>
                setAvatar(
                    householdId,
                    ownerId,
                    "image/png",
                    new Uint8Array(65537),
                ),
            ),
        ).rejects.toThrow();
        await asUser(ownerId, () =>
            setAvatar(householdId, ownerId, "image/png", new Uint8Array(65536)),
        );
    });

    test("the table refuses a content type outside the allowed three", async () => {
        await expect(
            asUser(ownerId, () =>
                setAvatar(
                    householdId,
                    ownerId,
                    "image/gif" as "image/png",
                    PNG,
                ),
            ),
        ).rejects.toThrow();
    });

    test("another member reads a picture but cannot replace or delete it", async () => {
        await asUser(ownerId, () =>
            setAvatar(householdId, ownerId, "image/png", PNG),
        );
        const seen = await asUser(memberId, () =>
            getAvatar(householdId, ownerId),
        );
        expect([...seen!.bytes]).toEqual([...PNG]);

        // Writing a row for someone else is refused.
        await expect(
            asUser(memberId, () =>
                setAvatar(householdId, ownerId, "image/png", new Uint8Array(4)),
            ),
        ).rejects.toThrow();
        // Deleting it silently touches nothing.
        expect(
            await asUser(memberId, () => deleteAvatar(householdId, ownerId)),
        ).toBe(false);
        const still = await asUser(ownerId, () =>
            getAvatar(householdId, ownerId),
        );
        expect([...still!.bytes]).toEqual([...PNG]);
    });

    test("another household cannot read it", async () => {
        const { sql } = getCtx();
        await asUser(ownerId, () =>
            setAvatar(householdId, ownerId, "image/png", PNG),
        );
        const other = await seedHousehold(sql);
        expect(
            await asUser(
                other.userId,
                () => getAvatar(other.householdId, ownerId),
                other.householdId,
            ),
        ).toBeNull();
        expect(
            await asUser(
                other.userId,
                () => getAvatar(householdId, ownerId),
                other.householdId,
            ),
        ).toBeNull();
        const versions = await asUser(
            other.userId,
            () => getAvatarVersions(householdId),
            other.householdId,
        );
        expect(versions.size).toBe(0);
    });

    test("removing the member from the household takes their picture", async () => {
        const { sql } = getCtx();
        await asUser(ownerId, () =>
            setAvatar(householdId, ownerId, "image/png", PNG),
        );
        await asUser(memberId, () =>
            setAvatar(householdId, memberId, "image/png", PNG),
        );
        await sql`
            delete from public.household_members
            where household_id = ${householdId} and user_id = ${memberId}
        `;
        const rows = (await sql`
            select user_id from public.member_avatars
        `) as { user_id: string }[];
        expect(rows.map((r) => r.user_id)).toEqual([ownerId]);
    });

    test("deleting a login takes their picture", async () => {
        const { sql } = getCtx();
        await asUser(memberId, () =>
            setAvatar(householdId, memberId, "image/png", PNG),
        );
        await sql`delete from public.users where id = ${memberId}`;
        const [counted] = (await sql`
            select count(*)::int as n from public.member_avatars
        `) as { n: number }[];
        expect(counted!.n).toBe(0);
    });
});
