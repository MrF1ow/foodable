export const TYPES = [
    "feat",
    "fix",
    "refactor",
    "perf",
    "docs",
    "test",
    "ci",
    "build",
    "chore",
    "revert",
] as const;

export const SCOPES = [
    "nutrition",
    "fridge",
    "grocery",
    "recipes",
    "settings",
    "foods",
    "household",
    "mcp",
    "widgets",
    "web",
    "auth",
    "db",
    "import",
    "export",
    "brand",
    "deps",
    "repo",
] as const;

export const PR_SECTIONS = [
    "Summary",
    "Blast radius",
    "Changes",
    "Migrations",
    "Contracts",
    "Testing",
    "Links",
] as const;

export const GRANDFATHERED_BRANCHES = [
    "usability/",
    "spike/",
    "cursor/",
] as const;

export type Level = "low" | "medium" | "high";
export type BlastLevel = Level;

export type Finding = { rule: string; message: string };

export type Classified = {
    level: Level;
    area: string;
    mapped: boolean;
};
type ClassifyResult = Classified;

const HIGH_EXACT = new Set([
    "package.json",
    "Dockerfile",
    "railway.toml",
    ".github/CODEOWNERS",
    "src/auth-context.ts",
    "src/oauth.ts",
    "src/oauth-redirect.ts",
    "src/web/middleware.ts",
    "src/mcp/server.ts",
    "src/mcp/shared.ts",
    "src/mcp/tools-list.snapshot.json",
    "src/domain/tz.ts",
    "src/domain/import.ts",
    "src/domain/csv.ts",
    "src/domain/export.ts",
    "src/domain/quantity.ts",
    "src/domain/units.ts",
    "src/zip.ts",
    "src/index.ts",
    "src/tokens.ts",
    "src/brand.ts",
]);

const HIGH_PREFIXES = [
    "supabase/migrations/",
    ".github/workflows/",
    ".github/rulesets/",
    "scripts/conventions/",
    "scripts/migration-safety/",
    "scripts/migration-dryrun",
    "public/widgets/src/shared/",
];

const MEDIUM_EXACT: Readonly<Record<string, string>> = {
    "src/domain/meals.ts": "nutrition",
    "src/domain/insights.ts": "nutrition",
    "src/domain/layout.ts": "nutrition",
    "src/mcp/tools/nutrition.ts": "nutrition",
    "src/mcp/tools/nutrition-insights.ts": "nutrition",
    "src/web/routes/nutrition.ts": "nutrition",
    "src/web/pages/nutrition.ts": "nutrition",
    "public/widgets/src/templates/nutrition-summary.html": "nutrition",
    "public/widgets/src/templates/meal-logged.html": "nutrition",
    "public/widgets/src/templates/trends.html": "nutrition",
    "public/widgets/src/templates/import-meals.html": "nutrition",
    "src/domain/fridge.ts": "fridge",
    "src/domain/stock.ts": "fridge",
    "src/mcp/tools/fridge.ts": "fridge",
    "src/web/routes/fridge.ts": "fridge",
    "src/web/pages/fridge.ts": "fridge",
    "public/widgets/src/templates/fridge.html": "fridge",
    "src/domain/grocery.ts": "grocery",
    "src/domain/rules.ts": "grocery",
    "src/mcp/tools/grocery.ts": "grocery",
    "src/mcp/tools/rules.ts": "grocery",
    "src/web/routes/grocery.ts": "grocery",
    "src/web/pages/grocery.ts": "grocery",
    "public/widgets/src/templates/grocery-list.html": "grocery",
    "src/domain/recipes.ts": "recipes",
    "src/mcp/tools/recipes.ts": "recipes",
    "src/web/routes/recipes.ts": "recipes",
    "src/web/pages/recipes.ts": "recipes",
    "src/domain/foods.ts": "foods",
    "src/domain/food-identity.ts": "foods",
    "src/domain/food-quantity.ts": "foods",
    "src/domain/linking.ts": "foods",
    "src/mcp/tools/food.ts": "foods",
    "src/web/routes/foods.ts": "foods",
    "src/web/pages/foods.ts": "foods",
    "src/foods.ts": "foods",
    "src/domain/settings.ts": "settings",
    "src/mcp/tools/profile.ts": "settings",
    "src/web/routes/settings.ts": "settings",
    "src/web/pages/settings.ts": "settings",
    "src/web/pages/settings-help.ts": "settings",
    "src/mcp/tools/household.ts": "household",
    "src/web/pages/household.ts": "household",
    "src/household.ts": "household",
    "src/household-token.ts": "household",
    "src/mcp/tools/goals.ts": "goals",
    "public/widgets/src/templates/goal-progress.html": "goals",
    "src/mcp/tools/weight.ts": "weight",
    "public/widgets/src/templates/weight-trends.html": "weight",
    "src/mcp/tools/water.ts": "water",
    "public/widgets/src/templates/component-gallery.html": "widgets",
    "src/web/shell.ts": "web",
    "src/web/toast.ts": "web",
    "src/web/toast-flash.ts": "web",
    "src/web/form.ts": "web",
    "src/web/loaders.ts": "web",
    "src/web/display-quantity.ts": "web",
    "src/alcohol.ts": "platform",
    "src/analytics.ts": "platform",
    "src/chunk.ts": "platform",
    "src/client-id.ts": "platform",
    "src/dashboard-data.ts": "platform",
    "src/discovery.ts": "platform",
    "src/food-search.ts": "platform",
    "src/html.ts": "platform",
    "src/mcp.ts": "platform",
    "src/middleware.ts": "platform",
    "src/net.ts": "platform",
    "src/normalize.ts": "platform",
    "src/rate-limit.ts": "platform",
    "src/routes.ts": "platform",
    "src/search.ts": "platform",
    "src/site-session.ts": "platform",
    "src/ttl-cache.ts": "platform",
    "src/url.ts": "platform",
    "src/widgets.ts": "platform",
    "bun.lock": "deps",
};

const MEDIUM_PREFIXES: Readonly<Array<{ prefix: string; area: string }>> = [
    { prefix: "src/db/", area: "db" },
    { prefix: "public/app/", area: "web" },
    { prefix: "src/web/components/", area: "web" },
    { prefix: "src/web/client/", area: "web" },
    { prefix: "src/copy/", area: "web" },
    { prefix: "public/brand/", area: "brand" },
];

const LOW_REPO_EXACT = new Set([
    "README.md",
    "LICENSE",
    ".gitignore",
    ".prettierignore",
    ".prettierrc",
    ".dockerignore",
    ".env.example",
    "tsconfig.json",
    "public/favicon.ico",
    "public/apple-touch-icon.png",
    "public/robots.txt",
]);

const LOW_REPO_PREFIXES = [
    ".github/",
    ".claude/",
    ".agents/",
    "scripts/",
    ".cursor/",
    "public/fonts/",
];

const BLAST_RANK: Record<BlastLevel, number> = {
    low: 0,
    medium: 1,
    high: 2,
};

function maxLevel(a: BlastLevel, b: BlastLevel): BlastLevel {
    return BLAST_RANK[a] >= BLAST_RANK[b] ? a : b;
}

function matchesPrefix(path: string, prefix: string): boolean {
    return path === prefix || path.startsWith(prefix);
}

export function classifyPath(path: string): ClassifyResult {
    if (HIGH_EXACT.has(path)) {
        return { level: "high", area: "high", mapped: true };
    }
    for (const prefix of HIGH_PREFIXES) {
        if (matchesPrefix(path, prefix)) {
            return { level: "high", area: "high", mapped: true };
        }
    }
    if (path.endsWith(".test.ts")) {
        return { level: "low", area: "test", mapped: true };
    }
    if (path.endsWith(".md") || path.startsWith("docs/")) {
        return { level: "low", area: "docs", mapped: true };
    }
    const mediumExact = MEDIUM_EXACT[path];
    if (mediumExact) {
        return { level: "medium", area: mediumExact, mapped: true };
    }
    for (const { prefix, area } of MEDIUM_PREFIXES) {
        if (path.startsWith(prefix)) {
            return { level: "medium", area, mapped: true };
        }
    }
    if (LOW_REPO_EXACT.has(path)) {
        return { level: "low", area: "repo", mapped: true };
    }
    for (const prefix of LOW_REPO_PREFIXES) {
        if (path.startsWith(prefix)) {
            return { level: "low", area: "repo", mapped: true };
        }
    }
    return { level: "high", area: "unmapped", mapped: false };
}

export function blastFloor(paths: string[]): {
    level: BlastLevel;
    areas: string[];
    highPaths: string[];
} {
    if (paths.length === 0) {
        return { level: "low", areas: [], highPaths: [] };
    }

    const areaSet = new Set<string>();
    const highPaths: string[] = [];
    let level: BlastLevel = "low";

    for (const path of paths) {
        const c = classifyPath(path);
        if (!c.mapped || c.level === "high") {
            level = "high";
            highPaths.push(path);
            continue;
        }
        if (c.level === "medium") {
            areaSet.add(c.area);
            if (level === "low") {
                level = "medium";
            }
        }
    }

    const areas = [...areaSet].sort();
    if (level !== "high" && areas.length >= 2) {
        level = "high";
    }

    return { level, areas, highPaths };
}

type ParsedTitle = {
    type: string;
    scope: string;
    breaking: boolean;
    subject: string;
};

function parseConventionalTitle(
    title: string,
): ParsedTitle | { error: string } {
    const match = /^([a-z]+)\(([a-z]+)\)(!?):\s+(.+)$/.exec(title);
    if (!match) {
        return { error: `Invalid title: ${title}` };
    }
    const type = match[1];
    const scope = match[2];
    const breaking = match[3] === "!";
    const subject = match[4];

    if (!(TYPES as readonly string[]).includes(type)) {
        return { error: `Invalid title: ${title}` };
    }
    if (!(SCOPES as readonly string[]).includes(scope)) {
        return { error: `Invalid title: ${title}` };
    }
    if (subject.endsWith(".")) {
        return { error: `Invalid title: ${title}` };
    }
    const words = subject.split(/\s+/);
    for (const word of words) {
        if (word === "") continue;
        if (word === "CI") continue;
        if (word !== word.toLowerCase()) {
            return { error: `Invalid title: ${title}` };
        }
    }

    return { type, scope, breaking, subject };
}

export function parseTitle(title: string): ParsedTitle | { error: string } {
    const revertMatch = /^Revert "(.+)"$/.exec(title);
    if (revertMatch) {
        if (title.length > 72) {
            return { error: `Invalid title: ${title}` };
        }
        const inner = parseConventionalTitle(revertMatch[1]);
        if ("error" in inner) {
            return inner;
        }
        return inner;
    }

    if (title.length > 72) {
        return { error: `Invalid title: ${title}` };
    }
    return parseConventionalTitle(title);
}

export function checkBranch(name: string): Finding[] {
    if (
        name.startsWith("dependabot/") ||
        name.startsWith("revert-") ||
        name.startsWith("usability/") ||
        name.startsWith("spike/") ||
        name.startsWith("cursor/")
    ) {
        return [];
    }

    const slash = name.indexOf("/");
    if (slash === -1) {
        return [
            {
                rule: "branch",
                message: `Branch name must be type/scope-slug, got ${name}`,
            },
        ];
    }
    const type = name.slice(0, slash);
    const rest = name.slice(slash + 1);
    if (!(TYPES as readonly string[]).includes(type)) {
        return [
            {
                rule: "branch",
                message: `Branch type must be one of ${TYPES.join(", ")}, got ${type}`,
            },
        ];
    }
    let scope: string | null = null;
    let slug: string | null = null;
    for (const candidate of SCOPES) {
        const prefix = `${candidate}-`;
        if (rest === candidate) {
            scope = candidate;
            slug = "";
            break;
        }
        if (rest.startsWith(prefix)) {
            scope = candidate;
            slug = rest.slice(prefix.length);
            break;
        }
    }
    if (scope === null) {
        return [
            {
                rule: "branch",
                message: `Branch name must be type/scope-slug, got ${name}`,
            },
        ];
    }
    if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
        return [
            {
                rule: "branch",
                message: `Branch slug must be [a-z0-9]+(-[a-z0-9]+)*, got ${slug ?? ""}`,
            },
        ];
    }
    return [];
}

export function parseBody(markdown: string): {
    sections: Record<string, string>;
    level: BlastLevel | null;
    rollback: string | null;
} {
    const sections: Record<string, string> = {};
    const lines = markdown.split("\n");
    let currentHeading: string | null = null;
    let currentLines: string[] = [];

    const flush = () => {
        if (currentHeading !== null) {
            sections[currentHeading] = currentLines.join("\n").trim();
        }
    };

    for (const line of lines) {
        const headingMatch = /^## (.+)$/.exec(line);
        if (headingMatch) {
            flush();
            currentHeading = headingMatch[1];
            currentLines = [];
        } else if (currentHeading !== null) {
            currentLines.push(line);
        }
    }
    flush();

    let level: BlastLevel | null = null;
    const blast = sections["Blast radius"] ?? "";
    const levelMatch = /Level:\s*(low|medium|high)/.exec(blast);
    if (levelMatch) {
        level = levelMatch[1] as BlastLevel;
    }

    let rollback: string | null = null;
    for (const line of blast.split("\n")) {
        const trimmed = line.trim();
        if (trimmed === "Rollback: revert-safe") {
            rollback = "revert-safe";
        } else if (trimmed === "Rollback: needs a follow-up migration") {
            rollback = "needs a follow-up migration";
        } else if (trimmed === "Rollback: needs a data fix") {
            rollback = "needs a data fix";
        }
    }

    return { sections, level, rollback };
}

function sectionIsNone(text: string | undefined): boolean {
    if (text === undefined) return true;
    const t = text.trim();
    return t === "" || t.toLowerCase() === "none";
}

function hasMigrationContract(content: string): boolean {
    for (const line of content.split("\n")) {
        const m = /^--\s*foodable:contract\s+(.+)$/.exec(line.trim());
        if (m && m[1].trim().length > 0) {
            return true;
        }
    }
    return false;
}

export function lintPr(input: {
    title: string;
    branch: string;
    body: string;
    files: string[];
    author?: string;
    fileContents?: Record<string, string>;
}): {
    findings: Finding[];
    floor: BlastLevel;
    areas: string[];
    highPaths: string[];
    labels: string[];
} {
    const findings: Finding[] = [];
    const { level: floor, areas, highPaths } = blastFloor(input.files);
    const parsed = parseTitle(input.title);
    const isDependabot = input.author === "dependabot[bot]";

    if ("error" in parsed) {
        findings.push({ rule: "title", message: parsed.error });
    }

    findings.push(...checkBranch(input.branch));

    const { sections, level: declaredLevel, rollback } = parseBody(input.body);
    const hasMigrationFiles = input.files.some((f) =>
        f.startsWith("supabase/migrations/"),
    );
    const snapshotChanged = input.files.includes(
        "src/mcp/tools-list.snapshot.json",
    );

    if (!isDependabot) {
        for (const heading of PR_SECTIONS) {
            if (!(heading in sections)) {
                findings.push({
                    rule: "body",
                    message: `Missing ## ${heading} section`,
                });
            }
        }
        const summary = sections["Summary"]?.trim() ?? "";
        if (!summary) {
            findings.push({
                rule: "body",
                message: "Summary section must not be empty",
            });
        }
        const testing = sections["Testing"]?.trim() ?? "";
        if (!testing) {
            findings.push({
                rule: "body",
                message: "Testing section must not be empty",
            });
        }
        if (declaredLevel === null) {
            findings.push({
                rule: "body",
                message:
                    "Blast radius must include Level: low, medium, or high",
            });
        }
        if (rollback === null) {
            findings.push({
                rule: "body",
                message:
                    "Blast radius must include Rollback: revert-safe, needs a follow-up migration, or needs a data fix",
            });
        }
        const migrations = sections["Migrations"];
        if (migrations !== undefined) {
            const mt = migrations.trim();
            if (mt === "") {
                findings.push({
                    rule: "body",
                    message: "Migrations section must not be empty",
                });
            } else if (hasMigrationFiles && mt.toLowerCase() === "none") {
                findings.push({
                    rule: "migrations",
                    message:
                        "Migrations section must describe changes when migration files are present",
                });
            }
        }

        const contracts = sections["Contracts"];
        const needsContracts =
            (!("error" in parsed) && parsed.breaking) || snapshotChanged;
        if (needsContracts && sectionIsNone(contracts)) {
            findings.push({
                rule: "contracts",
                message:
                    "Contracts section is required for breaking changes or tools-list snapshot updates",
            });
        }
    }

    if (
        declaredLevel !== null &&
        BLAST_RANK[declaredLevel] < BLAST_RANK[floor]
    ) {
        findings.push({
            rule: "blast",
            message: `Declared blast level ${declaredLevel} is below the floor ${floor}`,
        });
    }

    const labels: string[] = [];
    if (!("error" in parsed)) {
        labels.push(`type:${parsed.type}`);
        labels.push(`area:${parsed.scope}`);
    }
    for (const area of areas) {
        labels.push(`area:${area}`);
    }

    const blastLabelLevel = isDependabot
        ? floor
        : declaredLevel !== null
          ? maxLevel(declaredLevel, floor)
          : floor;
    labels.push(`blast:${blastLabelLevel}`);

    if (!("error" in parsed) && parsed.breaking) {
        labels.push("breaking");
    }
    if (hasMigrationFiles) {
        labels.push("migration");
    }
    if (input.fileContents) {
        for (const path of input.files) {
            if (!path.startsWith("supabase/migrations/")) continue;
            const content = input.fileContents[path];
            if (content && hasMigrationContract(content)) {
                labels.push("migration:contract");
                break;
            }
        }
    }
    if (isDependabot) {
        labels.push("dependencies");
    }

    const dedupedLabels = [...new Set(labels)];

    return {
        findings,
        floor,
        areas,
        highPaths,
        labels: dedupedLabels,
    };
}
