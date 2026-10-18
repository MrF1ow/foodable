import { isWeightUnit, type WeightUnit } from "../domain/units.js";
import { isDrinkUnit, type DrinkUnit } from "../alcohol.js";
import { getSupabase } from "./client.js";

// ---------- Profiles ----------

export interface Profile {
    user_id: string;
    // null means "never set with set_timezone" — the column has no default
    // to fall back on that would be distinguishable from a deliberate
    // choice, so every reader must coalesce this explicitly (see
    // timezoneFromProfile / getUserTimezone below). Do not read this
    // directly to decide whether a timezone is "configured" outside those
    // two: that was #99 — a row can exist (any set_* tool creates one) with
    // this still null.
    timezone: string | null;
    preferred_weight_unit: WeightUnit | null;
    widgets_enabled: boolean;
    alcohol_tracking_enabled: boolean;
    preferred_drink_unit: DrinkUnit | null;
    // Locale is unused: widgets and login are English-only. The column stays
    // until a later contract phase; do not read it to pick UI language.
    locale: string | null;
    theme: "light" | "dark" | null;
    accent_swatch: string | null;
    /** Null means default nutrition dashboard card order. */
    nutrition_layout: string[] | null;
    created_at: string;
    updated_at: string;
}

export async function getProfile(userId: string): Promise<Profile | null> {
    const { data, error } = await getSupabase()
        .from("profiles")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

    if (error) throw new Error(`Failed to get profile: ${error.message}`);
    return (data as Profile | null) ?? null;
}

// Returns the timezone the user actually chose with set_timezone, or null if
// they never have — regardless of whether a profile row exists. Callers that
// need to know whether the timezone is *configured* (as opposed to what to
// display) must use this, not `profile !== null`.
export function timezoneFromProfile(
    profile: Profile | null | undefined,
): string | null {
    return profile?.timezone ?? null;
}

export async function getUserTimezone(userId: string): Promise<string> {
    return timezoneFromProfile(await getProfile(userId)) ?? "UTC";
}

// Returns the user's saved weight-unit preference, or null if they have never
// chosen one. Write paths use null to refuse guessing; display paths coalesce
// to "kg". Mirrors timezoneFromProfile — a caller that
// already has a fetched profile (get_profile needs all five preferences at
// once) should use this instead of the *FromProfile-less
// getPreferredWeightUnit, which was the one preference without a pure
// derivation until this existed.
export function preferredWeightUnitFromProfile(
    profile: Profile | null | undefined,
): WeightUnit | null {
    const unit = profile?.preferred_weight_unit;
    return isWeightUnit(unit) ? unit : null;
}

export async function getPreferredWeightUnit(
    userId: string,
): Promise<WeightUnit | null> {
    return preferredWeightUnitFromProfile(await getProfile(userId));
}

// The three display preferences below come in two halves: a pure
// *FromProfile derivation over an already-fetched row, and a thin fetching
// wrapper kept for existing call sites. A caller that needs more than one of
// them (buildMcpServer needs all three) should call getProfile once and derive
// locally — each wrapper is its own `select * from profiles` round trip, so
// chaining them multiplies an identical query by the number of preferences
// read.

// Whether in-chat widgets should be shown for this user. Defaults to true when
// no profile exists yet, or (for backward compatibility) when the column is
// absent — widgets are on for everyone until a user explicitly opts out.
export function widgetsEnabledFromProfile(
    profile: Profile | null | undefined,
): boolean {
    return profile?.widgets_enabled ?? true;
}

export async function getWidgetsEnabled(userId: string): Promise<boolean> {
    return widgetsEnabledFromProfile(await getProfile(userId));
}

// Whether alcohol should be surfaced for this user. Defaults to false when no
// profile exists yet, or when the column is absent — alcohol tracking is opt-in,
// so the fallback must be "off". Storage is unaffected: alcohol explicitly
// passed is always persisted, this only gates display.
//
// The `?? false` is not a stylistic default: flipping it turns the opt-in into
// an opt-out and starts surfacing alcohol — including the trace alcohol that
// third-party recipe exports carry — to users who never asked to see it, which
// is the documented harm this toggle exists to prevent.
export function alcoholTrackingEnabledFromProfile(
    profile: Profile | null | undefined,
): boolean {
    return profile?.alcohol_tracking_enabled ?? false;
}

export async function getAlcoholTrackingEnabled(
    userId: string,
): Promise<boolean> {
    return alcoholTrackingEnabledFromProfile(await getProfile(userId));
}

// Returns the user's saved drink-unit preference, or null if they have never
// chosen one. Display paths coalesce null to "us"; storage stays in grams of
// ethanol either way. The isDrinkUnit guard is load-bearing: the column is
// free-form text to the client, so anything unrecognised must degrade to "no
// preference" rather than flow into a Record<DrinkUnit, …> lookup as undefined.
export function preferredDrinkUnitFromProfile(
    profile: Profile | null | undefined,
): DrinkUnit | null {
    const unit = profile?.preferred_drink_unit;
    return isDrinkUnit(unit) ? unit : null;
}

export async function getPreferredDrinkUnit(
    userId: string,
): Promise<DrinkUnit | null> {
    return preferredDrinkUnitFromProfile(await getProfile(userId));
}

// Upsert the fields provided in `patch`, leaving other columns untouched. On
// first insert, an omitted column falls back to its DB default where one
// exists (widgets_enabled: true, alcohol_tracking_enabled: false); timezone,
// preferred_weight_unit and preferred_drink_unit have none and land as NULL,
// meaning "never chosen".
export async function upsertProfile(
    userId: string,
    patch: {
        timezone?: string;
        preferred_weight_unit?: WeightUnit | null;
        widgets_enabled?: boolean;
        alcohol_tracking_enabled?: boolean;
        preferred_drink_unit?: DrinkUnit | null;
        locale?: string;
        theme?: "light" | "dark" | null;
        accent_swatch?: string | null;
        nutrition_layout?: string[] | null;
    },
): Promise<Profile> {
    const payload: Record<string, unknown> = {
        user_id: userId,
        updated_at: new Date().toISOString(),
    };
    if (patch.timezone !== undefined) payload.timezone = patch.timezone;
    // null is meaningful here (clears the preference), so only skip `undefined`.
    if (patch.preferred_weight_unit !== undefined)
        payload.preferred_weight_unit = patch.preferred_weight_unit;
    if (patch.widgets_enabled !== undefined)
        payload.widgets_enabled = patch.widgets_enabled;
    if (patch.alcohol_tracking_enabled !== undefined)
        payload.alcohol_tracking_enabled = patch.alcohol_tracking_enabled;
    // null is meaningful here too (clears the preference).
    if (patch.preferred_drink_unit !== undefined)
        payload.preferred_drink_unit = patch.preferred_drink_unit;
    if (patch.locale !== undefined) payload.locale = patch.locale;
    if (patch.theme !== undefined) payload.theme = patch.theme;
    if (patch.accent_swatch !== undefined)
        payload.accent_swatch = patch.accent_swatch;
    if (patch.nutrition_layout !== undefined)
        payload.nutrition_layout = patch.nutrition_layout;

    const { data, error } = await getSupabase()
        .from("profiles")
        .upsert(payload, { onConflict: "user_id" })
        .select()
        .single();

    if (error) throw new Error(`Failed to save profile: ${error.message}`);
    return data as Profile;
}

export async function setNutritionLayout(
    userId: string,
    layout: string[],
): Promise<Profile> {
    return upsertProfile(userId, { nutrition_layout: layout });
}
