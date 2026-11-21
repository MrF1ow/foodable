type Member = { role: "owner" | "admin" | "member" };
declare const member: Member;
declare const role: string;
const a = member.role === "owner";
const b = member.role !== "admin";
const c = role === "member";
const d = "owner" == member.role;
const e = member?.role != "owner";
if (member.role === "owner" || member.role === "admin") {
    void [a, b, c, d, e];
}
