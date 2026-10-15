import { describe, expect, it } from "vitest";
import { isTenantSlug, tenantConfig, tenantSlugFromHost } from "./host";

const cfg = tenantConfig({});

describe("tenantSlugFromHost", () => {
  it("the bare Command Center address is the default tenant", () => {
    expect(tenantSlugFromHost("command.tinconnect.com", cfg)).toBe("tin");
    expect(tenantSlugFromHost("COMMAND.tinconnect.com:443", cfg)).toBe("tin");
    expect(tenantSlugFromHost("command.tinconnect.com.", cfg)).toBe("tin");
  });
  it("a subdomain is the tenant", () => {
    expect(tenantSlugFromHost("botski.command.tinconnect.com", cfg)).toBe("botski");
    expect(tenantSlugFromHost("Botski.Command.TinConnect.com:3020", cfg)).toBe("botski");
  });
  it("reserved and malformed names are not tenants", () => {
    for (const h of ["admin", "www", "api", "auth", "app"]) expect(tenantSlugFromHost(`${h}.command.tinconnect.com`, cfg)).toBeNull();
    for (const h of ["-x", "x-", "a.b", "bad_name", "x".repeat(31)]) expect(tenantSlugFromHost(`${h}.command.tinconnect.com`, cfg)).toBeNull();
  });
  it("a look-alike host is not treated as the base domain", () => {
    expect(tenantSlugFromHost("evilcommand.tinconnect.com", cfg)).toBe("tin"); // other host: default in phase 1
    expect(tenantSlugFromHost("botski.command.tinconnect.com.evil.com", cfg)).toBe("tin");
    expect(tenantSlugFromHost("botski.command.tinconnect.com.evil.com", { ...cfg, otherHosts: "reject" })).toBeNull();
  });
  it("other hosts use the default tenant unless they are rejected", () => {
    for (const h of ["localhost:3020", "tin-ops-console.vercel.app", "console.tinconnect.com", "", null, undefined]) {
      expect(tenantSlugFromHost(h, cfg)).toBe("tin");
      expect(tenantSlugFromHost(h, { ...cfg, otherHosts: "reject" })).toBeNull();
    }
  });
  it("is configurable, so a copied instance needs only new settings", () => {
    const copy = tenantConfig({ COMMAND_BASE_DOMAIN: "Command.Implexus.io", DEFAULT_TENANT: "implexus", TENANT_OTHER_HOSTS: "reject" });
    expect(tenantSlugFromHost("command.implexus.io", copy)).toBe("implexus");
    expect(tenantSlugFromHost("acme.command.implexus.io", copy)).toBe("acme");
    expect(tenantSlugFromHost("command.tinconnect.com", copy)).toBeNull();
  });
});

describe("isTenantSlug", () => {
  it("matches the database rules", () => {
    expect(["a", "tin", "botski", "a-b", "x1"].every(isTenantSlug)).toBe(true);
    expect(["", "-a", "a-", "A", "admin", "command", "a b"].some(isTenantSlug)).toBe(false);
  });
});
