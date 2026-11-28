export {
  assertDashboardStoredPayload,
  decryptBlockPayload,
  decryptBlockPayloadStrict,
  encryptBlockPayload,
  DASHBOARD_BLOCKS_ENTITY,
  DASHBOARD_PAYLOAD_COLUMN,
} from "@/lib/dashboard/crypto";
export {
  runDerivedCompute,
  type DashboardDerivedComputer,
} from "@/lib/dashboard/compute";
export {
  assertBlockOwnedByAgent,
  assertSectionOwnedByAgent,
  extractHeadline,
  planCreateBlock,
  planCreateSection,
  planPatchBlock,
  planPatchSection,
} from "@/lib/dashboard/logic";
export {
  containsSingaporeNricOrFin,
  isForbiddenDashboardIdentifierKey,
  privacyOptionsForCategory,
  stringContainsLongDigitRun,
} from "@/lib/dashboard/nric-guard";
export {
  collectLegacyBlockKeyMatches,
  readPayloadBlockKey,
  sectionHasBlockKeyConflict,
} from "@/lib/dashboard/block-key";
export {
  normalizeDashboardCategory,
  normalizeDashboardCategories,
} from "@/lib/dashboard/category";
export {
  addDashboardWriter,
  assertAgentIsCategoryWriter,
  backfillDashboardWriters,
  listDashboardWriters,
  removeDashboardWriter,
} from "@/lib/dashboard/writers";
export {
  isBlockKeyAllowedForCategory,
  allowedBlockKeysForCategory,
} from "@/lib/dashboard/block-key-policy";
export { parseDashboardBlockPayload } from "@/lib/dashboard/parse-payload";
export {
  BANK_UNITS,
  parseBankBlockPayload,
  type BankUnit,
} from "@/lib/dashboard/bank-validation";
export { parseTravelBlockPayload } from "@/lib/dashboard/travel-validation";
export {
  DASHBOARD_BLOCK_KEY_CONFLICT_ERROR,
  DASHBOARD_INVALID_PAYLOAD_ERROR,
  DASHBOARD_INVALID_PAYLOAD_ISSUES_MAX,
  DASHBOARD_ISSUE_PATH_SEGMENT_MAX,
  DASHBOARD_ISSUE_PATH_SEGMENT_PLACEHOLDER,
  dashboardBlockKeyConflictResponse,
  dashboardInvalidPayloadResponse,
  formatDashboardZodIssues,
  type DashboardPayloadIssue,
} from "@/lib/dashboard/write-errors";
export {
  DASHBOARD_BLOCK_TYPES,
  type ChartSeriesPayload,
  type DashboardBlockAction,
  type DashboardBlockPublic,
  type DashboardBlockRow,
  type DashboardBlockType,
  type DashboardPayload,
  type DashboardReadResult,
  type DashboardSectionPublic,
  type DashboardSectionRow,
  type HeadlinePayload,
  type ListPayload,
  type MetricPayload,
  type ProgressPayload,
  type TextPayload,
} from "@/lib/dashboard/types";
