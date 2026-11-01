import { describe, expect, it } from "vitest";
import { isPendingUserId, parseCreateTenant, parseInviteOperator, parseOperatorId, parseOperatorRole, parseRetireTenant, pendingUserId } from "./validate";

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

describe("parseCreateTenant", () => {
  it("accepts a shared tenant and lower-cases the slug", () => {
    expect(parseCreateTenant(form({ slug: " Acme ", name: "Acme Ltd" }))).toEqual({ slug: "acme", name: "Acme Ltd", isolation: "shared", connectionRef: null });
  });
  it("accepts a dedicated tenant with the name of its secret", () => {
    expect(parseCreateTenant(form({ slug: "ent", name: "Ent", isolation: "dedicated", connectionRef: "TENANT_ENT_DATABASE_URL" }))).toMatchObject({ isolation: "dedicated", connectionRef: "TENANT_ENT_DATABASE_URL" });
  });
  it("refuses reserved or malformed slugs, with a sentence", () => {
    for (const slug of ["control", "api", "-x", "a b", "", "x".repeat(31)]) {
      expect(() => parseCreateTenant(form({ slug, name: "x" }))).toThrow(/Slug:/);
    }
  });
  it("refuses a connection string where a secret NAME belongs", () => {
    expect(() => parseCreateTenant(form({ slug: "ent", name: "Ent", isolation: "dedicated", connectionRef: "postgres://user:pw@host/db" }))).toThrow(/NAME of the secret/);
    expect(() => parseCreateTenant(form({ slug: "ent", name: "Ent", isolation: "dedicated" }))).toThrow(/NAME of the secret/);
  });
  it("refuses a connection secret on a shared tenant, an empty name and an unknown isolation", () => {
    expect(() => parseCreateTenant(form({ slug: "a", name: "A", connectionRef: "X_URL" }))).toThrow(/shared tenant has no connection secret/);
    expect(() => parseCreateTenant(form({ slug: "a", name: "" }))).toThrow(/Name:/);
    expect(() => parseCreateTenant(form({ slug: "a", name: "A", isolation: "cloud" }))).toThrow(/Isolation:/);
  });
});

describe("operators", () => {
  it("parses an invite, lower-casing the email, and defaults the role to viewer", () => {
    expect(parseInviteOperator(form({ email: "Mary@TIN.info" }))).toEqual({ email: "mary@tin.info", role: "viewer" });
    expect(parseInviteOperator(form({ email: "mary@tin.info", role: "admin" }))).toEqual({ email: "mary@tin.info", role: "admin" });
  });
  it("refuses a bad email or role", () => {
    expect(() => parseInviteOperator(form({ email: "nope" }))).toThrow(/Email:/);
    expect(() => parseInviteOperator(form({ email: "a@b.co", role: "owner" }))).toThrow(/Role:/);
  });
  it("parses role changes and removals", () => {
    expect(parseOperatorRole(form({ userId: "u1", role: "admin" }))).toEqual({ userId: "u1", role: "admin" });
    expect(() => parseOperatorRole(form({ userId: "", role: "admin" }))).toThrow(/Not an operator/);
    expect(parseOperatorId(form({ userId: "u1" }))).toEqual({ userId: "u1" });
    expect(parseRetireTenant(form({ slug: "Acme" }))).toEqual({ slug: "acme" });
  });
  it("pending ids are recognisable and never collide with a Neon Auth id", () => {
    expect(pendingUserId("Mary@tin.info")).toBe("pending:mary@tin.info");
    expect(isPendingUserId("pending:mary@tin.info")).toBe(true);
    expect(isPendingUserId("u_123")).toBe(false);
  });
});
