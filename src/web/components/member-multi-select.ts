import { escapeHtml } from "../shell.js";

export type SelectableMember = {
    userId: string;
    displayName: string;
};

export function renderMemberMultiSelect(
    members: readonly SelectableMember[],
    selectedIds: readonly string[] = [],
): string {
    const selected = new Set(selectedIds);
    const labels = members
        .map((member) => {
            const checked = selected.has(member.userId) ? " checked" : "";
            return `<label class="member-choice"><input type="checkbox" name="member_ids" value="${escapeHtml(member.userId)}"${checked} /> ${escapeHtml(member.displayName)}</label>`;
        })
        .join("");
    return `<fieldset class="member-multi-select"><legend>For who</legend>${labels}</fieldset>`;
}
