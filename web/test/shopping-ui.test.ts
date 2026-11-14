import { describe, expect, it } from "vitest";
import type { Offer } from "../src/offers";
import {
  basePriceLines,
  comparisonPrice,
  germanDecimals,
  multiBuyText,
  unitLines,
} from "../src/ui/shopping";

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

describe("unit facts", () => {
  const offer: Offer = {
    key: "1|2026-11-09",
    klNr: "1",
    title: "",
    subtitle: "",
    multiBuy: [],
    salesFrom: "2026-11-09",
    salesTo: "2026-11-14",
    sections: [],
  };

  it("takes the brackets off a base price", () => {
    expect(basePriceLines("(1 kg = 4.03 - 5.78)")).toEqual(["1 kg = 4,03 - 5,78"]);
    expect(basePriceLines(undefined)).toEqual([]);
  });

  it("splits a text before the brackets and several prices", () => {
    expect(basePriceLines("Abtropfgewicht 250 g (1 kg = 9.90)")).toEqual([
      "Abtropfgewicht 250 g",
      "1 kg = 9,90",
    ]);
    expect(basePriceLines("(1 kg = 4.03) / (1 l = 3.73)")).toEqual(["1 kg = 4,03", "1 l = 3,73"]);
  });

  it("lists the unit, the base price and the card's base price", () => {
    expect(
      unitLines({
        ...offer,
        unit: "je 310 - 445-g-Packg.",
        basePrice: "(1 kg = 4.03 - 5.78)",
        cardBasePrice: "(1 kg = 3.73 - 5.36)",
      }),
    ).toEqual([
      "je 310 - 445-g-Packg.",
      "1 kg = 4,03 - 5,78",
      "mit Kaufland Card: 1 kg = 3,73 - 5,36",
    ]);
  });

  it("drops a unit that says nothing", () => {
    expect(unitLines({ ...offer, unit: "je" })).toEqual([]);
  });
});
