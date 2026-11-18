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

/**
 * Listing lifecycle (scope F2, A3; F2 spec §7.1). Every listing has exactly one status. `hidden`: taken down by a
 * moderator (reversible); `expired`: not refreshed in time.
 */
export const LISTING_STATUSES = [
  'draft', 'pending_review', 'rejected', 'live', 'paused', 'reserved', 'sold', 'rented', 'unavailable', 'expired',
  'hidden', 'removed',
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
  /** Machines and rentals use the first active unit with this flag, set by the server (F2 spec §4.2, R48). */
  isMachineUnit: boolean;
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
  /**
   * The business's listings in every status but `draft` (F2 plan Task 16, I12): the same set the default
   * `/admin/listings?businessId=<id>` shows. The page links "Listings (n)" there.
   */
  listingsCount: number;
}

// ─── Listings (F2 + F3 + A3; spec 2026-11-18-f2-f3-listings-design) ───

/** Served to anyone (spec §7.1, R20); every other status is owner and admins only. */
export const PUBLIC_LISTING_STATUSES = ['live', 'reserved', 'rented'] as const satisfies readonly ListingStatus[];

/** A seller may PATCH a listing in these (§7.3); not `hidden`, `removed`, `reserved` (`409 LISTING_NOT_EDITABLE`). */
export const EDITABLE_LISTING_STATUSES = [
  'draft', 'pending_review', 'rejected', 'live', 'paused', 'expired', 'unavailable', 'sold', 'rented',
] as const satisfies readonly ListingStatus[];

/** Counted for the unverified open-listing cap: every status except `draft`, `sold`, `removed` (R36). */
export const OPEN_LISTING_STATUSES = [
  'pending_review', 'rejected', 'live', 'paused', 'reserved', 'rented', 'unavailable', 'expired', 'hidden',
] as const satisfies readonly ListingStatus[];

/** A seller may change the category only in these (R43, `409 CATEGORY_LOCKED`); admins always can. */
export const CATEGORY_EDITABLE_STATUSES = ['draft', 'rejected'] as const satisfies readonly ListingStatus[];

/** Buyer picks up · I can ship · Local delivery (§4.2). */
export const DELIVERY_OPTIONS = ['pickup', 'ship', 'local_delivery'] as const;
export type DeliveryOption = (typeof DELIVERY_OPTIONS)[number];

/** Whether the price includes GST (§4.6). */
export const GST_PRICE_MODES = ['included', 'extra'] as const;
export type GstPriceMode = (typeof GST_PRICE_MODES)[number];

/** Rental terms (§4.5, M14). */
export const RENTAL_OPERATOR_OPTIONS = ['included', 'optional', 'not_available', 'mandatory'] as const;
export type RentalOperator = (typeof RENTAL_OPERATOR_OPTIONS)[number];
export const RENTAL_FUEL_OPTIONS = ['client', 'included', 'per_litre'] as const;
export type RentalFuel = (typeof RENTAL_FUEL_OPTIONS)[number];
export const RENTAL_TRANSPORT_OPTIONS = ['owner_delivers', 'renter_picks_up', 'either'] as const;
export type RentalTransport = (typeof RENTAL_TRANSPORT_OPTIONS)[number];

/** Where the stock is: the business's address or another godown (§4.7). */
export const LISTING_LOCATION_SOURCES = ['business', 'godown'] as const;
export type ListingLocationSource = (typeof LISTING_LOCATION_SOURCES)[number];

export const MEDIA_TYPES = ['photo', 'video'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

/** A photo uploads `full` + `thumb`, a video `video` + `poster` (§6.2, §6.3). */
export const MEDIA_ROLES = ['full', 'thumb', 'video', 'poster'] as const;
export type MediaRole = (typeof MEDIA_ROLES)[number];

/**
 * Allowed major brands of an MP4 / QuickTime `ftyp` box (§6.3): 4-character strings, trailing spaces kept. HEIC
 * (`heic`, `mif1`) and AVIF (`avif`) also use `ftyp` and are refused by this list. `qt  ` → `video/quicktime`.
 */
export const VIDEO_FTYP_BRANDS = [
  'isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'qt  ', '3gp4', '3gp5', '3gp6', '3g2a',
] as const;

/** Sanity flags (§5.4); a flag a moderator hasn't accepted sends the listing to review. */
export const LISTING_FLAGS = ['price_check', 'unit_check', 'quantity_check'] as const;
export type ListingFlag = (typeof LISTING_FLAGS)[number];

/** Why a listing waits in the moderation queue (§5.5, §7.3, §11.1). */
export const REVIEW_REASONS = [
  'unverified_seller', 'first_listings', 'resubmitted', 'price_check', 'unit_check', 'quantity_check',
  'edited_after_report', 'edit_flagged',
] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];

/** A moderator's last decision (§7.2). Ask for changes and Reject both lead to `rejected` (R13). */
export const MODERATION_OUTCOMES = ['approved', 'changes_requested', 'rejected'] as const;
export type ModerationOutcome = (typeof MODERATION_OUTCOMES)[number];

/** Report listing reasons (§8.4). `something_else` needs details. */
export const LISTING_REPORT_REASONS = [
  'stock_photos', 'wrong_side_or_fit', 'wrong_price_or_quantity', 'already_sold', 'advance_payment', 'something_else',
] as const;
export type ListingReportReason = (typeof LISTING_REPORT_REASONS)[number];

/**
 * Who changed a status (`listing_status_history.actor`, the `history_actor` enum, §7.5, §13.1). The §7.2 table's
 * "moderator" actor is `admin` here.
 */
export const LISTING_ACTORS = ['seller', 'admin', 'system'] as const;
export type ListingActor = (typeof LISTING_ACTORS)[number];

/** Where a fitment row came from: the seller, or an admin edit (§4.3, R33). */
export const FITMENT_SOURCES = ['seller', 'admin'] as const;
export type FitmentSource = (typeof FITMENT_SOURCES)[number];

/**
 * What `POST /listings/:id/actions` takes and the manage sheet offers (§7.2, §10). Publish has its own endpoint.
 * There is no `duplicate` (owner decision 8).
 */
export const SELLER_LISTING_ACTIONS = [
  'pause', 'resume', 'renew', 'mark_sold', 'mark_unavailable', 'relist', 'mark_rented', 'end_rental', 'remove',
] as const;
export type SellerListingAction = (typeof SELLER_LISTING_ACTIONS)[number];

/** Moderator status actions (§11.3). Admin edit and media delete aren't status transitions. */
export const ADMIN_LISTING_ACTIONS = ['approve', 'ask_for_changes', 'reject', 'hide', 'unhide', 'remove'] as const;
export type AdminListingAction = (typeof ADMIN_LISTING_ACTIONS)[number];

/** Transitions the system makes (§7.2): the expiry job, edits back to review, admin's last-photo delete, F7 reservations. */
export const SYSTEM_LISTING_ACTIONS = ['expire', 'back_to_review', 'photos_removed', 'reserve', 'unreserve'] as const;
export type SystemListingAction = (typeof SYSTEM_LISTING_ACTIONS)[number];

export type ListingAction = 'publish' | SellerListingAction | AdminListingAction | SystemListingAction;

/**
 * Where a transition lands: a status; `'gate'` = `live` or `pending_review` as the go-live gate decides (§5.5; a
 * resubmission from `rejected` always lands in `pending_review`, reason `resubmitted`); `'return_status'` = the
 * listing's stored `return_status` (approve: else `live`; unhide).
 */
export type ListingTransitionTarget = ListingStatus | 'gate' | 'return_status';

export interface ListingTransition {
  action: ListingAction;
  actor: ListingActor;
  from: readonly ListingStatus[];
  to: ListingTransitionTarget;
  /** Only these kinds; every kind when absent. */
  kinds?: readonly ListingKind[];
}

const ALL_BUT_DRAFT_REMOVED: readonly ListingStatus[] = LISTING_STATUSES.filter((s) => s !== 'draft' && s !== 'removed');
const HIDEABLE: readonly ListingStatus[] = ['live', 'paused', 'expired', 'unavailable', 'sold', 'rented'];

/** The only ways a status changes (§7.2). `listing-lifecycle.service.ts` is the only writer of `status`. */
export const LISTING_TRANSITIONS: readonly ListingTransition[] = [
  { action: 'publish', actor: 'seller', from: ['draft'], to: 'gate' },
  { action: 'publish', actor: 'seller', from: ['rejected'], to: 'gate' },
  { action: 'approve', actor: 'admin', from: ['pending_review'], to: 'return_status' },
  { action: 'ask_for_changes', actor: 'admin', from: ['pending_review'], to: 'rejected' },
  { action: 'reject', actor: 'admin', from: ['pending_review'], to: 'rejected' },
  { action: 'pause', actor: 'seller', from: ['live'], to: 'paused' },
  { action: 'resume', actor: 'seller', from: ['paused'], to: 'gate' },
  { action: 'renew', actor: 'seller', from: ['live', 'expired'], to: 'gate' },
  { action: 'mark_sold', actor: 'seller', from: ['live', 'paused', 'expired', 'unavailable'], to: 'sold' },
  { action: 'mark_unavailable', actor: 'seller', from: ['live', 'paused', 'expired'], to: 'unavailable' },
  { action: 'relist', actor: 'seller', from: ['sold', 'unavailable'], to: 'gate' },
  { action: 'mark_rented', actor: 'seller', from: ['live'], to: 'rented', kinds: ['machine_rental'] },
  { action: 'end_rental', actor: 'seller', from: ['rented'], to: 'gate', kinds: ['machine_rental'] },
  { action: 'remove', actor: 'seller', from: ALL_BUT_DRAFT_REMOVED, to: 'removed' },
  { action: 'expire', actor: 'system', from: ['live', 'rented'], to: 'expired' },
  { action: 'back_to_review', actor: 'system', from: ['live', 'rented'], to: 'pending_review' },
  { action: 'hide', actor: 'admin', from: HIDEABLE, to: 'hidden' },
  { action: 'unhide', actor: 'admin', from: ['hidden'], to: 'return_status' },
  { action: 'remove', actor: 'admin', from: ALL_BUT_DRAFT_REMOVED, to: 'removed' },
  { action: 'photos_removed', actor: 'system', from: HIDEABLE, to: 'rejected' },
  { action: 'reserve', actor: 'system', from: ['live'], to: 'reserved' },
  { action: 'unreserve', actor: 'system', from: ['reserved'], to: 'live' },
];

/**
 * The transition for `action` from `from` on a listing of `kind`, or null (`409 LISTING_TRANSITION_NOT_ALLOWED`).
 * `remove` exists for the seller and for an admin with the same statuses: pass `actor` to pick one.
 */
export function listingTransition(
  from: ListingStatus,
  action: ListingAction,
  kind: ListingKind,
  actor?: ListingActor,
): ListingTransition | null {
  return (
    LISTING_TRANSITIONS.find(
      (t) =>
        t.action === action &&
        (actor === undefined || t.actor === actor) &&
        t.from.includes(from) &&
        (t.kinds === undefined || t.kinds.includes(kind)),
    ) ?? null
  );
}

/** The seller actions allowed on a listing now, in `SELLER_LISTING_ACTIONS` order (the manage sheet's buttons). */
export function sellerActions(status: ListingStatus, kind: ListingKind): SellerListingAction[] {
  return SELLER_LISTING_ACTIONS.filter((a) => listingTransition(status, a, kind, 'seller') !== null);
}

/** The moderator status actions allowed on a listing now, in `ADMIN_LISTING_ACTIONS` order (the admin action bar, §11.3). */
export function adminActions(status: ListingStatus, kind: ListingKind): AdminListingAction[] {
  return ADMIN_LISTING_ACTIONS.filter((a) => listingTransition(status, a, kind, 'admin') !== null);
}

// Limits (spec §4, §6.3, §9.1, §10, §11.1).
export const LISTING_TITLE_MIN = 3;
export const LISTING_TITLE_MAX = 100;
export const LISTING_DESCRIPTION_MAX = 1500;
export const LISTING_PHOTOS_MAX = 10;
export const LISTING_VIDEOS_MAX = 2;
/** 60 s plus half a second of encoder slack (§6.3, `400 VIDEO_TOO_LONG`). */
export const LISTING_VIDEO_MAX_MS = 60_500;
export const MEDIA_MAX_BYTES: Readonly<Record<MediaRole, number>> = {
  full: 4_194_304,
  thumb: 1_048_576,
  video: 52_428_800,
  poster: 1_048_576,
};
export const LISTING_FITMENTS_MAX = 20;
export const LISTING_DRAFTS_MAX = 20;
/** A listing an admin removed stays visible to its seller this long (R50). */
export const REMOVED_BY_TEAM_DAYS = 30;
/** The moderation queue's Decided tab looks back this far (§11.1). */
export const MODERATION_DECIDED_DAYS = 90;
export const PART_NUMBER_MAX = 40;
export const OTHER_SIDE_LIMIT = 20;
/** `pg_trgm` similarity of normalised part names for tiers 2 and 3 (§9.1). */
export const OTHER_SIDE_MIN_SIMILARITY = 0.5;

/**
 * Sanity thresholds (§5.4, R17), in paise. Prices are per unit; rentals are checked on their day-equivalent rate
 * (`rentalDayEquivalent`). A value strictly below `min` or above `max` is flagged.
 */
export const SANITY_LIMITS = {
  /** ₹5 … ₹50 lakh per unit. */
  partPricePaise: { min: 500, max: 500_000_000 },
  /** ₹10 000 … ₹50 crore. */
  machinePricePaise: { min: 1_000_000, max: 50_000_000_000 },
  /** ₹200 … ₹5 lakh a day. */
  rentalDayPaise: { min: 20_000, max: 50_000_000 },
  /** More than this many parts is flagged. */
  partQuantityMax: 100_000,
  /** More than this many machines (sale or rent) is flagged. */
  machineQuantityMax: 50,
} as const;

// ─── Part numbers and part names (§4.3, §9.1) ───

/** Upper-case with every character outside `A-Z0-9` removed: ` tp-200 L ` → `TP200L`. */
export function normalizePartNumber(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const SIDE_SUFFIXES: Partial<Record<PartSide, readonly string[]>> = {
  left: ['LEFT', 'LH', 'L'],
  right: ['RIGHT', 'RH', 'R'],
};

/**
 * The side-stripped base of a normalised part number (§4.3): for a `left` listing a trailing `LEFT`, `LH` or `L` is
 * removed (longest first), for a `right` listing `RIGHT`, `RH` or `R`. Only the suffix agreeing with the listing's own
 * side; other sides keep the number. A base shorter than 3 is stored but never matched.
 */
export function partNumberBase(norm: string, side: PartSide | null | undefined): string {
  const suffixes = side ? SIDE_SUFFIXES[side] : undefined;
  if (!suffixes) return norm;
  for (const suffix of suffixes) {
    if (norm.length > suffix.length && norm.endsWith(suffix)) return norm.slice(0, -suffix.length);
  }
  return norm;
}

/** Side words removed from part names (§9.1, R38), lower-case, NFC. `l h` / `r h` (from `l/h`, `r/h`) are pairs. */
const SIDE_WORDS = new Set(
  ['left', 'right', 'lh', 'rh', 'लेफ्ट', 'राइट', 'बायाँ', 'दायाँ', 'ડાબું', 'જમણું', 'લેફ્ટ', 'રાઇટ'].map((w) => w.normalize('NFC')),
);

/**
 * A part name for matching (§9.1): lower-case, punctuation to spaces, side words (English, Hindi, Gujarati) removed,
 * spaces collapsed. `Temple Roller – Left (LH)` → `temple roller`.
 */
export function normalizePartName(title: string): string {
  const tokens = title
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter((t) => t !== '');
  const kept: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (SIDE_WORDS.has(t)) continue;
    if ((t === 'l' || t === 'r') && tokens[i + 1] === 'h') {
      i++;
      continue;
    }
    kept.push(t);
  }
  return kept.join(' ');
}

// ─── Rentals, sanity flags, score, fit (§5.4, §8.3) ───

export interface RentalRates {
  rateHourPaise: number | null;
  rateDayPaise: number | null;
  rateWeekPaise: number | null;
  rateMonthPaise: number | null;
  /** A day = this many hours (default 8). */
  shiftHours: number;
  /** A month = this many working days (default 26). */
  monthDays: number;
}

/**
 * A rental's day-equivalent rate in paise (§5.4): the day rate, else hour rate × shift hours, else week rate ÷ 6,
 * else month rate ÷ `monthDays`; null without any rate.
 */
export function rentalDayEquivalent(rental: RentalRates): number | null {
  if (rental.rateDayPaise != null) return rental.rateDayPaise;
  if (rental.rateHourPaise != null) return rental.rateHourPaise * rental.shiftHours;
  if (rental.rateWeekPaise != null) return rental.rateWeekPaise / 6;
  if (rental.rateMonthPaise != null) return rental.rateMonthPaise / rental.monthDays;
  return null;
}

/** What `sanityFlags` reads from a listing. */
export interface SanityInput {
  kind: ListingKind;
  priceModel?: PriceModel | null;
  pricePaise?: number | null;
  /** Decimal string (or number). */
  quantity?: string | number | null;
  /** Whether the listing's unit is flagged `is_machine_unit` (parts only). */
  unitIsMachineUnit?: boolean;
  rental?: RentalRates | null;
}

const outside = (v: number, r: { min: number; max: number }): boolean => v < r.min || v > r.max;

/** The sanity flags of a listing (§5.4), in `LISTING_FLAGS` order. */
export function sanityFlags(listing: SanityInput): ListingFlag[] {
  const flags: ListingFlag[] = [];
  if (listing.kind === 'machine_rental') {
    const day = listing.rental ? rentalDayEquivalent(listing.rental) : null;
    if (day != null && outside(day, SANITY_LIMITS.rentalDayPaise)) flags.push('price_check');
  } else if (listing.priceModel !== 'on_request' && listing.pricePaise != null) {
    const range = listing.kind === 'part' ? SANITY_LIMITS.partPricePaise : SANITY_LIMITS.machinePricePaise;
    if (outside(listing.pricePaise, range)) flags.push('price_check');
  }
  if (listing.kind === 'part' && listing.unitIsMachineUnit) flags.push('unit_check');
  const qty = listing.quantity == null || listing.quantity === '' ? null : Number(listing.quantity);
  if (qty != null && Number.isFinite(qty)) {
    const max = listing.kind === 'part' ? SANITY_LIMITS.partQuantityMax : SANITY_LIMITS.machineQuantityMax;
    if (qty > max) flags.push('quantity_check');
  }
  return flags;
}

/** Items of the listing score, in the table's order (§5.4). */
export const LISTING_SCORE_ITEMS = [
  'photos', 'video', 'part_number', 'fitment', 'year', 'hours_run', 'optional_specs', 'description',
] as const;
export type ListingScoreItem = (typeof LISTING_SCORE_ITEMS)[number];

const SCORE_POINTS: Readonly<Record<'part' | 'machine', Partial<Record<ListingScoreItem, number>>>> = {
  part: { photos: 20, video: 15, part_number: 15, fitment: 20, optional_specs: 15, description: 15 },
  machine: { photos: 20, video: 20, year: 15, hours_run: 10, optional_specs: 15, description: 20 },
};

/** What `listingScore` reads from a listing. */
export interface ScoreInput {
  kind: ListingKind;
  photoCount: number;
  videoCount: number;
  partNumber?: string | null;
  fitmentCount?: number;
  year?: number | null;
  hoursRun?: number | null;
  specs?: Specs | null;
  /** Keys of the template's active, optional fields for the listing's node and kind (none = the item is met). */
  optionalSpecKeys?: readonly string[];
  description?: string | null;
}

const specFilled = (v: SpecValue | undefined): boolean =>
  v !== undefined && v !== null && (Array.isArray(v) ? v.length > 0 : typeof v === 'string' ? v.trim() !== '' : true);

/** Listing score 0–100 with the missing items as nudges, in table order (§5.4). */
export function listingScore(listing: ScoreInput): { score: number; missing: ListingScoreItem[] } {
  const points = SCORE_POINTS[listing.kind === 'part' ? 'part' : 'machine'];
  const specs = listing.specs ?? {};
  const has: Record<ListingScoreItem, boolean> = {
    photos: listing.photoCount >= 3,
    video: listing.videoCount >= 1,
    part_number: !!listing.partNumber && listing.partNumber.trim() !== '',
    fitment: (listing.fitmentCount ?? 0) >= 1,
    year: listing.year != null,
    hours_run: listing.hoursRun != null,
    optional_specs: (listing.optionalSpecKeys ?? []).every((k) => specFilled(specs[k])),
    description: (listing.description ?? '').trim().length >= 40,
  };
  let score = 0;
  const missing: ListingScoreItem[] = [];
  for (const item of LISTING_SCORE_ITEMS) {
    const p = points[item];
    if (p === undefined) continue;
    if (has[item]) score += p;
    else missing.push(item);
  }
  return { score, missing };
}

/** One "fits" row (§4.3): a machine brand, a catalogue model or "Other" text or neither (= all models), years, note. */
export interface Fitment {
  id?: string;
  brandId: string;
  brandName?: string;
  modelId: string | null;
  modelName?: string | null;
  modelOther: string | null;
  yearFrom: number | null;
  yearTo: number | null;
  note: string | null;
  source?: FitmentSource;
}

/**
 * "Check my machine" (§8.3, R21): `fits` when a row has the brand and either the same catalogue model or no model
 * (all models of the brand), and — when a year is given — the year inside the row's range (open ends unbounded). A
 * row with an "Other" model text never confirms a catalogue model.
 */
export function checkFit(
  fitments: readonly Pick<Fitment, 'brandId' | 'modelId' | 'modelOther' | 'yearFrom' | 'yearTo'>[],
  machine: { brandId: string; modelId: string | null; year: number | null },
): 'fits' | 'not_listed' {
  const fits = fitments.some((f) => {
    if (f.brandId !== machine.brandId) return false;
    const allModels = f.modelId == null && (f.modelOther == null || f.modelOther.trim() === '');
    if (!allModels && (f.modelId == null || f.modelId !== machine.modelId)) return false;
    if (machine.year != null) {
      if (f.yearFrom != null && machine.year < f.yearFrom) return false;
      if (f.yearTo != null && machine.year > f.yearTo) return false;
    }
    return true;
  });
  return fits ? 'fits' : 'not_listed';
}

// ─── Settings (`app_settings`, §12) ───

export interface AppSettingDef {
  key: string;
  type: 'int';
  default: number;
  min: number;
  max: number;
  label: string;
  help: string;
}

/** The registry: a missing row means the default, so nothing needs seeding (R10). */
export const APP_SETTINGS = [
  {
    key: 'listing_expiry_days', type: 'int', default: 60, min: 7, max: 365,
    label: 'Listing expiry (days)',
    help: 'A live or rented listing expires this many days after its last update.',
  },
  {
    key: 'listing_expiry_reminder_days', type: 'int', default: 7, min: 1, max: 30,
    label: 'Expiry reminder (days)',
    help: 'Sellers see "Still available?" this many days before expiry. Must be less than the expiry.',
  },
  {
    key: 'listing_review_first_n', type: 'int', default: 3, min: 0, max: 50,
    label: 'Review first listings',
    help: "A GST-verified business's first N listings are reviewed (0 = none).",
  },
  {
    key: 'unverified_listing_cap', type: 'int', default: 3, min: 1, max: 1000,
    label: 'Unverified listing cap',
    help: 'Open listings a business without GST verification may hold.',
  },
] as const satisfies readonly AppSettingDef[];

export type AppSettingKey = (typeof APP_SETTINGS)[number]['key'];
export type AppSettingsValues = Record<AppSettingKey, number>;

/** Every setting at its default. */
export function appSettingDefaults(): AppSettingsValues {
  return Object.fromEntries(APP_SETTINGS.map((s) => [s.key, s.default])) as AppSettingsValues;
}

/** The first problem of a full settings map (whole number, range, reminder < expiry), or null. */
export function validateSettings(values: AppSettingsValues): { key: AppSettingKey; message: string } | null {
  for (const def of APP_SETTINGS) {
    const v: unknown = values[def.key];
    if (typeof v !== 'number' || !Number.isInteger(v)) return { key: def.key, message: `${def.label} must be a whole number` };
    if (v < def.min || v > def.max) return { key: def.key, message: `${def.label} must be between ${def.min} and ${def.max}` };
  }
  if (values.listing_expiry_reminder_days >= values.listing_expiry_days) {
    return { key: 'listing_expiry_reminder_days', message: 'The reminder must be shorter than the expiry' };
  }
  return null;
}

/** GET /admin/settings. */
export interface AppSettingsView {
  values: AppSettingsValues;
  registry: readonly AppSettingDef[];
}

// ─── Listing payloads (§13.4). Later tasks may refine these as the endpoints are built. ───

/** A photo (`url` = full, `thumbUrl` = thumb) or a video (`url` = video, `thumbUrl` = poster). URLs are null without `MEDIA_PUBLIC_BASE_URL`. */
export interface ListingMediaItem {
  id: string;
  type: MediaType;
  url: string | null;
  thumbUrl: string | null;
  contentType: string;
  sizeBytes: number;
  durationMs: number | null;
  sortOrder: number;
}

/** Machine fields (§4.4). `serialNumber` only in owner and admin payloads. */
export interface MachineDetails {
  brandId: string | null;
  brandName: string | null;
  brandOther: string | null;
  modelId: string | null;
  modelName: string | null;
  modelOther: string | null;
  year: number | null;
  hoursRun: number | null;
  underPower: boolean;
  inspectionByAppointment: boolean;
  reasonForSale: string | null;
  serialNumber?: string | null;
}

/** Rental fields (§4.5). Money in paise; `availableFrom` is `YYYY-MM-DD`. */
export interface RentalTerms extends RentalRates {
  overtimeRateHourPaise: number | null;
  minDuration: number | null;
  minDurationPeriod: RentalPeriod | null;
  operator: RentalOperator | null;
  operatorRateDayPaise: number | null;
  fuel: RentalFuel;
  transport: RentalTransport | null;
  transportChargePaise: number | null;
  serviceRadiusKm: number | null;
  depositPaise: number | null;
  availableFrom: string | null;
  availabilityNote: string | null;
}

/** A listing in a list (cards, More from this seller, Other side, My listings). Never a pincode, address or point. */
export interface ListingCard {
  id: string;
  ref: number;
  kind: ListingKind;
  status: ListingStatus;
  title: string;
  side: PartSide | null;
  condition: { key: string; label: string } | null;
  quantity: string | null;
  unit: { key: string; label: string; decimals: number } | null;
  priceModel: PriceModel | null;
  pricePaise: number | null;
  gstMode: GstPriceMode | null;
  /** Rentals: the headline rate (the first set of day, hour, week, month). */
  rate: { period: RentalPeriod; paise: number } | null;
  thumbUrl: string | null;
  city: string | null;
  industrialAreaName: string | null;
  /** Whole km from the viewer, when known. */
  distanceKm: number | null;
  refreshedAt: string | null;
  businessId: string;
}

/** The public listing page (§8.1). */
export interface ListingDetail extends ListingCard {
  description: string | null;
  categoryId: string | null;
  /** Machine category › machine type › part group names. */
  categoryPath: string[];
  specs: Specs;
  partNumber: string | null;
  partBrand: { id: string; name: string } | null;
  minOrderQty: string | null;
  conditionNote: string | null;
  delivery: DeliveryOption[];
  state: string | null;
  media: ListingMediaItem[];
  fitments: Fitment[];
  machine: MachineDetails | null;
  rental: RentalTerms | null;
  seller: {
    businessId: string;
    displayName: string;
    industrialAreaName: string | null;
    city: string | null;
    gstVerified: boolean;
    memberSince: string;
    liveListings: number;
  };
  isOwner: boolean;
  publishedAt: string | null;
}

/** A field today's rules would ask for (§7.3 nudges, `LISTING_INCOMPLETE` problems): `side` / `SIDE_REQUIRED`, `specs.<key>` / `required`… */
export interface ListingProblem {
  field: string;
  code: string;
}

/** The owner's view of their listing, any status (`GET /listings/:id/owner`, §7.3–§7.5). */
export interface ListingOwnerView extends ListingDetail {
  version: number;
  unitId: string | null;
  conditionId: string | null;
  partBrandId: string | null;
  flags: ListingFlag[];
  acceptedFlags: ListingFlag[];
  reviewReasons: ReviewReason[];
  needsAttention: ListingProblem[];
  /** An open report: side / fit edits go to review (the app warns without naming the report). */
  reviewOnEdit: boolean;
  expiresAt: string | null;
  expiringSoon: boolean;
  moderation: { outcome: ModerationOutcome; note: string | null; at: string } | null;
  /** The hide / remove reason, or the seller's own note. */
  statusReason: string | null;
  score: { score: number; missing: ListingScoreItem[] };
  location: {
    source: ListingLocationSource;
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
  createdAt: string;
  updatedAt: string;
}

/** `PATCH /listings/:id`: only the fields sent change (§7.3). Money in paise; quantities as decimal strings. */
export interface ListingPatch {
  categoryId?: string;
  title?: string;
  description?: string | null;
  specs?: Specs;
  partNumber?: string | null;
  partBrandId?: string | null;
  side?: PartSide;
  quantity?: string;
  unitId?: string;
  minOrderQty?: string | null;
  conditionId?: string;
  conditionNote?: string | null;
  priceModel?: PriceModel;
  pricePaise?: number | null;
  gstMode?: GstPriceMode | null;
  delivery?: DeliveryOption[];
  location?:
    | { source: 'business' }
    | {
        source: 'godown';
        pincode: string;
        city: string;
        state: string;
        industrialAreaId?: string | null;
        industrialAreaOther?: string | null;
        addressLine?: string | null;
        lat?: number | null;
        lng?: number | null;
      };
  fitments?: Array<Pick<Fitment, 'brandId' | 'modelId' | 'modelOther' | 'yearFrom' | 'yearTo' | 'note'>>;
  machine?: Partial<Omit<MachineDetails, 'brandName' | 'modelName'>>;
  rental?: Partial<RentalTerms>;
}

/** One card of the Other side result (§9.1): tier 1 part number, 2 name and fit, 3 "possibly". */
export interface OtherSideCard extends ListingCard {
  tier: 1 | 2 | 3;
  possible: boolean;
}

/** `GET /listings/:id/other-side` (§9.1). `best` and `counts` are keyed by the wanted side and `pair`. */
export interface OtherSideResult {
  complement: PartSide | null;
  best: Partial<Record<'left' | 'right' | 'pair', OtherSideCard | null>>;
  counts: Partial<Record<'left' | 'right' | 'pair', number>>;
  items: OtherSideCard[];
}

/** My listings groups (§10, R29). */
export const MY_LISTINGS_GROUPS = ['live', 'review', 'paused', 'sold', 'drafts', 'removed_by_team'] as const;
export type MyListingsGroup = (typeof MY_LISTINGS_GROUPS)[number];

/** A card on My listings: the card plus what the seller acts on. */
export interface MyListingCard extends ListingCard {
  updatedAt: string;
  expiresAt: string | null;
  expiringSoon: boolean;
  moderation: { outcome: ModerationOutcome; note: string | null; at: string } | null;
  statusReason: string | null;
  scoreMissing: ListingScoreItem[];
  needsAttention: ListingProblem[];
}

/** `GET /listings/mine?group=`: counts per group plus one page of the group. */
export interface MyListingsView {
  counts: Record<MyListingsGroup, number>;
  group: MyListingsGroup;
  items: MyListingCard[];
  total: number;
  page: number;
  pageSize: number;
}

/** `GET /admin/listings` row (§11.4). */
export interface AdminListingRow {
  id: string;
  ref: number;
  thumbUrl: string | null;
  title: string;
  kind: ListingKind;
  status: ListingStatus;
  categoryPath: string[];
  city: string | null;
  side: PartSide | null;
  business: { id: string; name: string };
  priceModel: PriceModel | null;
  pricePaise: number | null;
  rate: { period: RentalPeriod; paise: number } | null;
  flags: ListingFlag[];
  openReports: number;
  updatedAt: string;
}

/** The moderation queue's tabs (§11.1). */
export const MODERATION_TABS = ['review', 'reported', 'decided'] as const;
export type ModerationTab = (typeof MODERATION_TABS)[number];

/** `GET /admin/moderation/queue` row (§11.1). */
export interface AdminModerationRow {
  id: string;
  ref: number;
  thumbUrl: string | null;
  title: string;
  kind: ListingKind;
  status: ListingStatus;
  side: PartSide | null;
  business: { id: string; name: string; gstVerified: boolean };
  reviewReasons: ReviewReason[];
  statusChangedAt: string | null;
  openReports: number;
  lastReportAt: string | null;
  /** Decided tab: the last moderation action and when. */
  decision: { action: AdminListingAction; at: string } | null;
}

/** A report in the admin review screen. */
export interface AdminListingReport {
  id: string;
  reason: ListingReportReason;
  details: string | null;
  status: ReportStatus;
  reporter: { businessId: string | null; businessName: string | null };
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

/** One status change (§7.5). */
export interface ListingHistoryEntry {
  id: string;
  fromStatus: ListingStatus | null;
  toStatus: ListingStatus;
  action: string;
  actor: ListingActor;
  adminName: string | null;
  reason: string | null;
  createdAt: string;
}

/** `GET /admin/listings/:id` (§11.2): everything, private fields included. */
export interface AdminListingDetail {
  listing: ListingOwnerView & { returnStatus: ListingStatus | null; firstLiveAt: string | null; statusChangedAt: string | null };
  /** The node's effective side convention, for the specs table. */
  sideConvention: string | null;
  seller: {
    businessId: string;
    name: string;
    gstVerified: boolean;
    ownerStatus: AccountStatus | null;
    memberSince: string;
    listingsByStatus: Partial<Record<ListingStatus, number>>;
    everLive: number;
  };
  reports: AdminListingReport[];
  history: ListingHistoryEntry[];
}

// ─── Listing contracts shared by the F2 lanes (C0): request / response shapes of the routes still to be built ───
// Route paths as in the plan (Tasks 13, 16, 19) and spec §11.3, §14. Responses are the `data` of `{ data }`.

/**
 * The video switch (amendment 3, plan Task 13). The API reads it only through `videoUploadEnabled()` in
 * `apps/api/src/lib/media-switch.ts`; the app through `videoUploadEnabled()` in `lib/media-prepare.ts` (also Android
 * only until iOS is verified). Off → presign / attach of `video` answer `400 MEDIA_TYPE` and the app offers photos only.
 *
 * **Off** until the native media spike has run on a real device. How the owner turns it on (device checks, then this
 * constant, the shared-types build, and the API test "the shipped video switch"):
 * `docs/superpowers/spikes/2026-11-18-f2-native-media.md`.
 */
export const LISTING_VIDEO_UPLOAD_ENABLED: boolean = false;

/** The roles one media item uploads, in this order (§6.2). */
export const MEDIA_ROLES_BY_TYPE: Readonly<Record<MediaType, readonly [MediaRole, MediaRole]>> = {
  photo: ['full', 'thumb'],
  video: ['video', 'poster'],
};

/**
 * `Content-Type`s a presign accepts per role (signed into the PUT, §6.2). Photos and posters always leave the device as
 * JPEG (manipulator, R46); the stored key's extension and the served type follow the server's sniff, not this.
 */
export const MEDIA_UPLOAD_CONTENT_TYPES: Readonly<Record<MediaRole, readonly string[]>> = {
  full: ['image/jpeg'],
  thumb: ['image/jpeg'],
  video: ['video/mp4', 'video/quicktime'],
  poster: ['image/jpeg'],
};

/** `POST /listings/:id/media/presign` body (§6.2): a photo sends `full` + `thumb`, a video `video` + `poster`. */
export interface MediaPresignRequest {
  type: MediaType;
  /** Send the same id again to re-presign an item on retry. */
  uploadId?: string;
  files: Array<{ role: MediaRole; contentType: string; size: number }>;
}

/** `POST /listings/:id/media/presign` response: PUTs signed for 300 s with `Content-Type` and `Content-Length`. */
export interface MediaPresignResult {
  uploadId: string;
  files: Array<{ role: MediaRole; key: string; url: string; expiresAt: string }>;
}

/** `POST /listings/:id/media` body (§6.2). `durationMs` is required for a video (≤ `LISTING_VIDEO_MAX_MS`). */
export type MediaAttachRequest =
  | { type: 'photo'; uploadId: string; keys: { full: string; thumb: string } }
  | { type: 'video'; uploadId: string; keys: { video: string; poster: string }; durationMs: number };

/** `POST /listings/:id/media` response (201): the attached item. */
export type MediaAttachResult = ListingMediaItem;

/** `PUT /listings/:id/media/order` body: every media id of the listing; the first photo is the cover (`400 MEDIA_ORDER_INVALID`). */
export interface MediaOrderRequest {
  ids: string[];
}

/** `PUT /listings/:id/media/order` response: the listing's media in the new order. */
export type MediaOrderResult = ListingMediaItem[];

/** `DELETE /listings/:id/media/:mediaId` response (seller). Objects and CDN copies go after commit, best-effort. */
export interface MediaDeleteResult {
  id: string;
  deleted: true;
}

/** `purgeUrls` (`apps/api/src/lib/cdn-purge.ts`): no zone configured → `skipped`; any failure → `failed`, never thrown. */
export const CDN_PURGE_RESULTS = ['ok', 'failed', 'skipped'] as const;
export type CdnPurgeResult = (typeof CDN_PURGE_RESULTS)[number];

// Seller routes already built (Batch 2b), typed for the app's `lib/listing-api.ts`.

/** `POST /listings` body → `ListingOwnerView` (201). */
export interface CreateListingRequest {
  kind: ListingKind;
}

/** `POST /listings/:id/publish` and `POST /listings/:id/actions` response. */
export interface ListingActionResult {
  listing: ListingOwnerView;
  /** Where the listing landed; for publish and the go-live actions `live` or `pending_review`. */
  outcome: ListingStatus;
}

/** `POST /listings/:id/actions` body (§7.2). The note goes to the history row (and is the reason for unavailable / remove). */
export interface ListingActionRequest {
  action: SellerListingAction;
  note?: string | null;
}

/** `DELETE /listings/:id` (drafts only) response. */
export interface ListingDeleteResult {
  id: string;
  deleted: true;
}

/** `POST /listings/:id/reports` body (§8.4): `details` required for `something_else` (≤ 500). */
export interface ListingReportRequest {
  reason: ListingReportReason;
  details?: string | null;
}

/** `POST /listings/:id/reports` response (201). */
export interface ListingReportResult {
  id: string;
  status: 'open';
}

// `GET /listings/:id` → `ListingDetail`, or `ListingOwnerView` when `isOwner` · `GET /listings/:id/owner` →
// `ListingOwnerView` · `GET /listings/mine?group=&page=` → `MyListingsView` · `PATCH /listings/:id` (`ListingPatch`) →
// `ListingOwnerView` · `GET /businesses/:id/listings?limit=(1–50, default 20)&exclude=` → `ListingCard[]` ·
// `GET /listings/:id/other-side` → `OtherSideResult`.

// Admin (plan Task 16; roles §11.6: moderation and actions `moderator`; list and detail also `support`).

/** Moderation queue page size (§11.1). */
export const MODERATION_PAGE_SIZE = 50;

/** `GET /admin/moderation/queue?tab=review|reported|decided&page=` (§11.1). */
export interface AdminModerationQueue {
  tab: ModerationTab;
  rows: AdminModerationRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** `GET /admin/moderation/counts`. The nav badge `moderationWaiting` = `review + reported`. */
export interface ModerationCounts {
  review: number;
  reported: number;
}

/** All listings page sizes (§11.4). */
export const ADMIN_LISTING_PAGE_SIZES = [25, 50, 100] as const;
export type AdminListingPageSize = (typeof ADMIN_LISTING_PAGE_SIZES)[number];

/**
 * `GET /admin/listings` filters (§11.4), parsed. In the URL (API and admin page alike) `status` and `flags` are
 * comma-separated lists (`?status=live,paused`), `reported=1` means "has open reports", the rest are one value each:
 * `?status=&kind=&machineCategoryId=&city=&side=&flags=&reported=&businessId=&q=&page=&pageSize=`.
 */
export interface AdminListingFilters {
  /** Default: every status but `draft`. */
  status?: ListingStatus[];
  kind?: ListingKind;
  /** A root (`machine_category`) node: listings anywhere under it. */
  machineCategoryId?: string;
  /** Exact city, case-insensitive. */
  city?: string;
  side?: PartSide;
  /** Listings carrying any of these flags. */
  flags?: ListingFlag[];
  /** Only listings with at least one open report. */
  reported?: boolean;
  businessId?: string;
  /** Title, normalised part number, `#ref` (`#100123`) or business name. */
  q?: string;
  page?: number;
  pageSize?: AdminListingPageSize;
}

/** `GET /admin/listings` response. */
export interface AdminListingList {
  rows: AdminListingRow[];
  total: number;
  page: number;
  pageSize: number;
  /** The `businessId` filter's business, for the removable chip with its name; null without the filter. */
  business: { id: string; name: string } | null;
}

/** `POST /admin/listings/:id/approve` body. `…/unhide` takes no body. */
export interface AdminApproveRequest {
  version: number;
}

/** `POST /admin/listings/:id/ask-for-changes` body (`ADMIN_REASON_MIN`–`ADMIN_REASON_MAX`). */
export interface AdminAskForChangesRequest {
  version: number;
  message: string;
}

/** `POST /admin/listings/:id/reject` body. */
export interface AdminRejectRequest {
  version: number;
  reason: string;
}

/** `POST /admin/listings/:id/hide` and `…/remove` body: no version, they always apply (R53). */
export interface AdminReasonRequest {
  reason: string;
}

/** `PATCH /admin/listings/:id` body (§11.3): at least one of category, side, fitments; edited fitments get `source = 'admin'`. */
export interface AdminListingPatch {
  version: number;
  categoryId?: string;
  side?: PartSide;
  fitments?: NonNullable<ListingPatch['fitments']>;
}

/** How a moderator closes a listing's open reports. */
export const REPORT_RESOLUTIONS = ['dismissed', 'actioned'] as const;
export type ReportResolution = (typeof REPORT_RESOLUTIONS)[number];

/** `POST /admin/listings/:id/reports/resolve` body: closes all open reports (`409 NO_OPEN_REPORTS` when none). */
export interface AdminResolveReportsRequest {
  outcome: ReportResolution;
  note?: string | null;
}

/**
 * Response of every single-listing admin action — approve, ask-for-changes, reject, hide, unhide, remove, `PATCH`,
 * reports/resolve: the refreshed review screen, so the page re-renders without a second request.
 */
export type AdminListingActionResult = AdminListingDetail;

/** `DELETE /admin/listings/:id/media/:mediaId` body: the reason (also the note when the last photo moves it to `rejected`, R52). */
export type AdminMediaDeleteRequest = AdminReasonRequest;

/** `DELETE /admin/listings/:id/media/:mediaId` response. On `failed` the page says "Deleted. The CDN copy may take a while to clear." */
export interface AdminMediaDeleteResult {
  purge: CdnPurgeResult;
}

/** Bulk actions on the all-listings page (§11.3, R34). */
export const ADMIN_LISTING_BULK_ACTIONS = ['hide', 'remove'] as const;
export type AdminListingBulkAction = (typeof ADMIN_LISTING_BULK_ACTIONS)[number];
export const ADMIN_LISTING_BULK_MAX = 50;

/** `POST /admin/listings/bulk` body: 1–`ADMIN_LISTING_BULK_MAX` ids. */
export interface AdminListingBulkRequest {
  action: AdminListingBulkAction;
  ids: string[];
  reason: string;
}

/** `POST /admin/listings/bulk` response: one transaction per listing; a skipped one carries its error code. */
export interface AdminListingBulkResult {
  done: string[];
  skipped: Array<{ id: string; code: string }>;
}

/** `GET /admin/settings/expiry-impact?days=` (§11.5): live and rented listings the next job run would expire. */
export interface SettingsExpiryImpact {
  days: number;
  count: number;
}
