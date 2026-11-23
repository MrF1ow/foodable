/**
 * Settings › Notifications (FigCraft Screens › Settings › Notifications and
 * Desktop › Settings › Notifications): one row with a switch for each kind a
 * person can turn off. BASE kinds are on until the person turns them off,
 * EXTRAS are off until they turn them on. Allergens has no row: it cannot be
 * turned off.
 *
 * Each switch is its own one-click form that saves itself
 * (`data-fd-autosave="form"`, `client/v2/autosave.js`), posts to
 * `POST /settings/notifications` and comes back here with no toast. A refused
 * save is said in place.
 */
import {
    NOTIFICATIONS_SETTINGS as COPY,
    NOTIFICATION_BUCKET_LABELS,
    NOTIFICATION_KIND_LABELS,
} from "../../../copy/notifications.js";
import {
    NOTIFICATION_KINDS,
    NOTIFICATION_KIND_IDS,
    type NotificationKind,
} from "../../../domain/notification-kinds.js";
import {
    kindEnabled,
    type NotificationPref,
} from "../../../domain/notifications.js";
import type { AppChromeBase } from "../../attention.js";
import { esc, raw, type Html } from "../../components/v2/html.js";
import { itemRow } from "../../components/v2/item-row.js";
import { listGroup } from "../../components/v2/list-group.js";
import { sectionHeader } from "../../components/v2/section-header.js";
import { APP_PATHS } from "../../route-map.js";
import {
    renderSettingsV2Page,
    settingsErrorBanner,
    settingsPageHeader,
} from "./settings-shared.js";

export const NOTIFICATIONS_SETTINGS_PATH = APP_PATHS.settingsNotifications;

export type SettingsNotificationsV2View = {
    chrome: AppChromeBase;
    /** The viewer's saved choices; a kind with none is at its default. */
    prefs: readonly Pick<NotificationPref, "kind" | "enabled">[];
    /** A refused save, said in place. */
    error?: string;
};

type SwitchKind = Exclude<NotificationKind, "allergens">;

/** The kinds that get a row, in the order of `NOTIFICATION_KIND_IDS`. */
function switchKinds(onByDefault: boolean): SwitchKind[] {
    return NOTIFICATION_KIND_IDS.filter(
        (kind): kind is SwitchKind =>
            NOTIFICATION_KINDS[kind].canDisable &&
            NOTIFICATION_KINDS[kind].defaultOn === onByDefault,
    );
}

/** The row's form is the button's own wrapper; marking it makes it save
 * itself. The post carries the value the switch is moving to, so a save the
 * script sends after another one (no submitter) still says it. */
function markAutosave(row: Html): Html {
    return raw(
        String(row).replace(
            '<form class="fd-inline-form"',
            '<form class="fd-inline-form" data-fd-autosave="form"',
        ),
    );
}

function kindRow(kind: SwitchKind, on: boolean): Html {
    const label = NOTIFICATION_KIND_LABELS[kind];
    return markAutosave(
        itemRow({
            id: `notification-kind-${kind}`,
            title: label,
            subtitle:
                NOTIFICATION_BUCKET_LABELS[NOTIFICATION_KINDS[kind].bucket],
            trailing: {
                kind: "toggle",
                on,
                label,
                form: {
                    action: NOTIFICATIONS_SETTINGS_PATH,
                    fields: {
                        kind,
                        enabled: on ? "false" : "true",
                        return: NOTIFICATIONS_SETTINGS_PATH,
                    },
                },
            },
        }),
    );
}

/** A section: its header, 12 px, then its rows (settings.css). */
function section(
    label: string,
    kinds: readonly SwitchKind[],
    view: SettingsNotificationsV2View,
): string {
    if (kinds.length === 0) return "";
    const rows = kinds.map((kind) =>
        kindRow(kind, kindEnabled(view.prefs, kind)),
    );
    return `<section class="fd-notification-settings__section" aria-label="${esc(label)}">${String(sectionHeader({ label, rule: false }))}${String(listGroup({ rows }))}</section>`;
}

export function renderSettingsNotificationsV2Body(
    view: SettingsNotificationsV2View,
): string {
    return `${String(settingsPageHeader(COPY.title))}${String(settingsErrorBanner(view.error))}<div class="fd-notification-settings">${section(COPY.baseLabel, switchKinds(true), view)}${section(COPY.extrasLabel, switchKinds(false), view)}</div>`;
}

export function renderSettingsNotificationsV2Page(
    view: SettingsNotificationsV2View,
): string {
    return renderSettingsV2Page({
        chrome: view.chrome,
        page: "notifications",
        title: COPY.title,
        body: renderSettingsNotificationsV2Body(view),
    });
}
