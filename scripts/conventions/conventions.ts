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

// Files the policy workflow (.github/workflows/policy.yml) runs from main,
// never from the pull request: a prefix matches everything below it, a name
// matches itself and anything that starts with it. A PR that edits one is still
// judged by main's copy; the edit takes effect once it merges. The skills are
// here because the skill-drift check reads their `watches:` from main.
export const POLICY_PATHS = [
    "scripts/conventions/",
    "scripts/migration-safety",
    "scripts/data-api-grants.ts",
    ".github/agent-context-budget.json",
    ".github/workflows/policy.yml",
    ".claude/skills/",
] as const;

export function isPolicyPath(path: string): boolean {
    return POLICY_PATHS.some((prefix) => path.startsWith(prefix));
}

// Files that define checks which run from the pull request itself (the `check`
// job, the linter, the dependency pins), unlike POLICY_PATHS, which run from
// main. A PR that edits one changes the checks that judge it, so the policy
// check names them for the reviewer. policy.yml is not here: it is in
// POLICY_PATHS and runs from main.
const PR_CONTROLLED_CHECK_PREFIXES = [
    ".github/workflows/",
    "scripts/check-changed.ts",
    "scripts/typecheck.ts",
    "scripts/lint-rules/",
    ".oxlintrc.json",
    "package.json",
] as const;

export function isPrControlledCheckPath(path: string): boolean {
    return (
        !isPolicyPath(path) &&
        PR_CONTROLLED_CHECK_PREFIXES.some((prefix) => path.startsWith(prefix))
    );
}

export type Level = "low" | "medium" | "high";
export type BlastLevel = Level;

export type Finding = { rule: string; message: string };

export type Classified = {
    level: Level;
    area: string;
    mapped: boolean;
};
type ClassifyResult = Classified;

// The checks that judge a PR are themselves PR-controlled (check-changed,
// typecheck, the linter and its rules, the agent settings and flow profile, the
// context budget, bunfig), so editing one is as risky as editing the policy.
const HIGH_EXACT = new Set([
    "package.json",
    "bunfig.toml",
    "scripts/check-changed.ts",
    "scripts/typecheck.ts",
    ".oxlintrc.json",
    ".claude/settings.json",
    ".flow/profile.yaml",
    ".github/agent-context-budget.json",
    "Dockerfile",
    "docker-compose.yml",
    ".github/CODEOWNERS",
    "src/auth-context.ts",
    "src/domain/auth.ts",
    "src/oauth.ts",
    "src/oauth-login-sessions.ts",
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
    "db/",
    ".github/workflows/",
    ".github/rulesets/",
    ".railway/",
    "scripts/conventions/",
    "scripts/migration-safety/",
    "scripts/migration-dryrun",
    "scripts/db-rehearse",
    "scripts/lint-rules/",
    "public/widgets/src/shared/",
];

const MEDIUM_EXACT: Readonly<Record<string, string>> = {
    "src/domain/log-search.ts": "nutrition",
    "src/domain/log-search.test.ts": "nutrition",
    "src/domain/log-macro-format.ts": "nutrition",
    "src/domain/log-macro-format.test.ts": "nutrition",
    "src/meal-write.ts": "nutrition",
    "src/weight-write.ts": "nutrition",
    "src/domain/meals.ts": "nutrition",
    "src/domain/insights.ts": "nutrition",
    "src/domain/goal-label.ts": "nutrition",
    "src/domain/goal-label.test.ts": "nutrition",
    "src/domain/geometry.ts": "nutrition",
    "src/domain/trends-view.ts": "nutrition",
    "src/domain/trends-view.test.ts": "nutrition",
    "src/domain/today.ts": "nutrition",
    "src/domain/today.test.ts": "nutrition",
    "src/domain/today-edit.ts": "nutrition",
    "src/domain/today-edit.test.ts": "nutrition",
    "src/domain/meal-undo.ts": "nutrition",
    "src/domain/meal-undo.test.ts": "nutrition",
    "src/mcp/tools/nutrition.ts": "nutrition",
    "src/mcp/tools/nutrition-insights.ts": "nutrition",
    "src/web/routes/nutrition.ts": "nutrition",
    "public/widgets/src/templates/nutrition-summary.html": "nutrition",
    "public/widgets/src/templates/meal-logged.html": "nutrition",
    "public/widgets/src/templates/trends.html": "nutrition",
    "public/widgets/src/templates/import-meals.html": "nutrition",
    "src/domain/fridge.ts": "fridge",
    "src/domain/stock.ts": "fridge",
    "src/mcp/tools/fridge.ts": "fridge",
    "src/web/routes/fridge.ts": "fridge",
    "public/widgets/src/templates/fridge.html": "fridge",
    "src/domain/grocery.ts": "grocery",
    "src/domain/grocery-stores.ts": "grocery",
    "src/domain/grocery-sections.ts": "grocery",
    "src/domain/grocery-sections.test.ts": "grocery",
    "src/domain/restock.ts": "grocery",
    "src/domain/weekdays.ts": "grocery",
    "src/domain/rules.ts": "grocery",
    "src/restock-runner.ts": "grocery",
    "src/mcp/tools/grocery.ts": "grocery",
    "src/mcp/tools/rules.ts": "grocery",
    "src/web/routes/grocery.ts": "grocery",
    "public/widgets/src/templates/grocery-list.html": "grocery",
    "src/domain/recipes.ts": "recipes",
    "src/domain/plan.ts": "recipes",
    "src/domain/plan-week.ts": "recipes",
    "src/domain/suggestions.ts": "recipes",
    "src/domain/recipe-import.ts": "recipes",
    "src/domain/recipe-text.ts": "recipes",
    "src/domain/recipe-link.ts": "recipes",
    "src/domain/recipe-jsonld.ts": "recipes",
    "src/domain/ingredient-lines.ts": "recipes",
    "src/domain/not-measured.ts": "recipes",
    "src/recipe-url-fetcher.ts": "recipes",
    "src/sharing-import.ts": "recipes",
    "src/sharing-import.test.ts": "recipes",
    "src/domain/fetch-memory.ts": "recipes",
    "src/db/fetch-memory.ts": "recipes",
    "src/domain/social-readers.ts": "recipes",
    "src/db/social-readers.ts": "recipes",
    "src/db/plan-week.ts": "recipes",
    "src/copy/social-readers.ts": "recipes",
    "src/fetch-safe.ts": "platform",
    "src/mcp/tools/recipes.ts": "recipes",
    "src/mcp/tools/plan.ts": "recipes",
    "src/mcp/tools/plan.db.test.ts": "recipes",
    "src/web/routes/recipes.ts": "recipes",
    "src/web/truncate-toast-param.ts": "recipes",
    "src/web/routes/share.ts": "recipes",
    "src/web/routes/share-links.ts": "recipes",
    "src/web/routes/share-links.test.ts": "recipes",
    "src/web/routes/share-links.db.test.ts": "recipes",
    "src/web/routes/share-links-load.ts": "recipes",
    "src/web/routes/share-links-load.test.ts": "recipes",
    "src/web/routes/share-links-manage.ts": "recipes",
    "src/web/routes/share-links-manage.db.test.ts": "recipes",
    "src/web/routes/recipes-shared-import.ts": "recipes",
    "src/web/routes/recipes-shared-import.db.test.ts": "recipes",
    "src/web/pages/share-view.ts": "recipes",
    "src/web/pages/share-view.test.ts": "recipes",
    "src/web/share-import-prefill.ts": "recipes",
    "src/web/manifest.ts": "web",
    "src/web/components/share-arrived.ts": "web",
    "src/domain/share.ts": "recipes",
    "src/domain/foods.ts": "foods",
    "src/domain/foods-possible-duplicates.test.ts": "foods",
    "src/domain/food-merge-job.ts": "foods",
    "src/domain/food-identity.ts": "foods",
    "src/domain/food-quantity.ts": "foods",
    "src/domain/off-quality.ts": "foods",
    "src/domain/product-checks.ts": "foods",
    "src/domain/product-checks.test.ts": "foods",
    "src/domain/off-nutrient-levels.ts": "foods",
    "src/domain/product-score.ts": "foods",
    "src/domain/product-score-display.ts": "foods",
    "src/domain/product-score-display.test.ts": "foods",
    "src/domain/score-settings.ts": "foods",
    "src/domain/sharing.ts": "recipes",
    "src/domain/sharing.test.ts": "recipes",
    "src/domain/sharing-document.ts": "recipes",
    "src/domain/sharing-document.test.ts": "recipes",
    "src/domain/sharing-source.ts": "recipes",
    "src/domain/sharing-source.test.ts": "recipes",
    "src/domain/sharing-import.ts": "recipes",
    "src/domain/sharing-import.test.ts": "recipes",
    "src/domain/sharing-import.db.test.ts": "recipes",
    "src/mcp/tools/sharing.ts": "recipes",
    "src/mcp/tools/sharing.db.test.ts": "recipes",
    "src/domain/product-screen.ts": "foods",
    "src/domain/product-screen.test.ts": "foods",
    "src/domain/product-check-today.ts": "foods",
    "src/domain/additive-risk.ts": "foods",
    "src/domain/linking.ts": "foods",
    "src/mcp/tools/food.ts": "foods",
    "src/mcp/tools/product-score.ts": "foods",
    "src/web/routes/foods.ts": "foods",
    "src/web/pages/possible-duplicates.ts": "household",
    "src/web/pages/possible-duplicates.test.ts": "household",
    "src/foods.ts": "foods",
    "src/domain/settings.ts": "settings",
    "src/mcp/tools/profile.ts": "settings",
    "src/web/routes/settings.ts": "settings",
    "src/web/settings-back.ts": "web",
    "src/web/settings-back.test.ts": "web",
    "src/web/route-map.ts": "web",
    "src/web/route-map.test.ts": "web",
    "src/web/legacy-redirects.ts": "web",
    "src/web/route-links.test.ts": "web",
    "src/mcp/tools/household.ts": "household",
    "src/mcp/tools/household-digest.ts": "household",
    "src/db/household-digest.ts": "household",
    "src/web/routes/household.ts": "household",
    "src/web/routes/household-stores.ts": "household",
    "src/web/routes/household.test.ts": "household",
    "src/web/routes/possible-duplicates.test.ts": "household",
    "src/copy/notices-inline-guard.test.ts": "web",
    "src/web/usual-products-path.ts": "web",
    "src/web/usual-products-path.test.ts": "web",
    "src/household.ts": "household",
    "src/household-token.ts": "household",
    "src/domain/household-digest.ts": "household",
    "src/domain/last-active.ts": "household",
    "src/domain/last-active.test.ts": "household",
    "src/domain/household-digest.test.ts": "household",
    "src/mcp/tools/goals.ts": "goals",
    "public/widgets/src/templates/goal-progress.html": "goals",
    "src/mcp/tools/weight.ts": "weight",
    "public/widgets/src/templates/weight-trends.html": "weight",
    "src/mcp/tools/water.ts": "water",
    "public/widgets/src/templates/component-gallery.html": "widgets",
    "src/web/shell.ts": "web",
    "src/web/shell-v2.ts": "web",
    "src/test-support/recipe-macros.ts": "recipes",
    "src/web/form.ts": "web",
    "src/web/loaders.ts": "web",
    "src/web/loaders-today.ts": "web",
    "src/web/loaders-plan.ts": "web",
    "src/web/loaders-today.test.ts": "web",
    "src/web/display-quantity.ts": "web",
    "src/alcohol.ts": "platform",
    "src/analytics.ts": "platform",
    "src/chunk.ts": "platform",
    "src/client-id.ts": "platform",
    "src/discovery.ts": "platform",
    "src/domain/export-link.ts": "platform",
    "src/domain/signup.ts": "platform",
    "src/domain/signup.test.ts": "platform",
    "src/db/invites.ts": "platform",
    "src/web/pages/v2/settings-household-invites.ts": "web",
    "src/domain/notices.ts": "web",
    "src/domain/notice-dismissals.ts": "web",
    "src/domain/notices-for.ts": "web",
    "src/domain/notices-actionable.ts": "web",
    "src/domain/notices-actionable.test.ts": "web",
    "src/domain/notice-actions.ts": "web",
    "src/domain/notice-actions.test.ts": "web",
    "src/web/routes/notices.ts": "web",
    "src/web/pages/v2/notice-strip.ts": "web",
    "src/web/pages/v2/notice-strip.test.ts": "web",
    "src/mcp/tools/notices.ts": "web",
    "src/web/attention.ts": "web",
    "src/web/pages/needs-attention.ts": "web",
    "src/web/routes/needs-attention.ts": "web",
    "src/web/routes/dev-gallery.ts": "web",
    "src/web/routes/log.ts": "nutrition",
    "src/web/routes/log.test.ts": "nutrition",
    "src/web/routes/log.db.test.ts": "nutrition",
    "src/web/routes/log-relog.ts": "nutrition",
    "src/db/meals.db.test.ts": "db",
    "src/web/routes/recipes-list.test.ts": "recipes",
    "src/web/pages/v2/log-sheet.ts": "web",
    "src/web/pages/v2/log-sheet.test.ts": "web",
    "src/web/pages/v2/scanner-sheet.ts": "web",
    "src/web/pages/v2/scanner-sheet.test.ts": "web",
    "src/web/client/v2/scanner.js": "web",
    "src/web/client/v2/scanner-pick.js": "web",
    "src/web/client/v2/scanner.test.ts": "web",
    "src/web/client/v2/scanner-zxing-entry.js": "web",
    "public/app/v2/scanner.css": "web",
    "src/web/pages/v2/recipes-page-cook.ts": "web",
    "src/web/pages/v2/recipes-page-cook.test.ts": "web",
    "src/web/pages/v2/share-sheet.ts": "web",
    "src/web/pages/v2/share-sheet.test.ts": "web",
    "src/web/client/v2/cook-sheet.js": "web",
    "src/web/client/v2/cook-sheet.test.ts": "web",
    "src/web/pages/v2/recipes-favourite.ts": "web",
    "src/web/pages/v2/recipes-plan.ts": "web",
    "src/web/pages/v2/recipes-plan.test.ts": "web",
    "src/web/pages/v2/recipes-list.ts": "web",
    "src/web/pages/v2/recipes-list.test.ts": "web",
    "src/web/pages/v2/trends.ts": "web",
    "src/web/pages/v2/trends.test.ts": "web",
    "src/web/pages/v2/today.ts": "web",
    "src/web/pages/v2/today.test.ts": "web",
    "src/web/pages/v2/today-rail.test.ts": "web",
    "src/web/pages/v2/today-rail.ts": "web",
    "src/web/pages/v2/today-edit-sheet.ts": "web",
    "src/web/components/v2/sparkline.ts": "web",
    "src/web/components/v2/sparkline.test.ts": "web",
    "src/web/routes/today-meals.ts": "web",
    "src/web/routes/today-meals.test.ts": "web",
    "src/web/routes/today-meals.db.test.ts": "web",
    "src/web/routes/today-again.ts": "web",
    "src/web/routes/today-again.test.ts": "web",
    "src/web/routes/today-again.db.test.ts": "web",
    "src/web/meal-undo-flash.ts": "web",
    "src/web/client/v2/today.js": "web",
    "src/web/client/v2/today.test.ts": "web",
    "src/web/routes/nutrition.test.ts": "web",
    "public/app/v2/today.css": "web",
    "src/web/pages/v2/settings-shared.ts": "settings",
    "src/web/pages/v2/settings-home.ts": "settings",
    "src/web/pages/v2/settings-home.test.ts": "settings",
    "src/web/pages/v2/settings-account.ts": "settings",
    "src/web/pages/v2/settings-account.test.ts": "settings",
    "src/web/pages/v2/settings-display.ts": "settings",
    "src/web/pages/v2/settings-display.test.ts": "settings",
    "src/web/pages/v2/settings-help.ts": "settings",
    "src/web/pages/v2/settings-help.test.ts": "settings",
    "src/web/pages/v2/settings-household.ts": "settings",
    "src/web/pages/v2/settings-household.test.ts": "settings",
    "src/web/pages/v2/settings-household-shared-links.ts": "settings",
    "src/web/pages/v2/settings-household-shared-links.test.ts": "settings",
    "src/web/pages/v2/settings-household-modals.ts": "settings",
    "src/web/pages/v2/settings-household-modals.test.ts": "settings",
    "src/web/pages/v2/settings-stores.ts": "settings",
    "src/web/pages/v2/settings-stores.test.ts": "settings",
    "src/web/pages/v2/settings-stores-detail.ts": "settings",
    "src/web/pages/v2/settings-stores-detail.test.ts": "settings",
    "src/web/pages/v2/settings-member.ts": "settings",
    "src/web/pages/v2/settings-member.test.ts": "settings",
    "src/web/pages/v2/settings-goals.ts": "settings",
    "src/web/pages/v2/settings-goals.test.ts": "settings",
    "src/web/pages/v2/settings-goals-form.ts": "settings",
    "src/web/pages/v2/settings-goals-form.test.ts": "settings",
    "src/web/pages/v2/settings-goals-label.ts": "settings",
    "src/web/pages/v2/settings-goals-label.test.ts": "settings",
    "src/web/pages/v2/settings-saved.ts": "settings",
    "src/web/pages/v2/settings-saved.test.ts": "settings",
    "src/web/pages/v2/settings-export.ts": "settings",
    "src/web/pages/v2/settings-export.test.ts": "settings",
    "src/web/pages/v2/settings-ai.ts": "settings",
    "src/web/pages/v2/settings-ai.test.ts": "settings",
    "src/web/pages/v2/settings-score.ts": "settings",
    "src/web/pages/v2/settings-score.test.ts": "settings",
    "src/web/client/v2/score-settings.js": "web",
    "src/web/client/v2/score-settings.test.ts": "web",
    "src/web/client/v2/share-link.js": "web",
    "src/web/client/v2/share-link.test.ts": "web",
    "src/web/client/v2/copy-address.js": "web",
    "src/web/client/v2/copy-address.test.ts": "web",
    "src/web/client/v2/copy-yesterday.js": "web",
    "src/web/client/v2/copy-yesterday.test.ts": "web",
    "src/web/routes/settings-score.db.test.ts": "settings",
    "src/web/routes/foods-score.db.test.ts": "foods",
    "public/app/v2/settings.css": "web",
    "public/app/v2/stores.css": "web",
    "src/web/client/v2/stores.js": "web",
    "src/web/client/v2/stores.test.ts": "web",
    "src/web/routes/settings.test.ts": "settings",
    "src/web/routes/settings-ai.db.test.ts": "settings",
    "src/web/routes/trends.ts": "web",
    "src/web/routes/trends.test.ts": "web",
    "src/web/client/v2/trends.js": "web",
    "src/web/client/v2/trends.test.ts": "web",
    "public/app/v2/trends.css": "web",
    "src/web/pages/v2/recipes-page.ts": "web",
    "src/web/pages/v2/recipes-page.test.ts": "web",
    "src/web/pages/v2/kitchen-head.ts": "web",
    "src/web/pages/v2/kitchen-fridge.ts": "fridge",
    "src/web/pages/v2/kitchen-fridge.test.ts": "fridge",
    "src/web/pages/v2/kitchen-overview.ts": "fridge",
    "src/web/pages/v2/kitchen-overview.test.ts": "fridge",
    "src/web/pages/v2/kitchen-groceries.ts": "grocery",
    "src/web/pages/v2/kitchen-groceries.test.ts": "grocery",
    "src/web/pages/v2/kitchen-usuals.ts": "web",
    "src/web/pages/v2/kitchen-usuals.test.ts": "web",
    // Select several rows, act once: the bulk twins of the single-row actions.
    "src/domain/bulk.ts": "web",
    "src/web/routes/bulk.ts": "web",
    "src/web/pages/v2/select-mode.ts": "web",
    "src/web/routes/grocery.test.ts": "grocery",
    "src/web/routes/fridge.test.ts": "fridge",
    "src/web/client/v2/kitchen.js": "web",
    "public/app/v2/kitchen.css": "web",
    "public/app/v2/recipes.css": "web",
    "public/app/v2/share.css": "web",
    "public/app/v2/share-links.css": "web",
    "src/web/client/v2/log-sheet.js": "web",
    "src/web/client/v2/log-sheet.test.ts": "web",
    "src/web/client/v2/recipes.js": "web",
    "src/db/foods.batch.test.ts": "store",
    "public/app/v2/log-sheet.css": "web",
    "public/app/v2/product.css": "web",
    "src/web/pages/v2/product.ts": "web",
    "src/web/pages/v2/product.test.ts": "web",
    "src/web/pages/v2/product-score.ts": "web",
    "src/web/pages/v2/product-score.test.ts": "web",
    "src/web/pages/v2/product-nutrition.ts": "web",
    "src/web/pages/v2/format-barcode-display.ts": "web",
    "src/web/pages/v2/format-barcode-display.test.ts": "web",
    "src/web/pages/dev-gallery.ts": "web",
    "src/exports-route.ts": "platform",
    "src/food-search.ts": "platform",
    "src/html.ts": "platform",
    "src/mcp.ts": "platform",
    "src/middleware.ts": "platform",
    "src/token-use.ts": "platform",
    "src/use-recorder.ts": "platform",
    "src/last-seen.ts": "platform",
    "src/last-seen.test.ts": "platform",
    "src/client-ip.ts": "platform",
    "src/cloudflare-ips.ts": "platform",
    "src/client-ip.test.ts": "platform",
    "src/net.ts": "platform",
    "src/normalize.ts": "platform",
    "src/flags.ts": "platform",
    "src/flag-pins.ts": "platform",
    "src/domain/flag-pins.ts": "platform",
    "src/viewer-flags.ts": "platform",
    "src/mcp/gated.ts": "platform",
    "src/test-support/flag-harness.ts": "platform",
    "src/test-support/chrome-flags.ts": "web",
    "src/web/gated.ts": "web",
    "src/rate-limit.ts": "platform",
    "src/routes.ts": "platform",
    "src/search.ts": "platform",
    "src/site-session.ts": "platform",
    "src/ttl-cache.ts": "platform",
    "src/url.ts": "platform",
    "src/version.ts": "platform",
    "src/widgets.ts": "platform",
    "bun.lock": "deps",
    "flags/rollout.yml": "platform",
    "src/flags-rollout.ts": "platform",
    "scripts/flags-apply.ts": "platform",
};

const MEDIUM_PREFIXES: Readonly<Array<{ prefix: string; area: string }>> = [
    { prefix: "src/domain/fixtures/recipe-pages/", area: "recipes" },
    { prefix: "src/domain/fixtures/captions/", area: "recipes" },
    { prefix: "src/domain/fixtures/social/", area: "recipes" },
    { prefix: "src/domain/__fixtures__/off/", area: "foods" },
    { prefix: "src/domain/__snapshots__/", area: "foods" },
    { prefix: "src/db/", area: "db" },
    { prefix: "public/app/", area: "web" },
    { prefix: "src/web/components/", area: "web" },
    { prefix: "src/web/client/", area: "web" },
    { prefix: "src/copy/", area: "web" },
    { prefix: "public/brand/", area: "brand" },
    { prefix: "public/widgets/src/templates/v2/", area: "widgets" },
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
    "public/icon-192.png",
    "public/icon-512.png",
    "public/icon-maskable-512.png",
    "public/robots.txt",
]);

const LOW_REPO_PREFIXES = [
    ".github/",
    ".claude/",
    ".agents/",
    ".flow/",
    "scripts/",
    ".cursor/",
    "public/fonts/",
    "design/",
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
    // Every group is non-optional, so a match always fills all four.
    const [, type = "", scope = "", bang = "", subject = ""] = match;
    const breaking = bang === "!";

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

const MAX_TITLE_LENGTH = 72;

/**
 * `maxLength` is the title length limit. Dependabot titles are generated from
 * the dependency names and cannot be shortened, so `lintPr` lifts the limit
 * for that author only.
 */
export function parseTitle(
    title: string,
    opts: { maxLength?: number } = {},
): ParsedTitle | { error: string } {
    const maxLength = opts.maxLength ?? MAX_TITLE_LENGTH;
    const revertMatch = /^Revert "(.+)"$/.exec(title);
    if (revertMatch) {
        if (title.length > maxLength) {
            return { error: `Invalid title: ${title}` };
        }
        const inner = parseConventionalTitle(revertMatch[1] ?? "");
        if ("error" in inner) {
            return inner;
        }
        return inner;
    }

    if (title.length > maxLength) {
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
            currentHeading = headingMatch[1] ?? null;
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
        if (m && (m[1] ?? "").trim().length > 0) {
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
    const isDependabot = input.author === "dependabot[bot]";
    const parsed = parseTitle(
        input.title,
        isDependabot ? { maxLength: Infinity } : {},
    );

    if ("error" in parsed) {
        findings.push({ rule: "title", message: parsed.error });
    }

    findings.push(...checkBranch(input.branch));

    const { sections, level: declaredLevel, rollback } = parseBody(input.body);
    const hasMigrationFiles = input.files.some((f) =>
        f.startsWith("db/migrations/"),
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
            if (!path.startsWith("db/migrations/")) continue;
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
