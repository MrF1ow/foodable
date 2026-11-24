import { expect, test } from "bun:test";
import {
    addMemberSheet,
    HOUSEHOLD_ADD_MEMBER_SHEET_ID,
} from "./settings-household-add-member.js";

test("the sheet is a side sheet of three fields and one Add member button", () => {
    const html = addMemberSheet({});
    expect(html).toContain(`id="${HOUSEHOLD_ADD_MEMBER_SHEET_ID}"`);
    // A bottom sheet on a phone, the 480 px side panel from 1024 px.
    expect(html).toContain("fd-sheet--side");
    expect(html).toContain('<h2 class="fd-sheet__title"');
    expect(html).toContain(">Add household member<");
    for (const name of ["display_name", "login", "password"]) {
        expect(html).toContain(`name="${name}"`);
    }
    expect(html).toContain("fd-sheet__actions--single");
    expect(html.match(/type="submit"/g)).toHaveLength(1);
    expect(html).toContain('maxlength="80"');
    expect(html).toContain('placeholder="Jo"');
    expect(html).not.toContain('name="role"');
    expect(html).not.toContain("data-sheet-open-on-load");
    expect(html).not.toContain("fd-settings-error");
});

test("a refused add reopens the sheet and shows the reason once, inside the form", () => {
    const html = addMemberSheet({
        error: "Enter an email or username.",
        open: true,
    });
    expect(html).toContain("data-sheet-open-on-load");
    expect(html.match(/Enter an email or username\./g)).toHaveLength(1);
    expect(html.indexOf("Enter an email or username.")).toBeLessThan(
        html.indexOf('name="display_name"'),
    );
});

test("the reason is escaped", () => {
    expect(addMemberSheet({ error: "<img src=x>" })).not.toContain(
        "<img src=x>",
    );
});

test("the owner's sheet has a Role of Member (the default) and Admin", () => {
    const html = addMemberSheet({ canChooseRole: true });
    expect(html).toContain('fd-sheet__label">Role<');
    expect(html).toContain('role="radiogroup" aria-label="Role"');
    expect(html).toMatch(/name="role" value="member" checked/);
    expect(html).toMatch(/name="role" value="admin"(?! checked)/);
});
