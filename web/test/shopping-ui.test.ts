import { describe, expect, it } from "vitest";
import { comparisonPrice, germanDecimals, multiBuyText } from "../src/ui/shopping";

describe("comparisonPrice", () => {
  it("formats a plain price", () => {
    expect(comparisonPrice("3.69")).toBe("3,69 €");
  });

  it("keeps the list-price prefix and formats the amount", () => {
    expect(comparisonPrice("UVP 47.69")).toBe("UVP 47,69 €");
    expect(comparisonPrice("UVP 199.99")).toBe("UVP 199,99 €");
  });

  it("leaves anything else as it is", () => {
    expect(comparisonPrice("ab 2 Stück")).toBe("ab 2 Stück");
  });
});

describe("small print", () => {
  it("writes base prices with decimal commas", () => {
    expect(germanDecimals("(1 kg = 10.38)")).toBe("(1 kg = 10,38)");
  });

  it("names what a multi-buy price is for", () => {
    expect(multiBuyText(["3 Stück", "entspr. pro Beutel 1.34"])).toBe(
      "Preis für 3 Stück (entspr. pro Beutel 1,34)",
    );
    expect(multiBuyText([])).toBeNull();
  });
});
