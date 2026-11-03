import pkg from "../package.json" with { type: "json" };

// The one version string. A release is a PR that bumps `package.json`; the
// release workflow tags `v<version>` when that lands on main, and the MCP
// `serverInfo` reads it from here so the two cannot drift.
export const VERSION: string = pkg.version;
