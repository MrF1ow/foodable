import { type McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { liveRulesStore } from "../../db/rules.js";
import { liveSettingsStore } from "../../db/settings.js";
import { listHouseholdMembers } from "../../db/household.js";
import { withAnalytics } from "../../analytics.js";
import {
    addAllergen,
    addDislike,
    addPersonRule,
    addStoreRule,
} from "../../domain/rules.js";
import { ALLERGEN_SCHEMA, idTag } from "../shared.js";
import type { ToolContext } from "../shared.js";

const RULE_BODY = z.object({
    id: z.string(),
    body: z.string(),
});

const ALLERGEN_ROW = z.object({
    allergen: z.string(),
    other_label: z.string().nullable(),
});

export function registerRulesTools(server: McpServer, ctx: ToolContext) {
    const { callerHouseholdId, requireHouseholdMemberId, analytics } = ctx;
    server.registerTool(
        "get_household_rules",
        {
            title: "Get Household Rules",
            description:
                "List store rules plus each member's free-text rules, allergens, and dislikes. Honor these as constraints before proposing grocery lines, recipes, or meals.",
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            outputSchema: z.object({
                store_rules: z.array(
                    z.object({
                        store_id: z.string(),
                        store_name: z.string(),
                        id: z.string(),
                        body: z.string(),
                    }),
                ),
                person: z.array(
                    z.object({
                        user_id: z.string(),
                        display_name: z.string(),
                        rules: z.array(RULE_BODY),
                        allergens: z.array(ALLERGEN_ROW),
                        dislikes: z.array(z.string()),
                    }),
                ),
            }),
        },
        async () =>
            withAnalytics(
                "get_household_rules",
                async () => {
                    const householdId = await callerHouseholdId();
                    const rulesStore = liveRulesStore();
                    const [members, stores] = await Promise.all([
                        listHouseholdMembers(householdId),
                        liveSettingsStore().listStores(householdId),
                    ]);
                    const store_rules: Array<{
                        store_id: string;
                        store_name: string;
                        id: string;
                        body: string;
                    }> = [];
                    for (const store of stores) {
                        const rows = await rulesStore.listStoreRules(store.id);
                        for (const rule of rows) {
                            store_rules.push({
                                store_id: store.id,
                                store_name: store.name,
                                id: rule.id,
                                body: rule.body,
                            });
                        }
                    }
                    const person = [];
                    for (const member of members) {
                        const [rules, allergens, dislikes] = await Promise.all([
                            rulesStore.listPersonRules(
                                householdId,
                                member.userId,
                            ),
                            rulesStore.listAllergens(
                                householdId,
                                member.userId,
                            ),
                            rulesStore.listDislikes(householdId, member.userId),
                        ]);
                        person.push({
                            user_id: member.userId,
                            display_name: member.displayName,
                            rules: rules.map((rule) => ({
                                id: rule.id,
                                body: rule.body,
                            })),
                            allergens: allergens.map((row) => ({
                                allergen: row.allergen,
                                other_label: row.otherLabel,
                            })),
                            dislikes: dislikes.map((row) => row.displayName),
                        });
                    }
                    const payload = { store_rules, person };
                    const storeText =
                        store_rules.length === 0
                            ? "No store rules."
                            : store_rules
                                  .map(
                                      (rule) =>
                                          `${rule.store_name}: ${rule.body}${idTag(rule.store_id, "store_id")}`,
                                  )
                                  .join("\n");
                    const personText =
                        person.length === 0
                            ? "No members."
                            : person
                                  .map((row) => {
                                      const bits = [
                                          row.display_name,
                                          row.rules.length
                                              ? `rules: ${row.rules.map((r) => r.body).join("; ")}`
                                              : "no rules",
                                          row.allergens.length
                                              ? `allergens: ${row.allergens
                                                    .map((a) =>
                                                        a.other_label
                                                            ? `${a.allergen} (${a.other_label})`
                                                            : a.allergen,
                                                    )
                                                    .join(", ")}`
                                              : "no allergens",
                                          row.dislikes.length
                                              ? `dislikes: ${row.dislikes.join(", ")}`
                                              : "no dislikes",
                                      ];
                                      return (
                                          bits.join(" — ") +
                                          idTag(row.user_id, "user_id")
                                      );
                                  })
                                  .join("\n");
                    return {
                        content: [
                            {
                                type: "text",
                                text: `${storeText}\n\n${personText}`,
                            },
                        ],
                        structuredContent: payload,
                    };
                },
                analytics,
            ),
    );

    server.registerTool(
        "set_household_rules",
        {
            title: "Set Household Rules",
            description:
                "Add store rules and/or per-person rules, allergens, and dislikes. Each array item is appended (it does not replace the existing list). Pass store_rules and/or person; omit a nested field to leave that list unchanged.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            inputSchema: z.object({
                store_rules: z
                    .array(
                        z.object({
                            store_id: z.string(),
                            body: z.string().min(1),
                        }),
                    )
                    .optional(),
                person: z
                    .array(
                        z.object({
                            user_id: z.string(),
                            rules: z.array(z.string().min(1)).optional(),
                            allergens: z
                                .array(
                                    z.object({
                                        allergen: ALLERGEN_SCHEMA,
                                        other_label: z.string().optional(),
                                    }),
                                )
                                .optional(),
                            dislikes: z.array(z.string().min(1)).optional(),
                        }),
                    )
                    .optional(),
            }),
            outputSchema: z.object({
                added: z.object({
                    store_rules: z.number(),
                    person_rules: z.number(),
                    allergens: z.number(),
                    dislikes: z.number(),
                }),
            }),
        },
        async (args) =>
            withAnalytics(
                "set_household_rules",
                async () => {
                    if (!args.store_rules?.length && !args.person?.length) {
                        throw new Error(
                            "Pass store_rules and/or person with at least one change.",
                        );
                    }
                    const householdId = await callerHouseholdId();
                    const store = liveRulesStore();
                    const added = {
                        store_rules: 0,
                        person_rules: 0,
                        allergens: 0,
                        dislikes: 0,
                    };
                    for (const rule of args.store_rules ?? []) {
                        await addStoreRule(store, {
                            householdId,
                            storeId: rule.store_id,
                            body: rule.body,
                        });
                        added.store_rules += 1;
                    }
                    for (const row of args.person ?? []) {
                        await requireHouseholdMemberId(row.user_id);
                        for (const body of row.rules ?? []) {
                            await addPersonRule(store, {
                                householdId,
                                userId: row.user_id,
                                body,
                            });
                            added.person_rules += 1;
                        }
                        for (const allergen of row.allergens ?? []) {
                            await addAllergen(store, {
                                householdId,
                                userId: row.user_id,
                                allergen: allergen.allergen,
                                otherLabel: allergen.other_label,
                            });
                            added.allergens += 1;
                        }
                        for (const displayName of row.dislikes ?? []) {
                            await addDislike(store, {
                                householdId,
                                userId: row.user_id,
                                displayName,
                            });
                            added.dislikes += 1;
                        }
                    }
                    const bits = [];
                    if (added.store_rules)
                        bits.push(`${added.store_rules} store rule(s)`);
                    if (added.person_rules)
                        bits.push(`${added.person_rules} person rule(s)`);
                    if (added.allergens)
                        bits.push(`${added.allergens} allergen(s)`);
                    if (added.dislikes)
                        bits.push(`${added.dislikes} dislike(s)`);
                    return {
                        content: [
                            {
                                type: "text",
                                text:
                                    bits.length === 0
                                        ? "No rules added."
                                        : `Stored ${bits.join(", ")}.`,
                            },
                        ],
                        structuredContent: { added },
                    };
                },
                analytics,
            ),
    );
}
