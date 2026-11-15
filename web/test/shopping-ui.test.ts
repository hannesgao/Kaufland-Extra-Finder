import { describe, expect, it } from "vitest";
import type { Offer } from "../src/offers";
import {
  basePriceFacts,
  comparisonPrice,
  germanDecimals,
  lateStart,
  multiBuyText,
  packText,
  splitDeposit,
  tripText,
  unitFacts,
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

  it("splits a base price into label and amount", () => {
    expect(basePriceFacts("(1 kg = 4.03 - 5.78)")).toEqual([
      { label: "1 kg", value: "4,03\u00a0– 5,78\u00a0€" },
    ]);
    expect(basePriceFacts("(pro Stück = 0.25)")).toEqual([
      { label: "pro Stück", value: "0,25\u00a0€" },
    ]);
    expect(basePriceFacts(undefined)).toEqual([]);
  });

  it("keeps a text before the brackets and splits several prices", () => {
    expect(basePriceFacts("Abtropfgewicht 250 g (1 kg = 9.90)")).toEqual([
      { value: "Abtropfgewicht 250 g" },
      { label: "1 kg", value: "9,90\u00a0€" },
    ]);
    expect(basePriceFacts("(1 kg = 4.03) / (1 l = 3.73)")).toEqual([
      { label: "1 kg", value: "4,03\u00a0€" },
      { label: "1 l", value: "3,73\u00a0€" },
    ]);
  });

  it("leaves a price it cannot split as text", () => {
    expect(basePriceFacts("(entspr. z. B. für eine 500-g-Packg. 4.99)")).toEqual([
      { value: "entspr. z. B. für eine 500-g-Packg. 4,99" },
    ]);
  });

  it("lists the base price and the card's base price", () => {
    expect(
      unitFacts({
        ...offer,
        unit: "je 310 - 445-g-Packg.",
        basePrice: "(1 kg = 4.03)",
        cardBasePrice: "(1 kg = 3.73)",
      }),
    ).toEqual([
      { label: "1 kg", value: "4,03\u00a0€" },
      { label: "1 kg", value: "3,73\u00a0€", card: true },
    ]);
  });

  it("names the pack, unless the unit says nothing", () => {
    expect(packText({ unit: "je Ka. 20 x 0,5-l-Fl." })).toBe("Ka. 20 x 0,5-l-Fl.");
    expect(packText({ unit: "je kg" })).toBe("kg");
    expect(packText({ unit: "je-1,5kg-Bund" })).toBe("1,5kg-Bund");
    expect(packText({ unit: "jede Sorte" })).toBe("jede Sorte");
    expect(packText({ unit: "je" })).toBeNull();
    expect(packText({})).toBeNull();
  });
});

describe("splitDeposit", () => {
  it("takes the deposit out of the description", () => {
    expect(splitDeposit("auch alkoholfrei (+ 3.10 Pfand)")).toEqual({
      text: "auch alkoholfrei",
      deposit: "3.10",
    });
    expect(splitDeposit("max. 3 % Fett (+ 0.15 Flaschenpfand), gekühlt")).toEqual({
      text: "max. 3 % Fett, gekühlt",
      deposit: "0.15",
    });
  });

  it("leaves no text when the deposit was all there was", () => {
    expect(splitDeposit("(+ 3.42 Pfand)")).toEqual({ deposit: "3.42" });
  });

  it("keeps a description without a deposit", () => {
    expect(splitDeposit("versch. Sorten")).toEqual({ text: "versch. Sorten" });
    expect(splitDeposit("ohne Pfand")).toEqual({ text: "ohne Pfand" });
    expect(splitDeposit(undefined)).toEqual({});
  });
});

describe("days", () => {
  it("names the weekday of an offer that starts later than its week", () => {
    expect(lateStart({ salesFrom: "2026-11-19" }, "2026-11-16")).toBe("Do");
    expect(lateStart({ salesFrom: "2026-11-20" }, "2026-11-19")).toBe("Fr");
    expect(lateStart({ salesFrom: "2026-11-16" }, "2026-11-14")).toBeNull(); // a Monday
    expect(lateStart({ salesFrom: "2026-11-19" }, "2026-11-19")).toBeNull(); // has started
  });

  it("says on which days a trip gets every price", () => {
    const trip = { from: "2026-11-19", to: "2026-11-21", items: [] };
    expect(tripText(trip)).toBe("KW\u00a047 · Gültig Do, 19.11. – Sa, 21.11.");
    const item = { id: "a", quantity: 1, note: "" };
    expect(tripText({ ...trip, to: "2026-11-19", items: [item, item] })).toBe(
      "KW\u00a047 · Alles gültig nur Do, 19.11.",
    );
  });
});
