// `bun run lint`: oxlint with the repo's rules, then the suppression policy.
//
// Arguments go to oxlint as given (`--no-error-on-unmatched-pattern`, file and
// directory paths, `-c`, `-f`, …); the paths among them are also what the
// suppression check looks at, so `bun run lint <files>` (check:changed) checks
// the same files twice over. Both always run, so one failure does not hide the
// other. Why the suppression check is separate: see check-suppressions.ts.
import path from "node:path";
import { runSuppressionCheck } from "./check-suppressions.ts";

const ROOT = path.resolve(import.meta.dir, "../..");
/** oxlint options that take their value as the next argument. */
const VALUE_FLAGS = new Set([
    "-c",
    "--config",
    "-f",
    "--format",
    "--tsconfig",
    "--ignore-path",
    "--ignore-pattern",
    "--threads",
    "--max-warnings",
    "--rules-dir",
]);

const args = process.argv.slice(2);
const paths: string[] = [];
for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--") {
        paths.push(...args.slice(i + 1));
        break;
    }
    if (!arg.startsWith("-")) paths.push(arg);
    else if (VALUE_FLAGS.has(arg)) i++;
}

const oxlint = Bun.spawn(
    [path.join(ROOT, "node_modules/.bin/oxlint"), ...args],
    { stdin: "inherit", stdout: "inherit", stderr: "inherit" },
);
const oxlintCode = await oxlint.exited;
const suppressionCode = await runSuppressionCheck(paths);
process.exit(oxlintCode !== 0 ? oxlintCode : suppressionCode);
