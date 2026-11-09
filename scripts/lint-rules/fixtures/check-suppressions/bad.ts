/* eslint-disable */
export const blockForm = 1;

/* oxlint-disable foodable/no-wall-clock-waits -- reason does not make it block-safe */
export const blockWithReason = 2;

// oxlint-disable foodable/skip-needs-reason -- file-wide line form
export const fileWideLine = 3;

// oxlint-enable foodable/skip-needs-reason
export const enable = 4;

export const bareLine = 5; // oxlint-disable-line

// oxlint-disable-next-line -- a reason but no rule name
export const noRuleName = 6;

// oxlint-disable-next-line foodable/gated-tool
export const noReason = 7;

// eslint-disable-next-line foodable/gated-tool --
export const emptyReason = 8;
