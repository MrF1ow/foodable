import type {
    Icon,
    McpServer,
    RegisteredTool,
    ScopeChallengeHandler,
    StandardSchemaWithJSON,
    ToolAnnotations,
    ToolCallback,
} from "@modelcontextprotocol/server";
import type { FlagName } from "../flags.js";
import { isViewerFlagOn } from "../viewer-flags.js";
import type { ToolContext } from "./shared.js";

// The config of McpServer.registerTool's supported overload (schema objects,
// not raw shapes). Spelled out because `Parameters<McpServer["registerTool"]>`
// resolves to the deprecated raw-shape overload, which rejects `z.object(…)`
// and leaves the handler's arguments unchecked.
export type GatedToolConfig<
    OutputArgs extends StandardSchemaWithJSON,
    InputArgs extends StandardSchemaWithJSON | undefined,
> = {
    title?: string;
    description?: string;
    inputSchema?: InputArgs;
    outputSchema?: OutputArgs;
    annotations?: ToolAnnotations;
    icons?: Icon[];
    scopeChallenge?: ScopeChallengeHandler;
    _meta?: Record<string, unknown>;
};

/**
 * `server.registerTool` behind a flag. With the flag off for this caller the
 * tool is not registered at all: it is absent from tools/list and calling it is
 * the SDK's unknown-tool error. Every call is recorded in `ctx.gatedTools`, on
 * or off, so tests can check that the flag-off list is the snapshot (the
 * all-flags-on list) minus the gated tools. Writes are never gated.
 */
export function gatedTool<
    OutputArgs extends StandardSchemaWithJSON,
    InputArgs extends StandardSchemaWithJSON | undefined = undefined,
>(
    server: McpServer,
    ctx: ToolContext,
    flag: FlagName,
    name: string,
    config: GatedToolConfig<OutputArgs, InputArgs>,
    handler: ToolCallback<InputArgs>,
): RegisteredTool | undefined {
    const registered = isViewerFlagOn(ctx.flags, flag);
    ctx.gatedTools.push({ name, flag, registered });
    if (!registered) return undefined;
    return server.registerTool(name, config, handler);
}
