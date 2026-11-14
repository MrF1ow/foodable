import { FRIDGE_ADMIN_TOOL_NAMES } from "./fridge-admin.js";
import { GROCERY_ADMIN_TOOL_NAMES } from "./grocery-admin.js";

/**
 * The four kitchen tools behind `mcp-household-admin`, in the order they are
 * registered (the fridge pair first, then the grocery pair).
 */
export const KITCHEN_ADMIN_TOOL_NAMES = [
    ...FRIDGE_ADMIN_TOOL_NAMES,
    ...GROCERY_ADMIN_TOOL_NAMES,
] as const;
