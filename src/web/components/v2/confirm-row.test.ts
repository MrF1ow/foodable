import { expect, test } from "bun:test";
import {
    CONFIRM_ARM_ATTRS,
    CONFIRM_IDLE_ATTRS,
    confirmButtons,
} from "./confirm-row.js";
import { sheetActions } from "./sheet.js";

const tags = (html: string): string[] =>
    [...html.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]);

test("confirmButtons are Cancel and the verb, both hidden, the verb a danger submit of its form", () => {
    const [cancel, go] = tags(
        String(confirmButtons({ label: "Clear 3", form: "clear-form" })),
    );
    expect(cancel).toContain("data-fd-confirm-cancel");
    expect(cancel).toContain('type="button"');
    expect(cancel).toMatch(/\bhidden\b/);
    expect(go).toContain("data-fd-confirm-go");
    expect(go).toContain('type="submit"');
    expect(go).toContain('form="clear-form"');
    expect(go).toContain("fd-btn--danger");
    expect(go).toMatch(/\bhidden\b/);
});

test("a hostile verb is escaped", () => {
    const html = String(
        confirmButtons({ label: "<img src=x onerror=alert(1)>", form: "f" }),
    );
    expect(html).not.toContain("<img");
});

test("the markers name the arm and the idle buttons", () => {
    expect(CONFIRM_ARM_ATTRS).toEqual({ "data-fd-confirm-arm": "" });
    expect(CONFIRM_IDLE_ATTRS).toEqual({ "data-fd-confirm-idle": "" });
});

test("a sheet's pair with confirm turns its Cancel into the arm and hides the confirm step", () => {
    const html = String(
        sheetActions({
            kind: "pair",
            cancel: { label: "Clear checked" },
            primary: { label: "Put away", type: "submit", form: "put-form" },
            confirm: { label: "Clear 2", form: "clear-form" },
            sheetId: "s",
        }),
    );
    expect(html).toContain("fd-sheet__actions--pair");
    expect(html).toContain("data-fd-confirm");
    const [arm, put, cancel, go] = tags(html);
    // The arm posts nothing and does not close the sheet.
    expect(arm).toContain("data-fd-confirm-arm");
    expect(arm).toContain('type="button"');
    expect(arm).not.toContain("form=");
    expect(arm).not.toContain("commandfor");
    expect(put).toContain("data-fd-confirm-idle");
    expect(put).toContain('form="put-form"');
    expect(cancel).toContain("data-fd-confirm-cancel");
    expect(cancel).toMatch(/\bhidden\b/);
    expect(go).toContain('form="clear-form"');
    expect(go).toMatch(/\bhidden\b/);
});

test("confirm needs a cancel to arm", () => {
    expect(() =>
        sheetActions({
            kind: "pair",
            primary: { label: "Put away" },
            confirm: { label: "Clear 2", form: "f" },
            sheetId: "s",
        }),
    ).toThrow("confirm needs a cancel");
});
