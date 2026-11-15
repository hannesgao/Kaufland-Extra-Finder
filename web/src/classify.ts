/**
 * Kaufland names an assortment category for about two thirds of the offers; the others are only
 * in promotion categories ("Unsere Knüller", "Nächste Woche"). This module guesses the category
 * of those from their texts, and splits every category into groups. Pure.
 *
 * All patterns run on normalised text: lower case, no accents, "ß" as "ss".
 */

import { normalize } from "./text";

export const DEPARTMENTS = {
  produce: "Obst, Gemüse, Pflanzen",
  meat: "Fleisch, Geflügel, Wurst",
  fish: "Fisch",
  dairy: "Molkereiprodukte, Fette",
  frozen: "Tiefkühlkost",
  deli: "Feinkost, Konserven",
  staples: "Grundnahrungsmittel",
  sweets: "Kaffee, Tee, Süßwaren, Knabberartikel",
  drinks: "Getränke, Spirituosen",
  drugstore: "Drogerie, Tiernahrung",
  electro: "Elektro, Büro, Medien",
  home: "Heim, Haus",
  leisure: "Bekleidung, Auto, Freizeit, Spiel",
} as const;

type DepartmentId = keyof typeof DEPARTMENTS;

/** The texts of an offer that the patterns look at. */
export interface Classifiable {
  title: string;
  subtitle: string;
  description?: string;
  unit?: string;
}

interface Texts {
  /** Brand and product name. */
  name: string;
  /** Product name only. */
  sub: string;
  desc: string;
  unit: string;
}

function texts(offer: Classifiable): Texts {
  return {
    name: normalize(`${offer.title} ${offer.subtitle}`),
    sub: normalize(offer.subtitle),
    desc: normalize(offer.description ?? ""),
    unit: normalize(offer.unit ?? ""),
  };
}

/** Matches when one of the patterns matches its text and `not` (on name and description) does not. */
interface Pattern {
  name?: RegExp;
  sub?: RegExp;
  desc?: RegExp;
  unit?: RegExp;
  not?: RegExp;
}

function matches(pattern: Pattern, t: Texts): boolean {
  if (pattern.not?.test(`${t.name} ${t.desc}`)) return false;
  return (
    (pattern.name?.test(t.name) ?? false) ||
    (pattern.sub?.test(t.sub) ?? false) ||
    (pattern.desc?.test(t.desc) ?? false) ||
    (pattern.unit?.test(t.unit) ?? false)
  );
}

type Rule<T> = [T, Pattern];

function firstMatch<T>(rules: readonly Rule<T>[], t: Texts): T | undefined {
  return rules.find(([, pattern]) => matches(pattern, t))?.[0];
}

// ---------- Department ----------

/** Kaufland writes the properties of non-food articles as "> Aus Polyester > Größe …". */
const NON_FOOD = /^\s*>/;

/** Non-food articles; what none of these patterns matches is household goods. */
const NON_FOOD_RULES: readonly Rule<DepartmentId>[] = [
  ["home", { name: /deko|nikolaus|lichter|kerzen|teelichter|aufhanger|geschenkbox|sticker/ }],
  [
    "leisure",
    {
      name: /damen|herren|kinder|socken|strumpf|pyjama|pullover|hose\b|jacke|weste\b|schuhe|stiefel|boots|leggings|shirt|hoodie|beanie|slips|unterhemd|boxer|unterwasche|overall|kostum|perucke|rucksack|tasche\b|gymbag|trolley|spielset|bauset|\blego|puppe|plusch|puzzle|kartenspiel|rennbahn|\brc-|fahrzeug|\bauto|horfigur|eisenbahn|\blok\b|feuerwehrlok|erweiterungs-set|blaster|mikroskop|bastelset|stifte-set|feuerwerk|knallerbsen|fontanen|bengal|motorenol|frostschutz|enteiser|adblue|\bkfz|bettwasche|kissen|steppbett|kuscheldecke|handtuch|duschtuch|gastetuch|walkie|garage|magnetwurfel|schlusselanhanger|mini-figur|leuchtstab|puppenhaus|frisiertisch|\bsitz|kofferraum|eiskratzer|flachbalkenwischer|vorhang|tischdecke|monster/,
    },
  ],
  [
    "electro",
    {
      name: /\btv\b|lautsprecher|soundbar|kopfhorer|powerbank|smartwatch|beamer|drucker|ladegerat|sauger|saugroboter|bugeleisen|bugelstation|dampfglatter|toaster|wasserkocher|mixer|fritteuse|mikrowelle|kuchenmaschine|vollautomat|padmaschine|eierkocher|grill\b|sandwichmaker|zerkleinerer|smoothiemaker|funkwecker|kamera|karaoke|projektor|partypfanne|led-birnen|led-filament|led-reflektoren|rasierer|haartrockner|haarschneider|trimmer|epilierer|groomer|nahmaschine|pizza-ofen|bohrmaschine|taschenlampe|marker|gelschreiber|pinselstifte|\bps5|sonicare|batterien|knopfzellen/,
    },
  ],
];

const CHILLED = /gekuhlt/;

/** Kaufland's fruit and vegetables have no brand: the name starts with the origin. */
const ORIGIN =
  /^(bioland |demeter )?(dtsch|span|ital|niederl|brasil|peruan|port|marokk|turk|griech|belg|sudafrik|costa-rican|ghana|chin|poln|domenik|dominik|kroat)\./;

/** Food, drugstore articles and plants: the first pattern that matches decides. */
const RULES: readonly Rule<DepartmentId>[] = [
  ["frozen", { desc: /tiefgefroren|gefroren|tiefkuhl/, name: /\beis\b/ }],
  ["electro", { name: /batterien|knopfzellen|\bps5\b|playstation|nintendo|xbox/ }],
  ["leisure", { name: /motorenol|frostschutz|enteiser|adblue|feuerwerk/ }],
  [
    "drugstore",
    {
      name: /protein-?riegel|\bwhey\b|creatin|kreatin|protein iced|low sugar bar|duschgel|dusche\b|\bdeo|shampoo|spulung|zahn|haftcreme|waschmittel|weichspuler|wascheparfum|spulmittel|geschirr|spulmaschinen|tucher\b|toilettenpapier|windeln|\bpants\b|hundenahrung|hundesnack|katzen|reiniger|seife|rasier|haarspray|haarpflege|coloration|gesichts|entharter|slipeinlagen|erfrischer|hygiene|backpapier|lippen|burstenkopfe|\bwc-/,
      desc: /gegen kalk|reiniger\b/,
    },
  ],
  [
    "fish",
    {
      name: /lachsfilet|heilbutt|dorade|barsch|schellfisch|forelle|kabeljau|miesmuscheln|heringsdoppelfilet|heringshappen|thunfischfilet|flusskrebs/,
    },
  ],
  [
    "produce",
    {
      name: /weihnachtsstern|zauberstern|amaryllis|christrose|strauss|gesteck|schnittgrun|weihnachtskaktus|orchidee|alpenveilchen|hyazinthe|kalanchoe|sukkulente|chrysanthemen|bepflanzt|, lose\b|suppengrun|\bpapaya/,
      desc: /\bk[li]\. ?i+\b|qualitat i\b|laut auszeichnung|\btopf\b/,
    },
  ],
  ["produce", { name: ORIGIN }],
  [
    "staples",
    {
      name: /brot(chen)?\b|\btoast\b|sandwichtoast|bagel|croissant|pains? au|baguette|muffin/,
      desc: /^\S*(brotchen|geback)\b|plunderteig|\bbelegt mit/,
    },
  ],
  [
    "deli",
    {
      name: /(fleisch|kartoffel|nudel|kraut|wurst|eier|thunfisch-?)salat|vegan|raucherlachs|graved|stremellachs|surimi|antipasti/,
      not: /schoko|creme\b|keks/,
    },
  ],
  ["deli", { name: /hering|thunfisch|sardinen|makrele/ }],
  [
    "meat",
    {
      name: /schwein|\brind|rinder|jungbulle|\bkalb|\blamm|hahnchen|chicken|\bpute|geflugel|hackfleisch|gulasch|steak|braten\b|kotelett|schnitzel|ripp|wurst|wiener\b|salami|schinken|speck\b|bacon|leberkase|frikadelle|bouletten|cevapcici|kasseler|pastrami|kabanos|\bmett\b|sulze|aufschnitt|zunge\b|fleisch|hamburger|roastbeef|entrecote|tafelspitz|eisbein|serrano|krakauer|hirsch|\bracks\b|\bente\b|\bgans\b|piglet/,
      desc: /^vom (schwein|rind|jungbullen|kalb|lamm|spanferkel)|aus schweinefleisch|sulze|wurstchen/,
    },
  ],
  [
    "drinks",
    {
      name: /whisk|wodka|vodka|\bgin\b|\brum\b|tequila/,
      desc: /vol\. ?%|\+ ?\d+[.,]\d+ (flaschen)?pfand/,
      not: /milch|joghurt/,
    },
  ],
  [
    "staples",
    {
      name: /nuss-?nugat-creme|nuss-?creme|erdnusscreme|konfiture|honig|erdnusse|pistazien|nusskerne|kerne\b|mandeln\b|cashew|walnuss|studentenfutter|datteln|nuts royal|nuss-mix/,
      desc: /^getrocknet|^geraspelt/,
      not: CHILLED,
    },
  ],
  [
    "staples",
    {
      name: /nudel|pasta|pesto|teigware|spaghetti|fusilli|\breis\b|basmati|mehl\b|zucker\b|musli|cerealien|haferflocken|porridge|kuchen|^berliner\/|-berliner\b|donut|pancake|suppe\b|suppen|bruhe|bouillon|sosse|\bfix\b|terrine|chiasamen|krustchen|brezel|oblaten/,
      not: /lebkuchen/,
    },
  ],
  [
    "sweets",
    {
      name: /schoko|praline|fruchtgummi|gummi|bonbon|lakritz|kaugummi|lollies|pastillen|keks|geback|butterblatter|waffel|lebkuchen|spekulatius|domino|marzipan|chips|knabber|snack|erdnuss-?locken|nic nac|sticks\b|stangli|riegel|kuchlein|weihnachtsmann|toffifee|kusschen|baumbehang|puffreis|nougat|fasschen|konfekt|prinzen|bake rolls|^(kinder|lindt|milka|ferrero|haribo|trolli|storck|maoam|hitschies|halloren|hanuta|duplo|trumpf|dickmann's) /,
      desc: /schoko|fruchtgummi|schaumkuss|kakaocreme|kaubonbon|pralinen|riegel/,
      not: CHILLED,
    },
  ],
  [
    "dairy",
    {
      name: /kase|gouda|emmentaler|camembert|mozzarella|\bfeta\b|cheddar|limburger|raclette|parmigiano|grana padano|appenzeller|joghurt|jogurt|skyr|quark|kefir|ayran|\bmilch|milch\b|sahne|creme fraiche|schmand|pudding|dessert|butter\b|butterschmalz|margarine|streichfett|pflanzencreme|kokosfett|\bmonte\b|grutze|eiklar|mousse|kaffeemischgetrank/,
      desc: /% fett|kondensmilch|milch-?dessert|^pudding/,
    },
  ],
  [
    "drinks",
    {
      name: /\bbier|bier\b|pils|\blager\b|radler|(?<!sch)wein\b|\bwein|\bsekt\b|-sekt|prosecco|secco\b|likor|aperitif|aperitivo|erfrischungsgetrank|mineralwasser|saft\b|saft-|saftgetrank|nektar|limonade|eistee|ice tea|teegetrank|energy drink|sports drink|\bcola\b|\bsirup|getrankesirup|cider|punsch|bowle|riesling|dornfelder|chardonnay|merlot|cabernet|primitivo|burgunder|rioja|grigio|-shot\b|tonic|trinkmahlzeit/,
      sub: /\bhell\b/,
      desc: /erfrischungsgetrank|mineralwasser|qualitatswein|schaumwein|saftgetrank|\bbier\b|\bpils\b/,
      unit: /0,7\d?-l-fl|\bka\. \d+ x/,
    },
  ],
  [
    "sweets",
    {
      name: /kaffee|caffe|espresso|cappuccino|\bcrema\b|tee\b|teegenuss|kakao|matcha|kapseln|prodomo/,
      desc: /rostkaffee|bohnenkaffee/,
    },
  ],
  [
    "deli",
    {
      name: /ketchup|\bsenf|mayonnaise|salatcreme|essig|ol\b|tomaten|mais\b|eintopf|fertiggericht|gnocchi|tortelloni|gewurz|zwiebeln|champignons|\blachs|heidelbeeren|mandarin|peperoni|paprika|knodel|teig\b|hulsenfruchte|gemuse|fruchtmus|rotkohl|gurken|oliven|brotaufstrich|wurzsauce|pizzakit/,
      desc: /gurkchen/,
    },
  ],
];

function ruleDepartment(t: Texts): DepartmentId | undefined {
  if (NON_FOOD.test(t.desc)) return firstMatch(NON_FOOD_RULES, t) ?? "home";
  return firstMatch(RULES, t);
}

/** Lookup key of a brand; empty for offers without one. */
function brandKey(title: string): string {
  return normalize(title).trim();
}

/**
 * Brands whose offers with a category are all in the same one, e.g. every K-PURLAND offer is
 * meat. Brands seen in two categories (K-CLASSIC) are left out.
 */
export function brandDepartments(
  labelled: Iterable<{ title: string; department: string }>,
): Map<string, string> {
  const seen = new Map<string, string | null>();
  for (const { title, department } of labelled) {
    const key = brandKey(title);
    if (!key) continue;
    const known = seen.get(key);
    seen.set(key, known === undefined || known === department ? department : null);
  }
  const out = new Map<string, string>();
  for (const [key, department] of seen) if (department !== null) out.set(key, department);
  return out;
}

/**
 * The category an offer without one probably belongs to: from its texts, else from its brand.
 * Undefined when neither says anything.
 */
export function guessDepartment(
  offer: Classifiable,
  brands?: ReadonlyMap<string, string>,
): string | undefined {
  const id = ruleDepartment(texts(offer));
  return id ? DEPARTMENTS[id] : brands?.get(brandKey(offer.title));
}

// ---------- Groups within a department ----------

export const OTHER_GROUP = "Sonstiges";

const MEAT_CUT = /braten|gulasch|schnitzel|eisbein|steak|kotelett|geschnetzeltes|filet/;

/** Display orders; the rules below can only name these groups. */
const MEAT_ORDER = [
  "Schwein",
  "Rind & Kalb",
  "Geflügel",
  "Lamm & Wild",
  "Hackfleisch & Burger",
  "Wurst & Aufschnitt",
  "Schinken & Speck",
] as const;
const DRINK_ORDER = [
  "Wasser",
  "Saft",
  "Limonade & Eistee",
  "Bier",
  "Wein, Sekt & Glühwein",
  "Spirituosen",
] as const;
const SWEET_ORDER = [
  "Kaffee & Tee",
  "Schokolade & Pralinen",
  "Gebäck & Kekse",
  "Fruchtgummi & Bonbons",
  "Chips & Knabbereien",
] as const;

const MEAT_GROUPS: readonly Rule<(typeof MEAT_ORDER)[number]>[] = [
  [
    "Wurst & Aufschnitt",
    {
      name: /wurst|wiener\b|salami|aufschnitt|\bmett\b|leberkase|sulze|kabanos|krakauer|knacki|lyoner|pastrami|heidefruhstuck|fruhstucksfleisch|in aspik|hahnchenbraten|putenbrust\b/,
      desc: /wurstchen/,
    },
  ],
  ["Hackfleisch & Burger", { name: /hackfleisch|cevapcici|hamburger|burger|frikadelle|bouletten/ }],
  ["Geflügel", { name: /hahnchen|chicken|\bpute|geflugel|\bente\b|\bgans\b/ }],
  ["Lamm & Wild", { name: /\blamm|hirsch|\bwild|kaninchen|\bracks\b/ }],
  [
    "Rind & Kalb",
    {
      name: /\brind|rinder|jungbulle|\bkalb|beef|roastbeef|entrecote|tafelspitz|huftsteak|rib-eye|flanksteak/,
      desc: /^vom (rind|jungbullen|kalb)|vom black angus/,
    },
  ],
  ["Schwein", { name: /schwein|kasseler|piglet/, desc: /vom schwein|aus dem schwein/ }],
  ["Schinken & Speck", { name: /schinken|speck\b|bacon|serrano|kaiserfleisch/, not: MEAT_CUT }],
  [
    "Schwein",
    { name: /braten|gulasch|schnitzel|eisbein|kotelett|ripp|nacken|bauch|pokel|geschnetzeltes/ },
  ],
];

const DRINK_GROUPS: readonly Rule<(typeof DRINK_ORDER)[number]>[] = [
  [
    "Bier",
    {
      name: /\bbier|bier\b|pils|\blager\b|radler|brau\b|tannenzapfle|mixery/,
      sub: /\bhell\b|^alkoholfrei/,
      desc: /\bbier\b|\bpils\b|bierspezialitat|biermischgetrank|bugelflasche/,
      not: /wein|sekt|secco|likor|punsch/,
    },
  ],
  [
    "Wein, Sekt & Glühwein",
    {
      name: /(?<!sch)wein|sekt|prosecco|secco|punsch|bowle|riesling|dornfelder|chardonnay|merlot|cabernet|primitivo|burgunder|rioja|grigio|silvaner|trollinger|imiglykos|cider|gluh/,
      desc: /qualitatswein|schaumwein|tafelwein|pradikatswein|\bsecco\b|^(italien|spanien|kalifornien|pfalz|baden)\b/,
    },
  ],
  [
    "Spirituosen",
    {
      name: /wodka|vodka|whisk|\bgin\b|\brum\b|likor|liqueur|tequila|aperitif|aperitivo|bitter\b|ouzo|sambuca|spirituose|mixgetrank|weinbrand|korn\b/,
      desc: /vol\. ?%|spirituose|likor|kornbrand/,
    },
  ],
  [
    "Wasser",
    { name: /mineralwasser|wasser\b|\baqua\b|naturelle/, desc: /^(naturliches )?mineralwasser/ },
  ],
  ["Saft", { name: /saft|nektar|smoothie|-shot\b|wurzmittel/, desc: /^frucht(saft|nektar)/ }],
  [
    "Limonade & Eistee",
    {
      name: /erfrischungsgetrank|limonade|\bcola\b|eistee|ice tea|teegetrank|teegenuss|energy|sports drink|tonic|sirup|malz/,
      desc: /erfrischungsgetrank|limonade|koffeinhaltig/,
    },
  ],
  ["Bier", { unit: /\bka\. (20|24|11) x 0,(5|33)-l/ }],
];

const SWEET_GROUPS: readonly Rule<(typeof SWEET_ORDER)[number]>[] = [
  [
    "Kaffee & Tee",
    {
      name: /kaffee|caffe|espresso|cappuccino|\bcrema\b|tee\b|teegenuss|kakao|matcha|kapseln|pads\b|capsa|prodomo|nescafe/,
      desc: /rostkaffee|bohnenkaffee/,
    },
  ],
  [
    "Fruchtgummi & Bonbons",
    {
      name: /fruchtgummi|gummi|bonbon|lakritz|kaugummi|lollies|pastillen|hitschies|maoam|cremelife/,
      desc: /fruchtgummi|kaubonbon/,
    },
  ],
  [
    "Chips & Knabbereien",
    {
      name: /chips|knabber|snack|erdnuss-?locken|nic nac|sticks\b|stangli|flips|pretzel|bake rolls|erdnusse|pistazien/,
      not: /schoko/,
    },
  ],
  [
    "Gebäck & Kekse",
    {
      name: /keks|geback|butterblatter|waffel|lebkuchen|spekulatius|domino|kuchlein|prinzen|leibniz/,
      not: /schokoriegel/,
    },
  ],
  [
    "Schokolade & Pralinen",
    {
      name: /schoko|praline|riegel|weihnachtsmann|toffifee|kusschen|baumbehang|puffreis|nougat|marzipan|fasschen|konfekt|kugeln|\bkinder\b|lindt|milka|ferrero|duplo|hanuta|yogurette|halloren|dickmann|kitkat|m&m|nutella|kaba\b/,
      desc: /schoko|kakaocreme|pralinen|riegel/,
    },
  ],
];

interface Grouping {
  /** Display order; `OTHER_GROUP` follows. */
  order: readonly string[];
  /** The first pattern that matches decides, so their order differs from the display order. */
  rules: readonly Rule<string>[];
}

/** Checks that the rules only name groups of the display order. */
function grouping<const O extends readonly string[]>(
  order: O,
  rules: readonly Rule<O[number]>[],
): Grouping {
  return { order, rules };
}

const PRODUCE = grouping(
  ["Obst", "Gemüse & Salat", "Nüsse & Trockenfrüchte", "Blumen & Pflanzen"],
  [
    [
      "Blumen & Pflanzen",
      {
        name: /weihnachtsstern|zauberstern|amaryllis|christrose|strauss|gesteck|schnittgrun|kaktus|orchidee|alpenveilchen|hyazinthe|kalanchoe|sukkulente|chrysanthemen|bepflanzt|rosen\b|tulpen/,
        desc: /\btopf\b/,
      },
    ],
    [
      "Nüsse & Trockenfrüchte",
      { name: /nuss|maronen|getrocknet|datteln|mandeln|pistazien/, desc: /^getrocknet/ },
    ],
    [
      "Obst",
      {
        name: /apfel|birne|trauben|clementinen|mandarinen|orangen|zitronen|limetten|grapefruit|kaki|kiwi|mango|melone|papaya|ananas|bananen|beeren|pflaumen|passionsfrucht|avocado|kirschen|pfirsich|nektarinen|aprikosen|feigen/,
      },
    ],
    [
      "Gemüse & Salat",
      {
        name: /tomaten|gurke|paprika|zucchini|aubergine|mohren|karotten|kartoffeln|zwiebeln|salat|kohl|broccoli|sellerie|rote bete|radieschen|bohnen|schoten|champignons|pilze|ingwer|suppengrun|lauch|pastinaken|petersilie|spinat|spargel|kurbis|knoblauch|krauter|rucola|fenchel|mais\b/,
      },
    ],
  ],
);

const FISH = grouping(
  ["Frischer Fisch", "Geräuchert & mariniert", "Meeresfrüchte"],
  [
    ["Meeresfrüchte", { name: /muscheln|garnelen|krebs|prawns|tintenfisch|calamari|scampi/ }],
    [
      "Geräuchert & mariniert",
      {
        name: /gerauchert|hering|matjes|rollmops|salat|stremel|graved/,
        desc: /gerauchert|mariniert/,
      },
    ],
    [
      "Frischer Fisch",
      { name: /filet|lachs|dorade|heilbutt|barsch|forelle|kabeljau|fisch|thunfisch|scholle/ },
    ],
  ],
);

const DAIRY = grouping(
  ["Käse", "Joghurt & Desserts", "Milch & Sahne", "Butter & Fette", "Eier"],
  [
    [
      "Käse",
      {
        name: /kase|gouda|emmentaler|camembert|mozzarella|\bfeta\b|cheddar|limburger|raclette|parmigiano|grana padano|appenzeller|gruyere|manchego|roquefort|morbier|fondue|quase|hausmacher|cheese|leerdammer|\bkiri\b/,
        desc: /fett i\. ?tr|schnittkase|weichkase|hartkase|frischkase|sauermilchkase/,
        not: /kasekuchen|quark/,
      },
    ],
    [
      "Joghurt & Desserts",
      {
        name: /joghurt|jogurt|skyr|quark|pudding|dessert|mousse|grutze|milchreis|\bmonte\b|pingui|actimel|choco fresh|tortenstuck|edelcreme/,
        desc: /joghurt|dessert|^pudding/,
      },
    ],
    [
      "Butter & Fette",
      {
        name: /butter\b|butterschmalz|margarine|streichfett|pflanzencreme|kokosfett|\blatta\b|\brama\b|sanella|kaergarden|finello/,
        desc: /streichfett|aufstrich/,
        not: /buttermilch|cremefine/,
      },
    ],
    ["Eier", { name: /\beier\b|eiklar/ }],
    [
      "Milch & Sahne",
      {
        name: /milch|sahne|creme fraiche|cremefine|schmand|kefir|ayran|kakao|kaffeemischgetrank|trinkmahlzeit/,
        desc: /kondensmilch/,
      },
    ],
  ],
);

const FROZEN = grouping(
  [
    "Eis",
    "Pizza & Snacks",
    "Fisch",
    "Fleisch & Geflügel",
    "Kartoffeln & Klöße",
    "Gemüse & Obst",
    "Fertiggerichte",
    "Kuchen & Backwaren",
  ],
  [
    ["Eis", { name: /\beis\b|cremissimo/ }],
    ["Fertiggerichte", { name: /vegan|fertiggericht|gerichte|a la carte/ }],
    [
      "Pizza & Snacks",
      // "snack" and "burger" on the product name only: SNACKMASTER, BRANDENBURGER
      {
        name: /pizza|flammkuchen|piccolinis|toast|fingerfood|baguette|rustipani|ofenbrot/,
        sub: /snack/,
      },
    ],
    [
      "Fisch",
      { name: /fisch|lachs|garnelen|prawns|filegro|schlemmer-filet|makrele|seelachs|muscheln/ },
    ],
    [
      "Fleisch & Geflügel",
      {
        name: /\bente\b|gans\b|\bpute|hirsch|wild|kaninchen|chicken|hahnchen|schnitzel|cordon|gyros|braten|gulasch|frikadelle/,
        sub: /burger/,
      },
    ],
    [
      "Kartoffeln & Klöße",
      { name: /pommes|kroketten|frites|fritten|kartoffel|klosse|knodel|rosti/ },
    ],
    [
      "Kuchen & Backwaren",
      {
        name: /kuchen|torte|strudel|\bcake\b|brotchen|brezen|semmeln|goldstucke|sahne-rolle|croissant/,
      },
    ],
    ["Gemüse & Obst", { name: /gemuse|spinat|beeren|krauter|erbsen|bohnen|kohl\b|obst/ }],
    ["Fertiggerichte", { name: /pfanne|nudel|pasta|lasagne/, desc: /fertiggericht/ }],
  ],
);

const DELI = grouping(
  ["Feinkost & Salate", "Fertiggerichte & Teige", "Saucen, Öl & Gewürze", "Konserven"],
  [
    [
      "Feinkost & Salate",
      {
        name: /salat\b|antipasti|peppers|peperoni|florini|lachs|graved|surimi|vegan|brotaufstrich|bouletten|oliven\b/,
        desc: /gefullt mit|frischkase/,
        not: /salatcreme/,
      },
    ],
    [
      "Fertiggerichte & Teige",
      {
        name: /eintopf|fertiggericht|suppe|gulasch|curry king|tortelloni|gnocchi|tradizionali|teig\b|pizzakit|knodel|ravioli/,
      },
    ],
    [
      "Saucen, Öl & Gewürze",
      {
        name: /ketchup|\bsenf|mayonnaise|salatcreme|sauce|essig|ol\b|gewurz|zimt|mildessa|wurz|dressing/,
      },
    ],
    [
      "Konserven",
      {
        name: /mais\b|champignons|zwiebeln|hulsenfruchte|gemuse|tomaten|heidelbeeren|mandarin|fruchtmus|apfelmus|rotkohl|gurken|spreelinge|schlemmertopfchen|hering|thunfisch|sardinen|makrele|bohnen|erbsen|sauerkraut|ananas|pfirsich/,
      },
    ],
  ],
);

const STAPLES = grouping(
  [
    "Brot & Backwaren",
    "Nudeln, Reis & Suppen",
    "Müsli & Cerealien",
    "Aufstriche & Honig",
    "Backen & Zucker",
    "Nüsse & Trockenfrüchte",
  ],
  [
    [
      "Brot & Backwaren",
      {
        name: /brot(chen)?\b|toast|croissant|^berliner\/|-berliner\b|brezel|baguette|donut|bagel|muffin|stange\b|krustchen|burli|pizza|hot dog|waffel|wafer|ohne gleichen|pains? au|pancakes|kuchen|rolle\b/,
        desc: /geback\b|plunderteig|brot\b|geschnitten/,
        not: /pfannkuchen- oder/,
      },
    ],
    [
      "Aufstriche & Honig",
      {
        name: /nuss-?nugat-creme|nuss-?creme|erdnusscreme|honig|konfiture|sirup|fruchtcreme|gourmet-fruhstuck/,
      },
    ],
    ["Müsli & Cerealien", { name: /musli|cerealien|haferflocken|porridge|flakes/ }],
    [
      "Nudeln, Reis & Suppen",
      {
        name: /nudel|pasta|pesto|teigware|spaghetti|fusilli|\breis\b|basmati|suppe|bruhe|bouillon|sosse|\bfix\b|terrine/,
      },
    ],
    [
      "Backen & Zucker",
      { name: /zucker|mehl\b|oblaten|geraspelt|raspel|flocken|shaker|backmischung/ },
    ],
    [
      "Nüsse & Trockenfrüchte",
      {
        name: /nuss|nuts|kerne\b|mandeln|pistazien|cashew|studentenfutter|datteln|aprikosen|blaubeeren|samen\b/,
        desc: /^getrocknet/,
      },
    ],
  ],
);

const DRUGSTORE = grouping(
  [
    "Körperpflege",
    "Waschen & Reinigen",
    "Papier & Haushalt",
    "Baby",
    "Tiernahrung",
    "Sport & Protein",
  ],
  [
    ["Tiernahrung", { name: /hunde|katzen|\bcesar\b|\bfelix\b|whiskas|dreamies|purina/ }],
    ["Baby", { name: /windeln|\bpants\b|pampers|\bhipp\b|quetschbeutel|smelties/ }],
    ["Sport & Protein", { name: /protein|\bwhey\b|creatin|kreatin|low sugar/ }],
    ["Papier & Haushalt", { name: /toilettenpapier|kuchentucher|taschentucher|backpapier/ }],
    [
      "Waschen & Reinigen",
      {
        name: /waschmittel|weichspuler|reiniger|spulmittel|spuler|spulmaschinen|geschirr|\bwc|tabs\b|entharter|erfrischer|wascheparfum|hygiene|allzweck|\bbref\b|bad total|\bfrosch\b/,
        desc: /gegen kalk|reiniger\b/,
      },
    ],
    [
      "Körperpflege",
      {
        name: /dusch|\bdeo|shampoo|spulung|haar|zahn|mund|rasier|creme\b|lippen|seife|gesichts|slipeinlagen|tagespflege|coloration|bodyspray|hydro|burstenkopfe|sonicare|falten|pflege|reinigungstucher/,
      },
    ],
  ],
);

const ELECTRO = grouping(
  [
    "TV & Audio",
    "Küchengeräte",
    "Haushaltsgeräte",
    "Körperpflege",
    "Technik & Zubehör",
    "Batterien & Leuchtmittel",
    "Büro & Schreibwaren",
  ],
  [
    [
      "Batterien & Leuchtmittel",
      { name: /batterien|knopfzellen|led-birnen|led-filament|led-reflektoren|taschenlampe/ },
    ],
    [
      "Körperpflege",
      {
        name: /rasierer|haartrockner|haarschneider|trimmer|epilierer|groomer|sonicare|zahnburste|reinigungskartuschen/,
      },
    ],
    [
      "TV & Audio",
      {
        name: /\btv\b|-tv\b|lautsprecher|soundbar|kopfhorer|beamer|karaoke|projektor|wandhalterung|radio/,
      },
    ],
    [
      "Küchengeräte",
      {
        name: /toaster|wasserkocher|mixer|fritteuse|mikrowelle|kuchenmaschine|vollautomat|padmaschine|eierkocher|grill\b|sandwichmaker|zerkleinerer|smoothiemaker|partypfanne|pizza-ofen|waffeleisen/,
      },
    ],
    ["Haushaltsgeräte", { name: /sauger|saugroboter|bugel|dampf|nahmaschine|bohrmaschine/ }],
    [
      "Technik & Zubehör",
      {
        name: /powerbank|smartwatch|ladegerat|drucker|kamera|\bps5\b|playstation|nintendo|xbox|funkwecker|usb/,
      },
    ],
    ["Büro & Schreibwaren", { name: /marker|stifte|gelschreiber|schreiber|papier|ordner/ }],
  ],
);

const HOME = grouping(
  ["Kochen & Küche", "Putzen & Wäsche", "Deko & Beleuchtung", "Aufbewahrung & Möbel"],
  [
    [
      "Deko & Beleuchtung",
      {
        name: /deko|lichter|\bled-|kerzen|teelicht|weihnacht|nikolaus|aufhanger|sticker|geschenkbox|malset|windlicht/,
      },
    ],
    [
      "Putzen & Wäsche",
      {
        name: /wischer|wischmop|wischtuch|staub|swiffer|wasche(stander|trockner)|bugeltisch|kehr|abzieher|reiniger|teleskopstiel|tucher\b|starter-set/,
      },
    ],
    [
      "Kochen & Küche",
      {
        name: /pfanne|topf|besteck|messer|schneidebrett|backform|auflaufform|\bwok|becher|isolier|glaser|kanne|wasserfilter|wasserflter|sodastream|sprudler|zylinder|flasche|gebackdose|entkalker/,
      },
    ],
    [
      "Aufbewahrung & Möbel",
      {
        name: /box\b|regal|schrank|garderobe|hocker|kommode|korb|multibag|schale\b|tierhohle|haustierbett/,
      },
    ],
  ],
);

const LEISURE = grouping(
  ["Bekleidung & Schuhe", "Taschen & Koffer", "Heimtextilien", "Spielzeug", "Auto", "Feuerwerk"],
  [
    ["Feuerwerk", { name: /feuerwerk|knallerbsen|fontanen|bengal/ }],
    [
      "Spielzeug",
      {
        name: /spielset|bauset|\blego|puppe|plusch|puzzle|kartenspiel|rennbahn|\brc-|fahrzeug|horfigur|eisenbahn|\blok\b|feuerwehrlok|erweiterungs-set|blaster|mikroskop|bastelset|stifte-set|walkie|parkgarage|magnetwurfel|schlusselanhanger|figur|leuchtstab|puppenhaus|frisiertisch|kostum|perucke|kamera|monster|3-in-1/,
      },
    ],
    [
      "Auto",
      {
        name: /motorenol|frostschutz|enteiser|adblue|\bkfz|garage|flachbalkenwischer|\bsitz|kofferraum|eiskratzer|starthilfe|autoscheiben|kuhler/,
      },
    ],
    [
      "Heimtextilien",
      {
        name: /bettwasche|kissen|steppbett|kuscheldecke|handtuch|duschtuch|gastetuch|vorhang|tischdecke/,
      },
    ],
    ["Taschen & Koffer", { name: /rucksack|tasche\b|gymbag|trolley|koffer\b/ }],
    [
      "Bekleidung & Schuhe",
      {
        name: /damen|herren|kinder|socken|strumpf|pyjama|pullover|hose\b|jacke|weste\b|schuhe|stiefel|boots|leggings|shirt|hoodie|beanie|slips|unterhemd|boxer|shorts|unterwasche|overall/,
      },
    ],
  ],
);

const GROUPINGS: ReadonlyMap<string, Grouping> = new Map<string, Grouping>([
  [DEPARTMENTS.produce, PRODUCE],
  [DEPARTMENTS.meat, { order: MEAT_ORDER, rules: MEAT_GROUPS }],
  [DEPARTMENTS.fish, FISH],
  [DEPARTMENTS.dairy, DAIRY],
  [DEPARTMENTS.frozen, FROZEN],
  [DEPARTMENTS.deli, DELI],
  [DEPARTMENTS.staples, STAPLES],
  [DEPARTMENTS.sweets, { order: SWEET_ORDER, rules: SWEET_GROUPS }],
  [DEPARTMENTS.drinks, { order: DRINK_ORDER, rules: DRINK_GROUPS }],
  [DEPARTMENTS.drugstore, DRUGSTORE],
  [DEPARTMENTS.electro, ELECTRO],
  [DEPARTMENTS.home, HOME],
  [DEPARTMENTS.leisure, LEISURE],
]);

/** The groups a department is split into, in display order; empty for an unknown one. */
export function groupsOf(department: string): string[] {
  const grouping = GROUPINGS.get(department);
  return grouping ? [...grouping.order, OTHER_GROUP] : [];
}

/** The offer's group within its department; undefined when the department has no groups. */
export function groupOf(offer: Classifiable, department: string): string | undefined {
  const grouping = GROUPINGS.get(department);
  return grouping && (firstMatch(grouping.rules, texts(offer)) ?? OTHER_GROUP);
}
