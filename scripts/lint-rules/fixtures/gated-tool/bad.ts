declare const server: {
    registerTool(name: string, config: object, fn: () => void): void;
};
declare const ctx: { flags: Record<string, boolean> };
declare function isViewerFlagOn(flags: object, name: string): boolean;

export function registerBad() {
    if (isViewerFlagOn(ctx.flags, "mcp-share-links")) {
        server.registerTool("if_gated", {}, () => {});
    }
    isViewerFlagOn(ctx.flags, "mcp-share-links") &&
        server.registerTool("and_gated", {}, () => {});
    ctx.flags["x"] ? server.registerTool("ternary_gated", {}, () => {}) : null;
}

export function registerAfterGuard() {
    if (!isViewerFlagOn(ctx.flags, "mcp-share-links")) return;
    server.registerTool("guarded", {}, () => {});
}
