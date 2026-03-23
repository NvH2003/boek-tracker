/**
 * Vertaling van de (standaard) Goodreads-achtige genrelabels naar het Nederlands.
 * We gebruiken bewust ASCII-tekens zodat opslag/vergelijking stabiel blijft.
 */

const TRANSLATIONS_EN_TO_NL: Record<string, string> = {
  art: "Kunst",
  autobiography: "Autobiografie",
  biography: "Biografie",
  business: "Zakelijk",
  "chick lit": "Chicklit",
  "children's": "Kinderboeken",
  christian: "Christelijk",
  classics: "Klassiekers",
  comics: "Strips",
  contemporary: "Hedendaags",
  cookbooks: "Kookboeken",
  crime: "Misdaad",
  fantasy: "Fantasy",
  fiction: "Fictie",
  "gay and lesbian": "Gay en lesbisch",
  "graphic novels": "Stripverhalen",
  "historical fiction": "Historische fictie",
  history: "Geschiedenis",
  horror: "Horror",
  "humor and comedy": "Humor en komedie",
  erotica: "Erotiek",
  "magical realism": "Magisch realisme",
  manga: "Manga",
  memoir: "Memoires",
  music: "Muziek",
  mystery: "Mysterie",
  nonfiction: "Non-fictie",
  paranormal: "Paranormaal",
  philosophy: "Filosofie",
  poetry: "Poetrie",
  psychology: "Psychologie",
  religion: "Religie",
  romance: "Romantiek",
  science: "Wetenschap",
  "science fiction": "Sciencefiction",
  "self help": "Zelfhulp",
  suspense: "Spanning",
  spirituality: "Spiritualiteit",
  sports: "Sport",
  thriller: "Thriller",
  travel: "Reizen",
  "young adult": "Jong volwassenen",
};

function normalizeKey(s: string): string {
  const t = s
    .trim()
    .toLowerCase()
    // maak varianten van apostrof/quot consistent
    .replace(/[’‘]/g, "'")
    // laat letters/cijfers/spaties over
    .replace(/[^a-z0-9\s']/g, " ")
    .replace(/\s+/g, " ");
  return t;
}

export function translateGenreToDutch(label: string): string {
  const key = normalizeKey(label);
  return TRANSLATIONS_EN_TO_NL[key] ?? label;
}

