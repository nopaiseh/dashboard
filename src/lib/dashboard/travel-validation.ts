/**
 * Strict zod schemas for travel dashboard block payloads.
 * Times: ISO 8601 with explicit offset + IANA timezone (writers send local;
 * frontend displays as-is). Booking refs: at most `ref_tail` (≤2 chars) or
 * a booked flag — never full refs / passport / card / passwords.
 * FAKE fixtures only — never real booking data or personal identifiers.
 */

import { z } from "zod";
import {
  isTravelBlockKey,
  parseTravelBlockKey,
  type TravelBlockSlot,
} from "@/lib/travel-block-keys";
import {
  BODY_MAX,
  DASHBOARD_AMOUNT_MAX,
  DASHBOARD_EMPTY_TEXT_MAX,
  DASHBOARD_YEAR_MAX,
  DASHBOARD_YEAR_MIN,
  TITLE_MAX,
} from "@/lib/validation";

export const TRAVEL_DESTINATIONS_MAX = 8;
export const TRAVEL_DESTINATION_MAX = 80;
export const TRAVEL_COMPANIONS_MAX = 12;
export const TRAVEL_COMPANION_NAME_MAX = 40;
export const TRAVEL_STATUS_ITEMS_MAX = 20;
export const TRAVEL_LEGS_MAX = 20;
export const TRAVEL_STAYS_MAX = 20;
export const TRAVEL_DAYS_MAX = 31;
export const TRAVEL_DAY_ITEMS_MAX = 20;
export const TRAVEL_DOCUMENTS_MAX = 20;
export const TRAVEL_TODOS_MAX = 50;
export const TRAVEL_PACKING_MAX = 80;
export const TRAVEL_EMERGENCY_MAX = 12;
export const TRAVEL_CANDIDATES_MAX = 20;
export const TRAVEL_NOTE_MAX = 200;
export const TRAVEL_SERVICE_NUMBER_MAX = 16;
export const TRAVEL_TERMINAL_MAX = 40;
export const TRAVEL_ADDRESS_MAX = 200;
export const TRAVEL_PHONE_MAX = 24;
export const TRAVEL_CURRENCY_MAX = 8;
export const TRAVEL_REF_TAIL_MAX = 2;
export const TRAVEL_SOURCE_MAX = 40;

const IANA_TIME_ZONES: ReadonlySet<string> = new Set(
  Intl.supportedValuesOf("timeZone"),
);

/** ISO 8601 datetime with explicit offset (`+08:00` / `Z`), minutes required. */
export const TRAVEL_ISO_OFFSET_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/;

/** Budget / candidate amounts are non-negative only. */
const travelAmount = z
  .number()
  .finite()
  .min(0)
  .max(DASHBOARD_AMOUNT_MAX);

/**
 * Reject `javascript:` and URL-looking strings in free-text candidate fields.
 * Never logs the matched value.
 */
export function travelTextLooksLikeUrlOrScript(value: string): boolean {
  const trimmed = value.trim();
  if (/^javascript\s*:/i.test(trimmed)) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return true;
  if (/https?:\/\//i.test(trimmed)) return true;
  if (/www\./i.test(trimmed)) return true;
  return false;
}

const travelSafeText = (max: number, min = 0) =>
  z
    .string()
    .min(min)
    .max(max)
    .refine((s) => !travelTextLooksLikeUrlOrScript(s), {
      message: "urls and javascript: not allowed",
    });

/**
 * Validate ISO offset datetime: calendar components, Date.parse, and
 * offset in [-12:00, +14:00] (Z = 0).
 */
export function isValidTravelIsoOffsetDateTime(raw: string): boolean {
  if (!TRAVEL_ISO_OFFSET_RE.test(raw)) return false;
  const y = Number(raw.slice(0, 4));
  const mo = Number(raw.slice(5, 7));
  const d = Number(raw.slice(8, 10));
  const hh = Number(raw.slice(11, 13));
  const mm = Number(raw.slice(14, 16));
  if (y < DASHBOARD_YEAR_MIN || y > DASHBOARD_YEAR_MAX) return false;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  if (hh > 23 || mm > 59) return false;
  let ss = 0;
  let offsetIndex = 16;
  if (raw[16] === ":") {
    ss = Number(raw.slice(17, 19));
    if (ss > 59) return false;
    offsetIndex = 19;
  }
  const offsetPart = raw.slice(offsetIndex);
  if (offsetPart !== "Z") {
    const sign = offsetPart[0] === "-" ? -1 : 1;
    const oh = Number(offsetPart.slice(1, 3));
    const om = Number(offsetPart.slice(4, 6));
    if (om > 59) return false;
    const totalMin = sign * (oh * 60 + om);
    if (totalMin < -12 * 60 || totalMin > 14 * 60) return false;
  }
  // Reconstruct a UTC-comparable instant; reject if Date.parse fails or
  // calendar day does not round-trip (e.g. Feb 30).
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) return false;
  const asUtc = new Date(
    Date.UTC(y, mo - 1, d, hh, mm, ss),
  );
  if (
    asUtc.getUTCFullYear() !== y ||
    asUtc.getUTCMonth() !== mo - 1 ||
    asUtc.getUTCDate() !== d
  ) {
    return false;
  }
  return true;
}

const travelBlockKeySchema = z.string().refine(isTravelBlockKey, {
  message: "invalid travel block_key",
});

const travelDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((t) => {
    const y = Number(t.slice(0, 4));
    const m = Number(t.slice(5, 7));
    const d = Number(t.slice(8, 10));
    if (y < DASHBOARD_YEAR_MIN || y > DASHBOARD_YEAR_MAX) return false;
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    const dt = new Date(`${t}T00:00:00Z`);
    return (
      !Number.isNaN(dt.getTime()) &&
      dt.toISOString().slice(0, 10) === t
    );
  });

const travelMonth = z
  .string()
  .regex(/^\d{4}-\d{2}$/)
  .refine((t) => {
    const y = Number(t.slice(0, 4));
    const m = Number(t.slice(5, 7));
    return (
      y >= DASHBOARD_YEAR_MIN &&
      y <= DASHBOARD_YEAR_MAX &&
      m >= 1 &&
      m <= 12
    );
  });

const travelIsoOffsetDateTime = z
  .string()
  .min(1)
  .max(40)
  .refine(isValidTravelIsoOffsetDateTime, {
    message: "invalid ISO datetime with offset",
  });

const travelIanaTz = z
  .string()
  .min(1)
  .max(64)
  .refine((tz) => IANA_TIME_ZONES.has(tz), {
    message: "invalid IANA timezone",
  });

const travelRefTail = z.string().min(1).max(TRAVEL_REF_TAIL_MAX);

const bookingStatus = z.enum(["已订", "待订", "待定"]);
const documentStatus = z.enum(["已备", "未备"]);

const travelCurrency = z
  .string()
  .min(1)
  .max(TRAVEL_CURRENCY_MAX)
  .regex(/^[A-Za-z$¥€£]+$/);

/** Phones must use separators so privacy digit-run (≥9) does not trip. */
const travelPhone = z
  .string()
  .min(2)
  .max(TRAVEL_PHONE_MAX)
  .regex(/^[0-9+\-\s()]+$/)
  .refine((s) => !/\d{9,}/.test(s), {
    message: "phone must not contain 9+ consecutive digits",
  });

const overviewStatusItemSchema = z
  .object({
    label: z.string().min(1).max(TITLE_MAX),
    status: bookingStatus,
  })
  .strict();

const travelOverviewSchema = z
  .object({
    block_key: travelBlockKeySchema,
    title: z.string().max(TITLE_MAX).optional(),
    destinations: z
      .array(z.string().min(1).max(TRAVEL_DESTINATION_MAX))
      .min(1)
      .max(TRAVEL_DESTINATIONS_MAX),
    start_date: travelDate,
    end_date: travelDate,
    companions: z
      .array(z.string().min(1).max(TRAVEL_COMPANION_NAME_MAX))
      .max(TRAVEL_COMPANIONS_MAX),
    statuses: z
      .array(overviewStatusItemSchema)
      .max(TRAVEL_STATUS_ITEMS_MAX),
    note: z.string().max(TRAVEL_NOTE_MAX).optional(),
    empty_text: z.string().max(DASHBOARD_EMPTY_TEXT_MAX).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.end_date < val.start_date) {
      ctx.addIssue({
        code: "custom",
        message: "end_date must be on or after start_date",
        path: ["end_date"],
      });
    }
  });

const transportLegSchema = z
  .object({
    mode: z.enum(["flight", "train", "bus"]),
    service_number: z.string().min(1).max(TRAVEL_SERVICE_NUMBER_MAX),
    depart_at: travelIsoOffsetDateTime,
    depart_tz: travelIanaTz,
    arrive_at: travelIsoOffsetDateTime,
    arrive_tz: travelIanaTz,
    from_terminal: z.string().max(TRAVEL_TERMINAL_MAX).optional(),
    to_terminal: z.string().max(TRAVEL_TERMINAL_MAX).optional(),
    ref_tail: travelRefTail.optional(),
    booked: z.boolean().optional(),
    check_in: z.string().max(TITLE_MAX).optional(),
    baggage: z.string().max(TRAVEL_NOTE_MAX).optional(),
    status: bookingStatus,
    note: z.string().max(TRAVEL_NOTE_MAX).optional(),
  })
  .strict();

const travelTransportSchema = z
  .object({
    block_key: travelBlockKeySchema,
    title: z.string().max(TITLE_MAX).optional(),
    legs: z.array(transportLegSchema).max(TRAVEL_LEGS_MAX),
    empty_text: z.string().max(DASHBOARD_EMPTY_TEXT_MAX).optional(),
  })
  .strict();

const staySchema = z
  .object({
    name: z.string().min(1).max(TITLE_MAX),
    address: z.string().min(1).max(TRAVEL_ADDRESS_MAX),
    check_in_at: travelIsoOffsetDateTime,
    check_in_tz: travelIanaTz,
    check_out_at: travelIsoOffsetDateTime,
    check_out_tz: travelIanaTz,
    ref_tail: travelRefTail.optional(),
    booked: z.boolean().optional(),
    free_cancellation: z.boolean(),
    free_cancellation_until: travelIsoOffsetDateTime.optional(),
    status: bookingStatus.optional(),
    note: z.string().max(TRAVEL_NOTE_MAX).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.free_cancellation && val.free_cancellation_until === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "free_cancellation_until required when free_cancellation",
        path: ["free_cancellation_until"],
      });
    }
  });

const travelStaysSchema = z
  .object({
    block_key: travelBlockKeySchema,
    title: z.string().max(TITLE_MAX).optional(),
    stays: z.array(staySchema).max(TRAVEL_STAYS_MAX),
    empty_text: z.string().max(DASHBOARD_EMPTY_TEXT_MAX).optional(),
  })
  .strict();

const itineraryItemSchema = z
  .object({
    kind: z.enum(["sight", "restaurant", "reservation"]),
    title: z.string().min(1).max(TITLE_MAX),
    at: travelIsoOffsetDateTime.optional(),
    tz: travelIanaTz.optional(),
    transit_note: z.string().max(TRAVEL_NOTE_MAX).optional(),
    note: z.string().max(TRAVEL_NOTE_MAX).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if ((val.at !== undefined) !== (val.tz !== undefined)) {
      ctx.addIssue({
        code: "custom",
        message: "at and tz must be paired",
        path: val.at === undefined ? ["at"] : ["tz"],
      });
    }
  });

const itineraryDaySchema = z
  .object({
    date: travelDate,
    items: z.array(itineraryItemSchema).max(TRAVEL_DAY_ITEMS_MAX),
  })
  .strict();

const travelItinerarySchema = z
  .object({
    block_key: travelBlockKeySchema,
    title: z.string().max(TITLE_MAX).optional(),
    days: z.array(itineraryDaySchema).max(TRAVEL_DAYS_MAX),
    empty_text: z.string().max(DASHBOARD_EMPTY_TEXT_MAX).optional(),
  })
  .strict();

const documentItemSchema = z
  .object({
    kind: z.enum([
      "passport",
      "visa",
      "e_arrival",
      "insurance",
      "other",
    ]),
    label: z.string().max(TITLE_MAX).optional(),
    status: documentStatus,
    expiry_month: travelMonth.optional(),
  })
  .strict();

const travelDocumentsSchema = z
  .object({
    block_key: travelBlockKeySchema,
    title: z.string().max(TITLE_MAX).optional(),
    items: z.array(documentItemSchema).max(TRAVEL_DOCUMENTS_MAX),
    empty_text: z.string().max(DASHBOARD_EMPTY_TEXT_MAX).optional(),
  })
  .strict();

const travelBudgetSchema = z
  .object({
    block_key: travelBlockKeySchema,
    title: z.string().max(TITLE_MAX).optional(),
    estimate: travelAmount,
    actual: travelAmount.optional(),
    currency: travelCurrency,
    per_person: travelAmount.optional(),
    note: z.string().max(TRAVEL_NOTE_MAX).optional(),
    empty_text: z.string().max(DASHBOARD_EMPTY_TEXT_MAX).optional(),
  })
  .strict();

const todoItemSchema = z
  .object({
    title: z.string().min(1).max(TITLE_MAX),
    due: travelDate.optional(),
    done: z.boolean(),
    kind: z.enum([
      "book",
      "check_in",
      "pack",
      "document",
      "remind",
      "other",
    ]),
    note: z.string().max(TRAVEL_NOTE_MAX).optional(),
  })
  .strict();

const travelTodosSchema = z
  .object({
    block_key: travelBlockKeySchema,
    title: z.string().max(TITLE_MAX).optional(),
    items: z.array(todoItemSchema).max(TRAVEL_TODOS_MAX),
    empty_text: z.string().max(DASHBOARD_EMPTY_TEXT_MAX).optional(),
  })
  .strict();

const packingItemSchema = z
  .object({
    label: z.string().min(1).max(TITLE_MAX),
    done: z.boolean(),
  })
  .strict();

const emergencyContactSchema = z
  .object({
    label: z.string().min(1).max(TITLE_MAX),
    phone: travelPhone,
  })
  .strict();

const travelPackingEmergencySchema = z
  .object({
    block_key: travelBlockKeySchema,
    title: z.string().max(TITLE_MAX).optional(),
    packing: z.array(packingItemSchema).max(TRAVEL_PACKING_MAX),
    emergency: z.array(emergencyContactSchema).max(TRAVEL_EMERGENCY_MAX),
    empty_text: z.string().max(DASHBOARD_EMPTY_TEXT_MAX).optional(),
  })
  .strict();

const candidateItemSchema = z
  .object({
    label: z.string().min(1).max(TITLE_MAX),
    price: travelAmount,
    currency: travelCurrency,
    notes: travelSafeText(TRAVEL_NOTE_MAX).optional(),
    source: travelSafeText(TRAVEL_SOURCE_MAX, 1),
  })
  .strict();

const travelCandidatesSchema = z
  .object({
    block_key: travelBlockKeySchema,
    title: z.string().max(TITLE_MAX).optional(),
    flights: z.array(candidateItemSchema).max(TRAVEL_CANDIDATES_MAX),
    hotels: z.array(candidateItemSchema).max(TRAVEL_CANDIDATES_MAX),
    note: travelSafeText(BODY_MAX).optional(),
    empty_text: z.string().max(DASHBOARD_EMPTY_TEXT_MAX).optional(),
  })
  .strict();

const SLOT_SCHEMA: Record<
  TravelBlockSlot,
  { blockType: "text" | "list"; schema: z.ZodType }
> = {
  overview: { blockType: "text", schema: travelOverviewSchema },
  transport: { blockType: "list", schema: travelTransportSchema },
  stays: { blockType: "list", schema: travelStaysSchema },
  itinerary: { blockType: "list", schema: travelItinerarySchema },
  documents: { blockType: "list", schema: travelDocumentsSchema },
  budget: { blockType: "text", schema: travelBudgetSchema },
  todos: { blockType: "list", schema: travelTodosSchema },
  packing_emergency: {
    blockType: "text",
    schema: travelPackingEmergencySchema,
  },
  candidates: { blockType: "list", schema: travelCandidatesSchema },
};

/**
 * Expected block_type for a travel block_key (upsert / create).
 */
export function expectedTravelBlockType(
  blockKey: string,
): "text" | "list" | null {
  const parsed = parseTravelBlockKey(blockKey);
  if (!parsed) return null;
  return SLOT_SCHEMA[parsed.slot].blockType;
}

export type TravelPayloadParseResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error?: z.ZodError };

/**
 * Strict-parse a travel payload for the given block_type + block_key.
 * `block_key` must already be a travel key and match payload.block_key.
 * Zod failures include `error` so write routes can return capped issues.
 */
export function parseTravelBlockPayload(
  blockType: string,
  payload: unknown,
  blockKey: string,
): TravelPayloadParseResult {
  if (!isTravelBlockKey(blockKey)) {
    return { ok: false };
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return { ok: false };
  }
  const record = payload as Record<string, unknown>;
  if (record.block_key !== blockKey) {
    return { ok: false };
  }
  const parsedKey = parseTravelBlockKey(blockKey);
  if (!parsedKey) {
    return { ok: false };
  }
  const slot = SLOT_SCHEMA[parsedKey.slot];
  if (slot.blockType !== blockType) {
    return { ok: false };
  }
  const parsed = slot.schema.safeParse(record);
  if (!parsed.success) {
    return { ok: false, error: parsed.error };
  }
  return { ok: true, data: parsed.data as Record<string, unknown> };
}
