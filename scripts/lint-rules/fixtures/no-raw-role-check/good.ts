type Member = { role?: "owner" | "admin" | "member"; name: string };
declare const member: Member;
declare const role: string;
// Presence checks are not role comparisons.
const a = member.role !== undefined;
const b = role === undefined;
// Other fields and other strings are fine.
const c = member.name === "owner";
const d = role === "other";
const e = member.role === role;
// A marked comparison is a deliberate exception.
// oxlint-disable-next-line foodable/no-raw-role-check -- display label, not a permission decision
const f = member.role === "owner" ? "Owner" : "Member";
void [a, b, c, d, e, f];
