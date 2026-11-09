// oxlint-disable-next-line foodable/no-wall-clock-waits -- the retry loop under test is time-based
export const a = 1;

export const b = 2; // oxlint-disable-line foodable/gated-tool -- reason on the same line

// eslint-disable-next-line no-console, no-debugger -- two rules, one reason
export const c = 3;

/* oxlint-disable-next-line foodable/skip-needs-reason -- block comment, still one line */
export const d = 4;

// Mentioning oxlint-disable in prose is not a directive.
export const e = "// oxlint-disable";
export const f = `/* eslint-disable */`;
export const g = /eslint-disable/.test("x");
