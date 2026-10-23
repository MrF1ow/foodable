import { describe, expect, test } from "bun:test";
import { checkServiceRoleGrants } from "./data-api-grants.js";

const PATH = "supabase/migrations/20261022190000_tbl.sql";

describe("checkServiceRoleGrants", () => {
    test("create table without a service_role grant is grant", () => {
        const findings = checkServiceRoleGrants(
            PATH,
            `
create table public.new_thing (id int);
alter table public.new_thing enable row level security;
grant select, insert, update, delete on table public.new_thing to authenticated;
`,
        );
        expect(findings).toHaveLength(1);
        expect(findings[0]?.rule).toBe("grant");
        expect(findings[0]?.message).toContain("new_thing");
    });

    test("grant all to service_role covers the data api privileges", () => {
        const findings = checkServiceRoleGrants(
            PATH,
            `
create table public.new_thing (id int);
alter table public.new_thing enable row level security;
grant all on table public.new_thing to service_role;
`,
        );
        expect(findings).toHaveLength(0);
    });

    test("split grants to service_role are enough", () => {
        const findings = checkServiceRoleGrants(
            PATH,
            `
create table "public"."new_thing" (id int);
alter table public.new_thing enable row level security;
grant select, insert on table public.new_thing to "service_role";
grant update, delete on table public.new_thing to service_role;
`,
        );
        expect(findings).toHaveLength(0);
    });

    test("select alone is not a service_role grant", () => {
        const findings = checkServiceRoleGrants(
            PATH,
            `
create table public.new_thing (id int);
alter table public.new_thing enable row level security;
grant select on table public.new_thing to service_role;
`,
        );
        expect(findings).toHaveLength(1);
    });

    test("grant all on all tables does not cover a new table", () => {
        const findings = checkServiceRoleGrants(
            PATH,
            `
create table public.new_thing (id int);
grant all on all tables in schema public to service_role;
`,
        );
        expect(findings).toHaveLength(1);
    });
});
