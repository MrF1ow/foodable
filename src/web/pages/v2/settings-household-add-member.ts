import { MIN_PASSWORD_LENGTH } from "../../../domain/auth.js";
import { MEMBER_NAME_MAX_LENGTH } from "../../../household.js";
import { segmented } from "../../components/v2/segmented.js";
import { field } from "../../components/v2/field.js";
import { join, raw, type Html } from "../../components/v2/html.js";
import { sheet, sheetSection } from "../../components/v2/sheet.js";
import { settingsErrorBanner } from "./settings-shared.js";

/** The sheet the Add a member row opens; a failed add reopens it with the reason. */
export const HOUSEHOLD_ADD_MEMBER_SHEET_ID = "fd-household-add-member";

const FORM_ID = `${HOUSEHOLD_ADD_MEMBER_SHEET_ID}-form`;

/**
 * Name, the email or username they sign in with, a password and, for the
 * owner only, a Role (Member or Admin, frame 422747). An admin's sheet has no
 * Role: whoever they add is a member, and the route refuses a role an admin
 * posts. It is a bottom sheet on a phone and the 480 px side panel from 1024.
 */
export function addMemberSheet(opts: {
    /** The owner chooses the new person's role; nobody else sees the control. */
    canChooseRole?: boolean;
    /** The reason the last add failed; shown in the sheet, which reopens. */
    error?: string;
    open?: boolean;
}): string {
    // Each field sits under its own caps label, as the design's Sheet section
    // draws it; the label is also the input's accessible name.
    const section = (label: string, input: Html) =>
        sheetSection({ kind: "fields", label, content: input });
    const form = `<form id="${FORM_ID}" method="post" action="/settings/household">${join(
        [
            settingsErrorBanner(opts.error),
            section(
                "Name",
                field({
                    id: "add_display_name",
                    label: "Name",
                    labelHidden: true,
                    name: "display_name",
                    placeholder: "Jo",
                    autocomplete: "off",
                    maxlength: MEMBER_NAME_MAX_LENGTH,
                    required: true,
                }),
            ),
            section(
                "Email or username",
                field({
                    id: "add_login",
                    label: "Email or username",
                    labelHidden: true,
                    name: "login",
                    placeholder: "jo@example.com",
                    autocomplete: "off",
                    autocapitalize: "none",
                    spellcheck: false,
                    required: true,
                }),
            ),
            section(
                "Password",
                field({
                    id: "add_password",
                    label: "Password",
                    labelHidden: true,
                    name: "password",
                    type: "password",
                    autocomplete: "new-password",
                    minlength: MIN_PASSWORD_LENGTH,
                    placeholder: `At least ${MIN_PASSWORD_LENGTH} characters`,
                    required: true,
                }),
            ),
            opts.canChooseRole
                ? section(
                      "Role",
                      segmented({
                          label: "Role",
                          name: "role",
                          segments: [
                              {
                                  label: "Member",
                                  value: "member",
                                  selected: true,
                              },
                              { label: "Admin", value: "admin" },
                          ],
                      }),
                  )
                : "",
        ],
        "",
    )}</form>`;
    return sheet({
        id: HOUSEHOLD_ADD_MEMBER_SHEET_ID,
        placement: "side",
        header: { kind: "title", title: "Add household member" },
        body: raw(form),
        actions: {
            kind: "single",
            primary: { label: "Add member", type: "submit", form: FORM_ID },
        },
        openOnLoad: opts.open,
    });
}
