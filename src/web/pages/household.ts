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
import {
    confirmModal,
    emptyState,
    errorBanner,
    modal,
    modalTrigger,
    pageHeader,
    pageLevelErrorBanner,
    panel,
    row,
} from "../components/ui.js";

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
    openModalId?: string;
};

export const HOUSEHOLD_ADD_MEMBER_MODAL_ID = "household-add-member";
export const HOUSEHOLD_ADD_STORE_MODAL_ID = "household-add-store";
export const HOUSEHOLD_ROTATE_TOKEN_MODAL_ID = "household-rotate-token";

function modalOpen(view: HouseholdSettingsView, id: string): boolean {
    return view.openModalId === id;
}

function manageModalId(userId: string): string {
    return `household-manage-${userId}`;
}

function removeMemberModalId(userId: string): string {
    return `household-remove-${userId}`;
}

function makeOwnerModalId(userId: string): string {
    return `household-make-owner-${userId}`;
}

function storeRuleModalId(storeId: string): string {
    return `household-store-rule-${storeId}`;
}

export function householdMemberRulesModalId(userId: string): string {
    return `household-member-rules-${userId}`;
}

function addMemberFormBody(error?: string): string {
    return `${errorBanner(error)}
<label for="add_display_name">Name</label>
<input id="add_display_name" name="display_name" required maxlength="80" />
<label for="add_login">Email or username</label>
<input id="add_login" name="login" required autocomplete="off" autocapitalize="none" spellcheck="false" />
<p class="hint">A username has no @: 2–31 letters, digits, dots, dashes or underscores. They sign in with it on the same login page.</p>
<label for="add_password">Password</label>
<input id="add_password" name="password" type="password" required minlength="8" autocomplete="new-password" />
<button type="submit" class="btn-primary">Add member</button>`;
}

function addMemberModal(view: HouseholdSettingsView): string {
    const modalError =
        view.error && modalOpen(view, HOUSEHOLD_ADD_MEMBER_MODAL_ID)
            ? errorBanner(view.error)
            : "";
    return modal({
        id: HOUSEHOLD_ADD_MEMBER_MODAL_ID,
        title: "Add household member",
        openOnLoad: modalOpen(view, HOUSEHOLD_ADD_MEMBER_MODAL_ID),
        body: `<form method="POST" action="/settings/household" class="add-member">
${modalError}${addMemberFormBody()}
</form>`,
    });
}

function memberActionsHtml(
    member: HouseholdMember,
    view: HouseholdSettingsView,
): { actions: string; modals: string } {
    const id = escapeHtml(member.userId);
    const name = escapeHtml(member.displayName);
    const manageId = manageModalId(member.userId);
    const removeId = removeMemberModalId(member.userId);
    const ownerId = makeOwnerModalId(member.userId);
    const removeError =
        view.error && modalOpen(view, removeId) ? errorBanner(view.error) : "";
    const modals =
        modal({
            id: manageId,
            title: `Manage ${member.displayName}`,
            openOnLoad: modalOpen(view, manageId),
            body: `<p class="muted">Transfer ownership or remove this member from the household.</p>
<div class="modal-actions">
${modalTrigger({
    target: ownerId,
    label: `Make ${member.displayName} the owner`,
    className: "btn-primary",
})}
${modalTrigger({
    target: removeId,
    label: "Remove member",
    className: "btn-danger",
})}
</div>`,
        }) +
        confirmModal({
            id: ownerId,
            title: "Transfer ownership",
            message: `${member.displayName} becomes the owner. You stay in the household as a member and lose the owner settings.`,
            action: `/settings/household/members/${member.userId}/make-owner`,
            confirmLabel: `Make ${member.displayName} the owner`,
            openOnLoad: modalOpen(view, ownerId),
            bodyPrefix:
                view.error && modalOpen(view, ownerId)
                    ? errorBanner(view.error)
                    : "",
        }) +
        modal({
            id: removeId,
            title: `Remove ${member.displayName}`,
            openOnLoad: modalOpen(view, removeId),
            body: `${removeError}<form method="post" action="/settings/household/members/${id}/remove" class="remove-member">
<label><input type="checkbox" name="confirm" value="yes" required /> Delete ${name}'s login and their meals, water, weight and goals. This can't be undone.</label>
<button type="submit" class="btn-danger">Remove ${name}</button>
</form>`,
        });
    const actions = modalTrigger({
        target: manageId,
        label: "Manage",
        className: "btn-sm",
    });
    return { actions, modals };
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

function storeCard(
    store: HouseholdStoreView,
    canEdit: boolean,
    view: HouseholdSettingsView,
): { card: string; modals: string } {
    const sections = store.sections
        .map((section) => sectionRow(section, canEdit))
        .join("");
    const rules = store.rules
        .map((rule) => `<li class="store-rule">${escapeHtml(rule.body)}</li>`)
        .join("");
    const ruleModalId = storeRuleModalId(store.id);
    const ruleModalError =
        view.error && modalOpen(view, ruleModalId)
            ? errorBanner(view.error)
            : "";
    const ruleModal = canEdit
        ? modal({
              id: ruleModalId,
              title: "Add store rule",
              openOnLoad: modalOpen(view, ruleModalId),
              body: `${ruleModalError}<form method="post" action="/settings/household/stores/${escapeHtml(store.id)}/rules" class="store-rule-form">
<label for="store-rule-${escapeHtml(store.id)}">Store rule</label>
<textarea id="store-rule-${escapeHtml(store.id)}" name="body" required maxlength="500"></textarea>
<button type="submit" class="btn-primary">Save store rule</button>
</form>`,
          })
        : "";
    const headRule = canEdit
        ? `<div class="row-actions">${modalTrigger({
              target: ruleModalId,
              label: "Add store rule",
              className: "btn-sm",
          })}</div>`
        : "";
    const card = `<section class="household-store psec" data-store-id="${escapeHtml(store.id)}">
<div class="row">
<h3 class="subsection-title">${escapeHtml(store.name)}</h3>
${headRule}
</div>
<ul class="store-section-list list">${sections}</ul>
<ul class="store-rule-list muted">${rules}</ul>
</section>`;
    return { card, modals: ruleModal };
}

function allergenLabel(row: MemberAllergen): string {
    if (row.allergen === "other") return row.otherLabel ?? "Other";
    return ALLERGEN_LABELS[row.allergen];
}

function memberRulesCard(
    view: HouseholdMemberRulesView,
    canEdit: boolean,
    pageView: HouseholdSettingsView,
): { card: string; modals: string } {
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
    const rulesModalId = householdMemberRulesModalId(view.member.userId);
    const rulesModalError =
        pageView.error && modalOpen(pageView, rulesModalId)
            ? errorBanner(pageView.error)
            : "";
    const rulesModal = canEdit
        ? modal({
              id: rulesModalId,
              title: `Rules for ${view.member.displayName}`,
              openOnLoad: modalOpen(pageView, rulesModalId),
              body: `${rulesModalError}<form method="post" action="/settings/household/members/${escapeHtml(view.member.userId)}/allergens" class="allergen-form">
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
</form>`,
          })
        : "";
    const editTrigger = canEdit
        ? `<div class="row-actions">${modalTrigger({
              target: rulesModalId,
              label: "Edit rules",
              className: "btn-sm",
          })}</div>`
        : "";
    const card = `<section class="member-rules psec" data-user-id="${escapeHtml(view.member.userId)}">
<div class="row">
<h3 class="subsection-title">${escapeHtml(view.member.displayName)}</h3>
${editTrigger}
</div>
<ul class="allergen-list pills">${allergens}</ul>
<ul class="dislike-list pills">${dislikes}</ul>
<ul class="person-rule-list muted">${rules}</ul>
</section>`;
    return { card, modals: rulesModal };
}

export function renderHouseholdSettingsPage(
    view: HouseholdSettingsView,
): string {
    const modalIds: string[] = [];
    const token = view.issuedToken
        ? `<p class="token-once">Household bot token (shown once): <code>${escapeHtml(view.issuedToken)}</code></p>`
        : "";
    let memberModals = "";
    const members = view.members
        .map((member) => {
            const actions =
                view.isOwner && member.role !== "owner"
                    ? memberActionsHtml(member, view)
                    : null;
            if (actions) {
                memberModals += actions.modals;
                modalIds.push(
                    manageModalId(member.userId),
                    removeMemberModalId(member.userId),
                    makeOwnerModalId(member.userId),
                );
            }
            return `<li class="household-member" data-role="${escapeHtml(member.role)}">${row(
                {
                    title: member.displayName,
                    meta: member.role,
                    actions: actions?.actions ?? "",
                },
            )}</li>`;
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
<div class="row-actions">${modalTrigger({
              target: HOUSEHOLD_ROTATE_TOKEN_MODAL_ID,
              label: "Rotate household token",
              className: "btn-sm",
          })}</div>`
        : `<p class="household-name">${escapeHtml(view.householdName)}</p>
<p class="household-location muted">${view.location ? escapeHtml(view.location) : "No location set."}</p>`;
    modalIds.push(HOUSEHOLD_ADD_MEMBER_MODAL_ID, HOUSEHOLD_ADD_STORE_MODAL_ID);
    if (view.isOwner) {
        modalIds.push(HOUSEHOLD_ROTATE_TOKEN_MODAL_ID);
    }
    let storeModals = "";
    const stores = view.stores
        .map((store) => {
            const part = storeCard(store, view.isOwner, view);
            storeModals += part.modals;
            if (view.isOwner) {
                modalIds.push(storeRuleModalId(store.id));
            }
            return part.card;
        })
        .join("");
    let rulesModals = "";
    const memberRules = view.memberRules
        .map((row) => {
            const part = memberRulesCard(row, view.isOwner, view);
            rulesModals += part.modals;
            if (view.isOwner) {
                modalIds.push(householdMemberRulesModalId(row.member.userId));
            }
            return part.card;
        })
        .join("");

    const headerActions: string[] = [];
    if (view.isOwner) {
        headerActions.push(
            modalTrigger({
                target: HOUSEHOLD_ADD_MEMBER_MODAL_ID,
                label: "Add member",
                className: "btn-primary",
            }),
            modalTrigger({
                target: HOUSEHOLD_ADD_STORE_MODAL_ID,
                label: "Add store",
                className: "btn-primary",
            }),
        );
    }

    const pageModals = [
        view.isOwner ? addMemberModal(view) : "",
        view.isOwner
            ? modal({
                  id: HOUSEHOLD_ADD_STORE_MODAL_ID,
                  title: "Add store",
                  openOnLoad: modalOpen(view, HOUSEHOLD_ADD_STORE_MODAL_ID),
                  body: `${view.error && modalOpen(view, HOUSEHOLD_ADD_STORE_MODAL_ID) ? errorBanner(view.error) : ""}<form method="post" action="/settings/household/stores" class="add-store">
<label for="store_name">Grocery store</label>
<input id="store_name" name="name" required maxlength="80" autocomplete="off" />
<button type="submit" class="btn-primary">Add store</button>
</form>`,
              })
            : "",
        view.isOwner
            ? confirmModal({
                  id: HOUSEHOLD_ROTATE_TOKEN_MODAL_ID,
                  title: "Rotate household token",
                  message:
                      "Issue a new household bot token? The old token stops working immediately.",
                  action: "/settings/household/rotate-token",
                  confirmLabel: "Rotate token",
                  formClass: "rotate-token modal-confirm",
                  turboFalse: true,
                  openOnLoad: modalOpen(view, HOUSEHOLD_ROTATE_TOKEN_MODAL_ID),
              })
            : "",
        memberModals,
        storeModals,
        rulesModals,
    ].join("");

    const body = `
        ${pageHeader({
            title: "Household",
            actions: headerActions.length
                ? headerActions.join("\n")
                : undefined,
        })}
        ${pageLevelErrorBanner(view, modalIds)}
        ${renderSettingsNav("household")}
        ${token}
        ${panel({ title: "Household", body: householdCard })}
        ${panel({
            title: "Members",
            body: `<ul class="household-members list">${members}</ul>`,
        })}
        ${panel({
            title: "Grocery stores",
            body: `${stores || emptyState("Add a grocery store.", "empty-stores")}`,
        })}
        ${panel({ title: "Rules", body: memberRules })}
        ${pageModals}
    `;
    return renderAppShell({
        title: "Household",
        active: "settings",
        theme: view.chrome.theme,
        body,
    });
}

/** @deprecated Use modal markup; kept for tests that import the form fields. */
export function addMemberFormHtml(error?: string): string {
    return `<form method="POST" action="/settings/household" class="add-member">
${addMemberFormBody(error)}
</form>`;
}
