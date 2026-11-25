/**
 * The design's Calorie gauge (FigCraft 381807): a half ring with the calories
 * left in the middle. The ring is drawn in SVG: a track, and the day's protein,
 * carbs and fat as arcs from the left, together as long as the share of the
 * target already eaten.
 *
 * Numbers are inputs. An unknown eaten amount shows a dash and only the
 * track, never a zero. With the eaten amount known and no target, the figure is
 * what was eaten ("kcal eaten") beside the note that there is no goal, and the
 * ring stays a bare track. Past the target the ring is full and the text says
 * "over". The ring is decorative (`aria-hidden`); the figures are real text, and
 * a spoken line says what was eaten.
 *
 * Styles: `public/app/v2/nutrition-display.css`.
 */
import { valueText } from "./card.js";
import { cls, esc, raw, srOnly, type Html } from "./html.js";

export type CalorieGaugeOptions = {
    /** Calories eaten; null is unknown. */
    consumed: number | null;
    /** The calorie goal; null, or one that rounds below 1, means there is none. */
    target: number | null;
    /** Calories each macro contributed; they split the eaten arc. */
    protein?: number | null;
    carbs?: number | null;
    fat?: number | null;
    className?: string;
};

// The design's box: 196 x 103.5, a half circle of radius 92.5 drawn with an
// 11 px stroke, centred on (98, 98).
const CX = 98;
const CY = 98;
const R = 92.5;
const TRACK = `M5.5 98A92.5 92.5 0 0 1 190.5 98`;

const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** The point `deg` degrees round the ring, 0 at the left end, 180 at the right. */
function point(deg: number): string {
    const rad = (deg * Math.PI) / 180;
    return `${(CX - R * Math.cos(rad)).toFixed(2)} ${(CY - R * Math.sin(rad)).toFixed(2)}`;
}

function arc(kind: string, from: number, to: number): string {
    return `<path class="fd-calorie-gauge__arc fd-calorie-gauge__arc--${kind}" d="M${point(from)}A${R} ${R} 0 0 1 ${point(to)}"/>`;
}

const positive = (n: number | null | undefined): n is number =>
    typeof n === "number" && Number.isFinite(n) && n > 0;

/** A goal that rounds below 1 would print "0" and is no goal at all. */
const usableTarget = (n: number | null | undefined): n is number =>
    positive(n) && Math.round(n) >= 1;

export function calorieGauge(opts: CalorieGaugeOptions): Html {
    const known =
        typeof opts.consumed === "number" &&
        Number.isFinite(opts.consumed) &&
        opts.consumed >= 0 &&
        usableTarget(opts.target);
    const consumed = known ? opts.consumed! : 0;
    const target = known ? opts.target! : 0;
    const share = known ? Math.min(1, Math.max(0, consumed / target)) : 0;
    // The text is worked out from the rounded figures, so "over" never sits
    // beside a spoken line that says the target was met.
    // `+ 0` turns a negative zero (`-0 >= 0` passes the check above) into 0, which
    // Intl would otherwise print as "-0".
    const eaten = Math.round(consumed) + 0;
    // Eaten known, no goal: the day's total still shows, without a "left".
    const eatenOnly =
        !known &&
        typeof opts.consumed === "number" &&
        Number.isFinite(opts.consumed) &&
        opts.consumed >= 0 &&
        !usableTarget(opts.target);
    const eatenNoGoal = eatenOnly ? Math.round(opts.consumed!) + 0 : 0;
    const goal = Math.round(target);
    const over = known && eaten > goal;

    const parts: [string, number][] = [];
    for (const [kind, kcal] of [
        ["protein", opts.protein],
        ["carbs", opts.carbs],
        ["fat", opts.fat],
    ] as const) {
        if (positive(kcal)) parts.push([kind, kcal]);
    }
    const total = parts.reduce((sum, p) => sum + p[1], 0);
    const segments: [string, number][] =
        total > 0
            ? parts.map(([kind, kcal]) => [kind, (kcal / total) * share * 180])
            : share > 0
              ? [["calories", share * 180]]
              : [];

    // Drawn from the last to the first, so each round end rests on the next arc.
    let at = 0;
    const spans = segments.map(([kind, deg]) => {
        const span = { kind, from: at, to: at + deg };
        at += deg;
        return span;
    });
    const arcs = spans
        .filter((s) => s.to - s.from >= 0.5)
        .reverse()
        .map((s) => arc(s.kind, s.from, s.to))
        .join("");

    const figure = valueText(
        known
            ? number.format(Math.abs(goal - eaten))
            : eatenOnly
              ? number.format(eatenNoGoal)
              : null,
    );
    const sub = known
        ? `kcal ${over ? "over" : "left of"} ${number.format(goal)}`
        : eatenOnly
          ? "kcal eaten · no calorie goal"
          : usableTarget(opts.target)
            ? `kcal left of ${number.format(opts.target)}`
            : "no calorie goal";
    const summary = known
        ? srOnly(`Eaten ${number.format(eaten)} of ${number.format(goal)} kcal`)
        : eatenOnly
          ? srOnly(`Eaten ${number.format(eatenNoGoal)} kcal, no calorie goal`)
          : "";
    return raw(
        `<div class="${cls("fd-calorie-gauge", over && "fd-calorie-gauge--over", opts.className)}"><svg class="fd-calorie-gauge__ring" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 196 103.5" fill="none" stroke-width="11" stroke-linecap="round" aria-hidden="true" focusable="false"><path class="fd-calorie-gauge__arc fd-calorie-gauge__arc--track" d="${TRACK}"/>${arcs}</svg><div class="fd-calorie-gauge__text"><span class="fd-calorie-gauge__figure">${figure}</span><span class="fd-calorie-gauge__sub">${esc(sub)}</span></div>${summary}</div>`,
    );
}
