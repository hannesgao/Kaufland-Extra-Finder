import { describe, expect, it } from "vitest";
import {
  countUnchecked,
  emptyStatus,
  listSummary,
  nearestStatus,
  radiusStatus,
} from "../src/summary";
import { listAll } from "../src/search";
import { fixture, MONDAY } from "./helpers";

describe("status texts", () => {
  const where = "um PLZ 76131";

  it("describes radius results without the switch", () => {
    expect(radiusStatus({ shown: 4, hidden: 0, unchecked: 0 }, 25, where, false)).toBe(
      "4 Extra-Filialen im Umkreis von 25 km um PLZ 76131.",
    );
    expect(radiusStatus({ shown: 1, hidden: 0, unchecked: 0 }, 10, where, false)).toBe(
      "1 Extra-Filiale im Umkreis von 10 km um PLZ 76131.",
    );
  });

  it("names the filter, hidden and unchecked stores with the switch", () => {
    expect(radiusStatus({ shown: 2, hidden: 2, unchecked: 0 }, 25, where, true)).toBe(
      "2 Filialen, für die der Extra-Prospekt laut PDF gilt, im Umkreis von 25 km um PLZ 76131 " +
        "(2 Filialen ausgeblendet).",
    );
    expect(radiusStatus({ shown: 1, hidden: 1, unchecked: 1 }, 25, where, true)).toBe(
      "1 Filiale, für die der Extra-Prospekt laut PDF gilt, im Umkreis von 25 km um PLZ 76131 " +
        "(1 Filiale ausgeblendet, bei 1 Filiale ist die PDF-Prüfung noch offen).",
    );
  });

  it("describes the nearest-store fallback and empty data", () => {
    expect(nearestStatus("224,8 km", 100, "um PLZ 20095", false)).toBe(
      "Keine Extra-Filiale im Umkreis von 100 km um PLZ 20095. Die nächste ist 224,8 km entfernt.",
    );
    expect(nearestStatus("5 km", 10, where, true)).toBe(
      "Keine Filiale, für die der Extra-Prospekt laut PDF gilt, im Umkreis von 10 km um PLZ " +
        "76131. Die nächste ist 5 km entfernt.",
    );
    expect(emptyStatus(true)).toBe(
      "Derzeit ist keine Filiale bekannt, für die der Extra-Prospekt laut PDF gilt.",
    );
  });

  it("summarises the full list", () => {
    expect(listSummary({ shown: 102, hidden: 0, unchecked: 16 }, false)).toBe(
      "102 Filialen mit Extra-Prospekt",
    );
    expect(listSummary({ shown: 55, hidden: 47, unchecked: 16 }, true)).toBe(
      "55 Filialen, für die der Extra-Prospekt laut PDF gilt " +
        "(47 Filialen ausgeblendet, bei 16 Filialen ist die PDF-Prüfung noch offen)",
    );
  });

  it("counts stores whose PDF check is still open", () => {
    const views = listAll(fixture(), MONDAY, "plz-asc");
    expect(countUnchecked(views)).toBe(0);
    const first = views[0]?.leaflets[0]?.leaflet;
    if (first) delete first.pdfStoreMatch;
    expect(countUnchecked(views)).toBe(1);
  });
});
