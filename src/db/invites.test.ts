import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
    createHouseholdInvite,
    hashInviteCode,
    INVITE_TTL_MS,
    listHouseholdInvites,
    peekInviteCode,
    revokeHouseholdInvite,
    signUpWithInvite,
} from "./invites.js";
import { describeDb } from "./testing/pg.js";
import { seedHousehold } from "./testing/fixtures.js";
import { findPgBin } from "./testing/pg-temp.js";
import { setSqlForTests } from "./sql.js";

const pgAvailable = await findPgBin();

describeDb(pgAvailable !== null, "household invites", (getCtx) => {
    let householdId = "";
    let ownerId = "";

    beforeEach(async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        ({ householdId, userId: ownerId } = await seedHousehold(sql));
    });

    afterEach(() => {
        setSqlForTests(null);
    });

    test("create lists and revoke an unused invite", async () => {
        const { invite, code } = await createHouseholdInvite(
            householdId,
            ownerId,
        );
        expect(code.length).toBeGreaterThanOrEqual(16);
        expect(invite.usedAt).toBeNull();
        const expiresMs = Date.parse(invite.expiresAt) - Date.now();
        expect(expiresMs).toBeGreaterThan(INVITE_TTL_MS - 60_000);
        expect(expiresMs).toBeLessThan(INVITE_TTL_MS + 60_000);

        const listed = await listHouseholdInvites(householdId);
        expect(listed).toHaveLength(1);
        expect(listed[0]?.id).toBe(invite.id);

        expect(await peekInviteCode(code)).toEqual({ valid: true });
        expect(await revokeHouseholdInvite(householdId, invite.id)).toBe(true);
        expect(await peekInviteCode(code)).toEqual({ valid: false });
        expect(await listHouseholdInvites(householdId)).toHaveLength(0);
    });

    async function counts(): Promise<{
        users: number;
        members: number;
        unused: number;
    }> {
        const [row] = (await getCtx().sql`
            select
                (select count(*)::int from public.users) as users,
                (select count(*)::int from public.household_members) as members,
                (select count(*)::int from public.household_invites where used_at is null) as unused
        `) as { users: number; members: number; unused: number }[];
        return row!;
    }

    const PASSWORD = "a-long-enough-password";

    test("an invite signs up one person into the household, once", async () => {
        const { code } = await createHouseholdInvite(householdId, ownerId);
        const result = await signUpWithInvite({
            code: ` ${code} `,
            email: "new@foodable.test",
            password: PASSWORD,
            displayName: "Newbie",
        });
        if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);
        expect(result.householdId).toBe(householdId);
        const [member] = (await getCtx().sql`
            select household_id, role, display_name
            from public.household_members
            where user_id = ${result.userId}
        `) as { household_id: string; role: string; display_name: string }[];
        expect(member).toEqual({
            household_id: householdId,
            role: "member",
            display_name: "Newbie",
        });
        const [invite] = (await getCtx().sql`
            select used_by, used_at is not null as used
            from public.household_invites
        `) as { used_by: string; used: boolean }[];
        expect(invite).toEqual({ used_by: result.userId, used: true });

        expect(
            await signUpWithInvite({
                code,
                email: "second@foodable.test",
                password: PASSWORD,
                displayName: "Second",
            }),
        ).toEqual({ ok: false, reason: "invalid-invite" });
        expect(await peekInviteCode(code)).toEqual({ valid: false });
    });

    test("expired, wrong and blank codes sign nobody up", async () => {
        const { code } = await createHouseholdInvite(householdId, ownerId);
        await getCtx().sql`
            update public.household_invites
            set expires_at = now() - interval '1 minute'
            where code_hash = ${hashInviteCode(code)}
        `;
        const before = await counts();
        for (const attempt of [code, "not-a-real-code", "  "]) {
            expect(
                await signUpWithInvite({
                    code: attempt,
                    email: "new@foodable.test",
                    password: PASSWORD,
                    displayName: "Newbie",
                }),
            ).toEqual({ ok: false, reason: "invalid-invite" });
        }
        expect(await peekInviteCode(code)).toEqual({ valid: false });
        expect(await counts()).toEqual(before);
    });

    test("a failure after the claim rolls everything back and leaves the code unused", async () => {
        const { code } = await createHouseholdInvite(householdId, ownerId);
        const before = await counts();

        // Too short a password: the login cannot be created after the claim.
        await expect(
            signUpWithInvite({
                code,
                email: "new@foodable.test",
                password: "short",
                displayName: "Newbie",
            }),
        ).rejects.toThrow(/at least/);
        expect(await counts()).toEqual(before);

        // The membership step fails after the login was written.
        await expect(
            signUpWithInvite({
                code,
                email: "new@foodable.test",
                password: PASSWORD,
                displayName: "   ",
            }),
        ).rejects.toThrow(/person name required/);
        expect(await counts()).toEqual(before);

        // Any failure after the claim, injected.
        await expect(
            signUpWithInvite(
                {
                    code,
                    email: "new@foodable.test",
                    password: PASSWORD,
                    displayName: "Newbie",
                },
                {
                    afterClaim: async () => {
                        throw new Error("boom");
                    },
                },
            ),
        ).rejects.toThrow("boom");
        expect(await counts()).toEqual(before);
        expect(await peekInviteCode(code)).toEqual({ valid: true });

        // The code still works afterwards.
        const ok = await signUpWithInvite({
            code,
            email: "new@foodable.test",
            password: PASSWORD,
            displayName: "Newbie",
        });
        expect(ok.ok).toBe(true);
    });

    test("an email that already has a login leaves the code unused", async () => {
        const { code } = await createHouseholdInvite(householdId, ownerId);
        const ownerEmail = `test-${ownerId}@foodable.test`;
        const before = await counts();
        expect(
            await signUpWithInvite({
                code,
                email: ownerEmail,
                password: PASSWORD,
                displayName: "Owner again",
            }),
        ).toEqual({ ok: false, reason: "already-registered" });
        expect(await counts()).toEqual(before);
        expect(await peekInviteCode(code)).toEqual({ valid: true });
    });
});
