import { expect, test } from "bun:test";
import { sourceIcon } from "./source-icon.js";

test("sourceIcon decorative omits role and aria-label", () => {
    const html = sourceIcon("website", {
        label: "example.com",
        decorative: true,
    });
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("role=");
    expect(html).not.toContain("aria-label=");
});

test("sourceIcon labelled keeps accessible name", () => {
    const html = sourceIcon("instagram", { label: "Instagram" });
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Instagram"');
});
