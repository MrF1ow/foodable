import { expect, test } from "bun:test";
import { truncateToastParam } from "./truncate-toast-param.js";

test("truncateToastParam leaves short values unchanged", () => {
    expect(truncateToastParam("Soup")).toBe("Soup");
    expect(truncateToastParam("x".repeat(80))).toHaveLength(80);
});

test("truncateToastParam shortens an 83-char title and 89-char host to 80 with ellipsis", () => {
    const title = "T".repeat(83);
    const host = "h".repeat(89);
    expect(truncateToastParam(title)).toBe("T".repeat(79) + "…");
    expect(truncateToastParam(title)).toHaveLength(80);
    expect(truncateToastParam(host)).toBe("h".repeat(79) + "…");
    expect(truncateToastParam(host)).toHaveLength(80);
});
