import { describe, expect, test } from "bun:test";
import { buildWebAppManifest } from "./manifest.js";

describe("buildWebAppManifest", () => {
    test("includes share_target GET with three params", () => {
        const m = buildWebAppManifest();
        expect(m.name).toBe("Foodable");
        expect(m.display).toBe("standalone");
        expect(m.share_target).toEqual({
            action: "/share",
            method: "GET",
            params: { title: "title", text: "text", url: "url" },
        });
    });

    test("every listed icon exists on disk", async () => {
        const m = buildWebAppManifest();
        for (const icon of m.icons) {
            const path = icon.src.startsWith("/brand/")
                ? `public/brand/${icon.src.slice("/brand/".length)}`
                : `public${icon.src}`;
            expect(await Bun.file(path).exists(), path).toBe(true);
        }
    });
});
