// Typecheck gate for CI and `bun run check:changed`.
//
// Covers the whole project tsconfig.json describes: src/, scripts/, the
// widget tests under public/, and every *.test.ts among them. A type error
// anywhere fails the gate, so tests and tooling stay as honest as the app code.
//
// The exit code is still inspected, but only to tell "compiled with type
// errors" (2) apart from "tsc could not run at all" (bad config, missing
// binary), which must fail loudly with tsc's own output rather than pass
// silently or masquerade as a list of type errors.

const proc = Bun.spawn(["bunx", "tsc", "--noEmit", "--pretty", "false"], {
    stdout: "pipe",
    stderr: "pipe",
});
const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
]);
const exitCode = await proc.exited;
const output = stdout + stderr;

// 0 = clean, 2 = type errors found. Anything else means tsc itself failed.
if (exitCode !== 0 && exitCode !== 2) {
    console.error(`tsc failed to run (exit ${exitCode}):\n${output}`);
    process.exit(1);
}

if (exitCode === 2) {
    // Print tsc's diagnostics verbatim (continuation lines included).
    const errorCount = output
        .split("\n")
        .filter((line) => / error TS\d+: /.test(line)).length;
    console.error(`Type errors (${errorCount}):\n`);
    console.error(output.trimEnd());
    process.exit(1);
}

console.log("project typechecks clean");
