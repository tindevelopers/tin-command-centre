import { describe, expect, it } from "vitest";
import { ageLabel } from "./format";

const now = new Date("2026-10-14T12:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000);

describe("ageLabel", () => {
  it("reads naturally at each scale", () => {
    expect(ageLabel(null, now)).toBe("never");
    expect(ageLabel(ago(0), now)).toBe("just now");
    expect(ageLabel(ago(-5), now)).toBe("just now");
    expect(ageLabel(ago(12), now)).toBe("12 min ago");
    expect(ageLabel(ago(59), now)).toBe("59 min ago");
    expect(ageLabel(ago(60), now)).toBe("1 h ago");
    expect(ageLabel(ago(47 * 60 + 59), now)).toBe("47 h ago");
    expect(ageLabel(ago(48 * 60), now)).toBe("2 d ago");
    expect(ageLabel(ago(10 * 24 * 60), now)).toBe("10 d ago");
  });
});
