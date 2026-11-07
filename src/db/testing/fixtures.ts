import type { SQL } from "bun";

export type SeededHousehold = {
    userId: string;
    householdId: string;
};

export async function seedHousehold(sql: SQL): Promise<SeededHousehold> {
    const userId = crypto.randomUUID();
    const householdId = crypto.randomUUID();
    const email = `test-${userId}@foodable.test`;
    await sql`
        insert into auth.users (id, email)
        values (${userId}, ${email})
    `;
    await sql`
        insert into public.households (id, name)
        values (${householdId}, ${"Test household"})
    `;
    await sql`
        insert into public.household_members (
            household_id,
            user_id,
            role,
            display_name
        )
        values (${householdId}, ${userId}, ${"owner"}, ${"Owner"})
    `;
    return { userId, householdId };
}

export async function seedGroceryStore(
    sql: SQL,
    householdId: string,
    name = "Main store",
): Promise<string> {
    const id = crypto.randomUUID();
    await sql`
        insert into public.grocery_stores (id, household_id, name, sort_order)
        values (${id}, ${householdId}, ${name}, ${0})
    `;
    return id;
}

export async function seedGrocerySection(
    sql: SQL,
    householdId: string,
    storeId: string,
    name = "Produce",
): Promise<string> {
    const id = crypto.randomUUID();
    await sql`
        insert into public.grocery_sections (
            id,
            household_id,
            store_id,
            name,
            sort_order,
            hidden,
            is_other
        )
        values (${id}, ${householdId}, ${storeId}, ${name}, ${0}, ${false}, ${false})
    `;
    return id;
}

export async function seedFridgeLocation(
    sql: SQL,
    householdId: string,
    name = "Fridge",
): Promise<string> {
    const id = crypto.randomUUID();
    await sql`
        insert into public.fridge_locations (id, household_id, name, sort_order)
        values (${id}, ${householdId}, ${name}, ${0})
    `;
    return id;
}

export async function seedFood(
    sql: SQL,
    householdId: string,
    opts?: {
        name?: string;
        kind?: "food" | "supply";
        normalizedName?: string;
    },
): Promise<string> {
    const id = crypto.randomUUID();
    const name = opts?.name ?? "Eggs";
    const kind = opts?.kind ?? "food";
    const normalizedName = opts?.normalizedName ?? name.toLowerCase();
    await sql`
        insert into public.foods (
            id,
            household_id,
            kind,
            name,
            normalized_name,
            default_unit,
            allergens
        )
        values (
            ${id},
            ${householdId},
            ${kind},
            ${name},
            ${normalizedName},
            ${"g"},
            ${sql.array([], "text")}
        )
    `;
    return id;
}

export async function seedFridgeItem(
    sql: SQL,
    householdId: string,
    locationId: string,
    foodId: string,
    opts?: { displayName?: string; amount?: number; unit?: string },
): Promise<string> {
    const displayName = opts?.displayName ?? "Contract fridge item";
    const amount = opts?.amount ?? 100;
    const unit = opts?.unit ?? "g";
    const [row] = await sql`
        insert into public.fridge_items (
            household_id,
            location_id,
            kind,
            display_name,
            amount,
            unit,
            food_id
        )
        values (
            ${householdId},
            ${locationId},
            ${"food"},
            ${displayName},
            ${amount},
            ${unit},
            ${foodId}
        )
        returning id
    `;
    return String(row.id);
}
