import { afterEach, describe, expect, test } from "bun:test";
import {
    fetchMigrationContents,
    isManagedLabel,
    reconcile,
} from "./apply-pr-labels.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe("fetchMigrationContents", () => {
    test("omits paths that 404 at head and still throws on other errors", async () => {
        const present = "supabase/migrations/20260101000000_present.sql";
        const missing = "supabase/migrations/20260101000000_renamed.sql";
        const sql = "-- foodable:contract reason\nSELECT 1;\n";
        const b64 = Buffer.from(sql, "utf8").toString("base64");

        globalThis.fetch = (async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes(missing)) {
                return new Response("not found", { status: 404 });
            }
            if (url.includes(present)) {
                return new Response(
                    JSON.stringify({
                        content: b64,
                        encoding: "base64",
                    }),
                    { status: 200 },
                );
            }
            if (url.includes("server_broken")) {
                return new Response("error", { status: 500 });
            }
            return new Response("unexpected", { status: 418 });
        }) as typeof fetch;

        const fileContents = await fetchMigrationContents(
            "token",
            "owner/repo",
            [present, missing, "src/foo.ts"],
            "abc123",
        );
        expect(fileContents).toEqual({ [present]: sql });
        expect(fileContents[missing]).toBeUndefined();

        await expect(
            fetchMigrationContents(
                "token",
                "owner/repo",
                ["supabase/migrations/server_broken.sql"],
                "abc123",
            ),
        ).rejects.toThrow(/failed \(500\)/);
    });
});

describe("isManagedLabel", () => {
    test("managed prefixes and change labels", () => {
        expect(isManagedLabel("type:feat")).toBe(true);
        expect(isManagedLabel("area:fridge")).toBe(true);
        expect(isManagedLabel("blast:high")).toBe(true);
        expect(isManagedLabel("migration")).toBe(true);
        expect(isManagedLabel("bug")).toBe(false);
    });
});

describe("reconcile", () => {
    test("adds missing managed labels", () => {
        const r = reconcile([], ["type:feat", "blast:low"], isManagedLabel);
        expect(r.add).toEqual(["blast:low", "type:feat"]);
        expect(r.remove).toEqual([]);
    });

    test("removes stale managed labels", () => {
        const r = reconcile(
            ["type:fix", "blast:high"],
            ["type:feat", "blast:high"],
            isManagedLabel,
        );
        expect(r.add).toEqual(["type:feat"]);
        expect(r.remove).toEqual(["type:fix"]);
    });

    test("never removes protected hand labels", () => {
        const r = reconcile(
            ["needs-decision", "type:feat"],
            ["type:feat"],
            isManagedLabel,
        );
        expect(r.remove).toEqual([]);
    });

    test("leaves community labels alone", () => {
        const r = reconcile(
            ["bug", "enhancement"],
            ["type:feat"],
            isManagedLabel,
        );
        expect(r.remove).toEqual([]);
        expect(r.add).toEqual(["type:feat"]);
    });
});
