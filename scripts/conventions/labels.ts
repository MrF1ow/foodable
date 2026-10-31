import { SCOPES, TYPES } from "./conventions.ts";

export type LabelDef = {
    name: string;
    color: string;
    description: string;
};

const TYPE_COLOR = "1d76db";
const AREA_COLOR = "0e8a16";

const EXTRA_AREAS = [
    "goals",
    "weight",
    "water",
    "platform",
    "test",
    "docs",
    "high",
    "unmapped",
] as const;

function typeLabels(): LabelDef[] {
    return TYPES.map((t) => ({
        name: `type:${t}`,
        color: TYPE_COLOR,
        description: `PR type ${t} (conventional title)`,
    }));
}

function areaLabels(): LabelDef[] {
    const areas = [...SCOPES, ...EXTRA_AREAS];
    return areas.map((a) => ({
        name: `area:${a}`,
        color: AREA_COLOR,
        description: `Touches ${a} code or config`,
    }));
}

const STATIC_LABELS: LabelDef[] = [
    {
        name: "blast:low",
        color: "c5def5",
        description: "Low blast radius",
    },
    {
        name: "blast:medium",
        color: "fbca04",
        description: "Medium blast radius",
    },
    {
        name: "blast:high",
        color: "b60205",
        description: "High blast radius",
    },
    {
        name: "breaking",
        color: "d93f0b",
        description: "Breaking API or behavior change",
    },
    {
        name: "migration",
        color: "5319e7",
        description: "Includes supabase migration SQL",
    },
    {
        name: "migration:contract",
        color: "b60205",
        description: "Migration has a foodable:contract marker",
    },
    {
        name: "dependencies",
        color: "0366d6",
        description: "Dependency update (e.g. Dependabot)",
    },
    {
        name: "gate:approved",
        color: "0e8a16",
        description:
            "Code owner approved the gate files at the latest push (apply by hand)",
    },
    {
        name: "security",
        color: "ee0701",
        description: "Security-related change (apply by hand)",
    },
    {
        name: "needs-decision",
        color: "fbca04",
        description: "Needs a maintainer decision before merge",
    },
    {
        name: "blocked",
        color: "d93f0b",
        description: "Blocked on another change or external factor",
    },
    {
        name: "agent",
        color: "c5def5",
        description: "Touched primarily by an automated agent",
    },
    {
        name: "bug",
        color: "d73a4a",
        description: "Something isn't working",
    },
    {
        name: "enhancement",
        color: "a2eeef",
        description: "New feature or request",
    },
    {
        name: "documentation",
        color: "0075ca",
        description: "Improvements or additions to documentation",
    },
    {
        name: "good first issue",
        color: "7057ff",
        description: "Good for newcomers",
    },
    {
        name: "help wanted",
        color: "008672",
        description: "Extra attention is needed",
    },
    {
        name: "question",
        color: "d876e3",
        description: "Further information is requested",
    },
    {
        name: "duplicate",
        color: "cfd3d7",
        description: "This issue or pull request already exists",
    },
    {
        name: "wontfix",
        color: "ffffff",
        description: "This will not be worked on",
    },
];

export const LABEL_CATALOG: LabelDef[] = [
    ...typeLabels(),
    ...areaLabels(),
    ...STATIC_LABELS,
];

const catalogNameSet = new Set(LABEL_CATALOG.map((l) => l.name));

export function catalogNames(): Set<string> {
    return catalogNameSet;
}

export function catalogByName(): Map<string, LabelDef> {
    return new Map(LABEL_CATALOG.map((l) => [l.name, l]));
}
