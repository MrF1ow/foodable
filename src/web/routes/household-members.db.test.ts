import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { getHouseholdMembership } from "../../db/household.js";
import { listHouseholdInvites } from "../../db/invites.js";
import { setSqlForTests } from "../../db/sql.js";
import { describeDb } from "../../db/testing/pg.js";
import { seedHousehold, seedMember } from "../../db/testing/fixtures.js";
import { findPgBin } from "../../db/testing/pg-temp.js";
import { resetFlagsForTests } from "../../flags.js";
import { mintSiteSession, SITE_COOKIE } from "../../site-session.js";
import { HOUSEHOLD_TOKEN_PREFIX } from "../../household-token.js";
import { householdRoutes } from "./household.js";

process.env.SESSION_SECRET ||= "01234567890123456789012345678901";
process.env.OAUTH_CLIENT_SECRET ||= "test-client-secret-thirty-two-chars-min";

const pgAvailable = await findPgBin();

// The household routes over one real database: the Household and member
// pages by role, the owner's invite codes, and the member actions.
const app = new Hono();
app.route("/", householdRoutes);

function request(userId: string, path: string, form?: Record<string, string>) {
    return app.request(`http://test${path}`, {
        method: form ? "POST" : "GET",
        headers: {
            cookie: `${SITE_COOKIE}=${mintSiteSession(userId)}`,
            ...(form
                ? { "content-type": "application/x-www-form-urlencoded" }
                : {}),
        },
        body: form ? new URLSearchParams(form).toString() : undefined,
    });
}

/** A form post with the body written out, for repeated or bracketed keys. */
function requestRaw(userId: string, path: string, body: string) {
    return app.request(`http://test${path}`, {
        method: "POST",
        headers: {
            cookie: `${SITE_COOKIE}=${mintSiteSession(userId)}`,
            "content-type": "application/x-www-form-urlencoded",
        },
        body,
    });
}

describeDb(
    pgAvailable !== null,
    "household members, invites and member actions",
    (getCtx) => {
        let owner: string;
        let householdId: string;
        let admin: string;
        let member: string;

        beforeEach(async () => {
            const { sql, truncateAll } = getCtx();
            await truncateAll();
            setSqlForTests(sql);
            ({ userId: owner, householdId } = await seedHousehold(sql));
            admin = await seedMember(sql, householdId, {
                role: "admin",
                displayName: "Adele",
            });
            member = await seedMember(sql, householdId, {
                displayName: "Bob",
            });
        });

        afterEach(() => {
            setSqlForTests(null);
            resetFlagsForTests();
        });

        describe("invite codes", () => {
            test("the owner's page lists them with Revoke only on an active one, and goes back to the household", async () => {
                const { sql } = getCtx();
                await sql`
                    insert into public.household_invites (household_id, code_hash, created_by, expires_at)
                    values (${householdId}, ${"a".repeat(64)}, ${owner}, now() + interval '3 days'),
                           (${householdId}, ${"b".repeat(64)}, ${owner}, now() - interval '1 day')
                `;
                const res = await request(owner, "/settings/household/invites");
                expect(res.status).toBe(200);
                const html = await res.text();
                expect(html).toContain('data-fd-settings-page="household"');
                expect(html).toContain(
                    'aria-label="Back" href="/settings/household"',
                );
                expect(html).toContain("Active");
                expect(html).toContain("Expired");
                // One menu, on the active code.
                expect(html.match(/data-fd-menu-trigger/g)).toHaveLength(1);
                expect(html).not.toContain("New invite code");
            });

            test("an expiry is the day in the household's zone, not UTC", async () => {
                const { sql } = getCtx();
                await sql`
                    update public.households
                    set household_preferences = jsonb_set(
                        coalesce(household_preferences, '{}'::jsonb),
                        '{timezone}',
                        '"Pacific/Kiritimati"'
                    )
                    where id = ${householdId}
                `;
                // 20:00 UTC is already the next morning in Kiritimati (UTC+14).
                const now = new Date();
                const expires = new Date(
                    Date.UTC(
                        now.getUTCFullYear(),
                        now.getUTCMonth(),
                        now.getUTCDate() + 3,
                        20,
                    ),
                );
                await sql`
                    insert into public.household_invites (household_id, code_hash, created_by, expires_at)
                    values (${householdId}, ${"c".repeat(64)}, ${owner}, ${expires.toISOString()})
                `;
                const html = await (
                    await request(owner, "/settings/household/invites")
                ).text();
                const label = (zone: string) =>
                    new Intl.DateTimeFormat("en-US", {
                        timeZone: zone,
                        month: "short",
                        day: "numeric",
                    }).format(expires);
                expect(label("Pacific/Kiritimati")).not.toBe(label("UTC"));
                expect(html).toContain(
                    `Expires ${label("Pacific/Kiritimati")}`,
                );
                expect(html).not.toContain(`Expires ${label("UTC")}`);
            });

            test("+ answers 200 with the one-time code and a form that opts out of Turbo; the next visit does not show it", async () => {
                const page = await (
                    await request(owner, "/settings/household/invites")
                ).text();
                expect(page).toMatch(
                    /<form method="post" action="\/settings\/household\/invites" class="fd-settings-invite-create" data-turbo="false">/,
                );
                const res = await request(
                    owner,
                    "/settings/household/invites",
                    {},
                );
                expect(res.status).toBe(200);
                expect(res.headers.get("set-cookie") ?? "").not.toContain(
                    "toast",
                );
                const html = await res.text();
                const code = html.match(
                    /<code id="household-invite-code" data-fd-copy-source>([^<]+)<\/code>/,
                )?.[1];
                expect(code).toBeDefined();
                expect(html).toContain("shown only now");
                expect(await listHouseholdInvites(householdId)).toHaveLength(1);
                const again = await (
                    await request(owner, "/settings/household/invites")
                ).text();
                expect(again).not.toContain(code!);
            });

            test("Revoke answers 303 back to the page and removes the code; a bad id is a 400", async () => {
                const created = await request(
                    owner,
                    "/settings/household/invites",
                    {},
                );
                expect(created.status).toBe(200);
                const [invite] = await listHouseholdInvites(householdId);
                const revoked = await request(
                    owner,
                    "/settings/household/invites/revoke",
                    { invite_id: invite!.id },
                );
                expect(revoked.status).toBe(303);
                expect(revoked.headers.get("location")).toBe(
                    "/settings/household/invites",
                );
                expect(await listHouseholdInvites(householdId)).toEqual([]);
                expect(
                    (
                        await request(
                            owner,
                            "/settings/household/invites/revoke",
                            { invite_id: "nope" },
                        )
                    ).status,
                ).toBe(400);
            });

            test("an admin and a member get 403 on the page and on every form", async () => {
                for (const who of [admin, member]) {
                    expect(
                        (await request(who, "/settings/household/invites"))
                            .status,
                    ).toBe(403);
                    expect(
                        (await request(who, "/settings/household/invites", {}))
                            .status,
                    ).toBe(403);
                    expect(
                        (
                            await request(
                                who,
                                "/settings/household/invites/revoke",
                                { invite_id: crypto.randomUUID() },
                            )
                        ).status,
                    ).toBe(403);
                }
                expect(await listHouseholdInvites(householdId)).toEqual([]);
            });
        });

        describe("the Household page by role", () => {
            const labels = (html: string, group: string) => {
                const at = html.indexOf(`aria-label="${group}"><li`);
                return [
                    ...html
                        .slice(at, html.indexOf("</ul>", at))
                        .matchAll(/fd-item-row__title" title="([^"]*)"/g),
                ].map((m) => m[1]);
            };

            test("the owner has Add a member, Invite codes and both menu items", async () => {
                const html = await (
                    await request(owner, "/settings/household")
                ).text();
                // The owner first, then the rest in their order.
                expect(labels(html, "Members")).toEqual([
                    "Owner",
                    "Adele",
                    "Bob",
                    "Add a member",
                ]);
                expect(labels(html, "Household")).toContain("Invite codes");
                expect(html).toContain("Rename household");
                expect(html).toContain("Rotate household token");
            });

            test("an admin adds members and renames, but has no Invite codes and no token rotation", async () => {
                const html = await (
                    await request(admin, "/settings/household")
                ).text();
                expect(labels(html, "Members")).toContain("Add a member");
                expect(labels(html, "Household")).not.toContain("Invite codes");
                expect(html).toContain("Rename household");
                expect(html).not.toContain("Rotate household token");
                expect(html).not.toContain("/settings/household/invites");
            });

            test("a member sees the values only", async () => {
                const html = await (
                    await request(member, "/settings/household")
                ).text();
                expect(labels(html, "Members")).toEqual([
                    "Owner",
                    "Adele",
                    "Bob",
                ]);
                expect(html).not.toContain("data-fd-menu");
                expect(html).not.toContain("Invite codes");
                expect(html).not.toContain("Rotate household token");
                expect(html).not.toContain('action="/settings/household/');
            });
        });

        describe("adding a member and choosing their role", () => {
            const PASSWORD = "correct-horse-battery";
            const add = (
                who: string,
                name: string,
                extra: Record<string, string> = {},
            ) =>
                request(who, "/settings/household", {
                    display_name: name,
                    login: `${name.toLowerCase()}@example.com`,
                    password: PASSWORD,
                    ...extra,
                });
            const roleOf = async (name: string) => {
                const { sql } = getCtx();
                const rows = await sql`
                    select role from public.household_members
                    where household_id = ${householdId} and display_name = ${name}
                `;
                return rows.length === 0 ? null : String(rows[0].role);
            };
            const count = async () => {
                const { sql } = getCtx();
                const rows = await sql`
                    select count(*)::int as n from public.household_members
                    where household_id = ${householdId}
                `;
                return Number(rows[0].n);
            };

            test("the owner adds an admin, and the role is set through the same path as a role change", async () => {
                const res = await add(owner, "Cleo", { role: "admin" });
                expect(res.status).toBe(303);
                expect(res.headers.get("location")).toBe("/settings/household");
                expect(res.headers.get("set-cookie") ?? "").not.toContain(
                    "toast",
                );
                expect(await roleOf("Cleo")).toBe("admin");
            });

            test("the owner adds a member by choosing Member, or by choosing nothing", async () => {
                expect(
                    (await add(owner, "Dina", { role: "member" })).status,
                ).toBe(303);
                expect((await add(owner, "Eli")).status).toBe(303);
                expect(await roleOf("Dina")).toBe("member");
                expect(await roleOf("Eli")).toBe("member");
            });

            test("the owner posting a role that is neither is refused and adds nobody", async () => {
                const before = await count();
                const res = await add(owner, "Fay", { role: "owner" });
                expect(res.status).toBe(400);
                const html = await res.text();
                expect(html).toContain("Choose admin or member.");
                expect(html).toContain("data-sheet-open-on-load");
                expect(await count()).toBe(before);
            });

            test("an admin adds a member, and a role an admin posts is refused and adds nobody", async () => {
                expect((await add(admin, "Gus")).status).toBe(303);
                expect(await roleOf("Gus")).toBe("member");
                const before = await count();
                for (const role of ["admin", "member"]) {
                    const res = await add(admin, `Hal${role}`, { role });
                    expect([role, res.status]).toEqual([role, 400]);
                    expect(await res.text()).toContain(
                        "Only the owner can choose a role.",
                    );
                }
                expect(await roleOf("Haladmin")).toBeNull();
                expect(await roleOf("Halmember")).toBeNull();
                expect(await count()).toBe(before);
            });

            test("a forged repeat of role cannot slip an admin past the owner-only rule", async () => {
                const base = `display_name=Zed&login=zed%40example.com&password=${PASSWORD}`;
                const before = await count();
                for (const forged of [
                    "role=admin&role=",
                    "role=&role=admin",
                    "role%5B%5D=admin",
                    "role=member&role=admin",
                ]) {
                    const res = await requestRaw(
                        admin,
                        "/settings/household",
                        `${base}&${forged}`,
                    );
                    expect([forged, res.status]).toEqual([forged, 400]);
                    expect(await res.text()).toContain(
                        "Only the owner can choose a role.",
                    );
                }
                expect(await roleOf("Zed")).toBeNull();
                expect(await count()).toBe(before);
                // An empty role alone is no role: an admin adds a plain member.
                expect(
                    (
                        await requestRaw(
                            admin,
                            "/settings/household",
                            `${base}&role=`,
                        )
                    ).status,
                ).toBe(303);
                expect(await roleOf("Zed")).toBe("member");
            });

            test("the owner's repeated or conflicting roles are refused; one role, plain or bracketed, is taken", async () => {
                const base = `login=amy%40example.com&password=${PASSWORD}`;
                const before = await count();
                const conflict = await requestRaw(
                    owner,
                    "/settings/household",
                    `display_name=Amy&${base}&role=admin&role=member`,
                );
                expect(conflict.status).toBe(400);
                expect(await conflict.text()).toContain(
                    "Choose admin or member.",
                );
                expect(await count()).toBe(before);
                expect(
                    (
                        await requestRaw(
                            owner,
                            "/settings/household",
                            `display_name=Amy&${base}&role%5B%5D=admin`,
                        )
                    ).status,
                ).toBe(303);
                expect(await roleOf("Amy")).toBe("admin");
            });

            test("when the role step fails the person is still added as a member, and the answer says so", async () => {
                const { sql } = getCtx();
                await sql.unsafe(`
                    create or replace function public.p4_refuse_role() returns trigger
                    language plpgsql as $$ begin
                        raise exception 'boom from the database';
                    end $$;
                    create trigger p4_refuse_role before update of role
                        on public.household_members
                        for each row execute function public.p4_refuse_role();
                `);
                try {
                    const res = await add(owner, "Kit", { role: "admin" });
                    expect(res.status).toBe(400);
                    const html = await res.text();
                    expect(html).toContain(
                        "Kit was added as a member, but making them an admin didn't work.",
                    );
                    expect(html).toContain(
                        "Open their page and set Role to Admin to try again.",
                    );
                    // Not the database's own words.
                    expect(html).not.toContain("boom from the database");
                    expect(html).not.toContain("Failed to change role");
                    expect(await roleOf("Kit")).toBe("member");
                } finally {
                    await sql.unsafe(`
                        drop trigger if exists p4_refuse_role on public.household_members;
                        drop function if exists public.p4_refuse_role();
                    `);
                }
            });

            test("a member cannot add anyone", async () => {
                const before = await count();
                expect((await add(member, "Ivy")).status).toBe(403);
                expect(await count()).toBe(before);
            });

            test("a name over 80 characters is refused and adds nobody", async () => {
                const before = await count();
                const res = await add(owner, "J".repeat(81));
                expect(res.status).toBe(400);
                expect(await res.text()).toContain(
                    "Name must be at most 80 characters.",
                );
                expect(await count()).toBe(before);
                expect((await add(owner, "K".repeat(80))).status).toBe(303);
            });
        });

        describe("rotating the household token", () => {
            const tokenRows = async () => {
                const { sql } = getCtx();
                const rows = await sql`
                    select count(*)::int as n from public.household_mcp_tokens
                    where household_id = ${householdId}
                `;
                return Number(rows[0].n);
            };

            test("the owner gets the token on a page of its own, once, never cached", async () => {
                const res = await request(
                    owner,
                    "/settings/household/rotate-token",
                    {},
                );
                expect(res.status).toBe(200);
                expect(res.headers.get("cache-control")).toBe("no-store");
                expect(res.headers.get("set-cookie") ?? "").not.toContain(
                    "toast",
                );
                const html = await res.text();
                expect(html).toContain(
                    '<h1 class="fd-detail-bar__title">Household token</h1>',
                );
                expect(html).toContain("Shown only now");
                const token = html.match(
                    /<code id="household-token" data-fd-copy-source>([^<]+)<\/code>/,
                )?.[1];
                expect(token).toMatch(new RegExp(`^${HOUSEHOLD_TOKEN_PREFIX}`));
                expect(await tokenRows()).toBe(1);
                const again = await (
                    await request(owner, "/settings/household")
                ).text();
                expect(again).not.toContain(token!);
                expect(again).not.toContain("Shown only now");
            });

            test("an admin and a member are refused and nothing is rotated", async () => {
                for (const who of [admin, member]) {
                    const res = await request(
                        who,
                        "/settings/household/rotate-token",
                        {},
                    );
                    expect(res.status).toBe(403);
                    expect(await res.text()).not.toContain(
                        HOUSEHOLD_TOKEN_PREFIX,
                    );
                }
                expect(await tokenRows()).toBe(0);
            });
        });

        describe("a member's page and the actions on it", () => {
            const items = (html: string) =>
                [...html.matchAll(/fd-menu__label">([^<]*)</g)].map(
                    (m) => m[1],
                );

            test("the owner's page for another person has a Role drop-down (Member, Admin, Owner) and a red Remove row, no ⋯; for themselves neither", async () => {
                const html = await (
                    await request(
                        owner,
                        `/settings/household/members/${member}`,
                    )
                ).text();
                expect(items(html)).toEqual(["Member", "Admin", "Owner"]);
                expect(html.match(/data-fd-menu-trigger/g)).toHaveLength(1);
                expect(html).toContain("fd-member-make-owner");
                expect(html).toContain('commandfor="fd-member-remove"');
                expect(html).toContain("fd-item-row--danger");
                expect(html).toContain("Last active");
                const self = await (
                    await request(owner, `/settings/household/members/${owner}`)
                ).text();
                expect(self).not.toContain("data-fd-menu");
                expect(self).not.toContain("fd-item-row--danger");
                const adminPage = await (
                    await request(owner, `/settings/household/members/${admin}`)
                ).text();
                expect(items(adminPage)).toEqual(["Member", "Admin", "Owner"]);
                expect(adminPage).toContain('name="role" value="member"');
                expect(adminPage).not.toContain('name="role" value="admin"');
            });

            test("an admin and a member see a person's page with no menu", async () => {
                for (const who of [admin, member]) {
                    const html = await (
                        await request(
                            who,
                            `/settings/household/members/${owner}`,
                        )
                    ).text();
                    expect(html).toContain('data-fd-settings-page="household"');
                    expect(html).not.toContain("data-fd-menu");
                    expect(html).not.toContain("Make owner");
                    expect(html).not.toContain("fd-item-row--danger");
                    expect(html).toContain('fd-item-row__value">Owner<');
                }
            });

            test("a role change lands on that person's page with no toast; choosing Member undoes it", async () => {
                const up = await request(
                    owner,
                    `/settings/household/members/${member}/role`,
                    { role: "admin" },
                );
                expect(up.status).toBe(303);
                expect(up.headers.get("location")).toBe(
                    `/settings/household/members/${member}`,
                );
                expect(up.headers.get("set-cookie") ?? "").not.toContain(
                    "toast",
                );
                expect((await getHouseholdMembership(member))?.role).toBe(
                    "admin",
                );
                const page = await (
                    await request(
                        owner,
                        `/settings/household/members/${member}`,
                    )
                ).text();
                expect(page).toContain('fd-item-row__value">Admin<');
                expect(page).toContain('name="role" value="member"');
                const down = await request(
                    owner,
                    `/settings/household/members/${member}/role`,
                    { role: "member" },
                );
                expect(down.status).toBe(303);
                expect((await getHouseholdMembership(member))?.role).toBe(
                    "member",
                );
            });

            test("an admin and a member cannot change a role, hand over ownership or remove anyone", async () => {
                for (const who of [admin, member]) {
                    for (const [path, form] of [
                        [
                            `/settings/household/members/${member}/role`,
                            { role: "admin" },
                        ],
                        [
                            `/settings/household/members/${member}/make-owner`,
                            {},
                        ],
                        [
                            `/settings/household/members/${member}/remove`,
                            { confirm: "yes" },
                        ],
                    ] as const) {
                        expect([
                            path,
                            (await request(who, path, form)).status,
                        ]).toEqual([path, 403]);
                    }
                }
                expect((await getHouseholdMembership(member))?.role).toBe(
                    "member",
                );
            });

            test("a refused action shows its reason on the person's page", async () => {
                const bad = await request(
                    owner,
                    `/settings/household/members/${member}/role`,
                    { role: "owner" },
                );
                expect(bad.status).toBe(400);
                const html = await bad.text();
                expect(html).toContain("Choose admin or member.");
                expect(html).toContain("fd-settings-member-head");
                const self = await request(
                    owner,
                    `/settings/household/members/${owner}/remove`,
                    { confirm: "yes" },
                );
                expect(self.status).toBe(400);
                expect(await self.text()).toContain(
                    "You can't remove yourself.",
                );
                const noTick = await request(
                    owner,
                    `/settings/household/members/${member}/remove`,
                    {},
                );
                expect(noTick.status).toBe(400);
                expect(await noTick.text()).toContain(
                    "Confirm removing Bob in the sheet.",
                );
                expect(await getHouseholdMembership(member)).not.toBeNull();
            });

            test("Make owner hands ownership over and goes back to the household; Remove erases the member", async () => {
                const gone = await request(
                    owner,
                    `/settings/household/members/${member}/remove`,
                    { confirm: "yes" },
                );
                expect(gone.status).toBe(303);
                expect(gone.headers.get("location")).toBe(
                    "/settings/household",
                );
                expect(await getHouseholdMembership(member)).toBeNull();
                const handed = await request(
                    owner,
                    `/settings/household/members/${admin}/make-owner`,
                    {},
                );
                expect(handed.status).toBe(303);
                expect(handed.headers.get("location")).toBe(
                    "/settings/household",
                );
                expect((await getHouseholdMembership(admin))?.role).toBe(
                    "owner",
                );
                expect((await getHouseholdMembership(owner))?.role).toBe(
                    "member",
                );
            });
        });
    },
);
