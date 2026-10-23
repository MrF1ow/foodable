import { describe, expect, test } from "bun:test";
import { checkMigrations } from "./check.js";

const BASE_MIGRATION =
    "supabase/migrations/20261017180000_profile_nutrition_layout.sql";

async function fileContents(name: string): Promise<string> {
    return await Bun.file(`supabase/migrations/${name}`).text();
}

describe("checkMigrations", () => {
    test("modified migration is immutable only", () => {
        const findings = checkMigrations({
            changes: [{ status: "modified", path: BASE_MIGRATION }],
            newestBaseTimestamp: "20261017180000",
        });
        expect(findings).toHaveLength(1);
        expect(findings[0]?.rule).toBe("immutable");
        expect(findings[0]?.message).toContain("immutable:");
        expect(findings.some((f) => f.rule === "contract")).toBe(false);
    });

    test("deleted migration is immutable only", () => {
        const findings = checkMigrations({
            changes: [{ status: "deleted", path: BASE_MIGRATION }],
            newestBaseTimestamp: "20261017180000",
        });
        expect(findings).toHaveLength(1);
        expect(findings[0]?.rule).toBe("immutable");
    });

    test("renamed migration is immutable on previous path without contract", () => {
        const findings = checkMigrations({
            changes: [
                {
                    status: "renamed",
                    path: "supabase/migrations/20261018120000_renamed.sql",
                    previousPath: BASE_MIGRATION,
                    contents: "select 1;",
                },
            ],
            newestBaseTimestamp: "20261017180000",
        });
        expect(findings.some((f) => f.rule === "immutable")).toBe(true);
        expect(findings.some((f) => f.rule === "contract")).toBe(false);
    });

    test("bad filename yields name rule", () => {
        const findings = checkMigrations({
            changes: [
                {
                    status: "added",
                    path: "supabase/migrations/bad_name.sql",
                    contents: "select 1;",
                },
            ],
            newestBaseTimestamp: "20261017180000",
        });
        expect(findings.some((f) => f.rule === "name")).toBe(true);
    });

    test("timestamp equal to newest base is rejected", () => {
        const findings = checkMigrations({
            changes: [
                {
                    status: "added",
                    path: "supabase/migrations/20261017180000_duplicate.sql",
                    contents: "select 1;",
                },
            ],
            newestBaseTimestamp: "20261017180000",
        });
        expect(findings.some((f) => f.rule === "timestamp")).toBe(true);
    });

    test("later clean migration has no findings", () => {
        const findings = checkMigrations({
            changes: [
                {
                    status: "added",
                    path: "supabase/migrations/20261018120000_ok.sql",
                    contents: "select 1;",
                },
            ],
            newestBaseTimestamp: "20261017180000",
        });
        expect(findings).toHaveLength(0);
    });

    test("drop column without marker is contract", () => {
        const findings = checkMigrations({
            changes: [
                {
                    status: "added",
                    path: "supabase/migrations/20261018130000_drop_col.sql",
                    contents: "alter table public.foo drop column secret;",
                },
            ],
            newestBaseTimestamp: "20261017180000",
        });
        expect(findings.some((f) => f.rule === "contract")).toBe(true);
    });

    test("foodable contract comment with reason clears contract", () => {
        const findings = checkMigrations({
            changes: [
                {
                    status: "added",
                    path: "supabase/migrations/20261018130000_drop_col.sql",
                    contents:
                        "-- foodable:contract remove the unused secret\nalter table public.foo drop column secret;",
                },
            ],
            newestBaseTimestamp: "20261017180000",
        });
        expect(findings.some((f) => f.rule === "contract")).toBe(false);
    });

    test("foodable contract without reason still fails", () => {
        const findings = checkMigrations({
            changes: [
                {
                    status: "added",
                    path: "supabase/migrations/20261018130000_drop_col.sql",
                    contents:
                        "-- foodable:contract\nalter table public.foo drop column secret;",
                },
            ],
            newestBaseTimestamp: "20261017180000",
        });
        expect(findings.some((f) => f.rule === "contract")).toBe(true);
    });

    test("drop function is not contract", async () => {
        const contents = await fileContents(
            "20261004230100_drop_landing_stats.sql",
        );
        const findings = checkMigrations({
            changes: [
                {
                    status: "added",
                    path: "supabase/migrations/20261018140000_fn.sql",
                    contents,
                },
            ],
            newestBaseTimestamp: "20261017180000",
        });
        expect(findings.some((f) => f.rule === "contract")).toBe(false);
    });

    test("drop policy and drop trigger are not contract", () => {
        const findings = checkMigrations({
            changes: [
                {
                    status: "added",
                    path: "supabase/migrations/20261018140000_policy.sql",
                    contents: `
drop policy if exists p on public.foo;
drop trigger if exists t on public.foo;
`,
                },
            ],
            newestBaseTimestamp: "20261017180000",
        });
        expect(findings.some((f) => f.rule === "contract")).toBe(false);
    });

    test("create table with on delete cascade and enable rls is not contract", () => {
        const findings = checkMigrations({
            changes: [
                {
                    status: "added",
                    path: "supabase/migrations/20261018140000_cascade.sql",
                    contents: `
create table public.parent (id uuid primary key);
create table public.child (
    id uuid primary key,
    parent_id uuid references public.parent(id) on delete cascade
);
alter table public.parent enable row level security;
alter table public.child enable row level security;
`,
                },
            ],
            newestBaseTimestamp: "20261017180000",
        });
        expect(findings.some((f) => f.rule === "contract")).toBe(false);
        expect(findings.some((f) => f.rule === "rls")).toBe(false);
    });

    test("delete and update without where are contract", () => {
        for (const contents of [
            "delete from public.foo;",
            "update public.foo set x = 1;",
        ]) {
            const findings = checkMigrations({
                changes: [
                    {
                        status: "added",
                        path: "supabase/migrations/20261018150000_mut.sql",
                        contents,
                    },
                ],
                newestBaseTimestamp: "20261017180000",
            });
            expect(findings.some((f) => f.rule === "contract")).toBe(true);
        }
    });

    test("delete with where is not contract", () => {
        const findings = checkMigrations({
            changes: [
                {
                    status: "added",
                    path: "supabase/migrations/20261018150000_del.sql",
                    contents: "delete from public.foo where id = 1;",
                },
            ],
            newestBaseTimestamp: "20261017180000",
        });
        expect(findings.some((f) => f.rule === "contract")).toBe(false);
    });

    test("alter rename column, rename column shorthand, and rename constraint are contract", () => {
        const cases = [
            "alter table public.foo rename column old_name to new_name;",
            "alter table public.foo rename old_name to new_name;",
            "alter table public.foo rename constraint c to d;",
        ];
        for (const contents of cases) {
            const findings = checkMigrations({
                changes: [
                    {
                        status: "added",
                        path: "supabase/migrations/20261018160000_rename.sql",
                        contents,
                    },
                ],
                newestBaseTimestamp: "20261017180000",
            });
            expect(findings.some((f) => f.rule === "contract")).toBe(true);
        }
    });

    test("alter column type, rename to, truncate, set not null are contract", () => {
        const cases = [
            "alter table public.foo alter column x type text;",
            "alter table public.foo rename to bar;",
            "truncate public.foo;",
            "alter table public.foo alter column x set not null;",
        ];
        for (const contents of cases) {
            const findings = checkMigrations({
                changes: [
                    {
                        status: "added",
                        path: "supabase/migrations/20261018160000_ddl.sql",
                        contents,
                    },
                ],
                newestBaseTimestamp: "20261017180000",
            });
            expect(findings.some((f) => f.rule === "contract")).toBe(true);
        }
    });

    test("tagged dollar quote with digits hides drop column", () => {
        const findings = checkMigrations({
            changes: [
                {
                    status: "added",
                    path: "supabase/migrations/20261018170000_fn_tag.sql",
                    contents:
                        "create function f() as $fn1$ begin drop column secret; end $fn1$;",
                },
            ],
            newestBaseTimestamp: "20261017180000",
        });
        expect(findings.some((f) => f.rule === "contract")).toBe(false);
    });

    test("unclosed dollar quote hides trailing drop column", () => {
        const findings = checkMigrations({
            changes: [
                {
                    status: "added",
                    path: "supabase/migrations/20261018170000_unclosed.sql",
                    contents: "select 1; $$\n drop column secret",
                },
            ],
            newestBaseTimestamp: "20261017180000",
        });
        expect(findings.some((f) => f.rule === "contract")).toBe(false);
    });

    test("drop column outside dollar quote is still contract", () => {
        const findings = checkMigrations({
            changes: [
                {
                    status: "added",
                    path: "supabase/migrations/20261018170000_outside.sql",
                    contents:
                        "create function f() as $fn$ begin end $fn$; alter table public.foo drop column secret;",
                },
            ],
            newestBaseTimestamp: "20261017180000",
        });
        expect(findings.some((f) => f.rule === "contract")).toBe(true);
    });

    test("dollar-quoted delete with where is not contract", () => {
        const findings = checkMigrations({
            changes: [
                {
                    status: "added",
                    path: "supabase/migrations/20261018170000_fn.sql",
                    contents: `
create or replace function public.wipe() returns void language sql as $$
    delete from public.foo where id = 1;
$$;
`,
                },
            ],
            newestBaseTimestamp: "20261017180000",
        });
        expect(findings.some((f) => f.rule === "contract")).toBe(false);
    });

    test("quoted drop column string is not contract", () => {
        const findings = checkMigrations({
            changes: [
                {
                    status: "added",
                    path: "supabase/migrations/20261018180000_comment.sql",
                    contents: "select 'drop column secret';",
                },
            ],
            newestBaseTimestamp: "20261017180000",
        });
        expect(findings.some((f) => f.rule === "contract")).toBe(false);
    });

    test("create table without enable rls is rls", () => {
        const findings = checkMigrations({
            changes: [
                {
                    status: "added",
                    path: "supabase/migrations/20261018190000_tbl.sql",
                    contents: "create table public.new_thing (id int);",
                },
            ],
            newestBaseTimestamp: "20261017180000",
        });
        expect(findings.some((f) => f.rule === "rls")).toBe(true);
    });

    test("create table with enable rls is clean", () => {
        const findings = checkMigrations({
            changes: [
                {
                    status: "added",
                    path: "supabase/migrations/20261018190000_tbl.sql",
                    contents: `
create table public.new_thing (id int);
alter table public.new_thing enable row level security;
`,
                },
            ],
            newestBaseTimestamp: "20261017180000",
        });
        expect(findings.some((f) => f.rule === "rls")).toBe(false);
    });

    test("create table without a service_role grant is grant", () => {
        const findings = checkMigrations({
            changes: [
                {
                    status: "added",
                    path: "supabase/migrations/20261022190000_tbl.sql",
                    contents: `
create table public.new_thing (id int);
alter table public.new_thing enable row level security;
grant select, insert, update, delete on table public.new_thing to authenticated;
`,
                },
            ],
            newestBaseTimestamp: "20261017180000",
        });
        expect(findings.some((f) => f.rule === "grant")).toBe(true);
        expect(findings.some((f) => f.rule === "rls")).toBe(false);
    });

    test("grant all to service_role covers the data api privileges", () => {
        const findings = checkMigrations({
            changes: [
                {
                    status: "added",
                    path: "supabase/migrations/20261022190000_tbl.sql",
                    contents: `
create table public.new_thing (id int);
alter table public.new_thing enable row level security;
grant all on table public.new_thing to service_role;
`,
                },
            ],
            newestBaseTimestamp: "20261017180000",
        });
        expect(findings.some((f) => f.rule === "grant")).toBe(false);
    });

    test("split grants to service_role are enough", () => {
        const findings = checkMigrations({
            changes: [
                {
                    status: "added",
                    path: "supabase/migrations/20261022190000_tbl.sql",
                    contents: `
create table "public"."new_thing" (id int);
alter table public.new_thing enable row level security;
grant select, insert on table public.new_thing to "service_role";
grant update, delete on table public.new_thing to service_role;
`,
                },
            ],
            newestBaseTimestamp: "20261017180000",
        });
        expect(findings.some((f) => f.rule === "grant")).toBe(false);
    });

    test("select alone is not a service_role grant", () => {
        const findings = checkMigrations({
            changes: [
                {
                    status: "added",
                    path: "supabase/migrations/20261022190000_tbl.sql",
                    contents: `
create table public.new_thing (id int);
alter table public.new_thing enable row level security;
grant select on table public.new_thing to service_role;
`,
                },
            ],
            newestBaseTimestamp: "20261017180000",
        });
        expect(findings.some((f) => f.rule === "grant")).toBe(true);
    });

    test("fixture drop_tool_analytics produces contract", async () => {
        const contents = await fileContents(
            "20261004230200_drop_tool_analytics_protocol_era.sql",
        );
        const findings = checkMigrations({
            changes: [
                {
                    status: "added",
                    path: "supabase/migrations/20261018200000_tool.sql",
                    contents,
                },
            ],
            newestBaseTimestamp: "20261017180000",
        });
        expect(findings.some((f) => f.rule === "contract")).toBe(true);
    });

    test("fixture drop_patreon_tokens produces contract", async () => {
        const contents = await fileContents(
            "20261004230000_drop_patreon_tokens.sql",
        );
        const findings = checkMigrations({
            changes: [
                {
                    status: "added",
                    path: "supabase/migrations/20261018210000_patreon.sql",
                    contents,
                },
            ],
            newestBaseTimestamp: "20261017180000",
        });
        expect(findings.some((f) => f.rule === "contract")).toBe(true);
    });

    test("fixture drop_landing_stats does not produce contract", async () => {
        const contents = await fileContents(
            "20261004230100_drop_landing_stats.sql",
        );
        const findings = checkMigrations({
            changes: [
                {
                    status: "added",
                    path: "supabase/migrations/20261018220000_landing.sql",
                    contents,
                },
            ],
            newestBaseTimestamp: "20261017180000",
        });
        expect(findings.some((f) => f.rule === "contract")).toBe(false);
    });

    test("fixture drop_bootstrap_join does not produce contract", async () => {
        const contents = await fileContents(
            "20260920142021_drop_bootstrap_join.sql",
        );
        const findings = checkMigrations({
            changes: [
                {
                    status: "added",
                    path: "supabase/migrations/20261018230000_bootstrap.sql",
                    contents,
                },
            ],
            newestBaseTimestamp: "20261017180000",
        });
        expect(findings.some((f) => f.rule === "contract")).toBe(false);
    });
});
