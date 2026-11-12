// The foodable lint plugin: the repo rules that are checkable, as oxlint JS
// plugin rules (ESLint-compatible API). Loaded by .oxlintrc.json `jsPlugins`;
// rules are addressed as `foodable/<name>`.
//
// A rule's job is to enforce a rule that used to live only as a sentence in
// CLAUDE.md or .flow/profile.yaml. When you add one, delete the sentence and
// add a fixture pair under fixtures/<rule>/ (bad.ts must fire, good.ts must
// not); rules.test.ts walks the fixtures and fails on a rule without a pair.
//
// Suppression comments cannot be policed from here: oxlint applies a directive
// to the report about that same comment. See check-suppressions.ts.
import gatedTool from "./rules/gated-tool.js";
import mcpSchemaObject from "./rules/mcp-schema-object.js";
import noDbMockOutsideWindows from "./rules/no-db-mock-outside-windows.js";
import noPerTestTimeout from "./rules/no-per-test-timeout.js";
import noRestoreFromLiveImport from "./rules/no-restore-from-live-import.js";
import noStringReplacementPatterns from "./rules/no-string-replacement-patterns.js";
import noWallClockWaits from "./rules/no-wall-clock-waits.js";
import skipNeedsReason from "./rules/skip-needs-reason.js";

export default {
    meta: { name: "foodable" },
    rules: {
        "gated-tool": gatedTool,
        "mcp-schema-object": mcpSchemaObject,
        "no-db-mock-outside-windows": noDbMockOutsideWindows,
        "no-per-test-timeout": noPerTestTimeout,
        "no-restore-from-live-import": noRestoreFromLiveImport,
        "no-string-replacement-patterns": noStringReplacementPatterns,
        "no-wall-clock-waits": noWallClockWaits,
        "skip-needs-reason": skipNeedsReason,
    },
};
