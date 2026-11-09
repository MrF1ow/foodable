import { z } from "zod";

declare const server: {
    registerTool(
        name: string,
        config: Record<string, unknown>,
        fn: () => void,
    ): void;
};
declare function personSchema(shape: Record<string, unknown>): unknown;

const FOO_OUTPUT_SCHEMA = z.object({ ok: z.boolean() });
const ctx = { OUTPUT: FOO_OUTPUT_SCHEMA };
const shape = { id: z.string() };

server.registerTool(
    "a",
    { inputSchema: z.object({ id: z.string() }) },
    () => {},
);
server.registerTool("b", { outputSchema: FOO_OUTPUT_SCHEMA }, () => {});
server.registerTool(
    "c",
    { inputSchema: personSchema({ id: z.string() }) },
    () => {},
);
server.registerTool("d", { outputSchema: ctx.OUTPUT }, () => {});
server.registerTool("e", { inputSchema: z.object(shape) }, () => {});
server.registerTool("f", { description: "no schemas" }, () => {});
