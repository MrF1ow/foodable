import { expect, test } from "bun:test";
import { buildFlagContext } from "./flags.js";
import { clientFromExtra } from "./mcp/server.js";

test("the token's client travels from the request into the flag context", () => {
    const client = clientFromExtra({ client: "Claude" });
    const ctx = buildFlagContext({
        auth: { kind: "user", userId: "u1" },
        client,
    });
    expect(ctx.client).toBe("Claude");
});

test("a request with no client leaves the flag context's client unset", () => {
    for (const extra of [undefined, {}, { client: "" }, { client: 7 }]) {
        const ctx = buildFlagContext({
            auth: { kind: "user", userId: "u1" },
            client: clientFromExtra(extra),
        });
        expect("client" in ctx).toBe(false);
    }
});
