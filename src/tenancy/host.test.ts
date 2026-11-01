import { describe, expect, it } from "vitest";
import { isTenantSlug, tenantConfig, tenantSlugFromHost } from "./host";

const cfg = tenantConfig({});

describe("tenantSlugFromHost", () => {
  it("the bare Control Plane address is the default tenant", () => {
    expect(tenantSlugFromHost("control.tinconnect.com", cfg)).toBe("tin");
    expect(tenantSlugFromHost("CONTROL.tinconnect.com:443", cfg)).toBe("tin");
    expect(tenantSlugFromHost("control.tinconnect.com.", cfg)).toBe("tin");
  });
  it("a subdomain is the tenant", () => {
    expect(tenantSlugFromHost("botski.control.tinconnect.com", cfg)).toBe("botski");
    expect(tenantSlugFromHost("Botski.Control.TinConnect.com:3020", cfg)).toBe("botski");
  });
  it("reserved and malformed names are not tenants", () => {
    for (const h of ["admin", "www", "api", "auth", "app"]) expect(tenantSlugFromHost(`${h}.control.tinconnect.com`, cfg)).toBeNull();
    for (const h of ["-x", "x-", "a.b", "bad_name", "x".repeat(31)]) expect(tenantSlugFromHost(`${h}.control.tinconnect.com`, cfg)).toBeNull();
  });
  it("a look-alike host is not treated as the base domain", () => {
    expect(tenantSlugFromHost("evilcontrol.tinconnect.com", cfg)).toBe("tin"); // other host: default in phase 1
    expect(tenantSlugFromHost("botski.control.tinconnect.com.evil.com", cfg)).toBe("tin");
    expect(tenantSlugFromHost("botski.control.tinconnect.com.evil.com", { ...cfg, otherHosts: "reject" })).toBeNull();
  });
  it("other hosts use the default tenant unless they are rejected", () => {
    for (const h of ["localhost:3020", "tin-ops-console.vercel.app", "console.tinconnect.com", "", null, undefined]) {
      expect(tenantSlugFromHost(h, cfg)).toBe("tin");
      expect(tenantSlugFromHost(h, { ...cfg, otherHosts: "reject" })).toBeNull();
    }
  });
  it("is configurable, so a copied instance needs only new settings", () => {
    const copy = tenantConfig({ CONTROL_BASE_DOMAIN: "Control.Implexus.io", DEFAULT_TENANT: "implexus", TENANT_OTHER_HOSTS: "reject" });
    expect(tenantSlugFromHost("control.implexus.io", copy)).toBe("implexus");
    expect(tenantSlugFromHost("acme.control.implexus.io", copy)).toBe("acme");
    expect(tenantSlugFromHost("control.tinconnect.com", copy)).toBeNull();
  });
});

describe("isTenantSlug", () => {
  it("matches the database rules", () => {
    expect(["a", "tin", "botski", "a-b", "x1"].every(isTenantSlug)).toBe(true);
    expect(["", "-a", "a-", "A", "admin", "command", "control", "a b"].some(isTenantSlug)).toBe(false);
  });
});
