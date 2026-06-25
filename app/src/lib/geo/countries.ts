// ISO 3166-1 alpha-2 country codes and English short names, used to (a) drive
// the "find an IPT near you" country picker and (b) guess an ISO code from
// the free-text ChecklistMetadata.geo_country field (which predates this
// feature and was never constrained to a code — see PublishMetadataPage.tsx).
export const ISO_COUNTRIES: { code: string; name: string }[] = [
  { code: "AF", name: "Afghanistan" }, { code: "AL", name: "Albania" }, { code: "DZ", name: "Algeria" },
  { code: "AD", name: "Andorra" }, { code: "AO", name: "Angola" }, { code: "AR", name: "Argentina" },
  { code: "AM", name: "Armenia" }, { code: "AU", name: "Australia" }, { code: "AT", name: "Austria" },
  { code: "AZ", name: "Azerbaijan" }, { code: "BS", name: "Bahamas" }, { code: "BH", name: "Bahrain" },
  { code: "BD", name: "Bangladesh" }, { code: "BB", name: "Barbados" }, { code: "BY", name: "Belarus" },
  { code: "BE", name: "Belgium" }, { code: "BZ", name: "Belize" }, { code: "BJ", name: "Benin" },
  { code: "BT", name: "Bhutan" }, { code: "BO", name: "Bolivia" }, { code: "BA", name: "Bosnia and Herzegovina" },
  { code: "BW", name: "Botswana" }, { code: "BR", name: "Brazil" }, { code: "BN", name: "Brunei" },
  { code: "BG", name: "Bulgaria" }, { code: "BF", name: "Burkina Faso" }, { code: "BI", name: "Burundi" },
  { code: "KH", name: "Cambodia" }, { code: "CM", name: "Cameroon" }, { code: "CA", name: "Canada" },
  { code: "CV", name: "Cabo Verde" }, { code: "CF", name: "Central African Republic" }, { code: "TD", name: "Chad" },
  { code: "CL", name: "Chile" }, { code: "CN", name: "China" }, { code: "CO", name: "Colombia" },
  { code: "KM", name: "Comoros" }, { code: "CG", name: "Congo" }, { code: "CD", name: "Congo, Democratic Republic of the" },
  { code: "CR", name: "Costa Rica" }, { code: "CI", name: "Cote D'Ivoire" }, { code: "HR", name: "Croatia" },
  { code: "CU", name: "Cuba" }, { code: "CY", name: "Cyprus" }, { code: "CZ", name: "Czech Republic" },
  { code: "DK", name: "Denmark" }, { code: "DJ", name: "Djibouti" }, { code: "DM", name: "Dominica" },
  { code: "DO", name: "Dominican Republic" }, { code: "EC", name: "Ecuador" }, { code: "EG", name: "Egypt" },
  { code: "SV", name: "El Salvador" }, { code: "GQ", name: "Equatorial Guinea" }, { code: "ER", name: "Eritrea" },
  { code: "EE", name: "Estonia" }, { code: "SZ", name: "Eswatini" }, { code: "ET", name: "Ethiopia" },
  { code: "FJ", name: "Fiji" }, { code: "FI", name: "Finland" }, { code: "FR", name: "France" },
  { code: "GA", name: "Gabon" }, { code: "GM", name: "Gambia" }, { code: "GE", name: "Georgia" },
  { code: "DE", name: "Germany" }, { code: "GH", name: "Ghana" }, { code: "GR", name: "Greece" },
  { code: "GD", name: "Grenada" }, { code: "GT", name: "Guatemala" }, { code: "GN", name: "Guinea" },
  { code: "GW", name: "Guinea-Bissau" }, { code: "GY", name: "Guyana" }, { code: "HT", name: "Haiti" },
  { code: "HN", name: "Honduras" }, { code: "HK", name: "Hong Kong" }, { code: "HU", name: "Hungary" },
  { code: "IS", name: "Iceland" }, { code: "IN", name: "India" }, { code: "ID", name: "Indonesia" },
  { code: "IR", name: "Iran" }, { code: "IQ", name: "Iraq" }, { code: "IE", name: "Ireland" },
  { code: "IL", name: "Israel" }, { code: "IT", name: "Italy" }, { code: "JM", name: "Jamaica" },
  { code: "JP", name: "Japan" }, { code: "JO", name: "Jordan" }, { code: "KZ", name: "Kazakhstan" },
  { code: "KE", name: "Kenya" }, { code: "KI", name: "Kiribati" }, { code: "KW", name: "Kuwait" },
  { code: "KG", name: "Kyrgyzstan" }, { code: "LA", name: "Laos" }, { code: "LV", name: "Latvia" },
  { code: "LB", name: "Lebanon" }, { code: "LS", name: "Lesotho" }, { code: "LR", name: "Liberia" },
  { code: "LY", name: "Libya" }, { code: "LI", name: "Liechtenstein" }, { code: "LT", name: "Lithuania" },
  { code: "LU", name: "Luxembourg" }, { code: "MG", name: "Madagascar" }, { code: "MW", name: "Malawi" },
  { code: "MY", name: "Malaysia" }, { code: "MV", name: "Maldives" }, { code: "ML", name: "Mali" },
  { code: "MT", name: "Malta" }, { code: "MR", name: "Mauritania" }, { code: "MU", name: "Mauritius" },
  { code: "MX", name: "Mexico" }, { code: "MD", name: "Moldova" }, { code: "MC", name: "Monaco" },
  { code: "MN", name: "Mongolia" }, { code: "ME", name: "Montenegro" }, { code: "MA", name: "Morocco" },
  { code: "MZ", name: "Mozambique" }, { code: "MM", name: "Myanmar" }, { code: "NA", name: "Namibia" },
  { code: "NP", name: "Nepal" }, { code: "NL", name: "Netherlands" }, { code: "NZ", name: "New Zealand" },
  { code: "NI", name: "Nicaragua" }, { code: "NE", name: "Niger" }, { code: "NG", name: "Nigeria" },
  { code: "KP", name: "North Korea" }, { code: "MK", name: "North Macedonia" }, { code: "NO", name: "Norway" },
  { code: "OM", name: "Oman" }, { code: "PK", name: "Pakistan" }, { code: "PA", name: "Panama" },
  { code: "PG", name: "Papua New Guinea" }, { code: "PY", name: "Paraguay" }, { code: "PE", name: "Peru" },
  { code: "PH", name: "Philippines" }, { code: "PL", name: "Poland" }, { code: "PT", name: "Portugal" },
  { code: "QA", name: "Qatar" }, { code: "RO", name: "Romania" }, { code: "RU", name: "Russia" },
  { code: "RW", name: "Rwanda" }, { code: "SA", name: "Saudi Arabia" }, { code: "SN", name: "Senegal" },
  { code: "RS", name: "Serbia" }, { code: "SC", name: "Seychelles" }, { code: "SL", name: "Sierra Leone" },
  { code: "SG", name: "Singapore" }, { code: "SK", name: "Slovakia" }, { code: "SI", name: "Slovenia" },
  { code: "SB", name: "Solomon Islands" }, { code: "SO", name: "Somalia" }, { code: "ZA", name: "South Africa" },
  { code: "KR", name: "South Korea" }, { code: "SS", name: "South Sudan" }, { code: "ES", name: "Spain" },
  { code: "LK", name: "Sri Lanka" }, { code: "SD", name: "Sudan" }, { code: "SR", name: "Suriname" },
  { code: "SE", name: "Sweden" }, { code: "CH", name: "Switzerland" }, { code: "SY", name: "Syria" },
  { code: "TW", name: "Taiwan" }, { code: "TJ", name: "Tajikistan" }, { code: "TZ", name: "Tanzania" },
  { code: "TH", name: "Thailand" }, { code: "TL", name: "Timor-Leste" }, { code: "TG", name: "Togo" },
  { code: "TO", name: "Tonga" }, { code: "TT", name: "Trinidad and Tobago" }, { code: "TN", name: "Tunisia" },
  { code: "TR", name: "Turkey" }, { code: "TM", name: "Turkmenistan" }, { code: "UG", name: "Uganda" },
  { code: "UA", name: "Ukraine" }, { code: "AE", name: "United Arab Emirates" }, { code: "GB", name: "United Kingdom" },
  { code: "US", name: "United States" }, { code: "UY", name: "Uruguay" }, { code: "UZ", name: "Uzbekistan" },
  { code: "VU", name: "Vanuatu" }, { code: "VE", name: "Venezuela" }, { code: "VN", name: "Vietnam" },
  { code: "YE", name: "Yemen" }, { code: "ZM", name: "Zambia" }, { code: "ZW", name: "Zimbabwe" },
];

const ALIASES: Record<string, string> = {
  USA: "US",
  "UNITED STATES OF AMERICA": "US",
  "U.S.A.": "US",
  "U.S.": "US",
  UK: "GB",
  "UNITED KINGDOM OF GREAT BRITAIN AND NORTHERN IRELAND": "GB",
  "GREAT BRITAIN": "GB",
  "SOUTH KOREA": "KR",
  "REPUBLIC OF KOREA": "KR",
  "NORTH KOREA": "KP",
  "DEMOCRATIC PEOPLE'S REPUBLIC OF KOREA": "KP",
  RUSSIA: "RU",
  "RUSSIAN FEDERATION": "RU",
  "DR CONGO": "CD",
  "DRC": "CD",
  "IVORY COAST": "CI",
  VIETNAM: "VN",
  "VIET NAM": "VN",
  LAOS: "LA",
  "LAO PDR": "LA",
  TANZANIA: "TZ",
  "UNITED REPUBLIC OF TANZANIA": "TZ",
  CZECHIA: "CZ",
  "CZECH REPUBLIC": "CZ",
  SWAZILAND: "SZ",
  MYANMAR: "MM",
  BURMA: "MM",
};

/** Best-effort match from free text (a 2-letter code, an exact name, or a known alias) to an ISO-3166-1 alpha-2 code. Returns null rather than guessing wrong. */
export function guessCountryCode(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (trimmed.length === 2) {
    const code = trimmed.toUpperCase();
    if (ISO_COUNTRIES.some((c) => c.code === code)) return code;
  }

  const upper = trimmed.toUpperCase();
  if (ALIASES[upper]) return ALIASES[upper];

  const byName = ISO_COUNTRIES.find((c) => c.name.toUpperCase() === upper);
  return byName?.code ?? null;
}

// Transboundary bioregions don't map to one country, so a checklist whose
// only geography signal is a region name like "Eastern Himalaya" can't be
// resolved to a single exact country the way guessCountryCode resolves
// "Nepal" — this gives a short list of *candidate* countries to suggest
// instead, which the publish flow presents as picks, never auto-applies.
const BIOREGION_HINTS: { keyword: string; countries: string[] }[] = [
  { keyword: "eastern himalaya", countries: ["NP", "IN", "BT", "CN"] },
  { keyword: "western himalaya", countries: ["IN", "PK", "NP", "CN"] },
  { keyword: "himalaya", countries: ["NP", "IN", "BT", "PK", "CN"] },
  { keyword: "western ghats", countries: ["IN"] },
  { keyword: "indochina", countries: ["VN", "LA", "KH", "TH", "MM"] },
  { keyword: "mekong", countries: ["TH", "LA", "VN", "KH", "MM", "CN"] },
  { keyword: "amazon", countries: ["BR", "PE", "CO", "EC", "BO", "VE"] },
  { keyword: "andes", countries: ["PE", "BO", "EC", "CO", "CL", "AR"] },
  { keyword: "patagonia", countries: ["AR", "CL"] },
  { keyword: "sahel", countries: ["NE", "ML", "TD", "BF", "SN", "MR"] },
  { keyword: "congo basin", countries: ["CD", "CG", "CM", "CF", "GA"] },
  { keyword: "horn of africa", countries: ["ET", "SO", "DJ", "ER"] },
  { keyword: "caribbean", countries: ["JM", "TT", "BB", "BS", "DO", "CU"] },
  { keyword: "mediterranean", countries: ["IT", "GR", "ES", "FR", "TR", "MA"] },
];

/** Candidate countries for a transboundary bioregion name (e.g. "Eastern Himalaya") — never a confident single match, just suggestions for the user to pick from. */
export function guessNearbyCountries(regionName: string | null | undefined): string[] {
  if (!regionName) return [];
  const lower = regionName.toLowerCase();
  const hit = BIOREGION_HINTS.find((h) => lower.includes(h.keyword));
  return hit?.countries ?? [];
}
