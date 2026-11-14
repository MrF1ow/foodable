import { beforeEach, expect, test } from "bun:test";
import { describeDb } from "./testing/pg.js";
import { seedHousehold } from "./testing/fixtures.js";
import { findPgBin } from "./testing/pg-temp.js";
import { pgCode } from "./sql.js";

const pgAvailable = await findPgBin();

const FLAG_TABLES = [
    "flag_assignments",
    "flag_snapshot",
    "flag_beta_members",
    "flag_beta_events",
    "flag_eval_daily",
] as const;

function futureExpires(): string {
    return new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
}

describeDb(pgAvailable !== null, "feature flags db", (getCtx) => {
    beforeEach(async () => {
        const { truncateAll } = getCtx();
        await truncateAll();
    });

    test("RLS on and server-only table privileges", async () => {
        const { sql } = getCtx();
        for (const table of FLAG_TABLES) {
            const [rls] = (await sql`
                select c.relrowsecurity
                from pg_class c
                join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relname = ${table}
            `) as { relrowsecurity: boolean }[];
            expect(rls!.relrowsecurity).toBe(true);

            const qualified = `public.${table}`;
            const [anonAuth] = (await sql`
                select
                    has_table_privilege('anon', ${qualified}, 'SELECT') as anon_sel,
                    has_table_privilege(
                        'authenticated',
                        ${qualified},
                        'SELECT'
                    ) as auth_sel
            `) as { anon_sel: boolean; auth_sel: boolean }[];
            expect(anonAuth!.anon_sel).toBe(false);
            expect(anonAuth!.auth_sel).toBe(false);

            const [sr] = (await sql`
                select
                    has_table_privilege(
                        'service_role',
                        ${qualified},
                        'SELECT'
                    ) as sel,
                    has_table_privilege(
                        'service_role',
                        ${qualified},
                        'INSERT'
                    ) as ins,
                    has_table_privilege(
                        'service_role',
                        ${qualified},
                        'UPDATE'
                    ) as upd,
                    has_table_privilege(
                        'service_role',
                        ${qualified},
                        'DELETE'
                    ) as del
            `) as { sel: boolean; ins: boolean; upd: boolean; del: boolean }[];
            expect(sr!.sel).toBe(true);
            expect(sr!.ins).toBe(true);
            expect(sr!.upd).toBe(true);
            expect(sr!.del).toBe(true);
        }
    });

    test("flag_assignments household and user pins upsert", async () => {
        const { sql } = getCtx();
        const { householdId, userId } = await seedHousehold(sql);
        const expires = futureExpires();

        await sql`
            insert into public.flag_assignments (
                subject_kind,
                household_id,
                flag_name,
                value,
                reason,
                expires_at
            )
            values (
                ${"household"},
                ${householdId},
                ${"house-pin"},
                ${JSON.stringify(true)}::jsonb,
                ${"qa"},
                ${expires}
            )
            on conflict (subject_kind, subject_id, flag_name) do update
            set
                value = excluded.value,
                reason = excluded.reason,
                expires_at = excluded.expires_at
        `;
        await sql`
            insert into public.flag_assignments (
                subject_kind,
                household_id,
                flag_name,
                value,
                reason,
                expires_at
            )
            values (
                ${"household"},
                ${householdId},
                ${"house-pin"},
                ${JSON.stringify(false)}::jsonb,
                ${"qa2"},
                ${expires}
            )
            on conflict (subject_kind, subject_id, flag_name) do update
            set
                value = excluded.value,
                reason = excluded.reason,
                expires_at = excluded.expires_at
        `;
        const [houseRow] = (await sql`
            select subject_id, value
            from public.flag_assignments
            where subject_kind = ${"household"} and flag_name = ${"house-pin"}
        `) as { subject_id: string; value: boolean }[];
        expect(houseRow!.subject_id).toBe(householdId);
        expect(houseRow!.value).toBe(false);

        const [countHouse] = (await sql`
            select count(*)::int as n
            from public.flag_assignments
            where subject_kind = ${"household"}
        `) as { n: number }[];
        expect(countHouse!.n).toBe(1);

        await sql`
            insert into public.flag_assignments (
                subject_kind,
                user_id,
                flag_name,
                value,
                reason,
                expires_at
            )
            values (
                ${"user"},
                ${userId},
                ${"user-pin"},
                ${JSON.stringify("a")}::jsonb,
                ${"qa"},
                ${expires}
            )
            on conflict (subject_kind, subject_id, flag_name) do update
            set
                value = excluded.value,
                reason = excluded.reason,
                expires_at = excluded.expires_at
        `;
        await sql`
            insert into public.flag_assignments (
                subject_kind,
                user_id,
                flag_name,
                value,
                reason,
                expires_at
            )
            values (
                ${"user"},
                ${userId},
                ${"user-pin"},
                ${JSON.stringify("b")}::jsonb,
                ${"qa2"},
                ${expires}
            )
            on conflict (subject_kind, subject_id, flag_name) do update
            set
                value = excluded.value,
                reason = excluded.reason,
                expires_at = excluded.expires_at
        `;
        const [userRow] = (await sql`
            select subject_id, value
            from public.flag_assignments
            where subject_kind = ${"user"} and flag_name = ${"user-pin"}
        `) as { subject_id: string; value: string }[];
        expect(userRow!.subject_id).toBe(userId);
        expect(userRow!.value).toBe("b");
    });

    test("flag_assignments check constraints", async () => {
        const { sql } = getCtx();
        const { householdId, userId } = await seedHousehold(sql);
        const expires = futureExpires();

        const userKindHouseOnly = await sql`
            insert into public.flag_assignments (
                subject_kind,
                household_id,
                flag_name,
                value,
                reason,
                expires_at
            )
            values (
                ${"user"},
                ${householdId},
                ${"bad"},
                ${"true"}::jsonb,
                ${"x"},
                ${expires}
            )
        `.then(
            () => null,
            (e: unknown) => e,
        );
        expect(pgCode(userKindHouseOnly)).toBe("23514");

        const bothIds = await sql`
            insert into public.flag_assignments (
                subject_kind,
                user_id,
                household_id,
                flag_name,
                value,
                reason,
                expires_at
            )
            values (
                ${"user"},
                ${userId},
                ${householdId},
                ${"bad"},
                ${"true"}::jsonb,
                ${"x"},
                ${expires}
            )
        `.then(
            () => null,
            (e: unknown) => e,
        );
        expect(pgCode(bothIds)).toBe("23514");

        const badExpiry = await sql`
            insert into public.flag_assignments (
                subject_kind,
                user_id,
                flag_name,
                value,
                reason,
                assigned_at,
                expires_at
            )
            values (
                ${"user"},
                ${userId},
                ${"bad-exp"},
                ${"true"}::jsonb,
                ${"x"},
                ${"2026-01-02T12:00:00.000Z"},
                ${"2026-01-01T12:00:00.000Z"}
            )
        `.then(
            () => null,
            (e: unknown) => e,
        );
        expect(pgCode(badExpiry)).toBe("23514");

        const badName = await sql`
            insert into public.flag_assignments (
                subject_kind,
                user_id,
                flag_name,
                value,
                reason,
                expires_at
            )
            values (
                ${"user"},
                ${userId},
                ${"-leading"},
                ${"true"}::jsonb,
                ${"x"},
                ${expires}
            )
        `.then(
            () => null,
            (e: unknown) => e,
        );
        expect(pgCode(badName)).toBe("23514");

        await sql`
            insert into public.flag_assignments (
                subject_kind,
                user_id,
                flag_name,
                value,
                reason,
                expires_at
            )
            values (
                ${"user"},
                ${userId},
                ${"Checkout.v2"},
                ${"true"}::jsonb,
                ${"x"},
                ${expires}
            )
        `;
        await sql`
            insert into public.flag_assignments (
                subject_kind,
                user_id,
                flag_name,
                value,
                reason,
                expires_at
            )
            values (
                ${"user"},
                ${userId},
                ${"mcp-share-links"},
                ${"true"}::jsonb,
                ${"x"},
                ${expires}
            )
        `;
        const names = (await sql`
            select flag_name
            from public.flag_assignments
            where user_id = ${userId}
            order by flag_name
        `) as { flag_name: string }[];
        expect(names.map((r) => r.flag_name)).toEqual([
            "Checkout.v2",
            "mcp-share-links",
        ]);
    });

    test("flag_beta_events append-only, cascade, and actor set null", async () => {
        const { sql } = getCtx();
        const { userId: userA } = await seedHousehold(sql);
        const userB = crypto.randomUUID();
        await sql`
            insert into public.users (id, email)
            values (${userB}, ${`b-${userB}@foodable.test`})
        `;

        await sql`
            insert into public.flag_beta_events (user_id, action, actor)
            values (${userA}, ${"joined"}, ${userB})
        `;
        const [event] = (await sql`
            select id from public.flag_beta_events where user_id = ${userA}
        `) as { id: string }[];

        const upd = await sql`
            update public.flag_beta_events
            set action = ${"left"}
            where id = ${event!.id}
        `.then(
            () => null,
            (e: unknown) => e,
        );
        expect(String(upd)).toContain("append-only");

        await sql`
            insert into public.flag_beta_events (user_id, action)
            values (${userB}, ${"joined"})
        `;
        await sql`delete from public.users where id = ${userB}`;
        const leftB = (await sql`
            select count(*)::int as n
            from public.flag_beta_events
            where user_id = ${userB}
        `) as { n: number }[];
        expect(leftB[0]!.n).toBe(0);

        const [afterActor] = (await sql`
            select actor from public.flag_beta_events where id = ${event!.id}
        `) as { actor: string | null }[];
        expect(afterActor!.actor).toBeNull();

        await sql`delete from public.users where id = ${userA}`;
        const leftA = (await sql`
            select count(*)::int as n
            from public.flag_beta_events
            where id = ${event!.id}
        `) as { n: number }[];
        expect(leftA[0]!.n).toBe(0);
    });

    test("deleting household or user removes flag rows", async () => {
        const { sql } = getCtx();
        const { householdId, userId } = await seedHousehold(sql);
        const expires = futureExpires();

        await sql`
            insert into public.flag_assignments (
                subject_kind,
                household_id,
                flag_name,
                value,
                reason,
                expires_at
            )
            values (
                ${"household"},
                ${householdId},
                ${"h"},
                ${"true"}::jsonb,
                ${"x"},
                ${expires}
            )
        `;
        await sql`
            insert into public.flag_assignments (
                subject_kind,
                user_id,
                flag_name,
                value,
                reason,
                expires_at
            )
            values (
                ${"user"},
                ${userId},
                ${"u"},
                ${"true"}::jsonb,
                ${"x"},
                ${expires}
            )
        `;
        await sql`
            insert into public.flag_beta_members (user_id)
            values (${userId})
        `;

        await sql`delete from public.households where id = ${householdId}`;
        const housePins = (await sql`
            select count(*)::int as n from public.flag_assignments
            where household_id = ${householdId}
        `) as { n: number }[];
        expect(housePins[0]!.n).toBe(0);

        await sql`delete from public.users where id = ${userId}`;
        const userPins = (await sql`
            select count(*)::int as n from public.flag_assignments
            where user_id = ${userId}
        `) as { n: number }[];
        expect(userPins[0]!.n).toBe(0);
        const beta = (await sql`
            select count(*)::int as n from public.flag_beta_members
            where user_id = ${userId}
        `) as { n: number }[];
        expect(beta[0]!.n).toBe(0);
    });

    test("flag_eval_daily client length and upsert count", async () => {
        const { sql } = getCtx();
        const client81 = "x".repeat(81);
        const day = "2026-11-08";

        await sql`
            insert into public.flag_eval_daily (
                day,
                flag_name,
                value,
                reason,
                client,
                count
            )
            values (
                ${day},
                ${"f"},
                ${"on"},
                ${"r"},
                ${client81},
                ${1}
            )
        `;

        const tooLong = await sql`
            insert into public.flag_eval_daily (
                day,
                flag_name,
                value,
                reason,
                client,
                count
            )
            values (
                ${day},
                ${"f2"},
                ${"on"},
                ${"r"},
                ${"x".repeat(82)},
                ${1}
            )
        `.then(
            () => null,
            (e: unknown) => e,
        );
        expect(pgCode(tooLong)).toBe("23514");

        await sql`
            insert into public.flag_eval_daily (
                day,
                flag_name,
                value,
                reason,
                client,
                count
            )
            values (
                ${day},
                ${"up"},
                ${"v"},
                ${"why"},
                ${"cli"},
                ${3}
            )
            on conflict (day, flag_name, value, reason, client) do update
            set count = public.flag_eval_daily.count + excluded.count
        `;
        await sql`
            insert into public.flag_eval_daily (
                day,
                flag_name,
                value,
                reason,
                client,
                count
            )
            values (
                ${day},
                ${"up"},
                ${"v"},
                ${"why"},
                ${"cli"},
                ${5}
            )
            on conflict (day, flag_name, value, reason, client) do update
            set count = public.flag_eval_daily.count + excluded.count
        `;
        const [row] = (await sql`
            select count::int as count
            from public.flag_eval_daily
            where
                day = ${day}
                and flag_name = ${"up"}
                and client = ${"cli"}
        `) as { count: number }[];
        expect(row!.count).toBe(8);
    });
});
