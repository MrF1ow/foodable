import { z } from "zod";

declare const server: {
    registerTool(
        name: string,
        config: Record<string, unknown>,
        fn: () => void,
    ): void;
};
declare function gatedTool(name: string, config: Record<string, unknown>): void;

const SHAPE = { id: z.string() };

server.registerTool("raw_input", { inputSchema: { id: z.string() } }, () => {});
server.registerTool(
    "raw_output",
    { outputSchema: { ok: z.boolean() } },
    () => {},
);
server.registerTool("via_const", { inputSchema: SHAPE }, () => {});
gatedTool("gated", { inputSchema: { id: z.string() } });
