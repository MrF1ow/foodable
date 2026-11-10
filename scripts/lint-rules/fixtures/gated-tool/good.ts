declare const server: {
    registerTool(name: string, config: object, fn: () => void): void;
};
declare const ctx: { ready: boolean };
declare const args: { flags?: string[] };
declare function gatedTool(name: string, config: object, fn: () => void): void;

export function registerGood() {
    server.registerTool("plain", {}, () => {});
    gatedTool("through_gatedTool", {}, () => {});
    // A condition that is not a flag check is none of this rule's business.
    if (ctx.ready) {
        server.registerTool("ready", {}, () => {});
    }
}

export function registerWithFlagsArg() {
    // `flags` as a plain value is not the viewer-flag API.
    if (args.flags) {
        server.registerTool("flags_arg", {}, () => {});
    }
}

export function registerOtherGuard() {
    if (!ctx.ready) return;
    server.registerTool("after_other_guard", {}, () => {});
}
