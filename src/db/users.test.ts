import { beforeEach, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import type { SQL as SQLType } from "bun";
import { classifySignInFailure, resolveApproveUser } from "../oauth.js";
import { SignInError } from "../domain/auth.js";
import { addHouseholdMemberForHousehold } from "./household.js";
import { upsertProfile } from "./profiles.js";
import { createMemoryExportArchiveStore } from "./exports.js";
import { describeDb } from "./testing/pg.js";
import { seedFood, seedHousehold } from "./testing/fixtures.js";
import { findPgBin } from "./testing/pg-temp.js";
import {
    authUserCount,
    deleteAuthUser,
    signInUser,
    signUpUser,
} from "./users.js";
import { setSqlForTests } from "./sql.js";

const pgAvailable = await findPgBin();

const EXPECTED_USER_FKS: {
    table: string;
    column: string;
    deltype: "c" | "n" | "a";
}[] = [
    { table: "household_members", column: "user_id", deltype: "c" },
    { table: "meal_items", column: "user_id", deltype: "c" },
    { table: "member_allergens", column: "user_id", deltype: "c" },
    { table: "member_dislikes", column: "user_id", deltype: "c" },
    { table: "nutrition_goals", column: "user_id", deltype: "c" },
    { table: "person_rules", column: "user_id", deltype: "c" },
    { table: "profiles", column: "user_id", deltype: "c" },
    { table: "water_log", column: "user_id", deltype: "c" },
    { table: "weight_log", column: "user_id", deltype: "c" },
    { table: "foods", column: "created_by", deltype: "n" },
    { table: "household_mcp_tokens", column: "issued_by", deltype: "n" },
    { table: "stock_movements", column: "actor_user_id", deltype: "n" },
    { table: "auth_codes", column: "user_id", deltype: "a" },
    { table: "meals", column: "user_id", deltype: "a" },
    { table: "oauth_tokens", column: "user_id", deltype: "a" },
    { table: "refresh_tokens", column: "user_id", deltype: "a" },
];

async function loadUserForeignKeys(sql: SQL) {
    const rows = (await sql`
        select
            c.conrelid::regclass::text as table_name,
            a.attname as column_name,
            c.confdeltype as deltype,
            c.confrelid::regclass::text as ref_table
        from pg_constraint c
        join pg_attribute a
          on a.attrelid = c.conrelid
         and a.attnum = any (c.conkey)
        where c.contype = 'f'
          and c.confrelid = 'public.users'::regclass
        order by 1, 2
    `) as {
        table_name: string;
        column_name: string;
        deltype: string;
        ref_table: string;
    }[];
    return rows.map((r) => ({
        table: r.table_name.replace(/^public\./, ""),
        column: r.column_name,
        deltype: r.deltype as "c" | "n" | "a",
        ref_table: r.ref_table,
    }));
}

const CASCADE_TABLES = [
    "household_members",
    "meal_items",
    "member_allergens",
    "member_dislikes",
    "nutrition_goals",
    "person_rules",
    "profiles",
    "water_log",
    "weight_log",
] as const;

async function countUserRows(
    sql: SQLType,
    table: string,
    userId: string,
): Promise<number> {
    const [row] = await sql`
        select count(*)::int as n
        from ${sql.unsafe(table)}
        where user_id = ${userId}
    `;
    return row.n;
}

async function seedCascadeAndSetNullRows(
    sql: SQLType,
    userId: string,
    householdId: string,
): Promise<{ foodId: string }> {
    const otherUserId = crypto.randomUUID();
    await sql`
        insert into auth.users (id, email)
        values (${otherUserId}, ${`other-${otherUserId}@foodable.test`})
    `;
    await upsertProfile(userId, { timezone: "UTC" });
    await sql`
        insert into member_allergens (household_id, user_id, allergen)
        values (${householdId}, ${userId}, ${"peanut"})
    `;
    await sql`
        insert into member_dislikes (household_id, user_id, display_name)
        values (${householdId}, ${userId}, ${"Kale"})
    `;
    await sql`
        insert into nutrition_goals (user_id, daily_calories)
        values (${userId}, ${1800})
    `;
    await sql`
        insert into person_rules (household_id, user_id, body)
        values (${householdId}, ${userId}, ${"No shop on Mondays"})
    `;
    await sql`
        insert into water_log (user_id, amount_ml, logged_at, idempotency_key)
        values (
            ${userId},
            ${250},
            ${"2024-06-01T12:00:00.000Z"},
            ${`cascade-w-${userId}`}
        )
    `;
    await sql`
        insert into weight_log (user_id, weight_g, logged_at, idempotency_key)
        values (
            ${userId},
            ${70000},
            ${"2024-06-01T12:00:00.000Z"},
            ${`cascade-wt-${userId}`}
        )
    `;
    const [meal] = await sql`
        insert into meals (
            user_id,
            description,
            meal_type,
            logged_at,
            idempotency_key
        )
        values (
            ${otherUserId},
            ${"Other meal"},
            ${"lunch"},
            ${"2024-06-01T13:00:00.000Z"},
            ${`other-meal-${otherUserId}`}
        )
        returning id
    `;
    await sql`
        insert into meal_items (meal_id, user_id, label)
        values (${meal.id}, ${userId}, ${"Shared item"})
    `;
    const foodId = await seedFood(sql, householdId, { name: "Cascade apple" });
    await sql`
        update public.foods set created_by = ${userId} where id = ${foodId}
    `;
    await sql`
        insert into household_mcp_tokens (household_id, token_hash, issued_by)
        values (
            ${householdId},
            decode(repeat('00', 32), 'hex'),
            ${userId}
        )
        on conflict (household_id) do update
        set issued_by = excluded.issued_by
    `;
    await sql`
        insert into stock_movements (
            household_id,
            food_id,
            delta,
            unit,
            reason,
            actor_user_id
        )
        values (
            ${householdId},
            ${foodId},
            ${1},
            ${"g"},
            ${"adjust"},
            ${userId}
        )
    `;
    return { foodId };
}

describeDb(pgAvailable !== null, "users db", (getCtx) => {
    beforeEach(async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
    });

    test("foreign keys reference public.users with expected actions", async () => {
        const { sql } = getCtx();
        const fks = await loadUserForeignKeys(sql);
        expect(fks).toHaveLength(EXPECTED_USER_FKS.length);
        for (const expected of EXPECTED_USER_FKS) {
            const match = fks.find(
                (fk) =>
                    fk.table === expected.table &&
                    fk.column === expected.column,
            );
            expect(match?.deltype).toBe(expected.deltype);
            expect(match?.ref_table).toBe("users");
        }
        const authRefs = (await sql`
            select c.conrelid::regclass::text as table_name
            from pg_constraint c
            where c.contype = 'f'
              and c.confrelid = 'auth.users'::regclass
        `) as { table_name: string }[];
        expect(authRefs).toHaveLength(0);
    });

    test("sync trigger mirrors auth.users into public.users", async () => {
        const { sql } = getCtx();
        const id = crypto.randomUUID();
        await sql`
            insert into auth.users (id, email, encrypted_password, created_at)
            values (
                ${id},
                ${"sync@example.com"},
                ${"$2a$10$5pc/WMgCYJtPxZ3BH1Ccz.jWAQFEavBIGuDkytwIuSpPn9WqjSJSK"},
                ${"2020-01-01T00:00:00.000Z"}
            )
        `;
        const [row] = await sql`
            select email, password_hash, created_at
            from public.users
            where id = ${id}
        `;
        expect(row.email).toBe("sync@example.com");
        expect(row.password_hash).toBeTruthy();
        await sql`
            update auth.users
            set email = ${"sync2@example.com"},
                encrypted_password = ${"new-hash"}
            where id = ${id}
        `;
        const [updated] = await sql`
            select email, password_hash
            from public.users
            where id = ${id}
        `;
        expect(updated.email).toBe("sync2@example.com");
        expect(updated.password_hash).toBe("new-hash");
        await sql`delete from auth.users where id = ${id}`;
        const [gone] = await sql`
            select id from public.users where id = ${id}
        `;
        expect(gone).toBeUndefined();
    });

    test("cascade and set-null on public.users delete", async () => {
        const { sql } = getCtx();
        const { userId, householdId } = await seedHousehold(sql);
        const { foodId } = await seedCascadeAndSetNullRows(
            sql,
            userId,
            householdId,
        );
        for (const table of CASCADE_TABLES) {
            expect(await countUserRows(sql, table, userId)).toBeGreaterThan(0);
        }
        await deleteAuthUser(userId);
        for (const table of CASCADE_TABLES) {
            expect(await countUserRows(sql, table, userId)).toBe(0);
        }
        const [food] = await sql`
            select created_by from foods where id = ${foodId}
        `;
        expect(food.created_by).toBeNull();
        const [token] = await sql`
            select issued_by from household_mcp_tokens
            where household_id = ${householdId}
        `;
        expect(token.issued_by).toBeNull();
        const [movement] = await sql`
            select actor_user_id from stock_movements
            where food_id = ${foodId}
        `;
        expect(movement.actor_user_id).toBeNull();
    });

    test("no-action tables block delete until cleared", async () => {
        const { sql } = getCtx();
        const { userId } = await seedHousehold(sql);
        const blockers: { table: string; seed: () => Promise<void> }[] = [
            {
                table: "meals",
                seed: async () => {
                    await sql`
                        insert into meals (
                            user_id,
                            description,
                            meal_type,
                            logged_at,
                            idempotency_key
                        )
                        values (
                            ${userId},
                            ${"Block"},
                            ${"lunch"},
                            ${"2024-01-01T12:00:00.000Z"},
                            ${"block-meal"}
                        )
                    `;
                },
            },
            {
                table: "oauth_tokens",
                seed: async () => {
                    await sql`
                        insert into oauth_tokens (token, user_id, expires_at)
                        values (
                            ${"block-oauth"},
                            ${userId},
                            ${"2030-01-01T00:00:00.000Z"}
                        )
                    `;
                },
            },
            {
                table: "refresh_tokens",
                seed: async () => {
                    await sql`
                        insert into refresh_tokens (token, user_id, expires_at)
                        values (
                            ${"block-refresh"},
                            ${userId},
                            ${"2030-01-01T00:00:00.000Z"}
                        )
                    `;
                },
            },
            {
                table: "auth_codes",
                seed: async () => {
                    await sql`
                        insert into auth_codes (
                            code,
                            redirect_uri,
                            user_id,
                            code_challenge,
                            expires_at
                        )
                        values (
                            ${"block-code"},
                            ${"http://localhost/cb"},
                            ${userId},
                            ${"challenge"},
                            ${"2030-01-01T00:00:00.000Z"}
                        )
                    `;
                },
            },
        ];
        for (const { table, seed } of blockers) {
            await seed();
            const err = await deleteAuthUser(userId).then(
                () => null,
                (e: unknown) => e,
            );
            expect(err).toBeTruthy();
            await sql`delete from ${sql.unsafe(table)} where user_id = ${userId}`;
        }
    });

    test("ownership promotion prefers admin then oldest account", async () => {
        const { sql } = getCtx();
        const householdId = crypto.randomUUID();
        const ownerId = crypto.randomUUID();
        const adminId = crypto.randomUUID();
        const memberId = crypto.randomUUID();
        const now = new Date();
        for (const row of [
            {
                id: ownerId,
                email: "owner@example.com",
                created_at: now.toISOString(),
            },
            {
                id: adminId,
                email: "admin@example.com",
                created_at: new Date(now.getTime() - 86400000).toISOString(),
            },
            {
                id: memberId,
                email: "member@example.com",
                created_at: new Date(
                    now.getTime() - 86400000 * 365,
                ).toISOString(),
            },
        ]) {
            await sql`
                insert into auth.users (id, email, created_at)
                values (${row.id}, ${row.email}, ${row.created_at})
            `;
        }
        await sql`
            insert into public.households (id, name)
            values (${householdId}, ${"Promo"})
        `;
        await sql`
            insert into public.household_members (
                household_id,
                user_id,
                role,
                display_name
            )
            values
                (${householdId}, ${ownerId}, ${"owner"}, ${"Owner"}),
                (${householdId}, ${adminId}, ${"admin"}, ${"Admin"}),
                (${householdId}, ${memberId}, ${"member"}, ${"Member"})
        `;
        await deleteAuthUser(ownerId);
        const [nextOwner] = await sql`
            select display_name, role
            from household_members
            where household_id = ${householdId}
              and role = 'owner'
        `;
        expect(nextOwner.display_name).toBe("Admin");
    });

    test("ownership promotion picks oldest account when no admin", async () => {
        const { sql } = getCtx();
        const householdId = crypto.randomUUID();
        const ownerId = crypto.randomUUID();
        const olderMemberId = crypto.randomUUID();
        const newerMemberId = crypto.randomUUID();
        const now = new Date();
        for (const row of [
            {
                id: ownerId,
                email: "owner2@example.com",
                created_at: now.toISOString(),
            },
            {
                id: newerMemberId,
                email: "newer@example.com",
                created_at: new Date(now.getTime() - 86400000).toISOString(),
            },
            {
                id: olderMemberId,
                email: "older@example.com",
                created_at: new Date(
                    now.getTime() - 86400000 * 365,
                ).toISOString(),
            },
        ]) {
            await sql`
                insert into auth.users (id, email, created_at)
                values (${row.id}, ${row.email}, ${row.created_at})
            `;
        }
        await sql`
            insert into public.households (id, name)
            values (${householdId}, ${"Promo no admin"})
        `;
        await sql`
            insert into public.household_members (
                household_id,
                user_id,
                role,
                display_name
            )
            values
                (${householdId}, ${ownerId}, ${"owner"}, ${"Owner"}),
                (${householdId}, ${olderMemberId}, ${"member"}, ${"Older"}),
                (${householdId}, ${newerMemberId}, ${"member"}, ${"Newer"})
        `;
        await deleteAuthUser(ownerId);
        const [nextOwner] = await sql`
            select display_name, role
            from household_members
            where household_id = ${householdId}
              and role = 'owner'
        `;
        expect(nextOwner.display_name).toBe("Older");
    });

    test("live sign-in rehashes bcrypt and classifies failures", async () => {
        const bcryptHash = (
            await Bun.password.hash("live-pass", { algorithm: "bcrypt" })
        ).replace(/^\$2b\$/, "$2a$");
        const id = crypto.randomUUID();
        const { sql } = getCtx();
        await sql`
            insert into public.users (id, email, password_hash)
            values (${id}, ${"live@example.com"}, ${bcryptHash})
        `;
        await signInUser("live@example.com", "live-pass");
        const [row] = await sql`
            select password_hash from public.users where id = ${id}
        `;
        expect(row.password_hash.startsWith("$argon2id$")).toBe(true);
        await signInUser("live@example.com", "live-pass");
        const wrongPassErr = await signInUser(
            "live@example.com",
            "wrong",
        ).catch((e: unknown) => e);
        expect(wrongPassErr).toBeInstanceOf(SignInError);
        expect(wrongPassErr).toMatchObject({
            message: "Invalid login credentials",
            status: 400,
            code: "invalid_credentials",
        });
        expect(classifySignInFailure(wrongPassErr)).toBe("credentials");

        const savedSql = sql;
        setSqlForTests(
            new SQL("postgres://nobody:nothing@127.0.0.1:1/none", {
                prepare: false,
                max: 1,
                connectionTimeout: 500,
            }),
        );
        const storeErr = await signInUser(
            "live@example.com",
            "live-pass",
        ).catch((e: unknown) => e);
        setSqlForTests(savedSql);
        expect(classifySignInFailure(storeErr)).toBe("unavailable");
    });

    test("resolveApproveUser first user and closed household", async () => {
        const messages = {
            invalidCredentials: "Wrong password.",
            signInUnavailable: "Try again.",
        };
        const first = await resolveApproveUser({
            email: "first@example.com",
            password: "secret12",
            authUserCount,
            signInUser,
            signUpUser,
            messages,
        });
        expect(first).toBeTruthy();
        await expect(
            resolveApproveUser({
                email: "first@example.com",
                password: "wrong-pass",
                authUserCount,
                signInUser,
                signUpUser,
                messages,
            }),
        ).rejects.toThrow("Wrong password.");
        const countBefore = await authUserCount();
        expect(countBefore).toBe(1);
    });

    test("addHouseholdMemberForHousehold with live auth admin", async () => {
        const { sql } = getCtx();
        const { householdId } = await seedHousehold(sql);
        const ok = await addHouseholdMemberForHousehold(householdId, {
            displayName: "Newbie",
            login: { kind: "username", username: "newbie42" },
            password: "long-enough-password",
        });
        expect(ok).toEqual({ ok: true, userId: expect.any(String) });
        const dupe = await addHouseholdMemberForHousehold(householdId, {
            displayName: "Dupe",
            login: { kind: "username", username: "newbie42" },
            password: "long-enough-password",
        });
        expect(dupe).toEqual({
            ok: false,
            error: "That login is already in use.",
        });
    });

    test("addHouseholdMemberForHousehold compensates when RPC fails", async () => {
        const { sql } = getCtx();
        const { householdId } = await seedHousehold(sql);
        const badHousehold = crypto.randomUUID();
        const result = await addHouseholdMemberForHousehold(badHousehold, {
            displayName: "Ghost",
            login: { kind: "username", username: "ghost99" },
            password: "long-enough-password",
        });
        expect(result.ok).toBe(false);
        const [row] = await sql`
            select id from public.users where email = ${"ghost99@household.invalid"}
        `;
        expect(row).toBeUndefined();
    });
});
