import { afterEach, expect, test } from "bun:test";
import type { SQL } from "bun";
import { liveFoodsStore } from "./foods.js";
import { sampleFood } from "./contract/helpers.js";
import { describeDb } from "./testing/pg.js";
import { seedHousehold } from "./testing/fixtures.js";
import { findPgBin } from "./testing/pg-temp.js";
import { setSqlForTests } from "./sql.js";
import type { FoodQuality } from "../domain/foods.js";

const pgAvailable = await findPgBin();

function fullQuality(fetchedAt: string): FoodQuality {
    return {
        nutriscoreGrade: "e",
        novaGroup: 4,
        ecoscoreGrade: "a-plus",
        additives: [
            { tag: "en:e250", risk: "high" },
            { tag: "en:e150d", risk: "none" },
            { tag: "en:unknown-additive", risk: null },
        ],
        allergensTags: ["en:gluten"],
        tracesTags: [],
        ingredientsAnalysisTags: ["en:vegan"],
        labelsTags: ["en:organic"],
        fetchedAt,
    };
}

async function rawQuality(sql: SQL, id: string) {
    const [row] = await sql`
        select
            nutriscore_grade,
            nova_group,
            ecoscore_grade,
            additives_tags,
            allergens_tags,
            traces_tags,
            ingredients_analysis_tags,
            labels_tags,
            off_quality_fetched_at,
            cardinality(additives_tags) as additives_len,
            additives_tags is null as additives_null
        from public.foods
        where id = ${id}
    `;
    return row;
}

describeDb(pgAvailable !== null, "foods quality columns", (getCtx) => {
    afterEach(() => setSqlForTests(null));

    test("round-trip full quality, null quality, and empty tag arrays", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const { householdId } = await seedHousehold(sql);
        const store = liveFoodsStore();
        const fetched = "2026-11-07T15:00:00.000Z";

        const full = sampleFood(householdId, {
            name: "Cola full",
            normalizedName: "cola full",
            offQuality: fullQuality(fetched),
        });
        const savedFull = await store.insertFood(full);
        expect(savedFull.offQuality?.additives?.length).toBe(3);
        expect(savedFull.offQuality?.additives?.[0]?.risk).toBe("high");
        expect(savedFull.offQuality?.additives?.[1]?.risk).toBe("none");
        expect(savedFull.offQuality?.additives?.[2]?.risk).toBeNull();
        expect(new Date(savedFull.offQuality!.fetchedAt).toISOString()).toBe(
            new Date(fetched).toISOString(),
        );
        const rawFull = await rawQuality(sql, savedFull.id);
        expect(rawFull.additives_len).toBe(3);
        expect(rawFull.additives_tags).toEqual([
            "en:e250",
            "en:e150d",
            "en:unknown-additive",
        ]);
        expect(rawFull.traces_tags).toEqual([]);
        expect(
            new Date(String(rawFull.off_quality_fetched_at)).toISOString(),
        ).toBe(fetched);

        const emptyTags = sampleFood(householdId, {
            name: "Plain empty tags",
            normalizedName: "plain empty tags",
            offQuality: {
                nutriscoreGrade: null,
                novaGroup: null,
                ecoscoreGrade: null,
                additives: [],
                allergensTags: [],
                tracesTags: [],
                ingredientsAnalysisTags: [],
                labelsTags: [],
                fetchedAt: fetched,
            },
        });
        const savedEmpty = await store.insertFood(emptyTags);
        const rawEmpty = await rawQuality(sql, savedEmpty.id);
        expect(rawEmpty.additives_len).toBe(0);
        expect(rawEmpty.traces_tags).toEqual([]);

        const nullQ = sampleFood(householdId, {
            name: "Manual no quality",
            normalizedName: "manual no quality",
            offQuality: null,
        });
        const savedNull = await store.insertFood(nullQ);
        const rawNull = await rawQuality(sql, savedNull.id);
        expect(rawNull.additives_null).toBe(true);
        expect(rawNull.off_quality_fetched_at).toBeNull();
        expect(savedNull.offQuality).toBeNull();
    });

    test("updateFoodRow clears tag arrays back to null", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const { householdId } = await seedHousehold(sql);
        const store = liveFoodsStore();
        const fetched = "2026-11-07T15:00:00.000Z";
        const row = await store.insertFood(
            sampleFood(householdId, {
                name: "Snack tags",
                normalizedName: "snack tags",
                offQuality: {
                    nutriscoreGrade: "c",
                    novaGroup: 2,
                    ecoscoreGrade: null,
                    additives: null,
                    allergensTags: ["en:milk"],
                    tracesTags: null,
                    ingredientsAnalysisTags: null,
                    labelsTags: null,
                    fetchedAt: fetched,
                },
            }),
        );
        const cleared = await store.updateFoodRow({
            ...row,
            offQuality: {
                ...(row.offQuality ?? offQualityBlank(fetched)),
                allergensTags: null,
            },
        });
        expect(cleared?.offQuality?.allergensTags).toBeNull();
        const raw = await rawQuality(sql, row.id);
        expect(raw.allergens_tags).toBeNull();
    });

    test("updateFoodRow round-trip and check constraints", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const { householdId } = await seedHousehold(sql);
        const store = liveFoodsStore();
        const row = await store.insertFood(
            sampleFood(householdId, {
                name: "Snack quality",
                normalizedName: "snack quality",
            }),
        );
        const updated = await store.updateFoodRow({
            ...row,
            offQuality: fullQuality("2026-11-08T10:00:00.000Z"),
        });
        expect(updated?.offQuality?.novaGroup).toBe(4);

        let badGrade = false;
        try {
            await sql`
                update public.foods set nutriscore_grade = ${"unknown"}
                where id = ${row.id}
            `;
        } catch {
            badGrade = true;
        }
        expect(badGrade).toBe(true);

        let badNova = false;
        try {
            await sql`
                update public.foods set nova_group = ${5}
                where id = ${row.id}
            `;
        } catch {
            badNova = true;
        }
        expect(badNova).toBe(true);
    });

    test("setFoodQuality touches only quality columns", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const { householdId } = await seedHousehold(sql);
        const store = liveFoodsStore();
        const row = await store.insertFood(
            sampleFood(householdId, {
                name: "Untouched name",
                normalizedName: "untouched name",
                calories: 42,
            }),
        );
        await store.updateFoodRow({
            ...row,
            name: "Renamed elsewhere",
            normalizedName: "renamed elsewhere",
            calories: 99,
        });
        const fetched = "2026-11-09T18:00:00.000Z";
        const updated = await store.setFoodQuality(
            householdId,
            row.id,
            fullQuality(fetched),
        );
        expect(updated?.offQuality?.novaGroup).toBe(4);
        expect(new Date(updated!.offQuality!.fetchedAt).toISOString()).toBe(
            new Date(fetched).toISOString(),
        );
        expect(updated?.name).toBe("Renamed elsewhere");
        expect(updated?.calories).toBe(99);

        const [raw] = await sql`
            select name, calories, archived_at, off_quality_fetched_at
            from public.foods
            where id = ${row.id}
        `;
        expect(raw.name).toBe("Renamed elsewhere");
        expect(Number(raw.calories)).toBe(99);
        expect(raw.archived_at).toBeNull();
        expect(new Date(String(raw.off_quality_fetched_at)).toISOString()).toBe(
            fetched,
        );

        const older = await store.setFoodQuality(
            householdId,
            row.id,
            fullQuality("2026-11-08T10:00:00.000Z"),
        );
        expect(older).toBeNull();

        const archiveStamp = "2026-11-10T10:00:00.000Z";
        const afterQuality = (await store.getFood(householdId, row.id))!;
        await store.updateFoodRow({
            ...afterQuality,
            archivedAt: archiveStamp,
        });
        const archived = await store.setFoodQuality(
            householdId,
            row.id,
            fullQuality("2026-11-11T10:00:00.000Z"),
        );
        expect(archived).toBeNull();
    });

    test("setFoodQuality onlyIfUnset writes a miss stamp once, never over data", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const { householdId } = await seedHousehold(sql);
        const store = liveFoodsStore();
        const blank = await store.insertFood(
            sampleFood(householdId, {
                name: "Unknown product",
                normalizedName: "unknown product",
            }),
        );
        const stamp = "2026-11-12T10:00:00.000Z";
        const stamped = await store.setFoodQuality(
            householdId,
            blank.id,
            offQualityBlank(stamp),
            { onlyIfUnset: true },
        );
        expect(stamped?.offQuality?.nutriscoreGrade).toBeNull();
        const [raw] = await sql`
            select additives_tags is null as additives_null,
                   labels_tags is null as labels_null
            from public.foods where id = ${blank.id}
        `;
        expect(raw.additives_null).toBe(true);
        expect(raw.labels_null).toBe(true);

        const withData = await store.insertFood(
            sampleFood(householdId, {
                name: "Known product",
                normalizedName: "known product",
                offQuality: fullQuality("2026-11-01T10:00:00.000Z"),
            }),
        );
        const skipped = await store.setFoodQuality(
            householdId,
            withData.id,
            offQualityBlank(stamp),
            { onlyIfUnset: true },
        );
        expect(skipped).toBeNull();
        const kept = await store.getFood(householdId, withData.id);
        expect(kept?.offQuality?.nutriscoreGrade).toBe("e");
    });
});

function offQualityBlank(fetchedAt: string): FoodQuality {
    return {
        nutriscoreGrade: null,
        novaGroup: null,
        ecoscoreGrade: null,
        additives: null,
        allergensTags: null,
        tracesTags: null,
        ingredientsAnalysisTags: null,
        labelsTags: null,
        fetchedAt,
    };
}
