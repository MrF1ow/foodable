declare const server: {
    registerTool(name: string, config: object, fn: () => void): void;
};
declare const ctx: { flags: Record<string, boolean> };
declare function isViewerFlagOn(flags: object, name: string): boolean;

export function registerBad() {
    if (isViewerFlagOn(ctx.flags, "mcp-widgets-v2")) {
        server.registerTool("if_gated", {}, () => {});
    }
    isViewerFlagOn(ctx.flags, "mcp-widgets-v2") &&
        server.registerTool("and_gated", {}, () => {});
    ctx.flags["x"] ? server.registerTool("ternary_gated", {}, () => {}) : null;
}

export function registerAfterGuard() {
    if (!isViewerFlagOn(ctx.flags, "mcp-widgets-v2")) return;
    server.registerTool("guarded", {}, () => {});
}
