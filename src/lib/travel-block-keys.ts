/**
 * Whitelisted travel dashboard `block_key` slots.
 * Keys are semantic slot names only — never booking refs, passport numbers,
 * or personal identifiers.
 *
 * Base form: `travel_<slot>` (e.g. `travel_overview`).
 * Multi-trip form: `travel_<trip>_<slot>` where `<trip>` is a lowercase
 * slug (e.g. `travel_kl2027_overview`).
 *
 * FAKE: slot names for fixtures / agents; not live booking identifiers.
 */

export const TRAVEL_BLOCK_SLOTS = [
  "overview",
  "transport",
  "stays",
  "itinerary",
  "documents",
  "budget",
  "todos",
  "packing_emergency",
  "candidates",
] as const;

export type TravelBlockSlot = (typeof TRAVEL_BLOCK_SLOTS)[number];

/** Base keys without trip slug (docs / allowed-list display). */
export const TRAVEL_BLOCK_KEYS = TRAVEL_BLOCK_SLOTS.map(
  (slot) => `travel_${slot}` as const,
);

export type TravelBlockKeyBase = (typeof TRAVEL_BLOCK_KEYS)[number];

/** Trip slug: lowercase alnum, starting with a letter or digit; max 24. */
export const TRAVEL_TRIP_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,23}$/;

const SLOTS_BY_LENGTH = [...TRAVEL_BLOCK_SLOTS].sort(
  (a, b) => b.length - a.length,
);

export type ParsedTravelBlockKey = {
  trip: string | undefined;
  slot: TravelBlockSlot;
  /** Canonical key string. */
  key: string;
};

/**
 * Parse a travel block_key. Longest-suffix slot match so
 * `packing_emergency` wins over a shorter suffix.
 */
export function parseTravelBlockKey(
  key: string,
): ParsedTravelBlockKey | null {
  if (!key.startsWith("travel_")) return null;
  const rest = key.slice("travel_".length);
  for (const slot of SLOTS_BY_LENGTH) {
    if (rest === slot) {
      return { trip: undefined, slot, key };
    }
    const suffix = `_${slot}`;
    if (rest.endsWith(suffix)) {
      const trip = rest.slice(0, rest.length - suffix.length);
      if (TRAVEL_TRIP_SLUG_RE.test(trip)) {
        return { trip, slot, key };
      }
    }
  }
  return null;
}

export function isTravelBlockKey(key: string): boolean {
  return parseTravelBlockKey(key) !== null;
}

export function travelBlockKeyFor(
  slot: TravelBlockSlot,
  trip?: string,
): string {
  if (trip !== undefined) {
    if (!TRAVEL_TRIP_SLUG_RE.test(trip)) {
      throw new Error("invalid travel trip slug");
    }
    return `travel_${trip}_${slot}`;
  }
  return `travel_${slot}`;
}
