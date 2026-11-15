import { describe, expect, it } from "vitest";
import {
  brandDepartments,
  DEPARTMENTS as D,
  groupOf,
  groupsOf,
  guessDepartment,
  OTHER_GROUP,
} from "../src/classify";

/** title | subtitle | description | unit */
function offer(line: string) {
  const [title = "", subtitle = "", description = "", unit = ""] = line.split("|");
  return { title, subtitle, description, unit };
}

describe("guessDepartment", () => {
  it.each([
    // Fresh food: origin, quality class, pot size
    ["Span. Zitronen||Sorte laut Auszeichnung, Kl. I", D.produce],
    ["Dtsch. Zwiebeln||KI. II", D.produce], // Kaufland's typo for "Kl."
    ["Weihnachtsstern Busch||versch. Farben, Topf Ø 23 cm", D.produce],
    ["Norweg. Lachsfiletseite||mit Haut, gekühlt", D.fish],
    ["K-PURLAND|Schälrippchen XXL|vom Schwein, natur, gekühlt", D.meat],
    ["K-PURLAND|Filetsteak|vom Jungbullen, gekühlt", D.meat],
    ["K-CLASSIC|Bayr. Leberkäse|ofengebacken, gekühlt", D.meat], // not cheese
    ["RÜGENWALDER MÜHLE|Teewurst oder Leberwurst|", D.meat], // not tea
    ["ZIMMERMANN|Glühweinschinken|", D.meat], // not wine
    // Chilled and frozen
    ["K-CLASSIC|Gouda mittelalt|am Stück, 48 % Fett i. Tr., gekühlt", D.dairy],
    ["ZOTT|Monte Snack|Milchcreme & Schoko-Nuss, gekühlt", D.dairy], // not a snack
    ["MÜLLER|Reine Buttermilch|max. 1 % Fett (+ 0.25 Flaschenpfand), gekühlt", D.dairy],
    ["IGLO|Schlemmer-Filet|Fisch-Filet, tiefgefroren", D.frozen],
    ["ORIGINAL WAGNER|Steinofen-Pizza oder -Flammkuchen|versch. Sorten, tiefgefroren", D.frozen],
    // Shelves
    ["K-CLASSIC|Hot-Dog-Brötchen|supersoft", D.staples],
    ["K-CLASSIC|Hamburger-Brötchen|", D.staples], // not meat
    ["NUTELLA|Nuss-Nugat-Creme|Brotaufstrich", D.staples],
    ["HEINZ|Tomaten-Ketchup|die Klassiker", D.deli],
    ["K-CLASSIC|Sonnenblumenöl|reich an natürlichem Vitamin E", D.deli],
    ["GOLSSENER|Fleischsalat|", D.deli], // not meat
    ["LINDT|Vollmilchschokoladen-Figur|versch. Ausführungen", D.sweets], // not milk
    ["K-WINTER EDITION|Weinbrand-Fässchen|in Zartbitterschokolade, enthält Alkohol", D.sweets],
    ["KINDER|Bueno|Original", D.sweets],
    ["TEEKANNE|Wintertee|versch. Sorten", D.sweets],
    ["IDEE KAFFEE|Filterkaffee|gemahlen", D.sweets],
    // Drinks: deposit, alcohol, bottle size
    ["BAYREUTHER|Hell|(+ 3.10 Pfand)|je Ka. 20 x 0,5-l-Fl.", D.drinks],
    ["BALLANTINE'S|Finest Blended Scotch Whisky|mit Noten von Schokolade, 40 Vol. %", D.drinks],
    ["FÜRST VON METTERNICH|Sekt|versch. Sorten|je 0,75-l-Fl.", D.drinks], // not "Mett"
    ["ARIZONA|Teegetränk|Erfrischungsgetränk auf Teebasis", D.drinks],
    ["GRAND SUD|Franz. Wein|Merlot oder Chardonnay|je 1-l-Fl.", D.drinks],
    // Drugstore
    ["K-CONCEPT+ SPORTS|Protein-Riegel Crunchy|mit Himbeer-Geschmack", D.drugstore],
    ["PERSIL|Voll- oder Colorwaschmittel|Pulver oder Gel", D.drugstore],
    ["K-CLASSIC|Hundenahrung Kroketten|versch. Sorten", D.drugstore],
    // Non-food: Kaufland lists its properties with ">"
    ["ELLESSE|Herren-Winterjacke|> Aus Polyester > Größen M - XXL", D.leisure],
    ["LEGO CITY|»Traktor« Bau- und Spielset 60498|> Mit 4 großen Traktorreifen", D.leisure],
    ["PHILIPS|Wasserkocher »HD 9314.90«|> Fassungsvermögen ca. 1,7 l", D.electro],
    ["ENERGIZER|Knopfzellen CR2032|", D.electro], // no description at all
    ["SILIT|Topf-Set »Diamant«|> Aus rostfreiem Edelstahl", D.home],
    ["|Deko-Figur Elch|> Aus Mangoholz > Mit Juteband", D.home],
    ["|Nikolaus-Stiefel|> Aus Polyester > Größe ca. 24 x 35 cm", D.home], // not a shoe
  ])("%s", (line, department) => {
    expect(guessDepartment(offer(line))).toBe(department);
  });

  it("says nothing when the texts do not tell", () => {
    expect(guessDepartment(offer("ACME|Wochenknüller|versch. Sorten"))).toBeUndefined();
    expect(guessDepartment(offer("||"))).toBeUndefined();
  });

  it("falls back to the brand when all its other offers are in one category", () => {
    const brands = brandDepartments([
      { title: "K-PURLAND", department: D.meat },
      { title: "K-Purland", department: D.meat },
      { title: "K-CLASSIC", department: D.dairy },
      { title: "K-CLASSIC", department: D.deli },
      { title: "", department: D.produce },
    ]);
    expect([...brands]).toEqual([["k-purland", D.meat]]);
    expect(guessDepartment(offer("K-PURLAND|Minutenpfanne"), brands)).toBe(D.meat);
    expect(guessDepartment(offer("K-CLASSIC|Wochenknüller"), brands)).toBeUndefined();
    // The texts win over the brand
    expect(guessDepartment(offer("K-PURLAND|Kräuterbutter"), brands)).toBe(D.dairy);
  });
});

describe("groupOf", () => {
  it.each([
    ["K-PURLAND|Schinkenbraten|vom Schwein, gekühlt", "Schwein"], // a cut, not ham
    ["K-PURLAND|Schinkengulasch|", "Schwein"],
    ["K-CLASSIC|Kochhinterschinken|", "Schinken & Speck"],
    ["MARCHER|Schweinefilet im Speckmantel|", "Schwein"],
    ["K-PURLAND|Filetsteak|vom Jungbullen, mind. 21 Tage gereift", "Rind & Kalb"],
    ["K-PURLAND|Rinderhackfleisch|", "Hackfleisch & Burger"],
    ["GUTFRIED|Geflügel- oder Hähnchen- Fleischwurst|", "Wurst & Aufschnitt"],
    ["K-PURLAND|Putenschnitzel|aus dem Brustfilet", "Geflügel"],
    ["Lammkeule|mit Knochen|", "Lamm & Wild"],
    ["ACME|Spezialität|", OTHER_GROUP],
  ])("meat: %s", (line, group) => {
    expect(groupOf(offer(line), D.meat)).toBe(group);
  });

  it.each([
    ["HELL|Energy Drink|koffeinhaltig (+ 0.25 Pfand)", "Limonade & Eistee"], // not "Helles"
    ["PAULANER|Münchner Hell|(+ 3.10 Pfand)", "Bier"],
    ["ERDINGER|Alkoholfrei|(+ 0.48 Pfand)", "Bier"],
    ["ROTHAUS|Tannenzäpfle|(+ 3.42 Pfand)|je Ka. 24 x 0,33-l-Fl.", "Bier"],
    ["DOPPIO PASSO|Primitivo IGT oder Alkoholfrei|Italien", "Wein, Sekt & Glühwein"],
    ["FREIXENET|Schaumwein|auch alkoholfrei 0,0 Vol. %", "Wein, Sekt & Glühwein"],
    ["BOMBAY|Gin & Tonic|alkoholisches Mixgetränk, 10 Vol. %", "Spirituosen"],
    ["GEROLSTEINER|Mineralwasser|versch. Sorten (+ 3.30 Pfand)", "Wasser"],
    ["HOHES C|Fruchtsaft|versch. Sorten", "Saft"],
  ])("drinks: %s", (line, group) => {
    expect(groupOf(offer(line), D.drinks)).toBe(group);
  });

  it.each([
    ["DALLMAYR|Prodomo|gemahlen oder ganze Bohnen", "Kaffee & Tee"],
    ["HARIBO|Fruchtgummis oder Lakritze|", "Fruchtgummi & Bonbons"],
    ["GLICO|Mikado-Sticks|umhüllt mit feiner Schokolade", "Schokolade & Pralinen"],
    ["PRINGLES|Chips|versch. Sorten", "Chips & Knabbereien"],
    ["LEIBNIZ|Zoo|Figuren-Butterkekse", "Gebäck & Kekse"],
    ["KINDER|Bueno|Original", "Schokolade & Pralinen"],
  ])("sweets: %s", (line, group) => {
    expect(groupOf(offer(line), D.sweets)).toBe(group);
  });

  it("has groups for the three large departments only", () => {
    expect(groupsOf(D.meat)).toEqual([
      "Schwein",
      "Rind & Kalb",
      "Geflügel",
      "Lamm & Wild",
      "Hackfleisch & Burger",
      "Wurst & Aufschnitt",
      "Schinken & Speck",
      OTHER_GROUP,
    ]);
    expect(groupsOf(D.drinks).at(0)).toBe("Wasser");
    expect(groupsOf(D.sweets).at(-1)).toBe(OTHER_GROUP);
    expect(groupsOf(D.dairy)).toEqual([]);
    expect(groupOf(offer("ARLA|Skyr"), D.dairy)).toBeUndefined();
  });
});
