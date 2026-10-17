import { escapeHtml, renderAppShell } from "../shell.js";
import type { ViewerChrome } from "../shell.js";
import type { HouseholdMember } from "../../household.js";
import type { GrocerySection, GroceryStore } from "../../domain/settings.js";
import {
    ALLERGEN_LABELS,
    NAMED_ALLERGENS,
    type MemberAllergen,
    type MemberDislike,
    type PersonRule,
    type StoreRule,
} from "../../domain/rules.js";
import { renderSettingsNav } from "../components/settings-nav.js";

export type HouseholdStoreView = GroceryStore & {
    sections: GrocerySection[];
    rules: StoreRule[];
};

export type HouseholdMemberRulesView = {
    member: HouseholdMember;
    rules: PersonRule[];
    allergens: MemberAllergen[];
    dislikes: MemberDislike[];
};

export type HouseholdSettingsView = {
    chrome: ViewerChrome;
    householdName: string;
    location: string;
    members: HouseholdMember[];
    stores: HouseholdStoreView[];
    memberRules: HouseholdMemberRulesView[];
    isOwner: boolean;
    error?: string;
    issuedToken?: string;
};

function addMemberFormHtml(error?: string): string {
    const banner = error
        ? `<p class="error-banner">${escapeHtml(error)}</p>`
        : "";
    return `<details class="more"${error ? " open" : ""}>
<summary>Add household member</summary>
<form method="POST" action="/settings/household" class="add-member">
${banner}
<label for="add_display_name">Name</label>
<input id="add_display_name" name="display_name" required maxlength="80" />
<label for="add_login">Email or username</label>
<input id="add_login" name="login" required autocomplete="off" autocapitalize="none" spellcheck="false" />
<p class="hint">A username has no @: 2–31 letters, digits, dots, dashes or underscores. They sign in with it on the same login page.</p>
<label for="add_password">Password</label>
<input id="add_password" name="password" type="password" required minlength="8" autocomplete="new-password" />
<button type="submit" class="btn-primary">Add member</button>
</form>
</details>`;
}

// Owner-only controls on another person's row. Removal erases their login and
// personal history, so it needs a ticked box (checked again on the server)
// rather than a single click.
function memberActionsHtml(member: HouseholdMember): string {
    const id = escapeHtml(member.userId);
    const name = escapeHtml(member.displayName);
    return `<div class="row-actions">
<details class="more">
<summary>Manage</summary>
<form method="post" action="/settings/household/members/${id}/make-owner" class="make-owner">
<p class="muted">${name} becomes the owner. You stay in the household as a member and lose the owner settings.</p>
<button type="submit" class="btn-primary">Make ${name} the owner</button>
</form>
<form method="post" action="/settings/household/members/${id}/remove" class="remove-member">
<label><input type="checkbox" name="confirm" value="yes" required /> Delete ${name}'s login and their meals, water, weight and goals. This can't be undone.</label>
<button type="submit" class="btn-danger">Remove ${name}</button>
</form>
</details>
</div>`;
}

function sectionRow(section: GrocerySection, canEdit: boolean): string {
    if (!canEdit) {
        return `<li class="store-section">${escapeHtml(section.name)}</li>`;
    }
    return `<li class="store-section">
<form class="section-rename inline-form" method="post" action="/settings/household/sections/${escapeHtml(section.id)}">
<label class="visually-hidden" for="section-name-${escapeHtml(section.id)}">Section name</label>
<input id="section-name-${escapeHtml(section.id)}" name="name" value="${escapeHtml(section.name)}" required maxlength="80" />
<button type="submit" class="btn-sm">Rename</button>
</form>
</li>`;
}

function storeCard(store: HouseholdStoreView, canEdit: boolean): string {
    const sections = store.sections
        .map((section) => sectionRow(section, canEdit))
        .join("");
    const rules = store.rules
        .map((rule) => `<li class="store-rule">${escapeHtml(rule.body)}</li>`)
        .join("");
    const ruleForm = canEdit
        ? `<details class="more">
<summary>Add store rule</summary>
<form method="post" action="/settings/household/stores/${escapeHtml(store.id)}/rules" class="store-rule-form">
<label for="store-rule-${escapeHtml(store.id)}">Store rule</label>
<textarea id="store-rule-${escapeHtml(store.id)}" name="body" required maxlength="500"></textarea>
<button type="submit" class="btn-primary">Save store rule</button>
</form>
</details>`
        : "";
    return `<section class="household-store psec" data-store-id="${escapeHtml(store.id)}">
<h3>${escapeHtml(store.name)}</h3>
<ul class="store-section-list list">${sections}</ul>
<ul class="store-rule-list muted">${rules}</ul>
${ruleForm}
</section>`;
}

function allergenLabel(row: MemberAllergen): string {
    if (row.allergen === "other") return row.otherLabel ?? "Other";
    return ALLERGEN_LABELS[row.allergen];
}

function memberRulesCard(
    view: HouseholdMemberRulesView,
    canEdit: boolean,
): string {
    const allergens = view.allergens
        .map(
            (row) =>
                `<li class="allergen pill pill-bad">${escapeHtml(allergenLabel(row))}</li>`,
        )
        .join("");
    const dislikes = view.dislikes
        .map(
            (row) =>
                `<li class="dislike pill pill-dim">${escapeHtml(row.displayName)}</li>`,
        )
        .join("");
    const rules = view.rules
        .map((row) => `<li class="person-rule">${escapeHtml(row.body)}</li>`)
        .join("");
    const allergenOptions = NAMED_ALLERGENS.map(
        (code) =>
            `<option value="${code}">${escapeHtml(ALLERGEN_LABELS[code])}</option>`,
    ).join("");
    const forms = canEdit
        ? `<details class="more">
<summary>Edit rules</summary>
<form method="post" action="/settings/household/members/${escapeHtml(view.member.userId)}/allergens" class="allergen-form">
<label for="allergen-${escapeHtml(view.member.userId)}">Allergen</label>
<select id="allergen-${escapeHtml(view.member.userId)}" name="allergen">
${allergenOptions}
<option value="other">Other</option>
</select>
<label for="allergen-other-${escapeHtml(view.member.userId)}">Other allergen</label>
<input id="allergen-other-${escapeHtml(view.member.userId)}" name="other_label" maxlength="80" />
<button type="submit" class="btn-primary">Save allergen</button>
</form>
<form method="post" action="/settings/household/members/${escapeHtml(view.member.userId)}/dislikes" class="dislike-form">
<label for="dislike-${escapeHtml(view.member.userId)}">Dislike</label>
<input id="dislike-${escapeHtml(view.member.userId)}" name="display_name" required maxlength="80" />
<button type="submit" class="btn-primary">Save dislike</button>
</form>
<form method="post" action="/settings/household/members/${escapeHtml(view.member.userId)}/rules" class="person-rule-form">
<label for="person-rule-${escapeHtml(view.member.userId)}">Person rule</label>
<textarea id="person-rule-${escapeHtml(view.member.userId)}" name="body" required maxlength="500"></textarea>
<button type="submit" class="btn-primary">Save person rule</button>
</form>
</details>`
        : "";
    return `<section class="member-rules psec" data-user-id="${escapeHtml(view.member.userId)}">
<h3>${escapeHtml(view.member.displayName)}</h3>
<ul class="allergen-list pills">${allergens}</ul>
<ul class="dislike-list pills">${dislikes}</ul>
<ul class="person-rule-list muted">${rules}</ul>
${forms}
</section>`;
}

export function renderHouseholdSettingsPage(
    view: HouseholdSettingsView,
): string {
    const error = view.error
        ? `<p class="error-banner">${escapeHtml(view.error)}</p>`
        : "";
    const token = view.issuedToken
        ? `<p class="token-once">Household bot token (shown once): <code>${escapeHtml(view.issuedToken)}</code></p>`
        : "";
    const members = view.members
        .map((member) => {
            const actions =
                view.isOwner && member.role !== "owner"
                    ? memberActionsHtml(member)
                    : "";
            return `<li class="household-member" data-role="${escapeHtml(member.role)}"><div class="row"><span class="row-title">${escapeHtml(member.displayName)}</span><span class="row-meta">${escapeHtml(member.role)}</span></div>${actions}</li>`;
        })
        .join("");
    const householdCard = view.isOwner
        ? `<form method="post" action="/settings/household/name" class="household-name inline-form">
<label for="household_name">Household name</label>
<input id="household_name" name="name" value="${escapeHtml(view.householdName)}" required maxlength="80" />
<button type="submit">Save</button>
</form>
<form method="post" action="/settings/household/location" class="household-location inline-form">
<label for="household_location">Household location</label>
<input id="household_location" name="location" value="${escapeHtml(view.location)}" maxlength="120" />
<button type="submit">Save</button>
</form>
<form method="post" action="/settings/household/rotate-token" class="rotate-token">
<button type="submit" class="btn-sm">Rotate household token</button>
</form>`
        : `<p class="household-name">${escapeHtml(view.householdName)}</p>
<p class="household-location muted">${view.location ? escapeHtml(view.location) : "No location set."}</p>`;
    const addStore = view.isOwner
        ? `<details class="more"${view.stores.length === 0 ? " open" : ""}>
<summary>Add store</summary>
<form method="post" action="/settings/household/stores" class="add-store inline-form">
<label for="store_name">Grocery store</label>
<input id="store_name" name="name" required maxlength="80" autocomplete="off" />
<button type="submit" class="btn-primary">Add store</button>
</form>
</details>`
        : "";
    const stores = view.stores
        .map((store) => storeCard(store, view.isOwner))
        .join("");
    const memberRules = view.memberRules
        .map((row) => memberRulesCard(row, view.isOwner))
        .join("");
    const body = `
        <h1>Household</h1>
        ${renderSettingsNav("household")}
        ${error}
        ${token}
        <section class="panel">
            <h2>Household</h2>
            ${householdCard}
        </section>
        <section class="panel">
            <h2>Members</h2>
            <ul class="household-members list">${members}</ul>
            ${view.isOwner ? addMemberFormHtml() : ""}
        </section>
        <section class="panel">
            <h2>Grocery stores</h2>
            ${stores || `<p class="empty-stores">Add a grocery store.</p>`}
            ${addStore}
        </section>
        <section class="panel">
            <h2>Rules</h2>
            ${memberRules}
        </section>
    `;
    return renderAppShell({
        title: "Household",
        active: "settings",
        theme: view.chrome.theme,
        body,
    });
}

export { addMemberFormHtml };
