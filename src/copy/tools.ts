/** MCP tool identity catalog. mcp.test.ts pins tools/list against TOOLS
 * names and checks person-scoped tools carry optional user_id. */

export type CategoryId =
    | "logging-food-meals"
    | "reviewing-your-meals"
    | "water"
    | "weight"
    | "goals-progress"
    | "insights-trends"
    | "settings-account"
    | "fridge"
    | "grocery"
    | "recipes"
    | "rules";

export type BadgeKind =
    | "log"
    | "import"
    | "edit"
    | "setting"
    | "lookup"
    | "view"
    | "export"
    | "remove"
    | "widget";

export interface ToolParamIdentity {
    name: string;
    required: boolean;
}

export interface ToolIdentity {
    name: string;
    category: CategoryId;
    badges: BadgeKind[];
    params: ToolParamIdentity[];
    hasPhotoHint: boolean;
}

const TOOLS_BASE: ToolIdentity[] = [
    {
        name: "log_meal",
        category: "logging-food-meals",
        badges: ["log", "widget"],
        params: [
            { name: "description", required: true },
            { name: "meal_type", required: true },
            { name: "calories", required: false },
            { name: "protein_g", required: false },
            { name: "carbs_g", required: false },
            { name: "fat_g", required: false },
            { name: "fiber_g", required: false },
            { name: "sugar_g", required: false },
            { name: "alcohol_g", required: false },
            { name: "caffeine_mg", required: false },
            { name: "logged_at", required: false },
            { name: "notes", required: false },
            { name: "items", required: false },
            { name: "target_member", required: false },
        ],
        hasPhotoHint: true,
    },
    {
        name: "log_recipe_portion",
        category: "logging-food-meals",
        badges: ["log", "widget"],
        params: [
            { name: "recipe_id", required: true },
            { name: "portions", required: true },
            { name: "meal_type", required: false },
            { name: "logged_at", required: false },
            { name: "target_member", required: false },
        ],
        hasPhotoHint: false,
    },
    {
        name: "lookup_barcode",
        category: "logging-food-meals",
        badges: ["lookup"],
        params: [],
        hasPhotoHint: true,
    },
    {
        name: "start_meal_import",
        category: "logging-food-meals",
        badges: ["import", "widget"],
        params: [],
        hasPhotoHint: false,
    },
    {
        name: "bulk_import_meals",
        category: "logging-food-meals",
        badges: ["import"],
        params: [
            { name: "meals", required: true },
            { name: "expected_row_count", required: true },
            { name: "expected_total_kcal", required: false },
            { name: "dry_run", required: false },
            { name: "on_error", required: false },
            { name: "source_app", required: false },
            { name: "target_member", required: false },
        ],
        hasPhotoHint: false,
    },
    {
        name: "update_meal",
        category: "logging-food-meals",
        badges: ["edit", "widget"],
        params: [
            { name: "id", required: true },
            { name: "description", required: false },
            { name: "calories", required: false },
            { name: "protein_g", required: false },
            { name: "carbs_g", required: false },
            { name: "fat_g", required: false },
            { name: "fiber_g", required: false },
            { name: "sugar_g", required: false },
            { name: "alcohol_g", required: false },
            { name: "caffeine_mg", required: false },
            { name: "logged_at", required: false },
            { name: "notes", required: false },
            { name: "items", required: false },
            { name: "target_member", required: false },
        ],
        hasPhotoHint: false,
    },
    {
        name: "delete_meal",
        category: "logging-food-meals",
        badges: ["remove"],
        params: [
            { name: "id", required: true },
            { name: "target_member", required: false },
        ],
        hasPhotoHint: false,
    },
    {
        name: "search_meals",
        category: "reviewing-your-meals",
        badges: ["view"],
        params: [
            { name: "queries", required: true },
            { name: "days", required: false },
            { name: "limit", required: false },
        ],
        hasPhotoHint: false,
    },
    {
        name: "get_meals",
        category: "reviewing-your-meals",
        badges: ["view"],
        params: [
            { name: "date", required: false },
            { name: "from", required: false },
            { name: "to", required: false },
        ],
        hasPhotoHint: false,
    },
    {
        name: "export_all_data",
        category: "reviewing-your-meals",
        badges: ["export"],
        params: [],
        hasPhotoHint: false,
    },
    {
        name: "log_water",
        category: "water",
        badges: ["log"],
        params: [
            { name: "amount_ml", required: true },
            { name: "target_member", required: false },
        ],
        hasPhotoHint: false,
    },
    {
        name: "get_water",
        category: "water",
        badges: ["view"],
        params: [
            { name: "date", required: false },
            { name: "from", required: false },
            { name: "to", required: false },
        ],
        hasPhotoHint: false,
    },
    {
        name: "delete_water",
        category: "water",
        badges: ["remove"],
        params: [
            { name: "id", required: true },
            { name: "target_member", required: false },
        ],
        hasPhotoHint: false,
    },
    {
        name: "log_weight",
        category: "weight",
        badges: ["log"],
        params: [
            { name: "weight", required: true },
            { name: "target_member", required: false },
        ],
        hasPhotoHint: false,
    },
    {
        name: "update_weight",
        category: "weight",
        badges: ["edit"],
        params: [
            { name: "id", required: true },
            { name: "weight", required: false },
            { name: "logged_at", required: false },
            { name: "notes", required: false },
            { name: "target_member", required: false },
        ],
        hasPhotoHint: false,
    },
    {
        name: "delete_weight",
        category: "weight",
        badges: ["remove"],
        params: [
            { name: "id", required: true },
            { name: "target_member", required: false },
        ],
        hasPhotoHint: false,
    },
    {
        name: "get_weight",
        category: "weight",
        badges: ["view"],
        params: [
            { name: "date", required: false },
            { name: "from", required: false },
            { name: "to", required: false },
        ],
        hasPhotoHint: false,
    },
    {
        name: "get_weight_trends",
        category: "weight",
        badges: ["view", "widget"],
        params: [{ name: "days", required: false }],
        hasPhotoHint: false,
    },
    {
        name: "set_weight_unit",
        category: "weight",
        badges: ["setting"],
        params: [],
        hasPhotoHint: false,
    },
    {
        name: "set_nutrition_goals",
        category: "goals-progress",
        badges: ["setting"],
        params: [
            { name: "daily_calories", required: false },
            { name: "daily_protein_g", required: false },
            { name: "daily_carbs_g", required: false },
            { name: "daily_fat_g", required: false },
            { name: "daily_fiber_g", required: false },
            { name: "daily_sugar_g", required: false },
            { name: "daily_alcohol_g", required: false },
            { name: "daily_caffeine_mg", required: false },
            { name: "daily_water_ml", required: false },
            { name: "target_weight", required: false },
            { name: "target_member", required: false },
        ],
        hasPhotoHint: false,
    },
    {
        name: "get_goal_progress",
        category: "goals-progress",
        badges: ["view", "widget"],
        params: [],
        hasPhotoHint: false,
    },
    {
        name: "get_nutrition_summary",
        category: "goals-progress",
        badges: ["view", "widget"],
        params: [
            { name: "start_date", required: true },
            { name: "end_date", required: true },
        ],
        hasPhotoHint: false,
    },
    {
        name: "get_trends",
        category: "insights-trends",
        badges: ["view", "widget"],
        params: [{ name: "days", required: false }],
        hasPhotoHint: false,
    },
    {
        name: "get_meal_patterns",
        category: "insights-trends",
        badges: ["view"],
        params: [{ name: "days", required: false }],
        hasPhotoHint: false,
    },
    {
        name: "get_profile",
        category: "settings-account",
        badges: ["view"],
        params: [],
        hasPhotoHint: false,
    },
    {
        name: "set_timezone",
        category: "settings-account",
        badges: ["setting"],
        params: [],
        hasPhotoHint: false,
    },
    {
        name: "get_current_time",
        category: "settings-account",
        badges: ["view"],
        params: [],
        hasPhotoHint: false,
    },
    {
        name: "set_widget_display",
        category: "settings-account",
        badges: ["setting"],
        params: [{ name: "enabled", required: true }],
        hasPhotoHint: false,
    },
    {
        name: "set_alcohol_tracking",
        category: "settings-account",
        badges: ["setting"],
        params: [
            { name: "enabled", required: true },
            { name: "drink_unit", required: false },
        ],
        hasPhotoHint: false,
    },
    {
        name: "list_members",
        category: "settings-account",
        badges: ["lookup"],
        params: [],
        hasPhotoHint: false,
    },
    {
        name: "get_household_config",
        category: "settings-account",
        badges: ["view"],
        params: [],
        hasPhotoHint: false,
    },
    {
        name: "update_household_config",
        category: "settings-account",
        badges: ["setting"],
        params: [
            { name: "name", required: false },
            { name: "recipe_search_places", required: false },
            { name: "preferences", required: false },
        ],
        hasPhotoHint: false,
    },
    {
        name: "get_fridge",
        category: "fridge",
        badges: ["view", "widget"],
        params: [],
        hasPhotoHint: false,
    },
    {
        name: "add_fridge_location",
        category: "fridge",
        badges: ["log"],
        params: [{ name: "name", required: true }],
        hasPhotoHint: false,
    },
    {
        name: "delete_fridge_location",
        category: "fridge",
        badges: ["remove"],
        params: [{ name: "id", required: true }],
        hasPhotoHint: false,
    },
    {
        name: "add_fridge_item",
        category: "fridge",
        badges: ["log"],
        params: [
            { name: "location_id", required: true },
            { name: "kind", required: true },
            { name: "amount", required: true },
            { name: "name", required: false },
            { name: "barcode", required: false },
            { name: "food_id", required: false },
            { name: "unit", required: false },
        ],
        hasPhotoHint: true,
    },
    {
        name: "update_fridge_item",
        category: "fridge",
        badges: ["edit"],
        params: [
            { name: "id", required: true },
            { name: "amount", required: false },
            { name: "unit", required: false },
            { name: "location_id", required: false },
        ],
        hasPhotoHint: false,
    },
    {
        name: "delete_fridge_item",
        category: "fridge",
        badges: ["remove"],
        params: [{ name: "id", required: true }],
        hasPhotoHint: false,
    },
    {
        name: "list_expiring",
        category: "fridge",
        badges: ["view"],
        params: [{ name: "days", required: false }],
        hasPhotoHint: false,
    },
    {
        name: "eat_fridge_item",
        category: "fridge",
        badges: ["log"],
        params: [
            { name: "id", required: true },
            { name: "amount", required: false },
            { name: "meal_type", required: false },
            { name: "member_id", required: false },
        ],
        hasPhotoHint: false,
    },
    {
        name: "discard_fridge_item",
        category: "fridge",
        badges: ["remove"],
        params: [
            { name: "id", required: true },
            { name: "amount", required: false },
        ],
        hasPhotoHint: false,
    },
    {
        name: "list_grocery_lines",
        category: "grocery",
        badges: ["view", "widget"],
        params: [],
        hasPhotoHint: false,
    },
    {
        name: "add_grocery_line",
        category: "grocery",
        badges: ["log"],
        params: [
            { name: "store_id", required: true },
            { name: "kind", required: true },
            { name: "amount", required: true },
            { name: "name", required: false },
            { name: "barcode", required: false },
            { name: "food_id", required: false },
            { name: "unit", required: false },
            { name: "section_id", required: false },
        ],
        hasPhotoHint: true,
    },
    {
        name: "check_grocery_line",
        category: "grocery",
        badges: ["edit"],
        params: [
            { name: "id", required: true },
            { name: "checked", required: false },
        ],
        hasPhotoHint: false,
    },
    {
        name: "delete_grocery_line",
        category: "grocery",
        badges: ["remove"],
        params: [{ name: "id", required: true }],
        hasPhotoHint: false,
    },
    {
        name: "clear_checked_grocery_lines",
        category: "grocery",
        badges: ["remove"],
        params: [],
        hasPhotoHint: false,
    },
    {
        name: "put_away_grocery_lines",
        category: "grocery",
        badges: ["log"],
        params: [
            { name: "line_ids", required: true },
            { name: "location_id", required: false },
        ],
        hasPhotoHint: false,
    },
    {
        name: "list_recipes",
        category: "recipes",
        badges: ["view"],
        params: [
            { name: "tag", required: false },
            { name: "can_make_now", required: false },
            { name: "safe_for", required: false },
        ],
        hasPhotoHint: false,
    },
    {
        name: "get_recipe",
        category: "recipes",
        badges: ["view"],
        params: [
            { name: "id", required: true },
            { name: "member_id", required: false },
        ],
        hasPhotoHint: false,
    },
    {
        name: "create_recipe",
        category: "recipes",
        badges: ["log"],
        params: [
            { name: "name", required: true },
            { name: "yield_portions", required: true },
            { name: "instructions", required: false },
            { name: "source_url", required: false },
            { name: "tags", required: false },
            { name: "notes", required: false },
            { name: "prep_minutes", required: false },
            { name: "cook_minutes", required: false },
        ],
        hasPhotoHint: false,
    },
    {
        name: "add_recipe_ingredient",
        category: "recipes",
        badges: ["log"],
        params: [
            { name: "recipe_id", required: true },
            { name: "amount", required: true },
            { name: "name", required: false },
            { name: "barcode", required: false },
            { name: "food_id", required: false },
            { name: "unit", required: false },
        ],
        hasPhotoHint: true,
    },
    {
        name: "set_recipe_portion",
        category: "recipes",
        badges: ["setting"],
        params: [
            { name: "recipe_id", required: true },
            { name: "member_id", required: true },
            { name: "portion_count", required: true },
        ],
        hasPhotoHint: false,
    },
    {
        name: "delete_recipe",
        category: "recipes",
        badges: ["remove"],
        params: [{ name: "id", required: true }],
        hasPhotoHint: false,
    },
    {
        name: "add_recipe_to_grocery",
        category: "recipes",
        badges: ["log"],
        params: [
            { name: "recipe_id", required: true },
            { name: "store_id", required: true },
            { name: "member_ids", required: false },
            { name: "total_portions", required: false },
        ],
        hasPhotoHint: false,
    },
    {
        name: "cook_recipe",
        category: "recipes",
        badges: ["log"],
        params: [
            { name: "recipe_id", required: true },
            { name: "portions_by_member", required: false },
            { name: "total_portions", required: false },
            { name: "deduct_stock", required: false },
            { name: "log_meals", required: false },
            { name: "meal_type", required: false },
        ],
        hasPhotoHint: false,
    },
    {
        name: "update_recipe",
        category: "recipes",
        badges: ["edit"],
        params: [
            { name: "id", required: true },
            { name: "name", required: false },
            { name: "yield_portions", required: false },
            { name: "instructions", required: false },
            { name: "source_url", required: false },
            { name: "tags", required: false },
            { name: "notes", required: false },
            { name: "prep_minutes", required: false },
            { name: "cook_minutes", required: false },
        ],
        hasPhotoHint: false,
    },
    {
        name: "update_recipe_ingredient",
        category: "recipes",
        badges: ["edit"],
        params: [
            { name: "recipe_id", required: true },
            { name: "ingredient_id", required: true },
            { name: "amount", required: false },
            { name: "unit", required: false },
            { name: "note", required: false },
        ],
        hasPhotoHint: false,
    },
    {
        name: "remove_recipe_ingredient",
        category: "recipes",
        badges: ["remove"],
        params: [
            { name: "recipe_id", required: true },
            { name: "ingredient_id", required: true },
        ],
        hasPhotoHint: false,
    },
    {
        name: "reorder_recipe_ingredients",
        category: "recipes",
        badges: ["edit"],
        params: [
            { name: "recipe_id", required: true },
            { name: "ingredient_ids", required: true },
        ],
        hasPhotoHint: false,
    },
    {
        name: "import_recipe_from_text",
        category: "recipes",
        badges: ["import"],
        params: [
            { name: "text", required: true },
            { name: "source_url", required: false },
            { name: "name", required: false },
            { name: "yield_portions", required: false },
            { name: "ingredients", required: false },
            { name: "tags", required: false },
            { name: "notes", required: false },
            { name: "prep_minutes", required: false },
            { name: "cook_minutes", required: false },
        ],
        hasPhotoHint: false,
    },
    {
        name: "get_household_rules",
        category: "rules",
        badges: ["view"],
        params: [],
        hasPhotoHint: false,
    },
    {
        name: "set_household_rules",
        category: "rules",
        badges: ["setting"],
        params: [
            { name: "store_rules", required: false },
            { name: "person", required: false },
        ],
        hasPhotoHint: false,
    },
    {
        name: "search_food",
        category: "logging-food-meals",
        badges: ["lookup"],
        params: [{ name: "query", required: true }],
        hasPhotoHint: false,
    },
    {
        name: "get_food",
        category: "logging-food-meals",
        badges: ["view"],
        params: [{ name: "food_id", required: true }],
        hasPhotoHint: false,
    },
    {
        name: "upsert_food",
        category: "logging-food-meals",
        badges: ["edit"],
        params: [
            { name: "food_id", required: false },
            { name: "kind", required: false },
            { name: "name", required: false },
            { name: "brand", required: false },
            { name: "default_unit", required: false },
            { name: "grams_per_each", required: false },
            { name: "grams_per_ml", required: false },
            { name: "calories", required: false },
            { name: "protein_g", required: false },
            { name: "carbs_g", required: false },
            { name: "fat_g", required: false },
            { name: "fiber_g", required: false },
            { name: "sugar_g", required: false },
            { name: "alcohol_g", required: false },
            { name: "caffeine_mg", required: false },
            { name: "nutrition_source", required: false },
            { name: "allergens", required: false },
            { name: "aliases", required: false },
            { name: "archived", required: false },
        ],
        hasPhotoHint: false,
    },
    {
        name: "merge_foods",
        category: "logging-food-meals",
        badges: ["edit"],
        params: [
            { name: "keep_id", required: true },
            { name: "drop_id", required: true },
        ],
        hasPhotoHint: false,
    },
    {
        name: "delete_account",
        category: "settings-account",
        badges: ["remove"],
        params: [],
        hasPhotoHint: false,
    },
];

export const HOUSEHOLD_SCOPED_TOOL_NAMES = [
    "list_members",
    "get_household_config",
    "update_household_config",
    "get_fridge",
    "add_fridge_location",
    "delete_fridge_location",
    "add_fridge_item",
    "update_fridge_item",
    "delete_fridge_item",
    "list_expiring",
    "eat_fridge_item",
    "discard_fridge_item",
    "list_grocery_lines",
    "add_grocery_line",
    "check_grocery_line",
    "delete_grocery_line",
    "clear_checked_grocery_lines",
    "put_away_grocery_lines",
    "list_recipes",
    "get_recipe",
    "create_recipe",
    "add_recipe_ingredient",
    "set_recipe_portion",
    "delete_recipe",
    "add_recipe_to_grocery",
    "cook_recipe",
    "update_recipe",
    "update_recipe_ingredient",
    "remove_recipe_ingredient",
    "reorder_recipe_ingredients",
    "import_recipe_from_text",
    "get_household_rules",
    "set_household_rules",
    "search_food",
    "get_food",
    "upsert_food",
    "merge_foods",
] as const;

export const NUTRITION_WRITE_TOOL_NAMES = [
    "log_meal",
    "log_recipe_portion",
    "update_meal",
    "delete_meal",
    "bulk_import_meals",
    "log_water",
    "delete_water",
    "log_weight",
    "update_weight",
    "delete_weight",
    "set_nutrition_goals",
] as const;

export const OAUTH_ONLY_TOOL_NAMES = ["delete_account"] as const;

const PERSON_USER_ID_PARAM: ToolParamIdentity = {
    name: "user_id",
    required: false,
};

export const TOOLS: ToolIdentity[] = TOOLS_BASE.map((tool) => {
    if (
        (HOUSEHOLD_SCOPED_TOOL_NAMES as readonly string[]).includes(
            tool.name,
        ) ||
        (OAUTH_ONLY_TOOL_NAMES as readonly string[]).includes(tool.name)
    ) {
        return tool;
    }
    return {
        ...tool,
        params: [...tool.params, PERSON_USER_ID_PARAM],
    };
});
