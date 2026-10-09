import { describe, expect, it } from "vitest";
import { Money } from "@/lib/money";

describe("Money", () => {
  it("adds without floating point error", () => {
    expect(Money.of("0.1").add(Money.of("0.2")).toString()).toBe("0.3");
    expect(Money.sum(Array.from({ length: 10 }, () => Money.of("0.1"))).toDb()).toBe("1.00");
  });

  it("rejects JS-number-like and malformed input", () => {
    expect(() => Money.of("1e3")).toThrow();
    expect(() => Money.of("abc")).toThrow();
    expect(() => Money.of("")).toThrow();
  });

  it("parses Norwegian formatted input", () => {
    expect(Money.parse("1 234,50 kr").toDb()).toBe("1234.50");
    expect(Money.parse("1 000").toDb()).toBe("1000.00");
    expect(() => Money.parse("1.234,50")).toThrow();
  });

  it("rounds half up to whole øre", () => {
    expect(Money.of("0.125").round().toDb()).toBe("0.13");
    expect(Money.of("0.124").round().toDb()).toBe("0.12");
    expect(Money.of("-0.125").round().toDb()).toBe("-0.13");
  });

  it("refuses to store unrounded amounts", () => {
    expect(() => Money.of("1.005").toDb()).toThrow(/rounded/);
  });

  it("calculates MVA exactly", () => {
    expect(Money.of("199.99").pct("25").round().toDb()).toBe("50.00");
    expect(Money.of("80").pct("15").round().toDb()).toBe("12.00");
    expect(Money.of("33.33").pct("12").round().toDb()).toBe("4.00");
    expect(Money.of("100").mul("3").toDb()).toBe("300.00");
  });

  it("allocates without losing or inventing øre", () => {
    const parts = Money.of("100").allocate([1, 1, 1]);
    expect(parts.map((p) => p.toDb())).toEqual(["33.34", "33.33", "33.33"]);
    expect(Money.sum(parts).toDb()).toBe("100.00");
    const neg = Money.of("-10").allocate([1, 2]);
    expect(Money.sum(neg).toDb()).toBe("-10.00");
  });

  it("formats in Norwegian style", () => {
    const s = Money.of("1234.5").format("nb").replace(/\s/g, " ");
    expect(s).toMatch(/1 234,50/);
  });
});
