import { beforeEach, describe, expect, test } from "bun:test";
import type { SQL } from "bun";
import { classifySignInFailure, resolveApproveUser } from "../oauth.js";
import { SignInError } from "../domain/auth.js";
import { addHouseholdMemberForHousehold } from "./household.js";
import { deleteAllUserData } from "./nutrition.js";
import { createMemoryExportArchiveStore } from "./exports.js";
import { describeDb } from "./testing/pg.js";
import { seedHousehold } from "./testing/fixtures.js";
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
        await sql`
            insert into member_dislikes (household_id, user_id, display_name)
            values (${householdId}, ${userId}, ${"Kale"})
        `;
        const foodId = crypto.randomUUID();
        await sql`
            insert into foods (
                id,
                household_id,
                kind,
                name,
                normalized_name,
                default_unit,
                allergens,
                created_by
            )
            values (
                ${foodId},
                ${householdId},
                ${"food"},
                ${"Apple"},
                ${"apple"},
                ${"g"},
                ${sql.array([], "text")},
                ${userId}
            )
        `;
        await deleteAuthUser(userId);
        const dislikes = await sql`
            select count(*)::int as n
            from member_dislikes
            where user_id = ${userId}
        `;
        expect(dislikes[0].n).toBe(0);
        const [food] = await sql`
            select created_by from foods where id = ${foodId}
        `;
        expect(food.created_by).toBeNull();
    });

    test("no-action tables block delete until cleared", async () => {
        const { sql } = getCtx();
        const { userId } = await seedHousehold(sql);
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
        const err = await deleteAuthUser(userId).then(
            () => null,
            (e: unknown) => e,
        );
        expect(err).toBeTruthy();
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
        try {
            await signInUser("live@example.com", "wrong");
        } catch (err) {
            expect(classifySignInFailure(err)).toBe("credentials");
            expect((err as SignInError).message).toBe(
                "Invalid login credentials",
            );
        }
        expect(
            classifySignInFailure(new Error("timeout", { cause: "network" })),
        ).toBe("unavailable");
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
