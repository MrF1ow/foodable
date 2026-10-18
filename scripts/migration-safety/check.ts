export type MigrationStatus = "added" | "modified" | "deleted" | "renamed";

export type MigrationChange = {
    status: MigrationStatus;
    path: string;
    previousPath?: string;
    contents?: string;
};

export type Finding = {
    rule: "immutable" | "name" | "timestamp" | "contract" | "rls" | "contents";
    path: string;
    message: string;
};

const MIGRATION_NAME_RE = /^supabase\/migrations\/(\d{14})_([a-z0-9_]+)\.sql$/;

const CONTRACT_MARKER_RE = /^--[ \t]*foodable:contract[ \t]+\S/m;

export function stripSql(sql: string): string {
    let result = "";
    let i = 0;
    const n = sql.length;

    while (i < n) {
        if (sql[i] === "$") {
            const rest = sql.slice(i);
            const open = rest.match(/^(\$[A-Za-z_]*\$)/);
            if (open) {
                const tag = open[1]!;
                const closeAt = sql.indexOf(tag, i + tag.length);
                if (closeAt === -1) {
                    i += tag.length;
                    continue;
                }
                i = closeAt + tag.length;
                result += " ";
                continue;
            }
        }

        if (sql[i] === "/" && sql[i + 1] === "*") {
            const end = sql.indexOf("*/", i + 2);
            i = end === -1 ? n : end + 2;
            result += " ";
            continue;
        }

        if (sql[i] === "-" && sql[i + 1] === "-") {
            while (i < n && sql[i] !== "\n") i++;
            if (i < n) {
                result += "\n";
                i++;
            }
            continue;
        }

        if (sql[i] === "'") {
            i++;
            while (i < n) {
                if (sql[i] === "'") {
                    if (sql[i + 1] === "'") {
                        i += 2;
                        continue;
                    }
                    i++;
                    break;
                }
                i++;
            }
            result += " ";
            continue;
        }

        result += sql[i];
        i++;
    }

    return result;
}

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

function tablesWithRls(stripped: string): Set<string> {
    const enabled = new Set<string>();
    const re =
        /alter\s+table\s+(?:only\s+)?(?:(?:"[^"]+"|[a-zA-Z_][\w]*)\.)?(?:"[^"]+"|[a-zA-Z_][\w]*)\s+enable\s+row\s+level\s+security/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(stripped)) !== null) {
        const fragment = m[0]!;
        const nameRe =
            /alter\s+table\s+(?:only\s+)?(?:(?:"[^"]+"|[a-zA-Z_][\w]*)\.)?(?:"[^"]+"|[a-zA-Z_][\w]*)/i;
        const nm = fragment.match(nameRe);
        if (!nm) continue;
        const full = nm[0]!
            .replace(/^alter\s+table\s+(?:only\s+)?/i, "")
            .trim();
        const parts = full.split(".");
        if (parts.length === 2) {
            enabled.add(tableKey(parts[0], parts[1]!));
        } else {
            enabled.add(tableKey(undefined, parts[0]!));
        }
    }
    return enabled;
}

function deleteOrUpdateWithoutWhere(stmt: string): boolean {
    const s = stmt.replace(/\bon\s+delete\s+cascade\b/gi, " ");
    const trimmed = s.trim();
    if (!/^(with\b[\s\S]*?\s+)?(delete|update)\b/i.test(trimmed)) {
        return false;
    }
    return !/\bwhere\b/i.test(trimmed);
}

function statementNeedsContract(stmt: string): boolean {
    const s = stmt.trim();
    if (!s) return false;

    if (/^\s*drop\s+(function|policy|trigger|index|constraint)\b/i.test(s)) {
        return false;
    }
    if (/^\s*drop\s+table\b/i.test(s)) return true;
    if (/\bdrop\s+column\b/i.test(s)) return true;
    if (/^\s*truncate\b/i.test(s)) return true;
    if (/\brename\s+to\b/i.test(s)) return true;
    if (/\bset\s+not\s+null\b/i.test(s)) return true;
    if (/\balter\s+column\b[\s\S]*\btype\b/i.test(s)) return true;
    if (deleteOrUpdateWithoutWhere(s)) return true;

    return false;
}

function hasContractMarker(raw: string): boolean {
    return CONTRACT_MARKER_RE.test(raw);
}

function checkContract(path: string, contents: string): Finding | undefined {
    const stripped = stripSql(contents);
    const stmts = stripped.split(";").map((s) => s.trim());
    const needs = stmts.some(statementNeedsContract);
    if (!needs) return undefined;
    if (hasContractMarker(contents)) return undefined;
    return {
        rule: "contract",
        path,
        message:
            "destructive SQL requires a line matching -- foodable:contract <reason> with a non-empty reason",
    };
}

function checkRls(path: string, contents: string): Finding[] {
    const stripped = stripSql(contents);
    const created = findCreatedTables(stripped);
    const enabled = tablesWithRls(stripped);
    const findings: Finding[] = [];
    for (const table of created) {
        if (!enabled.has(table)) {
            const short = table.includes(".") ? table.split(".")[1]! : table;
            findings.push({
                rule: "rls",
                path,
                message: `CREATE TABLE must include ALTER TABLE ... ENABLE ROW LEVEL SECURITY for ${short}`,
            });
        }
    }
    return findings;
}

function immutableMessage(path: string): string {
    return `immutable: ${path} exists on the base branch and cannot be edited, renamed, or deleted.`;
}

function checkNewFile(
    path: string,
    contents: string | undefined,
    newestBaseTimestamp: string | null,
): Finding[] {
    const findings: Finding[] = [];
    const nameMatch = MIGRATION_NAME_RE.exec(path);
    if (!nameMatch) {
        findings.push({
            rule: "name",
            path,
            message:
                "migration filename must match supabase/migrations/<14-digit timestamp>_<snake_case>.sql",
        });
        return findings;
    }

    const timestamp = nameMatch[1]!;
    if (newestBaseTimestamp !== null && timestamp <= newestBaseTimestamp) {
        findings.push({
            rule: "timestamp",
            path,
            message: `migration timestamp ${timestamp} must be later than ${newestBaseTimestamp}; rebase and renumber`,
        });
    }

    if (contents === undefined) {
        findings.push({
            rule: "contents",
            path,
            message:
                "migration file contents are required for added or renamed migrations",
        });
        return findings;
    }

    const contract = checkContract(path, contents);
    if (contract) findings.push(contract);
    findings.push(...checkRls(path, contents));
    return findings;
}

export function checkMigrations(opts: {
    changes: MigrationChange[];
    newestBaseTimestamp: string | null;
}): Finding[] {
    const { changes, newestBaseTimestamp } = opts;
    const findings: Finding[] = [];

    for (const change of changes) {
        if (change.status === "modified" || change.status === "deleted") {
            findings.push({
                rule: "immutable",
                path: change.path,
                message: immutableMessage(change.path),
            });
            continue;
        }

        if (change.status === "renamed") {
            const prev = change.previousPath ?? change.path;
            findings.push({
                rule: "immutable",
                path: prev,
                message: immutableMessage(prev),
            });
            findings.push(
                ...checkNewFile(
                    change.path,
                    change.contents,
                    newestBaseTimestamp,
                ),
            );
            continue;
        }

        if (change.status === "added") {
            findings.push(
                ...checkNewFile(
                    change.path,
                    change.contents,
                    newestBaseTimestamp,
                ),
            );
        }
    }

    return findings;
}
