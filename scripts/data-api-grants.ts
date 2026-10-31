// The migrations job calls this through scripts/migration-safety.ts.
// It stays outside scripts/migration-safety/ so the rule can land without
// editing a gate file. Gate files need a code owner's gate:approved label.
import { stripSql } from "./migration-safety/check.js";

export type GrantFinding = {
    rule: "grant";
    path: string;
    message: string;
};

const TABLE_DML = ["select", "insert", "update", "delete"] as const;

function unquoteIdent(name: string): string {
    const t = name.trim();
    if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
        return t.slice(1, -1);
    }
    return t;
}

function tableKey(schema: string | undefined, table: string): string {
    const s = schema ? unquoteIdent(schema).toLowerCase() : "public";
    return `${s}.${unquoteIdent(table).toLowerCase()}`;
}

function findCreatedTables(stripped: string): string[] {
    const re =
        /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:(?:"[^"]+"|[a-zA-Z_][\w]*)\.)?(?:"[^"]+"|[a-zA-Z_][\w]*)/gi;
    const keys: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(stripped)) !== null) {
        const fragment = m[0]!;
        const nameRe =
            /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:(?:"[^"]+"|[a-zA-Z_][\w]*)\.)?(?:"[^"]+"|[a-zA-Z_][\w]*)/i;
        const nm = fragment.match(nameRe);
        if (!nm) continue;
        const full = nm[0]!.replace(
            /^create\s+table\s+(?:if\s+not\s+exists\s+)?/i,
            "",
        );
        const parts = full.split(".");
        if (parts.length === 2) {
            keys.push(tableKey(parts[0], parts[1]!));
        } else {
            keys.push(tableKey(undefined, parts[0]!));
        }
    }
    return keys;
}

function grantTargetKey(raw: string): string | undefined {
    const piece = raw.trim();
    if (!piece || piece.toLowerCase() === "only") return undefined;
    const parts = piece.split(".");
    if (parts.length === 2) return tableKey(parts[0], parts[1]!);
    if (parts.length === 1) return tableKey(undefined, parts[0]!);
    return undefined;
}

function addTablePrivileges(into: Set<string>, raw: string): void {
    if (/\ball(?:\s+privileges)?\b/i.test(raw)) {
        for (const privilege of TABLE_DML) into.add(privilege);
        return;
    }
    for (const part of raw.split(",")) {
        const name = part
            .trim()
            .toLowerCase()
            .match(/^[a-z_]+/)?.[0];
        if (
            name === "select" ||
            name === "insert" ||
            name === "update" ||
            name === "delete"
        ) {
            into.add(name);
        }
    }
}

// Tables in this file on which service_role receives select, insert, update,
// and delete, either in one GRANT ALL or across several statements.
function tablesGrantedToServiceRole(stripped: string): Set<string> {
    const privsByTable = new Map<string, Set<string>>();
    for (const stmt of stripped.split(";")) {
        const s = stmt.trim();
        if (!s) continue;
        const match =
            /^grant\s+([\s\S]+?)\s+on\s+(?:table\s+)?([\s\S]+?)\s+to\s+([\s\S]+)$/i.exec(
                s,
            );
        if (!match) continue;
        const targetRaw = match[2]!.trim();
        if (
            /^(?:function|procedure|routine|sequence|schema|type|domain|language)\b/i.test(
                targetRaw,
            ) ||
            /^all\s+(?:tables|sequences|functions|procedures|routines)\b/i.test(
                targetRaw,
            )
        ) {
            continue;
        }
        const roles = match[3]!
            .replace(/\bwith\s+grant\s+option\b/gi, "")
            .split(",")
            .map((role) => unquoteIdent(role.trim()).toLowerCase());
        if (!roles.includes("service_role")) continue;
        for (const tableRaw of targetRaw.split(",")) {
            const key = grantTargetKey(tableRaw);
            if (!key) continue;
            let privs = privsByTable.get(key);
            if (!privs) {
                privs = new Set();
                privsByTable.set(key, privs);
            }
            addTablePrivileges(privs, match[1]!);
        }
    }
    const covered = new Set<string>();
    for (const [key, privs] of privsByTable) {
        if (TABLE_DML.every((privilege) => privs.has(privilege))) {
            covered.add(key);
        }
    }
    return covered;
}

export function checkServiceRoleGrants(
    path: string,
    contents: string,
): GrantFinding[] {
    const stripped = stripSql(contents);
    const created = findCreatedTables(stripped);
    const granted = tablesGrantedToServiceRole(stripped);
    const findings: GrantFinding[] = [];
    for (const table of created) {
        if (!granted.has(table)) {
            const short = table.includes(".") ? table.split(".")[1]! : table;
            findings.push({
                rule: "grant",
                path,
                message: `CREATE TABLE must GRANT select, insert, update, delete on ${short} to service_role`,
            });
        }
    }
    return findings;
}
