// Guards the one-permission-check rule: outside `src/domain/permissions.ts`
// and `src/household.ts`, no non-test source compares a role to "owner",
// "admin" or "member" by hand unless the line before it carries the inline
// marker (`// oxlint-disable-next-line foodable/no-raw-role-check -- <why>`).
// The same rule runs in `bun run lint`; this test is the second net and needs
// no oxlint binary. It is a line scan: it sees `role ===` written on one line,
// the way this codebase writes it.
import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const EXEMPT = new Set(["src/domain/permissions.ts", "src/household.ts"]);
const MARKER =
    /^\s*\/\/ oxlint-disable-next-line foodable\/no-raw-role-check -- \S/;
const ROLE = String.raw`[\w$.?]*\brole\b`;
const LITERAL = String.raw`["'\x60](?:owner|admin|member)["'\x60]`;
const RAW_ROLE_CHECK = new RegExp(
    `${ROLE}\\s*(?:===|!==|==|!=)\\s*${LITERAL}|${LITERAL}\\s*(?:===|!==|==|!=)\\s*${ROLE}`,
);

/** The 1-based lines of `source` that compare a role by hand without the marker. */
export function unmarkedRoleChecks(source: string): number[] {
    const lines = source.split("\n");
    const hits: number[] = [];
    lines.forEach((line, i) => {
        if (!RAW_ROLE_CHECK.test(line)) return;
        if (i > 0 && MARKER.test(lines[i - 1]!)) return;
        hits.push(i + 1);
    });
    return hits;
}

describe("no raw role check", () => {
    test("catches a planted role comparison", () => {
        expect(unmarkedRoleChecks('if (member.role === "owner") {}')).toEqual([
            1,
        ]);
        expect(unmarkedRoleChecks('const x = role !== "admin";')).toEqual([1]);
        expect(unmarkedRoleChecks("if (m.role == 'member') {}")).toEqual([1]);
        expect(unmarkedRoleChecks('if ("owner" != m.role) {}')).toEqual([1]);
    });

    test("allows a comparison whose previous line is the marker", () => {
        const marked = [
            "// oxlint-disable-next-line foodable/no-raw-role-check -- display label",
            'const label = member.role === "owner" ? "Owner" : "Member";',
        ].join("\n");
        expect(unmarkedRoleChecks(marked)).toEqual([]);
    });

    test("a marker without a reason, or two lines up, does not count", () => {
        const noReason = [
            "// oxlint-disable-next-line foodable/no-raw-role-check",
            'const a = member.role === "owner";',
        ].join("\n");
        expect(unmarkedRoleChecks(noReason)).toEqual([2]);
        const far = [
            "// oxlint-disable-next-line foodable/no-raw-role-check -- why",
            "const gap = 1;",
            'const a = member.role === "owner";',
        ].join("\n");
        expect(unmarkedRoleChecks(far)).toEqual([3]);
    });

    test("ignores presence checks and unrelated strings", () => {
        expect(
            unmarkedRoleChecks(
                'if (m.role !== undefined) {}\nconst k = m.name === "owner";',
            ),
        ).toEqual([]);
    });

    test("no source file outside permissions.ts and household.ts compares a role unmarked", async () => {
        const offenders: string[] = [];
        for await (const file of new Glob("src/**/*.ts").scan({ cwd: ROOT })) {
            if (file.endsWith(".test.ts") || EXEMPT.has(file)) continue;
            const source = await Bun.file(join(ROOT, file)).text();
            for (const line of unmarkedRoleChecks(source)) {
                offenders.push(`${file}:${line}`);
            }
        }
        expect(offenders.sort()).toEqual([]);
    });
});
