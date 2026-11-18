// Shared types for every app. Kept in ONE file on purpose: Metro, Next.js and the
// NodeNext API resolve relative imports differently, and a single file has none.

// ─── api ───
/** Every API success body. */
export interface ApiSuccess<T> {
  data: T;
}

/** Every API error body. `code` is a stable SCREAMING_SNAKE identifier. */
export interface ApiErrorBody {
  error: string;
  code: string;
  details?: Record<string, unknown>;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ─── business ───
/** What a business does on the platform, one or more (scope F1 "One account can Buy + Sell", M1). Replaces buy/sell/both. */
export const BUSINESS_ACTIVITIES = ['buy', 'sell', 'rent_out'] as const;
export type BusinessActivity = (typeof BUSINESS_ACTIVITIES)[number];

/** Optional employee-count range on the business profile (F1 spec §4.1). */
export const EMPLOYEE_RANGES = ['1-10', '11-50', '51-200', '200+'] as const;
export type EmployeeRange = (typeof EMPLOYEE_RANGES)[number];

/** Where onboarding resumes: the profile step, the location step, or finished. */
export const ONBOARDING_STEPS = ['profile', 'location', 'done'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** Constitution of business as the GST registration names it (picker on the review form, F1 spec §5.3). */
export const CONSTITUTIONS = [
  'proprietorship', 'partnership', 'llp', 'private_limited', 'public_limited', 'huf', 'trust_society', 'government',
  'other',
] as const;
export type Constitution = (typeof CONSTITUTIONS)[number];

/**
 * The GST declaration's wording version (F1 spec §5.2 step 4: "I am the proprietor, partner, director or authorised
 * signatory of this business"). The API records it and refuses any other (`400 DECLARATION_OUTDATED`); the app sends
 * it with a review. Bump it whenever the wording changes, in the app's copy (en / hi / gu) at the same time.
 */
export const GST_DECLARATION_VERSION = 1;

/** A user account's standing (scope A2). Suspended or blocked accounts can't sign in (`ACCOUNT_SUSPENDED`). */
export const ACCOUNT_STATUSES = ['active', 'suspended', 'blocked'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** Badges earned in this order: phone (OTP) → GST → business documents (scope F1, A2). */
export const VERIFICATION_LEVELS = ['phone', 'gst', 'business'] as const;
export type VerificationLevel = (typeof VERIFICATION_LEVELS)[number];

/** Admin review of a business's verification request (scope A2). */
export const VERIFICATION_STATUSES = ['not_submitted', 'pending', 'approved', 'rejected'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/** A member's rights inside their business. */
export const MEMBER_ROLES = ['owner', 'listing_manager', 'sales', 'viewer'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

/** 10-digit Indian mobile, no +91 (phones are stored as +91XXXXXXXXXX). */
export const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;
export const OTP_LENGTH = 6;

export const LANGUAGES = ['en', 'hi', 'gu'] as const;
export type Language = (typeof LANGUAGES)[number];

// ─── listing ───
/** What a listing offers: a part/spare part for sale, a machine for sale, or a machine for rent (scope F2, F5, F7). */
export const LISTING_KINDS = ['part', 'machine', 'machine_rental'] as const;
export type ListingKind = (typeof LISTING_KINDS)[number];

/** Listing lifecycle (scope F2, A3). Every listing has exactly one status. */
export const LISTING_STATUSES = [
  'draft', 'pending_review', 'rejected', 'live', 'paused', 'reserved', 'sold', 'rented', 'unavailable', 'removed',
] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

/** Left / Right / Pair matching (scope F3). `not_applicable` for parts that have no side. */
export const PART_SIDES = ['left', 'right', 'pair', 'not_applicable'] as const;
export type PartSide = (typeof PART_SIDES)[number];

/** The side that completes a part (scope F3: "show complementary parts"). A pair or a sideless part has none. */
export function complementarySide(side: PartSide): PartSide | null {
  if (side === 'left') return 'right';
  if (side === 'right') return 'left';
  return null;
}

/** Price models (scope F2). */
export const PRICE_MODELS = ['fixed', 'negotiable', 'on_request'] as const;
export type PriceModel = (typeof PRICE_MODELS)[number];

/** Rental price periods (scope F5, F7: machinery rental). */
export const RENTAL_PERIODS = ['hour', 'day', 'week', 'month'] as const;
export type RentalPeriod = (typeof RENTAL_PERIODS)[number];

/** Replaced by GET /categories in M2. */
/** Top-level browse chips on Home until the admin category tree (A4) serves them. */
export const ROOT_CATEGORIES = [
  'spare_parts', 'machinery', 'machine_rental', 'tools', 'electrical', 'hydraulics', 'bearings_transmission',
] as const;
export type RootCategory = (typeof ROOT_CATEGORIES)[number];

// ─── enquiry & offer ───
/** Enquiry lifecycle (scope F6): a buyer's question to a seller about one listing. */
export const ENQUIRY_STATUSES = ['open', 'replied', 'converted', 'closed'] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];

/** Quick enquiry options (scope F6). */
export const QUICK_ENQUIRIES = [
  'is_available', 'more_photos', 'video', 'specifications', 'best_price', 'compatibility',
] as const;
export type QuickEnquiry = (typeof QUICK_ENQUIRIES)[number];

/** Offer state machine (scope F6): seller can accept, reject or counter. */
export const OFFER_STATUSES = [
  'pending', 'countered', 'accepted', 'rejected', 'expired', 'withdrawn',
] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

/** Counter rounds before the thread suggests a call. Admin-configurable later. */
export const MAX_COUNTER_ROUNDS = 5;

// ─── deal ───
/** Deal record (scope F7): enquiry → offer → negotiation → deal. Payment may happen off-platform. */
export const DEAL_STATUSES = ['agreed', 'completed', 'cancelled', 'disputed'] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];

/** Rental booking lifecycle (scope F7 "Mark machinery as rented", F9 "Booking updates"). */
export const RENTAL_BOOKING_STATUSES = ['requested', 'confirmed', 'active', 'returned', 'cancelled'] as const;
export type RentalBookingStatus = (typeof RENTAL_BOOKING_STATUSES)[number];

// ─── part request ───
/** Part request / availability alert lifecycle (scope F8, flow U3). Stays active until fulfilled or closed. */
export const PART_REQUEST_STATUSES = ['active', 'matched', 'fulfilled', 'closed', 'expired'] as const;
export type PartRequestStatus = (typeof PART_REQUEST_STATUSES)[number];

// ─── reports ───
/** Reports and flags (scope A2, A3, A6). */
export const REPORT_TARGETS = ['user', 'business', 'listing', 'conversation'] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];

export const REPORT_STATUSES = ['open', 'reviewing', 'actioned', 'dismissed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

// ─── notifications ───
/** Notification types (scope F9). */
export const NOTIFICATION_TYPES = [
  'enquiry_new', 'message_new', 'offer_new', 'offer_countered', 'offer_accepted', 'offer_rejected',
  'part_match', 'booking_update', 'listing_status', 'deal_completed',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

// ─── admin ───
/** Admin panel roles (scope flow U4, A1–A6). `super_admin` passes every check. Every admin action is audit-logged. */
export const ADMIN_ROLES = [
  'super_admin', 'moderator', 'verification_officer', 'category_manager', 'operations', 'support',
] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

/** An officer's reason or message (suspend, block, revoke, release, reject, ask for more): 3–500 characters, trimmed. */
export const ADMIN_REASON_MIN = 3;
export const ADMIN_REASON_MAX = 500;

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
}

// ─── catalogue ───
export const CATALOG_LEVELS = ['machine_category', 'machine_type', 'part_group'] as const;
export type CatalogLevel = (typeof CATALOG_LEVELS)[number];

export const FIELD_TYPES = ['single_select', 'multi_select', 'number', 'text', 'date'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const CATALOG_STATUSES = ['active', 'retired'] as const;
export type CatalogStatus = (typeof CATALOG_STATUSES)[number];

/** Which listings a field applies to: spare parts, machines (for sale and for rent), or both. */
export const FIELD_APPLIES_TO = ['parts', 'machines', 'both'] as const;
export type FieldAppliesTo = (typeof FIELD_APPLIES_TO)[number];

/** `machine` covers for-sale and for-rent listings. */
export const TEMPLATE_KINDS = ['part', 'machine'] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

/** lucide kebab-case names; verified present in both lucide-react@0.359 and lucide-react-native. */
export const CATEGORY_ICONS = [
  'cog', 'factory', 'scissors', 'shirt', 'layers', 'droplets', 'printer', 'microscope', 'washing-machine',
  'footprints', 'wrench', 'package',
] as const;
export type CategoryIcon = (typeof CATEGORY_ICONS)[number];

export const MAX_HIGHLIGHT_RANK = 6;
export const CARD_HIGHLIGHT_COUNT = 4;
export const CATALOG_KEY_REGEX = /^[a-z][a-z0-9_]{1,39}$/;

export const DEFAULT_SIDE_CONVENTION =
  'Left and right as seen by the operator standing at the front of the machine, facing it.';

export interface CategoryNode {
  id: string;
  parentId: string | null;
  level: CatalogLevel;
  name: string;
  slug: string;
  path: string;
  icon: CategoryIcon | null;
  sortOrder: number;
  isActive: boolean;
  hasSides: boolean | null;
  sideConvention: string | null;
  effectiveHasSides: boolean;
  effectiveSideConvention: string;
  children: CategoryNode[];
}

export interface FieldOption {
  id: string;
  key: string;
  label: string;
  sortOrder: number;
  status: CatalogStatus;
}

export interface TemplateField {
  id: string;
  categoryId: string;
  key: string;
  label: string;
  helpText: string | null;
  type: FieldType;
  appliesTo: FieldAppliesTo;
  unit: string | null;
  min: number | null;
  max: number | null;
  required: boolean;
  filterable: boolean;
  highlightRank: number | null;
  sortOrder: number;
  status: CatalogStatus;
  options: FieldOption[];
}

/** Category fields, then machine type, then part group; each group by sortOrder. */
export interface EffectiveTemplate {
  nodeId: string;
  kind: TemplateKind;
  fields: TemplateField[];
}

export interface Brand {
  id: string;
  key: string;
  name: string;
  slug: string;
  makesMachines: boolean;
  makesParts: boolean;
  needsReview: boolean;
  sortOrder: number;
  isActive: boolean;
}

export interface MachineModel {
  id: string;
  key: string;
  brandId: string;
  machineTypeId: string;
  name: string;
  needsReview: boolean;
  sortOrder: number;
  isActive: boolean;
}

/** Admin brands list: each brand with all its models (inactive included), models by sortOrder. */
export interface BrandWithModels extends Brand {
  models: MachineModel[];
}

export interface Unit {
  id: string;
  key: string;
  label: string;
  decimals: number;
  sortOrder: number;
  isActive: boolean;
}

export interface Condition {
  id: string;
  key: string;
  label: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
}

export interface MasterData {
  units: Unit[];
  conditions: Condition[];
}

export type SpecValue = string | string[] | number;
export type Specs = Record<string, SpecValue>;

export const SPEC_ERROR_CODES = [
  'required', 'unknown_field', 'invalid_option', 'not_a_number', 'below_min', 'above_max',
  'invalid_date', 'invalid_text', 'retired', 'unsupported_type',
] as const;
export type SpecErrorCode = (typeof SPEC_ERROR_CODES)[number];

/** Admin category detail: node (children empty), its own fields and those inherited; retired fields included. */
export interface AdminCategoryDetail {
  node: CategoryNode;
  ownFields: TemplateField[];
  inheritedFields: TemplateField[];
}

// ─── GST verification (F1, A2; spec 2026-11-18-f1-a2 §5) ───

/** `live`: a real provider; `stub`: textile's stub (never in production); `review`: officer review only (§5.1). */
export const GST_MODES = ['live', 'stub', 'review'] as const;
export type GstMode = (typeof GST_MODES)[number];

/** The GST portal's registration status. Only `active` can verify. */
export const GST_STATUSES = ['active', 'cancelled', 'suspended', 'inactive'] as const;
export type GstStatus = (typeof GST_STATUSES)[number];

/** One lookup's outcome. `held`: another business holds the GSTIN; `status_refused`: not `active`; `failed`: provider unreachable. */
export const GST_CHECK_RESULTS = ['found', 'held', 'status_refused', 'not_found', 'failed'] as const;
export type GstCheckResult = (typeof GST_CHECK_RESULTS)[number];

/**
 * A representative proof: instant path `declared` → `code_sent` → `passed`, or review `waiting` ⇄ `needs_more` →
 * `approved` / `rejected`. `spent`: closed without a result (code limit, superseded by a review).
 */
export const GST_PROOF_STATUSES = [
  'declared', 'code_sent', 'passed', 'waiting', 'needs_more', 'approved', 'rejected', 'spent',
] as const;
export type GstProofStatus = (typeof GST_PROOF_STATUSES)[number];

/** What the app shows for a business's GST (`GET /businesses/me/gst`, §5.5). */
export const GST_STATES = [
  'none', 'found', 'code_sent', 'under_review', 'needs_more', 'rejected', 'verified', 'revoked',
] as const;
export type GstState = (typeof GST_STATES)[number];

/** Files on a review: the REG-06 certificate (required) and an ID of a named person or an authorisation letter (§5.3). */
export const GST_DOCUMENT_TYPES = ['gst_certificate', 'id_proof', 'authorisation_letter'] as const;
export type GstDocumentType = (typeof GST_DOCUMENT_TYPES)[number];

/**
 * How many files a review takes (§5.3, §6; amended 2026-11-18). A submission sends 2–5; each round of files added
 * after an officer asks for more sends 1–5 new ones; a review holds at most 10 in all. The certificate and the ID /
 * letter rule applies to the whole set. The API and the app read these, so they refuse the same things.
 */
export const GST_REVIEW_FILES_MIN = 2;
export const GST_REVIEW_FILES_MAX = 5;
export const GST_REVIEW_ADD_FILES_MIN = 1;
export const GST_REVIEW_ADD_FILES_MAX = 5;
export const GST_REVIEW_FILES_TOTAL_MAX = 10;

const GSTIN_FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const GSTIN_BASE36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Upper-case with every space removed, so `24aaacc 0000c1zy` and `24AAACC0000C1ZY` are one GSTIN. */
export function normalizeGstin(input: string): string {
  return input.replace(/\s+/g, '').toUpperCase();
}

/** Format, then the standard base-36 check digit (15th character). Expects a normalised GSTIN. */
export function isValidGstin(gstin: string): boolean {
  if (!GSTIN_FORMAT.test(gstin)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = GSTIN_BASE36.indexOf(gstin.charAt(i)) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return gstin.charAt(14) === GSTIN_BASE36.charAt((36 - (sum % 36)) % 36);
}

/** The PAN inside a GSTIN: characters 3–12. */
export function panFromGstin(gstin: string): string {
  return gstin.slice(2, 12);
}

/** The state code of a GSTIN: characters 1–2. */
export function stateCodeFromGstin(gstin: string): string {
  return gstin.slice(0, 2);
}

/** The registration fields the product uses from a lookup; the full provider response is never stored. */
export interface GstDetails {
  legalName: string;
  tradeName: string | null;
  address: { line: string; city: string; state: string; pincode: string };
  constitution: string;
  natureOfBusiness: string | null;
  registeredOn: string | null;
  status: GstStatus;
}

/**
 * GET /businesses/me/gst: drives the Verification screen. `held`, `notFound`, `providerUnavailable` and
 * `statusRefused` describe the latest lookup's outcome when `state` is `none`.
 */
export interface GstStateView {
  mode: GstMode;
  state: GstState;
  instantAllowed: boolean;
  storageAvailable: boolean;
  expired?: boolean;
  held?: boolean;
  /** The latest lookup found no such GSTIN ("We couldn't find this GSTIN. Check it and try again."). */
  notFound?: boolean;
  providerUnavailable?: boolean;
  statusRefused?: GstStatus;
  gstin?: string;
  details?: GstDetails;
  checkId?: string;
  proofId?: string;
  /** An open review (`under_review` / `needs_more`): how many files it holds, for the add-files cap. */
  documentCount?: number;
  hint?: string;
  resendAvailableAt?: string;
  officerMessage?: string;
  reason?: string;
  verifiedAt?: string;
}

// ─── Business profile and location (F1; spec 2026-11-18-f1-a2 §4) ───

/** One pincode from the post-office directory; `city` is the offices' district, title-cased. */
export interface PincodeInfo {
  pincode: string;
  city: string;
  district: string;
  state: string;
  offices: string[];
}

/** An admin-managed industrial area, picked per district and state. */
export interface IndustrialArea {
  id: string;
  name: string;
  city: string;
  state: string;
  isActive: boolean;
  sortOrder: number;
}

/** GET /businesses/me. */
export interface BusinessProfile {
  id: string;
  /** The person's own name (`users.name`): the signed-in user, or the owner in the admin detail. */
  userName: string | null;
  tradeName: string;
  legalName: string | null;
  /** The name shown: GST's trade name (or legal name) once GST-verified, otherwise `tradeName`. */
  displayName: string;
  /** True while GST is verified: the business name can't be edited. */
  nameLocked: boolean;
  activities: BusinessActivity[];
  /** Machine category (level-1 catalogue node) ids. */
  categories: string[];
  email: string | null;
  yearEstablished: number | null;
  employees: EmployeeRange | null;
  location: {
    pincode: string | null;
    city: string | null;
    state: string | null;
    industrialAreaId: string | null;
    industrialAreaName: string | null;
    industrialAreaOther: string | null;
    addressLine: string | null;
    lat: number | null;
    lng: number | null;
  };
  gstin: string | null;
  constitution: string | null;
  gstRegisteredOn: string | null;
  gstAddress: GstDetails['address'] | null;
  verificationLevels: VerificationLevel[];
  verificationStatus: VerificationStatus;
  verifiedAt: string | null;
  onboarding: OnboardingStep;
  completion: { name: boolean; activities: boolean; location: boolean; gst: boolean };
}

// ─── Admin: GST review queue and businesses (F1 + A2 spec §8.1, §8.2) ───

/** The review queue's tabs: `decided` = approved or rejected in the last 90 days. */
export const GST_REVIEW_QUEUES = ['waiting', 'needs_more', 'decided'] as const;
export type GstReviewQueue = (typeof GST_REVIEW_QUEUES)[number];

/** What the business typed on a review with no lookup attached (§5.3). */
export interface GstEnteredDetails {
  legalName: string;
  tradeName: string | null;
  address: GstDetails['address'];
  constitution: string;
}

/** The officer's corrections on approval (only used when no fresh lookup decides, §5.3). */
export interface GstApprovalEdits {
  legalName?: string;
  tradeName?: string | null;
  address?: GstDetails['address'];
  constitution?: string;
}

/** GET /admin/verification/reviews. */
export interface AdminGstReviewRow {
  id: string;
  businessId: string;
  businessName: string;
  city: string | null;
  gstin: string;
  status: GstProofStatus;
  hasLookup: boolean;
  documentCount: number;
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
}

/** One stored document of a review: no key, only its place and type; the URL comes from `.../documents/:proofId/:index/url`. */
export interface AdminGstReviewDocument {
  index: number;
  type: GstDocumentType;
  format: 'jpg' | 'png' | 'webp' | 'pdf';
}

/** A GST lookup in a history list: never the details (a held lookup's details belong to another business). */
export interface AdminGstCheckEntry {
  id: string;
  gstin: string;
  source: 'business' | 'officer';
  result: GstCheckResult;
  gstStatus: GstStatus | null;
  createdAt: string;
}

/** A representative proof in a history list, without document keys. */
export interface AdminGstProofEntry {
  id: string;
  gstin: string;
  method: 'provider_otp' | 'documents' | null;
  status: GstProofStatus;
  documentTypes: GstDocumentType[];
  officerMessage: string | null;
  reason: string | null;
  lookupAtApproval: 'active' | 'unavailable' | 'none' | null;
  createdAt: string;
  decidedAt: string | null;
}

/** A grant or revocation in a history list. */
export interface AdminVerificationEntry {
  id: string;
  level: VerificationLevel;
  method: 'provider_otp' | 'officer_review' | null;
  status: 'active' | 'revoked';
  verifiedAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
}

export interface AdminGstHistory {
  checks: AdminGstCheckEntry[];
  proofs: AdminGstProofEntry[];
  verifications: AdminVerificationEntry[];
}

/** GET /admin/verification/reviews/:id. */
export interface AdminGstReviewDetail {
  id: string;
  status: GstProofStatus;
  gstin: string;
  declarationVersion: number;
  declaredAt: string;
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
  officerMessage: string | null;
  reason: string | null;
  lookupAtApproval: 'active' | 'unavailable' | 'none' | null;
  approvedDetails: GstDetails | null;
  business: {
    id: string;
    tradeName: string;
    /** The GSTIN the business holds now (may differ from the reviewed one after a revocation). */
    gstin: string | null;
    addressLine: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    verificationStatus: VerificationStatus;
  };
  submittedBy: { id: string; name: string | null; phone: string };
  /** What the business typed (no lookup attached), else null. */
  entered: GstEnteredDetails | null;
  /** The attached lookup (always a `found` one of this business), else null. */
  lookup: { checkId: string; details: GstDetails; resolvedAt: string | null } | null;
  /**
   * The GST side (lookup, else entered) against the business's profile: `legalName` when the business name matches
   * neither the GST legal nor trade name; `pincode` when the profile pincode differs from the GST address pincode.
   */
  mismatches: { legalName: boolean; pincode: boolean };
  documents: AdminGstReviewDocument[];
  history: AdminGstHistory;
  /** False in mode `review`: the officer checks the GST portal and may correct the details before approving. */
  providerAvailable: boolean;
  storageAvailable: boolean;
}

/** GET /admin/verification/documents/:proofId/:index/url. */
export interface AdminDocumentUrl {
  url: string;
  type: GstDocumentType;
  format: 'jpg' | 'png' | 'webp' | 'pdf';
  expiresAt: string;
}

/** GET /admin/businesses. */
export interface AdminBusinessRow {
  id: string;
  tradeName: string;
  legalName: string | null;
  gstin: string | null;
  city: string | null;
  state: string | null;
  /** The listed area's name, else the business's own "Other" text. */
  industrialArea: string | null;
  verificationStatus: VerificationStatus;
  verificationLevels: VerificationLevel[];
  owner: { id: string; name: string | null; phone: string; status: AccountStatus } | null;
  createdAt: string;
}

export interface AdminBusinessList {
  rows: AdminBusinessRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminAuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  adminId: string | null;
  adminName: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
}

/** GET /admin/businesses/:id. */
export interface AdminBusinessDetail {
  profile: BusinessProfile;
  verificationNote: string | null;
  users: Array<{ id: string; name: string | null; phone: string; status: AccountStatus; memberRole: MemberRole; createdAt: string }>;
  gst: GstStateView;
  /** True while a review is `waiting` or `needs_more` (Release GSTIN is refused then). */
  reviewOpen: boolean;
  history: AdminGstHistory;
  audit: AdminAuditEntry[];
}
