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

// ─── enquiry & offer (F6 + F7 spec 2026-11-19 §5.16) ───
/**
 * Enquiry lifecycle (scope F6). **Derived, never stored** (§6.2): `enquiryStatus()` computes it from the thread, so
 * nothing can drift.
 */
export const ENQUIRY_STATUSES = ['open', 'replied', 'converted', 'closed'] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];

/** Quick enquiry options (scope F6, §6.3). `price_request` is Ask price (price-on-request listings). */
export const QUICK_ENQUIRIES = [
  'is_available', 'more_photos', 'video', 'specifications', 'best_price', 'compatibility', 'price_request',
] as const;
export type QuickEnquiry = (typeof QUICK_ENQUIRIES)[number];

/** Offer state machine (§7.5). `backup` waits on stock; `closed` is a system close with an `OFFER_CLOSE_REASONS` reason. */
export const OFFER_STATUSES = [
  'pending', 'countered', 'accepted', 'rejected', 'expired', 'withdrawn', 'backup', 'closed',
] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

/** The opening row's kind (§7.1, R11–R13); counters keep `offer`. */
export const OFFER_KINDS = ['offer', 'buy_now', 'quote'] as const;
export type OfferKind = (typeof OFFER_KINDS)[number];

/** Why the system closed an open or backup offer (§7.5). */
export const OFFER_CLOSE_REASONS = ['listing_unavailable', 'listing_changed', 'blocked', 'account_inactive'] as const;
export type OfferCloseReason = (typeof OFFER_CLOSE_REASONS)[number];

/** The two parties of a thread, offer or deal. */
export const PARTY_SIDES = ['buyer', 'seller'] as const;
export type PartySide = (typeof PARTY_SIDES)[number];

/** Counters in one negotiation (R11), then accept or reject only. */
export const MAX_COUNTER_ROUNDS = 5;

// ─── chat (§5.2, §6) ───
/** `booking` added by M14 (a rental booking card, spec §5.5); no migration statement compares it as an enum literal. */
export const MESSAGE_KINDS = ['text', 'photos', 'enquiry', 'offer', 'deal', 'system', 'booking'] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

/** System lines (§6.9): stored as code + values, rendered in the reader's language (`chat.system.<code>`). */
export const SYSTEM_LINE_CODES = [
  'offer_withdrawn', 'offer_rejected', 'offer_expired', 'offer_backup', 'offer_revived', 'offer_reconfirmed',
  'offers_closed', 'deal_agreed', 'deal_notes_changed', 'deal_handed_over', 'deal_completed', 'deal_auto_completed',
  'deal_cancel_requested', 'deal_cancel_request_withdrawn', 'deal_cancelled', 'deal_problem_reported',
  'deal_dispute_resolved', 'contact_shared', 'blocked',
  // M14 rental bookings (spec §5.8).
  'booking_requested', 'booking_changed', 'booking_confirmed', 'booking_declined', 'booking_withdrawn',
  'booking_expired', 'booking_on_site', 'booking_returned', 'booking_completed', 'booking_cancelled',
  'booking_problem', 'booking_dispute_resolved',
] as const;
export type SystemLineCode = (typeof SYSTEM_LINE_CODES)[number];

/** Chat bounds (§5.16, §6.4, §6.8, §6.10, §11.5). */
export const CHAT_LIMITS = {
  messageMax: 2000,
  noteMax: 500,
  photosPerMessage: 5,
  messagesPerMinute: 30,
  photoMaxBytes: 10 * 1024 * 1024,
  /** Long edge after the server re-encode (§6.8). */
  photoMaxEdgePx: 2048,
  photoJpegQuality: 80,
  /** Life of a private photo's signed URL, seconds. */
  photoUrlSeconds: 300,
  inboxPageSize: 20,
  messagesPageSize: 30,
  /** Redis `viewing:<userId>` life and the app's `thread:viewing` refresh, seconds (§11.5). */
  viewingTtlSeconds: 45,
  viewingRefreshSeconds: 20,
  reportDetailsMax: 500,
} as const;

/** Every other F6 / F7 text, photo and rate bound (plan Global constraints). */
export const DEAL_LIMITS = {
  offerNoteMax: 500,
  rejectNoteMax: 300,
  dealNotesMax: 500,
  cancelNoteMax: 300,
  handoverNoteMax: 300,
  replyMax: 300,
  reviewTextMax: 1000,
  disputeDescriptionMin: 10,
  disputeDescriptionMax: 1000,
  disputePhotosMax: 5,
  messageToPartiesMax: 500,
  offerActionsPerMinute: 20,
  dealActionsPerMinute: 20,
  photoPresignPer10Min: 30,
  reportsPerDay: 10,
} as const;

/** An admin may read a conversation this long after its report or dispute was resolved (§16.3). */
export const ADMIN_READ_WINDOW_DAYS = 30;

// ─── consent (§5.5, §6.6) ───
export const CONSENT_KINDS = ['grant', 'withdraw'] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];
export const CONSENT_WITHDRAW_REASONS = ['number_removed', 'number_replaced', 'owner_changed'] as const;
export type ConsentWithdrawReason = (typeof CONSENT_WITHDRAW_REASONS)[number];
export const CONSENT_PHONE_SOURCES = ['business_contact', 'owner_phone'] as const;
export type ConsentPhoneSource = (typeof CONSENT_PHONE_SOURCES)[number];
/** The "Share my number" wording shown with the tick; bump when the copy changes. */
export const CONSENT_WORDING_VERSION = 1;

// ─── deal (§5.7–§5.10, §9) ───
/** Deal record (scope F7): an accepted offer → `agreed` → `handed_over` → `completed`. Payment happens off-platform. */
export const DEAL_STATUSES = ['agreed', 'handed_over', 'completed', 'cancelled', 'disputed'] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];

export const DEAL_COMPLETED_HOW = ['buyer_confirmed', 'auto', 'support'] as const;
export type DealCompletedHow = (typeof DEAL_COMPLETED_HOW)[number];
export const DEAL_CANCELLED_BY = ['buyer', 'seller', 'both', 'system'] as const;
export type DealCancelledBy = (typeof DEAL_CANCELLED_BY)[number];
export const DEAL_CANCEL_REASONS_BUYER = ['no_longer_needed', 'found_elsewhere', 'seller_not_responding', 'other'] as const;
export const DEAL_CANCEL_REASONS_SELLER = ['buyer_not_responding', 'payment_not_received', 'stock_problem', 'other'] as const;
export const DEAL_CANCEL_REASONS_SYSTEM = ['listing_removed', 'support_closed'] as const;
export type DealCancelReason =
  | (typeof DEAL_CANCEL_REASONS_BUYER)[number]
  | (typeof DEAL_CANCEL_REASONS_SELLER)[number]
  | (typeof DEAL_CANCEL_REASONS_SYSTEM)[number];
export const DEAL_PAYMENT_METHODS = ['bank', 'upi', 'cash', 'credit'] as const;
export type DealPaymentMethod = (typeof DEAL_PAYMENT_METHODS)[number];
export const DEAL_FULFILMENT = ['pickup', 'delivery'] as const;
export type DealFulfilment = (typeof DEAL_FULFILMENT)[number];
/** Timeline events (§5.9); each also posts a system line in the thread. */
export const DEAL_EVENT_CODES = [
  'agreed', 'notes_changed', 'handed_over', 'received', 'auto_completed', 'cancel_requested',
  'cancel_request_withdrawn', 'cancelled', 'problem_reported', 'dispute_resolved', 'contact_shared',
] as const;
export type DealEventCode = (typeof DEAL_EVENT_CODES)[number];
export const DEAL_ACTOR_SIDES = ['buyer', 'seller', 'system', 'support'] as const;
export type DealActorSide = (typeof DEAL_ACTOR_SIDES)[number];
/** A deal's stock hold (§5.7, R16). */
export const HOLD_STATUSES = ['active', 'converted', 'released'] as const;
export type HoldStatus = (typeof HOLD_STATUSES)[number];
export const DISPUTE_CATEGORIES = [
  'not_as_described', 'damaged', 'short_quantity', 'not_received', 'payment_not_received', 'other',
] as const;
export type DisputeCategory = (typeof DISPUTE_CATEGORIES)[number];
export const DISPUTE_STATUSES = ['open', 'resolved'] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];
export const DISPUTE_OUTCOMES = ['completed', 'cancelled', 'resumed'] as const;
export type DisputeOutcome = (typeof DISPUTE_OUTCOMES)[number];

/**
 * Rental booking lifecycle (M14 spec §6.1): `requested` <-> `countered` -> `confirmed` -> `on_rent` -> `returned` ->
 * `completed`; exits `declined`, `withdrawn`, `expired`, `cancelled`, `disputed`. The rest of M14's contracts are in
 * the "M14: rental bookings" section at the end of this file.
 */
export const RENTAL_BOOKING_STATUSES = [
  'requested', 'countered', 'confirmed', 'on_rent', 'returned', 'completed', 'declined', 'withdrawn', 'expired',
  'cancelled', 'disputed',
] as const;
export type RentalBookingStatus = (typeof RENTAL_BOOKING_STATUSES)[number];

// ─── reviews (§5.11, §10) ───
/** What a review (or a dispute) is about (M14 R11, R12): an F6 deal or an M14 rental booking. Exactly one per row. */
export const REVIEW_SUBJECTS = ['deal', 'rental'] as const;
export type ReviewSubjectKind = (typeof REVIEW_SUBJECTS)[number];
/**
 * The three facets each side rates (§10.2), keyed by subject, then the reviewer's side: the buyer (renter) rates the
 * seller (owner) and back. A rental's owner rates `care` of the machine in place of `pickup` (M14 R11).
 */
export const REVIEW_FACETS = {
  deal: {
    buyer: ['matched_listing', 'communication', 'on_time'],
    seller: ['communication', 'payment', 'pickup'],
  },
  rental: {
    buyer: ['matched_listing', 'communication', 'on_time'],
    seller: ['communication', 'payment', 'care'],
  },
} as const;
export type ReviewFacet = (typeof REVIEW_FACETS)[ReviewSubjectKind][PartySide][number];
export const REVIEW_REPORT_REASONS = ['abusive', 'false', 'personal_information', 'other'] as const;
export type ReviewReportReason = (typeof REVIEW_REPORT_REASONS)[number];
export const CONVERSATION_REPORT_REASONS = ['spam', 'scam_or_advance_payment', 'abusive', 'fake_listing', 'other'] as const;
export type ConversationReportReason = (typeof CONVERSATION_REPORT_REASONS)[number];

// ─── part request ───
/**
 * Part request lifecycle (scope F8, flow U3; F8 spec §9.1, R3). "Matched" is a derived badge (`isMatched`), never a
 * status. The rest of F8's contracts are in the "F8: part requests" section at the end of this file.
 */
export const PART_REQUEST_STATUSES = ['active', 'fulfilled', 'closed', 'expired', 'removed'] as const;
export type PartRequestStatus = (typeof PART_REQUEST_STATUSES)[number];

// ─── reports ───
/**
 * Reports and flags (scope A2, A3, A6). `review` added by F6 + F7 (§5.15); no migration statement uses it (§5.17: a
 * new enum value can't be used in the transaction that adds it).
 */
export const REPORT_TARGETS = ['user', 'business', 'listing', 'conversation', 'review', 'part_request'] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];

export const REPORT_STATUSES = ['open', 'reviewing', 'actioned', 'dismissed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

// ─── notifications ───
/** Notification types (scope F9; F6 + F7 §5.16, §11.3). */
export const NOTIFICATION_TYPES = [
  'enquiry_new', 'message_new', 'offer_new', 'offer_countered', 'offer_accepted', 'offer_rejected',
  'part_match', 'listing_status', 'deal_completed',
  'offer_quote', 'offer_expiring', 'offer_backup', 'offer_revived', 'deal_handed_over', 'deal_cancel_requested',
  'deal_cancelled', 'deal_problem', 'deal_dispute_resolved', 'deal_agreed_reminder', 'review_received',
  // §10.3: the other side is told it has until `publish_due_at` to review (plan review I6).
  'review_waiting',
  // F8 part requests (F8 spec §10.1); `part_match` above is F8's grouped auto-match row.
  'part_request_new', 'part_request_reply', 'part_request_expiring', 'part_request_expired',
  'part_request_fulfil_prompt', 'part_request_removed', 'part_request_reply_dropped',
  // M14 rental bookings (spec §11); every `rental_booking_*` type is in the `rentals` category.
  'rental_booking_requested', 'rental_booking_changed', 'rental_booking_confirmed', 'rental_booking_declined',
  'rental_booking_withdrawn', 'rental_booking_expired', 'rental_booking_cancelled', 'rental_booking_on_site',
  'rental_booking_returned', 'rental_booking_completed', 'rental_booking_starts_tomorrow', 'rental_booking_due_back',
  'rental_booking_overdue', 'rental_booking_not_started', 'rental_booking_clash', 'rental_booking_problem',
  'rental_booking_dispute_resolved',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** `rentals` added by M14 (§11); no migration statement compares it as an enum literal. */
export const NOTIFICATION_CATEGORIES = ['chat', 'offers', 'deals', 'reviews', 'requests', 'rentals'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/**
 * The category of a type (§11.3). Every `part_request_*` type and `part_match` are `requests` (F8 §5.11); every
 * `rental_booking_*` type is `rentals` (M14 §11); `listing_status` belongs to a later module (F2 notices) and falls
 * under `deals` until it gets one of its own.
 */
export function notificationCategory(type: NotificationType): NotificationCategory {
  if (type === 'part_match' || type.startsWith('part_request_')) return 'requests';
  if (type.startsWith('rental_booking_')) return 'rentals';
  if (type === 'enquiry_new' || type === 'message_new') return 'chat';
  if (type.startsWith('offer_')) return 'offers';
  if (type === 'review_received' || type === 'review_waiting') return 'reviews';
  return 'deals';
}

export const DELIVERY_STATES = ['queued', 'sent', 'sent_dev', 'failed', 'skipped'] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];
export const DEVICE_PLATFORMS = ['android', 'ios'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

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
  /** F4 + F5 §4.1: the name reads as a search chip only with a model of the brand or a machine type ("bull gear"). */
  chipNeedsContext: boolean;
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
  /** F6 + F7 §16.1: deals by status and disputes with outcomes. */
  dealHistory: AdminBusinessDealHistory;
  /** F6 + F7 §10.4: the seller score; null under `review_min_published` reviews. */
  sellerScore: SellerScore | null;
  /** F8 §14: the business's part requests in any status; the page links "Part requests (n)" to the filtered list. */
  partRequestCount: number;
  /** M14 §15: the business's rental bookings in any status, as the owner and as the renter. */
  rentalBookingCount: { asOwner: number; asRenter: number };
}

// ─── Listings (F2 + F3 + A3; spec 2026-11-18-f2-f3-listings-design) ───

/** Served to anyone (spec §7.1, R20); every other status is owner and admins only. */
export const PUBLIC_LISTING_STATUSES = ['live', 'reserved', 'rented'] as const satisfies readonly ListingStatus[];

/**
 * A seller may PATCH a listing in these (§7.3); not `hidden`, `removed` (`409 LISTING_NOT_EDITABLE`). `reserved` joined
 * with F6 + F7 (§8.3): price, photos, description and specs stay editable; a quantity edit stays ≥ `held_quantity`.
 */
export const EDITABLE_LISTING_STATUSES = [
  'draft', 'pending_review', 'rejected', 'live', 'paused', 'reserved', 'expired', 'unavailable', 'sold', 'rented',
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
 * There is no `duplicate` (owner decision 8). M14 §7.1 retired the seller's `mark_rented` / `end_rental`: a rental's
 * `rented` status follows its booking calendar (system `rent_out` / `rent_back`).
 */
export const SELLER_LISTING_ACTIONS = [
  'pause', 'resume', 'renew', 'mark_sold', 'mark_unavailable', 'relist', 'remove',
] as const;
export type SellerListingAction = (typeof SELLER_LISTING_ACTIONS)[number];

/** Moderator status actions (§11.3). Admin edit and media delete aren't status transitions. */
export const ADMIN_LISTING_ACTIONS = ['approve', 'ask_for_changes', 'reject', 'hide', 'unhide', 'remove'] as const;
export type AdminListingAction = (typeof ADMIN_LISTING_ACTIONS)[number];

/**
 * Transitions the system makes (§7.2): the expiry job, edits back to review, admin's last-photo delete, and F6 + F7's
 * stock moves (`reserve`, `unreserve`, `sell_out`; `syncReservation` in `services/deals/holds.ts`, §8.2).
 */
export const SYSTEM_LISTING_ACTIONS = [
  'expire', 'back_to_review', 'photos_removed', 'reserve', 'unreserve', 'sell_out',
  // M14 §7.1: `syncRentalStatus` (today's free capacity reached 0 / came back).
  'rent_out', 'rent_back',
] as const;
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
const HIDEABLE: readonly ListingStatus[] = ['live', 'paused', 'reserved', 'expired', 'unavailable', 'sold', 'rented'];

/** The only ways a status changes (§7.2). `listing-lifecycle.service.ts` is the only writer of `status`. */
export const LISTING_TRANSITIONS: readonly ListingTransition[] = [
  { action: 'publish', actor: 'seller', from: ['draft'], to: 'gate' },
  { action: 'publish', actor: 'seller', from: ['rejected'], to: 'gate' },
  { action: 'approve', actor: 'admin', from: ['pending_review'], to: 'return_status' },
  { action: 'ask_for_changes', actor: 'admin', from: ['pending_review'], to: 'rejected' },
  { action: 'reject', actor: 'admin', from: ['pending_review'], to: 'rejected' },
  // M14 §7.1: an owner whose machines are all out (`rented`) can still pause, renew or make the listing unavailable;
  // a rental is never "sold" (removed or made unavailable instead).
  { action: 'pause', actor: 'seller', from: ['live', 'reserved', 'rented'], to: 'paused' },
  { action: 'resume', actor: 'seller', from: ['paused'], to: 'gate' },
  { action: 'renew', actor: 'seller', from: ['live', 'expired', 'rented'], to: 'gate' },
  {
    action: 'mark_sold', actor: 'seller', from: ['live', 'paused', 'expired', 'unavailable'], to: 'sold',
    kinds: ['part', 'machine'],
  },
  {
    action: 'mark_unavailable', actor: 'seller', from: ['live', 'paused', 'expired', 'reserved', 'rented'],
    to: 'unavailable',
  },
  { action: 'relist', actor: 'seller', from: ['sold', 'unavailable'], to: 'gate' },
  { action: 'remove', actor: 'seller', from: ALL_BUT_DRAFT_REMOVED, to: 'removed' },
  { action: 'expire', actor: 'system', from: ['live', 'rented'], to: 'expired' },
  { action: 'back_to_review', actor: 'system', from: ['live', 'rented', 'reserved'], to: 'pending_review' },
  { action: 'hide', actor: 'admin', from: HIDEABLE, to: 'hidden' },
  { action: 'unhide', actor: 'admin', from: ['hidden'], to: 'return_status' },
  { action: 'remove', actor: 'admin', from: ALL_BUT_DRAFT_REMOVED, to: 'removed' },
  { action: 'photos_removed', actor: 'system', from: HIDEABLE, to: 'rejected' },
  { action: 'reserve', actor: 'system', from: ['live'], to: 'reserved' },
  { action: 'unreserve', actor: 'system', from: ['reserved'], to: 'live' },
  // F6 + F7 §8.3: the quantity reached 0 (a deal completed). On `hidden` / `pending_review` / `rejected` only
  // `return_status = 'sold'` is set (§8.2), so this row doesn't list them.
  { action: 'sell_out', actor: 'system', from: ['live', 'reserved', 'paused', 'unavailable', 'expired'], to: 'sold' },
  // M14 §7.1: `syncRentalStatus` only (no gate on the way back, as `unreserve`).
  { action: 'rent_out', actor: 'system', from: ['live'], to: 'rented', kinds: ['machine_rental'] },
  { action: 'rent_back', actor: 'system', from: ['rented'], to: 'live', kinds: ['machine_rental'] },
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
  // ─── Negotiation, deals and reviews (F6 + F7 spec §17) ───
  {
    key: 'offer_validity_hours_1', type: 'int', default: 24, min: 1, max: 720,
    label: 'Offer validity, short (hours)',
    help: 'The shortest validity a buyer or seller can give an offer. Must be less than the middle one.',
  },
  {
    key: 'offer_validity_hours_2', type: 'int', default: 48, min: 1, max: 720,
    label: 'Offer validity, default (hours)',
    help: 'The middle validity choice, picked by default. Must be less than the long one.',
  },
  {
    key: 'offer_validity_hours_3', type: 'int', default: 168, min: 1, max: 720,
    label: 'Offer validity, long (hours)',
    help: 'The longest validity choice.',
  },
  {
    key: 'offer_open_limit_unverified', type: 'int', default: 3, min: 1, max: 50,
    label: 'Open offers, unverified buyer',
    help: 'Open negotiations a business without GST verification may have at a time (backups and counters not counted).',
  },
  {
    key: 'offer_open_limit_verified', type: 'int', default: 20, min: 1, max: 500,
    label: 'Open offers, verified buyer',
    help: 'Open negotiations a GST-verified business may have at a time.',
  },
  {
    key: 'offer_expiring_notice_hours', type: 'int', default: 6, min: 1, max: 48,
    label: 'Offer "expiring soon" notice (hours)',
    help: 'The side whose turn it is hears this long before an offer expires. Must be less than the short validity.',
  },
  {
    key: 'enquiry_new_per_day_unverified', type: 'int', default: 10, min: 1, max: 500,
    label: 'New enquiries a day, unverified',
    help: 'New conversations a business without GST verification may start in a day (IST).',
  },
  {
    key: 'enquiry_new_per_day_verified', type: 'int', default: 40, min: 1, max: 2000,
    label: 'New enquiries a day, verified',
    help: 'New conversations a GST-verified business may start in a day (IST).',
  },
  {
    key: 'deal_problem_window_days', type: 'int', default: 2, min: 1, max: 30,
    label: 'Problem report window (days)',
    help: 'The buyer may report a problem this long after handover. Must be less than the auto-complete time.',
  },
  {
    key: 'deal_auto_complete_days', type: 'int', default: 3, min: 1, max: 60,
    label: 'Auto-complete after handover (days)',
    help: 'A handed-over deal completes by itself this long after handover.',
  },
  {
    key: 'review_window_days', type: 'int', default: 14, min: 3, max: 90,
    label: 'Review window (days)',
    help: 'Both sides may review this long after a deal completes.',
  },
  {
    key: 'review_blind_days', type: 'int', default: 7, min: 1, max: 30,
    label: 'Blind review wait (days)',
    help: 'After the first review the other side has this long before it publishes. At most the review window.',
  },
  {
    key: 'review_min_published', type: 'int', default: 3, min: 1, max: 20,
    label: 'Reviews before a score shows',
    help: 'A seller shows "New seller" until this many reviews are published.',
  },
  {
    key: 'offer_backup_max_days', type: 'int', default: 14, min: 1, max: 90,
    label: 'Backup offer life (days)',
    help: 'A backup offer waiting this long expires. At least as long as the long offer validity.',
  },
  {
    key: 'deal_agreed_reminder_days', type: 'int', default: 7, min: 1, max: 60,
    label: 'Hand-over reminder (days)',
    help: 'Both sides of a deal still agreed after this long are reminded (no auto-cancel).',
  },
  // ─── Part requests (F8 spec §16) ───
  {
    key: 'part_request_reach_n', type: 'int', default: 15, min: 1, max: 50,
    label: 'Sellers told per requirement',
    help: 'The best-matching eligible sellers notified when a requirement is posted (every eligible seller can still find it).',
  },
  {
    key: 'part_request_open_limit_unverified', type: 'int', default: 3, min: 1, max: 50,
    label: 'Open requirements, unverified buyer',
    help: 'Active requirements a business without GST verification may have at a time.',
  },
  {
    key: 'part_request_open_limit_verified', type: 'int', default: 15, min: 1, max: 200,
    label: 'Open requirements, verified buyer',
    help: 'Active requirements a GST-verified business may have at a time.',
  },
  {
    key: 'part_request_posts_per_day', type: 'int', default: 5, min: 1, max: 100,
    label: 'New requirements a day',
    help: 'Requirements a business may post in a day (IST).',
  },
  {
    key: 'part_request_validity_days_1', type: 'int', default: 7, min: 1, max: 90,
    label: 'Requirement validity, short (days)',
    help: 'The shortest validity a buyer can pick. Must be less than the middle one.',
  },
  {
    key: 'part_request_validity_days_2', type: 'int', default: 15, min: 1, max: 90,
    label: 'Requirement validity, default (days)',
    help: 'The middle validity choice, picked by default. Must be less than the long one.',
  },
  {
    key: 'part_request_validity_days_3', type: 'int', default: 30, min: 1, max: 90,
    label: 'Requirement validity, long (days)',
    help: 'The longest validity choice. At most the maximum open time.',
  },
  {
    key: 'part_request_max_days', type: 'int', default: 90, min: 7, max: 365,
    label: 'Requirement open at most (days)',
    help: 'Renewals stop this many days after the first post.',
  },
  {
    key: 'part_request_expiring_notice_hours', type: 'int', default: 24, min: 1, max: 72,
    label: 'Requirement "expires soon" notice (hours)',
    help: 'The buyer hears this long before a requirement expires. Must be shorter than the short validity.',
  },
  {
    key: 'part_request_seller_push_daily_cap', type: 'int', default: 10, min: 0, max: 100,
    label: 'Requirement pushes a seller gets a day',
    help: 'Beyond this a seller still gets the in-app notification, without a push (0 = never pushed).',
  },
  {
    key: 'part_request_match_push_daily_cap', type: 'int', default: 3, min: 0, max: 20,
    label: 'Match pushes per requirement a day',
    help: 'Auto-match pushes a buyer gets for one requirement in a day (IST). At most the total.',
  },
  {
    key: 'part_request_match_push_total_cap', type: 'int', default: 20, min: 0, max: 200,
    label: 'Match pushes per requirement in all',
    help: 'Auto-match pushes a buyer gets for one requirement over its life; later matches still show in the app.',
  },
  {
    key: 'part_request_reply_listings_max', type: 'int', default: 3, min: 1, max: 10,
    label: 'Listings per seller per requirement',
    help: 'Listings one seller business may send to one requirement (pending and delivered).',
  },
  {
    key: 'part_request_replies_per_day', type: 'int', default: 20, min: 1, max: 500,
    label: 'Requirement replies a seller sends a day',
    help: 'Replies a seller business may send in a day (IST).',
  },
  // ─── Rental bookings (M14 spec §16) ───
  {
    key: 'rental_reply_hours', type: 'int', default: 24, min: 1, max: 168,
    label: 'Booking reply window (hours)',
    help: 'A booking request or change expires when it is not answered within this time.',
  },
  {
    key: 'rental_max_changes', type: 'int', default: 5, min: 0, max: 20,
    label: 'Booking changes',
    help: 'Proposals after the first request; then the booking can only be confirmed, accepted or declined.',
  },
  {
    key: 'rental_open_limit_unverified', type: 'int', default: 3, min: 1, max: 50,
    label: 'Open booking requests, unverified renter',
    help: 'Requested or countered bookings a business without GST verification may have at a time. At most the verified limit.',
  },
  {
    key: 'rental_open_limit_verified', type: 'int', default: 15, min: 1, max: 200,
    label: 'Open booking requests, verified renter',
    help: 'Requested or countered bookings a GST-verified business may have at a time.',
  },
  {
    key: 'rental_requests_per_day', type: 'int', default: 5, min: 1, max: 100,
    label: 'Booking requests a day',
    help: 'New booking requests a renter business may send in a day (IST).',
  },
  {
    key: 'rental_complete_days', type: 'int', default: 2, min: 1, max: 14,
    label: 'Auto-complete after return (days)',
    help: 'A returned booking completes by itself this long after the owner marks it returned.',
  },
  {
    key: 'rental_advance_days', type: 'int', default: 180, min: 7, max: 365,
    label: 'Book ahead at most (days)',
    help: 'How far ahead a booking may start.',
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
  // F6 + F7 §17 cross-checks.
  if (values.offer_validity_hours_1 >= values.offer_validity_hours_2) {
    return { key: 'offer_validity_hours_1', message: 'The short validity must be less than the default one' };
  }
  if (values.offer_validity_hours_2 >= values.offer_validity_hours_3) {
    return { key: 'offer_validity_hours_2', message: 'The default validity must be less than the long one' };
  }
  if (values.offer_expiring_notice_hours >= values.offer_validity_hours_1) {
    return { key: 'offer_expiring_notice_hours', message: 'The "expiring soon" notice must be shorter than the short validity' };
  }
  if (values.deal_problem_window_days >= values.deal_auto_complete_days) {
    return { key: 'deal_problem_window_days', message: 'The problem window must be shorter than the auto-complete time' };
  }
  if (values.review_blind_days > values.review_window_days) {
    return { key: 'review_blind_days', message: 'The blind review wait must not be longer than the review window' };
  }
  if (values.offer_backup_max_days * 24 < values.offer_validity_hours_3) {
    return { key: 'offer_backup_max_days', message: 'A backup must live at least as long as the long offer validity' };
  }
  // F8 §16 cross-checks.
  if (values.part_request_validity_days_1 >= values.part_request_validity_days_2) {
    return { key: 'part_request_validity_days_1', message: 'The short validity must be less than the default one' };
  }
  if (values.part_request_validity_days_2 >= values.part_request_validity_days_3) {
    return { key: 'part_request_validity_days_2', message: 'The default validity must be less than the long one' };
  }
  if (values.part_request_validity_days_3 > values.part_request_max_days) {
    return { key: 'part_request_validity_days_3', message: 'The long validity must not be longer than the maximum open time' };
  }
  if (values.part_request_expiring_notice_hours >= values.part_request_validity_days_1 * 24) {
    return {
      key: 'part_request_expiring_notice_hours',
      message: 'The "expires soon" notice must be shorter than the short validity',
    };
  }
  if (values.part_request_match_push_daily_cap > values.part_request_match_push_total_cap) {
    return { key: 'part_request_match_push_daily_cap', message: 'The daily match pushes must not exceed the total' };
  }
  // M14 §16 cross-check.
  if (values.rental_open_limit_unverified > values.rental_open_limit_verified) {
    return {
      key: 'rental_open_limit_unverified',
      message: 'The unverified open-request limit must not exceed the verified one',
    };
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
  /** `quantity − held_quantity` (F6 + F7 §8.4): what buyers can still take; null when the listing has no quantity. */
  availableQuantity: string | null;
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
  /** Whether the signed-in viewer saved it (F4 + F5 §4.7); null for guests and where not computed. */
  saved: boolean | null;
  /** Reserved, On rent, "Pair: contains a left / right" (F4 + F5 §4.7, R6, R7). */
  tags: ListingCardTag[];
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
    /** F6 + F7 §10.4: null until `review_min_published` reviews are published ("New seller"). */
    score: SellerScore | null;
  };
  isOwner: boolean;
  publishedAt: string | null;
  /** F6 + F7 §12.2: the signed-in buyer's thread on this listing ("Open chat"); null for guests, owners and no thread. */
  myThreadId: string | null;
  /** F6 + F7 §12.2: the signed-in buyer's open negotiation on this listing, if any. */
  openNegotiation: { offerId: string; status: OfferStatus; turn: PartySide; pricePerUnitPaise: number } | null;
}

/** A field today's rules would ask for (§7.3 nudges, `LISTING_INCOMPLETE` problems): `side` / `SIDE_REQUIRED`, `specs.<key>` / `required`… */
export interface ListingProblem {
  field: string;
  code: string;
}

/** The owner's view of their listing, any status (`GET /listings/:id/owner`, §7.3–§7.5). */
export interface ListingOwnerView extends ListingDetail {
  version: number;
  /** F6 + F7 §8.4: quantity on hold in open deals (decimal string, "0" when none). */
  heldQuantity: string;
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
  /**
   * F8 §9.3, plan D4: the part request this listing answers, from its one `pending` reply (made only by
   * `POST /listings { kind, partRequestId }`), so the wizard can load the request; null when there is none.
   */
  partRequestId: string | null;
  /** F8 §9.3: "Goes to the buyer when your listing is live" (name masked); null without a pending reply. */
  pendingRequestReply: { partRequestId: string; name: string } | null;
  /** M14 plan D14: the owner's booking summary of a rental listing; null for parts and machines. */
  bookingSummary: RentalBookingSummary | null;
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
  /** M14 plan D14: a rental's machines out today and active bookings; null for parts and machines. */
  rentalLine: { quantity: number; outToday: number; activeBookings: number } | null;
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
  /** M14 §15: a rental listing's bookings and owner blocks; null for parts and machines. */
  rental: { bookings: AdminRentalBookingRow[]; blocks: RentalBlockView[] } | null;
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
  /** F8 §9.3: reply to this part request with the new draft (prefilled; the reply stays pending until it goes live). */
  partRequestId?: string;
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

// ─── Discovery: search, filters, browse, home, saved (F4 + F5; spec 2026-11-19-f4-f5-discovery-design §4.7) ───

/** Radius choices in km (R4); `null` in a request means All India. */
export const DISCOVERY_RADII_KM = [10, 25, 50, 100, 200] as const;
export type DiscoveryRadiusKm = (typeof DISCOVERY_RADII_KM)[number];
export const DEFAULT_RADIUS_KM: DiscoveryRadiusKm = 50;

/** Sorts (§5.8). R10: best match by default with words, nearest without words when a location is known, else newest. */
export const SEARCH_SORTS = ['best_match', 'nearest', 'newest', 'price_asc', 'price_desc', 'year_desc', 'hours_asc'] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];

/** Quantity filter steps (`quantity ≥ n`, §5.7). */
export const MIN_QTY_STEPS = [2, 10, 50] as const;
export type MinQtyStep = (typeof MIN_QTY_STEPS)[number];

/** What a search synonym points at (§4.2). */
export const SYNONYM_TARGETS = ['category', 'brand', 'model', 'side', 'word'] as const;
export type SynonymTarget = (typeof SYNONYM_TARGETS)[number];

/** A synonym term's script, derived from the term (§4.2). */
export const SEARCH_SCRIPTS = ['latin', 'devanagari', 'gujarati'] as const;
export type SearchScript = (typeof SEARCH_SCRIPTS)[number];

/** Catalogue changes that rebuild listings' search text in the background (§4.5, §5.2). */
export const SEARCH_REFRESH_SCOPES = ['category', 'brand', 'model', 'field', 'condition'] as const;
export type SearchRefreshScope = (typeof SEARCH_REFRESH_SCOPES)[number];

/** Chips the query reader makes that the buyer can remove (§5.3). A removed side chip drops its words (R8). */
export const REMOVABLE_CHIPS = ['side', 'brand', 'model', 'category', 'partNumber'] as const;
export type RemovableChip = (typeof REMOVABLE_CHIPS)[number];

/** Card tags (§4.7): Reserved, On rent, and a Pair shown under a Left / Right side filter. */
export const LISTING_CARD_TAGS = ['reserved', 'on_rent', 'pair_contains_left', 'pair_contains_right'] as const;
export type ListingCardTag = (typeof LISTING_CARD_TAGS)[number];

/** Where a request's origin came from (§6.3); `out_of_range` = a GPS point outside India, so the fallback (or none) was used. */
export const ORIGIN_SOURCES = ['gps', 'pincode', 'business', 'out_of_range'] as const;
export type OriginSource = (typeof ORIGIN_SOURCES)[number];

/** Error codes discovery adds (§10). F2's `LISTING_NOT_FOUND` is reused for a non-public listing. */
export const DISCOVERY_ERROR_CODES = [
  'LOCATION_REQUIRED',
  'SORT_NEEDS_MACHINES',
  'FILTER_NOT_AVAILABLE',
  'CURSOR_INVALID',
  'PINCODE_UNKNOWN',
  'CANNOT_SAVE_OWN_LISTING',
  'SAVED_LIMIT',
  'SYNONYM_EXISTS',
  'SYNONYM_TARGET_INVALID',
] as const;
export type DiscoveryErrorCode = (typeof DISCOVERY_ERROR_CODES)[number];

/** The exact numbers of the spec that the app and the API both use (plan "Global constraints"). */
export const DISCOVERY_LIMITS = {
  /** Results per page (R11). */
  pageSize: 20,
  /** Suggestions: at least 2 characters after normalising, at most 8, typed with a 250 ms debounce (§5.12). */
  suggestMinChars: 2,
  suggestMax: 8,
  suggestDebounceMs: 250,
  /** The Filters screen's live count (§5.11). */
  countDebounceMs: 300,
  /** On the phone only (R13). */
  recentSearches: 10,
  recentlyViewed: 20,
  /** Saved listings per user (`409 SAVED_LIMIT`, §4.4). */
  savedCap: 500,
  /** `POST /discover/cards` ids per call. */
  cardsMaxIds: 20,
  /** Query reader (§5.3): remaining words, part numbers, words in a synonym phrase. */
  maxWords: 10,
  maxPartNumbers: 3,
  maxSynonymPhraseWords: 4,
  /** Reader dictionary checks the Redis version key at most this often (§5.3). */
  readerVersionCheckMs: 5_000,
  /** Suggest's in-process count map is refreshed at most this often (§5.12). */
  suggestCountCacheMs: 90_000,
  /** Trending (§5.12): 7 days, ≥ 3 distinct days, ≥ 5 searches, top 10 (admin: top 20). */
  trendingWindowDays: 7,
  trendingMinDays: 3,
  trendingMinSearches: 5,
  trendingTop: 10,
  adminTrendingTop: 20,
  /** Zero-result report (§5.13): top 50 of 30 days. */
  zeroResultsWindowDays: 30,
  zeroResultsTop: 50,
  /** Search log retention and stored query length (§4.3, R14). */
  logRetentionDays: 90,
  logQueryMaxLength: 200,
  /** Search text refresh job (§5.2). */
  refreshJobIntervalMs: 30_000,
  refreshBatchSize: 200,
  refreshMaxAttempts: 5,
  /** `pg_trgm.word_similarity_threshold` set in each search / suggest transaction (§5.4). */
  trigramThreshold: 0.6,
  suggestTrigramThreshold: 0.5,
  /** Requests per minute per user / install id (R17, §7), and the outer per-IP cap across `/discover/*`. */
  rateLimitSearch: 120,
  rateLimitCount: 240,
  rateLimitSuggest: 240,
  rateLimitOther: 120,
  rateLimitIpOuter: 1_200,
  /** GPS fix cached on the phone for 10 minutes, rounded to 3 decimals; the server snaps to 0.01° (R3, §8.2). */
  gpsCacheMs: 600_000,
  gpsDecimals: 3,
  snapDegrees: 0.01,
  /** Home sections (§7): 8 cards each; the business-category restriction needs at least 4 items. */
  homeSectionSize: 8,
  homeRestrictMinItems: 4,
  /** Browse "Popular brands here" (§7). */
  popularBrands: 6,
} as const;

/**
 * Where distances are measured from (§6.3), in every POST body. `point` is the phone's GPS (rounded to 3 decimals; the
 * server snaps to 0.01°) with an optional `fallback` used when the point is outside India; `pincode` a guest's typed
 * pincode; `business` the signed-in user's business location (`401` for a guest). `null` = no origin (All India).
 */
export type DiscoveryOrigin =
  | { point: { lat: number; lng: number }; fallback?: { business: true } | { pincode: string } }
  | { pincode: string }
  | { business: true }
  | null;

/** What the server used as the origin (never coordinates): the nearest office's area and city, or the business's area and city. */
export interface OriginEcho {
  label: string | null;
  source: OriginSource | null;
}

export type SearchSide = Extract<PartSide, 'left' | 'right' | 'pair'>;

/** Range filter on a number spec field. */
export interface SpecRange {
  min?: number;
  max?: number;
}

/** Search filters (§5.7). Absent = not filtered; run through `cleanFilters()` before sending or sealing. */
export interface SearchFilters {
  /** Empty or absent = all kinds. */
  kinds?: ListingKind[];
  /** That node and its descendants. */
  categoryId?: string;
  side?: SearchSide;
  fit?: { brandId: string; modelId?: string; year?: number };
  /**
   * The brand chip's meaning, as a filter (the brand view's "All" opens it): the listing's part brand, a fitment's
   * brand or its machine make. Overrides the reader's brand chip (§5.3).
   */
  brandId?: string;
  conditionIds?: string[];
  /** Absent = `DEFAULT_RADIUS_KM`; `null` = All India. Ignored with no origin. */
  radiusKm?: DiscoveryRadiusKm | null;
  states?: string[];
  cities?: string[];
  industrialAreaIds?: string[];
  /** Per unit for parts and machines; the headline day rate for rentals. */
  priceMinPaise?: number;
  priceMaxPaise?: number;
  hidePriceOnRequest?: boolean;
  minQty?: MinQtyStep;
  gstVerifiedOnly?: boolean;
  delivers?: boolean;
  /** Hidden in the app while `LISTING_VIDEO_UPLOAD_ENABLED` is false (R16); the API accepts it. */
  hasVideo?: boolean;
  /** Filterable select (option keys) or number (range) fields of the category in play (`400 FILTER_NOT_AVAILABLE` otherwise). */
  specs?: Record<string, string[] | SpecRange>;
  /**
   * M14 R13 "Free on": rentals with at least one machine free on every day of `from` … `to` (IST `YYYY-MM-DD`, at
   * most `RENTAL_LIMITS.freeOnMaxDays` days).
   */
  rentalDates?: { from: string; to: string };
}

/** `POST /discover/search` body (§7). Chips the reader found apply as filters unless listed in `removedChips`. */
export interface SearchRequest {
  q?: string;
  filters?: SearchFilters;
  removedChips?: RemovableChip[];
  sort?: SearchSort;
  origin?: DiscoveryOrigin;
  cursor?: string | null;
}

/** `POST /discover/search/count` body: the same request without a cursor (§5.11). */
export type SearchCountRequest = Omit<SearchRequest, 'cursor'>;

/** What the query reader made of the text (§5.3): chips (removable) and the remaining words. */
export interface QueryReading {
  /** `#123456` typed with a hash: the listing ref (the route redirects when it is public). */
  ref: number | null;
  brand: { id: string; name: string } | null;
  model: { id: string; name: string; brandId: string } | null;
  category: { id: string; name: string; level: CatalogLevel } | null;
  /** Normalised part numbers (max 3). */
  partNumbers: string[];
  side: SearchSide | null;
  /** Remaining normalised words, stop words dropped (max 10 together with `wordGroups`). */
  words: string[];
  /**
   * Word synonyms read in the query (§5.3 step 2, amended 2026-11-19: a word synonym ADDS, it doesn't replace). A group
   * hits when all its `typed` words hit OR all the words of any one of its `alternatives` hit; each group counts as one
   * word (AND with the other words, the partial threshold, the 10-word cap).
   */
  wordGroups: WordSynonymGroup[];
}

/** One word synonym read in a query: the words as typed, and the synonym targets' words. */
export interface WordSynonymGroup {
  typed: string[];
  alternatives: string[][];
}

/** One option of a select spec facet. */
export interface SpecFacetOption {
  key: string;
  label: string;
  count: number;
}

/** A filterable spec field's facet (§5.9): counts per option, or the min / max of a number field. */
export type SpecFacet =
  | { key: string; label: string; type: 'select'; options: SpecFacetOption[] }
  | { key: string; label: string; type: 'number'; unit: string | null; min: number | null; max: number | null };

/** Disjunctive facets, first page only (§5.9): each group counted with every filter except its own. */
export interface SearchFacets {
  kinds: Record<ListingKind, number>;
  /** What each side choice returns: Left = Left + Pair, Right = Right + Pair, Pair = Pair. */
  side: Record<SearchSide, number>;
  conditions: Array<{ id: string; label: string; count: number }>;
  gstVerified: number;
  delivers: number;
  /** Top 10. */
  states: Array<{ state: string; count: number }>;
  /** Only with a category in play. */
  specs: SpecFacet[];
}

/** The next larger radius with full matches (§5.6); `radiusKm` null = All India. */
export interface SearchWiden {
  radiusKm: DiscoveryRadiusKm | null;
  count: number;
}

/** `POST /discover/search` reply (§7). `total` and `facets` on the first page only. */
export interface SearchPage {
  items: ListingCard[];
  nextCursor: string | null;
  total: number | null;
  /** The sort applied (R10 default when the request had none). */
  sort: SearchSort;
  reading: QueryReading;
  /** True when no full match within the radius and these are partial matches (§5.6). */
  partial: boolean;
  widen: SearchWiden | null;
  /** A bare number equal to a public listing's ref: shown as a "Listing #…" row above the results. */
  refSuggestion: { listingId: string; ref: number } | null;
  facets: SearchFacets | null;
  origin: OriginEcho;
}

/** `POST /discover/search` reply for `#ref` of a public listing. */
export interface SearchRedirect {
  redirect: { listingId: string };
}

export type SearchResponse = SearchPage | SearchRedirect;

/** `POST /discover/search/count` reply (§5.11). `partialTotal` only when `total` is 0 and there are ≥ 2 words. */
export interface CountOnlyResult {
  total: number;
  partialTotal: number | null;
}

/** `POST /discover/home` body. */
export interface HomeRequest {
  origin?: DiscoveryOrigin;
  radiusKm?: DiscoveryRadiusKm | null;
}

/** `POST /discover/home` reply (§7, R15). */
export interface HomeView {
  origin: OriginEcho;
  radiusKm: DiscoveryRadiusKm | null;
  /** Spare parts, Machinery, For rent: public counts within the radius. */
  kindTiles: Array<{ kind: ListingKind; count: number }>;
  rootCategories: Array<{ id: string; name: string; icon: CategoryIcon | null }>;
  topNearYou: ListingCard[];
  rentNearby: ListingCard[];
}

/** `POST /discover/browse` body. */
export interface BrowseRequest {
  parentId?: string | null;
  kinds?: ListingKind[];
  origin?: DiscoveryOrigin;
  radiusKm?: DiscoveryRadiusKm | null;
}

/** `POST /discover/browse` reply (§7). Children with no listings are hidden. */
export interface BrowseView {
  node: { id: string; name: string; level: CatalogLevel } | null;
  crumbs: Array<{ id: string; name: string }>;
  children: Array<{ id: string; name: string; level: CatalogLevel; icon: CategoryIcon | null; liveCount: number }>;
  popularBrands: Array<{ id: string; name: string; liveCount: number }>;
  origin: OriginEcho;
  radiusKm: DiscoveryRadiusKm | null;
}

/** `POST /discover/browse/brand` body. */
export interface BrandBrowseRequest {
  brandId: string;
  kinds?: ListingKind[];
  origin?: DiscoveryOrigin;
  radiusKm?: DiscoveryRadiusKm | null;
}

/** `POST /discover/browse/brand` reply (§7): `allCount` = the search total for the `brandId` filter (the brand chip's meaning). */
export interface BrandBrowseView {
  brand: { id: string; name: string };
  models: Array<{ id: string; name: string; liveCount: number }>;
  allCount: number;
}

/** `POST /discover/cards` body: recently viewed ids (≤ 20); the reply keeps the given order and drops non-public ones. */
export interface CardsRequest {
  ids: string[];
  origin?: DiscoveryOrigin;
}

/** `GET /discover/suggest?q=` item (§5.12). `listing`: `id` is the listing id, `ref` its ref. */
export interface Suggestion {
  type: 'category' | 'brand' | 'model' | 'listing';
  id: string;
  name: string;
  path: string[];
  liveCount: number;
  ref?: number;
}

/** A saved listing (§7): its card while public, else "No longer available". */
export type SavedListingItem =
  | { listingId: string; savedAt: string; card: ListingCard }
  | { listingId: string; savedAt: string; unavailable: true };

/** `GET /users/me/saved-listings?cursor=` reply. */
export interface SavedListingsPage {
  items: SavedListingItem[];
  nextCursor: string | null;
}

/** `PUT` / `DELETE /users/me/saved-listings/:listingId` reply. */
export interface SaveListingResult {
  saved: boolean;
}

/** A search synonym (§4.2) with its target's name for the admin table. */
export interface SearchSynonym {
  id: string;
  term: string;
  termNorm: string;
  script: SearchScript;
  targetKind: SynonymTarget;
  targetId: string | null;
  targetSide: SearchSide | null;
  targetWord: string | null;
  /** Category / brand / model name (category with its path), else null. */
  targetName: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** `POST /admin/search/synonyms` body; `PATCH` takes any subset. Exactly the target field of the kind is set. */
export interface SearchSynonymInput {
  term: string;
  targetKind: SynonymTarget;
  targetId?: string | null;
  targetSide?: SearchSide | null;
  targetWord?: string | null;
  isActive?: boolean;
}

/** `GET /admin/search/synonyms?q=&targetKind=&cursor=` reply (§7.1). */
export interface SearchSynonymPage {
  items: SearchSynonym[];
  nextCursor: string | null;
}

/** `PUT` / `DELETE /admin/search/trending-hidden/:normalized` reply (§7.1). */
export interface TrendingHiddenResult {
  normalized: string;
  hidden: boolean;
}

/** `GET /admin/search/trending` row (§7.1). */
export interface TrendingRow {
  normalized: string;
  searches: number;
  days: number;
  hidden: boolean;
}

/** `GET /admin/search/zero-results` row (§7.1). `lastDay` is `YYYY-MM-DD` (IST). */
export interface ZeroResultRow {
  normalized: string;
  searches: number;
  lastDay: string;
}

const isEmptyValue = (v: unknown): boolean =>
  v === undefined || v === null || v === false || v === '' || (Array.isArray(v) && v.length === 0);

const sortedSet = (xs: readonly string[]): string[] => [...new Set(xs.filter((x) => x !== ''))].sort();

function cleanSpecs(specs: SearchFilters['specs']): SearchFilters['specs'] | undefined {
  if (!specs) return undefined;
  const out: Record<string, string[] | SpecRange> = {};
  for (const key of Object.keys(specs).sort()) {
    const value = specs[key];
    if (Array.isArray(value)) {
      const options = sortedSet(value);
      if (options.length) out[key] = options;
    } else if (value && typeof value === 'object') {
      const range: SpecRange = {};
      if (typeof value.max === 'number') range.max = value.max;
      if (typeof value.min === 'number') range.min = value.min;
      if (range.max !== undefined || range.min !== undefined) out[key] = range;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Filters in one canonical form (§5.7), so the cursor seal and the request hash are stable: drops empty arrays, nulls,
 * empty strings, false toggles, empty spec entries and a fit without a brand; keeps `radiusKm: null` (All India); sorts
 * and de-duplicates the set-like arrays; keys in alphabetical order at every level. Pure: the input is not changed.
 */
export function cleanFilters(filters: SearchFilters | null | undefined): SearchFilters {
  if (!filters) return {};
  const draft: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (key === 'radiusKm') {
      if (value === null || typeof value === 'number') draft[key] = value;
      continue;
    }
    if (key === 'specs') {
      const specs = cleanSpecs(value as SearchFilters['specs']);
      if (specs) draft[key] = specs;
      continue;
    }
    if (key === 'fit') {
      const fit = value as SearchFilters['fit'] | null;
      if (!fit || !fit.brandId) continue;
      const out: Record<string, unknown> = { brandId: fit.brandId };
      if (fit.modelId) out.modelId = fit.modelId;
      if (typeof fit.year === 'number') out.year = fit.year;
      draft[key] = Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
      continue;
    }
    if (isEmptyValue(value)) continue;
    if (Array.isArray(value)) {
      const set = sortedSet(value as string[]);
      if (set.length) draft[key] = set;
      continue;
    }
    draft[key] = value;
  }
  return Object.fromEntries(Object.keys(draft).sort().map((k) => [k, draft[k]])) as SearchFilters;
}

// ─── F6 + F7: enquiries, chat, offers, deals, reviews, notifications (spec 2026-11-19) ───
// Money: `pricePerUnitPaise` is a JSON number (≤ 2 147 483 647, as listing prices); totals and advances are decimal
// strings (plan P4). Quantities are decimal strings ("2", "2.5"); code works in thousandths as `bigint`.

const QUANTITY_RE = /^\d+(?:\.\d{1,3})?$/;

/** A decimal-string quantity in thousandths ("2.5" → 2500n). Throws on a negative, malformed or 4+ decimal value. */
export function quantityToMilli(q: string): bigint {
  const s = q.trim();
  if (!QUANTITY_RE.test(s)) throw new Error(`Invalid quantity: ${q}`);
  const [whole, frac = ''] = s.split('.');
  return BigInt(whole!) * 1000n + BigInt((frac + '000').slice(0, 3));
}

/** Thousandths back to a decimal string, trailing zeros trimmed (2500n → "2.5", 3000n → "3"). */
export function milliToQuantity(m: bigint): string {
  const neg = m < 0n;
  const abs = neg ? -m : m;
  const whole = abs / 1000n;
  const frac = (abs % 1000n).toString().padStart(3, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/** Whether a quantity has no more decimals than the unit allows (trailing zeros don't count: "2.50" fits 1). */
export function fitsUnitDecimals(q: string, decimals: number): boolean {
  const s = q.trim();
  if (!QUANTITY_RE.test(s)) return false;
  const frac = (s.split('.')[1] ?? '').replace(/0+$/, '');
  return frac.length <= decimals;
}

/** Price per unit × quantity, rounded half up to the paisa from thousandths of a unit (§7.2, our call 12). */
export function totalPaise(pricePerUnitPaise: number | bigint, quantity: string): bigint {
  return (BigInt(pricePerUnitPaise) * quantityToMilli(quantity) + 500n) / 1000n;
}

/** Whole % below the asking price, rounded down so it never overstates (P13); null at or above asking. */
export function percentBelowAsking(price: number | bigint, asking: number | bigint): number | null {
  const p = BigInt(price);
  const a = BigInt(asking);
  if (a <= 0n || p >= a) return null;
  return Number(((a - p) * 100n) / a);
}

/**
 * The inclusive price range a counter may take (§7.4, R14). B = the buyer's latest price (null before the buyer's first
 * price, as after a quote), S = the seller's latest (the asking snapshot until the seller counters, or the quote).
 * Buyer: `B ≤ c < S` (`0 < c < S` without B). Seller: `B < c ≤ S`. An empty range has `minPaise > maxPaise`.
 */
export function counterBounds(input: {
  by: PartySide;
  buyerLatestPaise: number | null;
  sellerLatestPaise: number;
}): { minPaise: number; maxPaise: number } {
  const { by, buyerLatestPaise: b, sellerLatestPaise: s } = input;
  if (by === 'buyer') return { minPaise: b ?? 1, maxPaise: s - 1 };
  return { minPaise: (b ?? 0) + 1, maxPaise: s };
}

/** Derived enquiry status (§6.2): first match wins. */
export function enquiryStatus(input: {
  dealCount: number;
  firstSellerReplyAt: string | Date | null;
  hasOpenNegotiation: boolean;
  listingPublic: boolean;
  blocked: boolean;
}): EnquiryStatus {
  if (input.dealCount > 0) return 'converted';
  if (input.blocked || (!input.listingPublic && !input.hasOpenNegotiation)) return 'closed';
  if (input.firstSellerReplyAt) return 'replied';
  return 'open';
}

/**
 * Whether a deal waits on `side` (§9.2): the seller hands over an `agreed` deal, the buyer confirms a `handed_over` one;
 * a pending cancel request waits on the other side only (the requester has asked and waits; our reading of §9.2).
 */
export function dealYourTurn(
  deal: { status: DealStatus; cancelRequestedSide: PartySide | null },
  side: PartySide,
): boolean {
  if (deal.status === 'agreed') return side === 'seller';
  if (deal.status === 'handed_over') {
    if (deal.cancelRequestedSide) return deal.cancelRequestedSide !== side;
    return side === 'buyer';
  }
  return false;
}

/**
 * Each side's "Your turn" for a thread (§6.10): the open negotiation's turn, an unanswered (`open`) enquiry for the
 * seller, or a deal waiting on that side (`dealYourTurn`). Stored as `buyer_turn` / `seller_turn`.
 */
export function threadTurns(input: {
  openTurn: PartySide | null;
  enquiryOpen: boolean;
  deals: { status: DealStatus; cancelRequestedSide: PartySide | null }[];
}): { buyer: boolean; seller: boolean } {
  const turn = (side: PartySide): boolean =>
    input.openTurn === side ||
    (side === 'seller' && input.enquiryOpen) ||
    input.deals.some((d) => dealYourTurn(d, side));
  return { buyer: turn('buyer'), seller: turn('seller') };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The last moment a completed deal can be reviewed (§10.1): `completedAt + windowDays` (plain days, R21). */
export function reviewWindowEnd(completedAt: Date, windowDays: number): Date {
  return new Date(completedAt.getTime() + windowDays * DAY_MS);
}

/** When the first review publishes on its own (§10.3): `min(submitted + blindDays, completed + windowDays)`. */
export function publishDueAt(submittedAt: Date, completedAt: Date, blindDays: number, windowDays: number): Date {
  const blind = submittedAt.getTime() + blindDays * DAY_MS;
  const window = reviewWindowEnd(completedAt, windowDays).getTime();
  return new Date(Math.min(blind, window));
}

/** Whether a deal can be reviewed at `now` (§10.1): completed, and inside the review window. */
export function reviewApplicable(
  deal: { status: DealStatus; completedAt: Date | null },
  now: Date,
  windowDays: number,
): boolean {
  return deal.status === 'completed' && deal.completedAt !== null && now < reviewWindowEnd(deal.completedAt, windowDays);
}

// ─── F6 + F7 views (what a client reads) ───

/** The other business in a thread or deal. Name masked (`maskContact`) like every user-written public text. */
export interface Counterpart {
  businessId: string;
  name: string;
  gstVerified: boolean;
}

/** A private photo, read through a short-lived signed URL (§6.8: 300 s; refetch after `expiresAt`). */
export interface SignedPhoto {
  url: string;
  expiresAt: string;
}

/**
 * The listing as a thread shows it (§12.2, review change 8): read whatever the listing's status. `title` is the latest
 * deal's snapshot when there is one; `noLongerListed` when the listing isn't public.
 */
export interface ThreadListingStrip {
  listingId: string;
  ref: number;
  kind: ListingKind;
  title: string;
  thumbUrl: string | null;
  status: ListingStatus;
  priceModel: PriceModel | null;
  pricePaise: number | null;
  gstMode: GstPriceMode | null;
  unit: { key: string; label: string; decimals: number } | null;
  quantity: string | null;
  availableQuantity: string | null;
  minOrderQty: string | null;
  noLongerListed: boolean;
}

/** The buyer's Check my machine choice on an enquiry card (§5.2 `fit_machine`), resolved by the server. */
export interface EnquiryMachine {
  brandId: string;
  brandName: string;
  modelId: string | null;
  modelName: string | null;
  year: number | null;
  verdict: 'fits' | 'not_listed';
}

/** `POST /businesses/me/contact-phone/otp/verify` and `DELETE /businesses/me/contact-phone` (§6.6): the business's contact number, E.164. */
export interface ContactPhoneState {
  contactPhone: string | null;
  verifiedAt: string | null;
}

/**
 * `GET /businesses/me/contact-phone` (Profile › Contact number, §6.6): the state for the reader. Only the owner
 * (`canEdit`) reads the number; any other member gets `contactPhone` / `verifiedAt` null and `ownerPhoneFallback`
 * false. The owner's personal phone is never returned: `ownerPhoneFallback` only says that a tick would share it
 * (no verified contact number).
 */
export interface ContactPhoneView extends ContactPhoneState {
  ownerPhoneFallback: boolean;
  canEdit: boolean;
}

/** One row of `GET /users/me/blocks` (Profile › Blocked businesses, §6.11): name masked. */
export interface BlockedBusinessItem {
  businessId: string;
  name: string;
  blockedAt: string;
}

/** The share-my-number state of a thread or deal for the reader (§6.6). */
export interface ContactState {
  /** My business has a valid consent in this thread. */
  mine: boolean;
  /** The other business has a valid consent in this thread. */
  theirs: boolean;
  /** `contact_unlocked_at` is set (deal + both ticks, once). */
  revealed: boolean;
  /** The other side's number while their consent is valid and the reader may see it (never for a `viewer`). */
  number: string | null;
  /** The reader may tick now (a deal exists, not a viewer, and not the owner-phone fallback for a non-owner). */
  canTick: boolean;
  /** The number would be the owner's personal phone and the reader isn't the owner ("Your owner can share…"). */
  ownerOnlyHint: boolean;
}

export type BlockState = 'none' | 'blocked_by_me' | 'blocked_me';

export type OfferAction = 'accept' | 'reject' | 'counter' | 'withdraw' | 'reconfirm';

/** One row of a negotiation as the reader sees it (§7). Note and reject note masked per reader. */
export interface OfferView {
  id: string;
  threadId: string;
  listingId: string;
  negotiationId: string;
  previousOfferId: string | null;
  kind: OfferKind;
  round: number;
  /** Counters left in the negotiation (`MAX_COUNTER_ROUNDS − round`). */
  roundsLeft: number;
  status: OfferStatus;
  closeReason: OfferCloseReason | null;
  senderSide: PartySide;
  isMine: boolean;
  turn: PartySide;
  needsReconfirm: boolean;
  pricePerUnitPaise: number;
  quantity: string;
  totalPaise: string;
  askingPricePaise: number | null;
  /** Negotiable chains only, when below asking (P13). */
  percentBelowAsking: number | null;
  unit: { key: string; label: string; decimals: number } | null;
  gstMode: GstPriceMode | null;
  validityHours: number;
  expiresAt: string | null;
  backupSince: string | null;
  note: string | null;
  rejectNote: string | null;
  /** The other side wrote a payment phrase or handle in the note (§6.7); false on the reader's own rows. */
  scamWarning: boolean;
  answeredAt: string | null;
  createdAt: string;
  /** What the reader may do now (empty for a `viewer`). */
  actions: OfferAction[];
  /** The counter range for the turn side (`counterBounds`), null when no counter is possible. */
  bounds: { minPaise: number; maxPaise: number } | null;
}

/** A message as one reader sees it (§6.4–§6.9). Text masked per reader (`visibleText`). */
export interface ThreadMessage {
  id: string;
  threadId: string;
  /** Global order (bigserial as a string); `?before=<seq>` pages. */
  seq: string;
  kind: MessageKind;
  senderSide: PartySide | null;
  isMine: boolean;
  clientMessageId: string | null;
  text: string | null;
  photos: SignedPhoto[];
  /** Only for the other side's flagged messages (§6.7). */
  scamWarning: boolean;
  system: { code: SystemLineCode; values: Record<string, string | number> } | null;
  enquiry: { quick: QuickEnquiry[]; quantity: string | null; note: string | null; machine: EnquiryMachine | null } | null;
  offer: OfferView | null;
  deal: { id: string; ref: number; status: DealStatus; totalPaise: string } | null;
  /** M14 §8: a `booking` card. */
  booking: RentalBookingCardView | null;
  createdAt: string;
}

export type InboxFilter = 'all' | 'buying' | 'selling' | 'your_turn';
export type InboxPill = 'your_turn' | 'deal' | EnquiryStatus;

/** A Chats tab row (§6.10). */
export interface InboxRow {
  threadId: string;
  side: PartySide;
  counterpart: Counterpart;
  listing: { listingId: string; kind: ListingKind; title: string; thumbUrl: string | null };
  /** Per reader: masked text, photo count, the system line's code, or an offer's price. */
  lastMessage: {
    kind: MessageKind;
    text: string | null;
    photoCount: number;
    systemCode: SystemLineCode | null;
    offer: { pricePerUnitPaise: number; unitLabel: string | null } | null;
    isMine: boolean;
    at: string;
  } | null;
  unread: number;
  yourTurn: boolean;
  enquiryStatus: EnquiryStatus;
  pill: InboxPill;
  archived: boolean;
}

export interface InboxPage {
  items: InboxRow[];
  nextCursor: string | null;
  counts: { yourTurn: number };
}

/** A deal in a list (Deals tab, a thread's deals). */
export interface DealListRow {
  id: string;
  ref: number;
  threadId: string;
  listingId: string;
  side: PartySide;
  counterpart: Counterpart;
  listingTitle: string;
  thumbUrl: string | null;
  pricePerUnitPaise: number;
  quantity: string;
  unitLabel: string;
  totalPaise: string;
  gstMode: GstPriceMode | null;
  status: DealStatus;
  yourTurn: boolean;
  acceptedAt: string;
  handedOverAt: string | null;
  autoCompleteAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  updatedAt: string;
}

/** The thread screen (§12.2 `GET /threads/:id`). */
export interface ThreadDetail {
  id: string;
  side: PartySide;
  memberRole: MemberRole;
  counterpart: Counterpart;
  listingStrip: ThreadListingStrip;
  enquiryStatus: EnquiryStatus;
  /** False for a `viewer` and under a block. */
  canWrite: boolean;
  blockState: BlockState;
  openNegotiation: OfferView | null;
  deals: DealListRow[];
  contact: ContactState;
  archived: boolean;
  lastReadSeq: string;
  unread: number;
  /** Machine listings: the "never pay before inspecting a used machine" tip (§6.7, M19). */
  machineTip: boolean;
  /** M14 §8: the thread's rental bookings, newest first. */
  bookings: { id: string; status: RentalBookingStatus; confirmedAt: string | null }[];
}

export interface DealNotes {
  paymentMethod: DealPaymentMethod | null;
  advancePaise: string | null;
  /** total − advance, when an advance is set. */
  balancePaise: string | null;
  fulfilment: DealFulfilment | null;
  /** `YYYY-MM-DD`. */
  expectedOn: string | null;
  /** Masked per reader. */
  text: string | null;
  /** The other side's notes text carries a payment phrase or handle (§6.7). */
  scamWarning: boolean;
  updatedAt: string | null;
  updatedBySide: PartySide | null;
}

export interface DealTimelineEntry {
  code: DealEventCode;
  actorSide: DealActorSide;
  values: Record<string, string | number | boolean | null>;
  at: string;
}

export type DealAction =
  | 'edit_notes'
  | 'hand_over'
  | 'confirm_received'
  | 'cancel'
  | 'request_cancel'
  | 'accept_cancel_request'
  | 'clear_cancel_request'
  | 'report_problem'
  | 'share_contact'
  | 'review';

/** A dispute as the parties see it (description masked to the other party). */
export interface DealDisputeSummary {
  id: string;
  category: DisputeCategory;
  description: string;
  photos: SignedPhoto[];
  openedBySide: PartySide;
  status: DisputeStatus;
  outcome: DisputeOutcome | null;
  messageToParties: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

/** The Deal record (§9.1, `GET /deals/:id`). */
export interface DealView extends DealListRow {
  version: number;
  memberRole: MemberRole;
  notes: DealNotes;
  timeline: DealTimelineEntry[];
  actions: DealAction[];
  contact: ContactState;
  problemDeadlineAt: string | null;
  handover: { at: string; note: string | null; photo: SignedPhoto | null } | null;
  cancelRequest: { side: PartySide; reason: DealCancelReason | null; at: string } | null;
  completedHow: DealCompletedHow | null;
  cancelledBySide: DealCancelledBy | null;
  cancelReason: DealCancelReason | null;
  cancelNote: string | null;
  dispute: DealDisputeSummary | null;
  review: ReviewState | null;
}

export interface DealsPage {
  items: DealListRow[];
  nextCursor: string | null;
  counts: { active: number; completed: number; cancelled: number; yourTurn: number };
}

/** A facet → stars map (1–5); the facets are `REVIEW_FACETS[reviewerSide]`. */
export type ReviewRatings = Partial<Record<ReviewFacet, number>>;

/** `GET /deals/:id/review` (§10), `GET /rental-bookings/:id/review` (M14 R11). */
export interface ReviewState {
  /** M14: what the review is about. */
  subject: { kind: ReviewSubjectKind; id: string };
  /** The deal's id for a deal review (kept for F6 readers); null for a rental review. */
  dealId: string | null;
  mySide: PartySide;
  /** The reader may submit now. */
  eligible: boolean;
  /** Why not, when not eligible. */
  reason: 'not_completed' | 'window_closed' | 'submitted' | 'viewer' | 'other_published' | null;
  windowEndsAt: string | null;
  mine: {
    id: string;
    ratings: ReviewRatings;
    text: string | null;
    submittedAt: string;
    publishedAt: string | null;
    hidden: boolean;
  } | null;
  theirsSubmitted: boolean;
  /** When the first review publishes on its own (§10.3). */
  publishDueAt: string | null;
}

/** A published buyer → seller review (§10.4), public. Text and reply masked always. */
export interface PublicReview {
  id: string;
  reviewerName: string;
  listingTitle: string;
  ratings: ReviewRatings;
  /** Mean of the facets, one decimal. */
  stars: number;
  text: string | null;
  publishedAt: string;
  reply: { text: string; at: string } | null;
  /** Only to its author: "Hidden by our team". */
  hidden: boolean;
}

/** A seller's score (§10.4); null below `review_min_published` reviews. */
export interface SellerScore {
  count: number;
  /** Mean of every facet rating, rounded half up to one decimal. */
  stars: number;
  /** Facet mean ÷ 5, whole %. */
  facetsPercent: { matched_listing: number; communication: number; on_time: number };
}

export interface SellerReviewsPage {
  score: SellerScore | null;
  count: number;
  items: PublicReview[];
  nextCursor: string | null;
}

/** An in-app notification (§11), text rendered in the reader's language (never message text, §11.4). */
export interface NotificationRow {
  id: string;
  type: NotificationType;
  category: NotificationCategory;
  title: string;
  body: string;
  threadId: string | null;
  offerId: string | null;
  dealId: string | null;
  reviewId: string | null;
  /** F8 §10: the part request a `part_*` row opens. */
  partRequestId: string | null;
  /** M14 §11: the rental booking a `rental_booking_*` (or a rental review) row opens. */
  rentalBookingId: string | null;
  /** Grouped chat rows: messages since the row opened. */
  unreadCount: number;
  read: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationsPage {
  items: NotificationRow[];
  nextCursor: string | null;
  unreadCount: number;
}

/** `GET /users/me/badges` (§12.2). */
export interface Badges {
  unreadThreads: number;
  dealsYourTurn: number;
  notificationsUnread: number;
  /** F8 §12.2: requests this business was targeted for that are active, unopened, unreplied and not dismissed. */
  requestsForYou: number;
  /** M14 §6.6: rental bookings whose next step is this business's (`rentalYourTurn`). */
  rentalsYourTurn: number;
}

/** `GET /offers/options` (§12.2). */
export interface OffersOptions {
  validityHours: number[];
  defaultValidityHours: number;
  maxCounterRounds: number;
  openLimit: number;
  openCount: number;
}

// ─── F6 + F7 admin views (§16): never message or note text except in a permitted thread read (§16.3) ───

export interface AdminPartyRef {
  businessId: string;
  name: string;
}

/** `GET /admin/enquiries`. */
export interface AdminEnquiryRow {
  threadId: string;
  listing: { id: string; ref: number; title: string; kind: ListingKind };
  buyer: AdminPartyRef;
  seller: AdminPartyRef;
  enquiryStatus: EnquiryStatus;
  negotiation: {
    offerId: string;
    round: number;
    status: OfferStatus;
    lastPricePerUnitPaise: number;
    quantity: string;
    turn: PartySide;
    expiresAt: string | null;
  } | null;
  dealCount: number;
  createdAt: string;
  lastActivityAt: string;
}

export interface AdminOfferChainEntry {
  id: string;
  negotiationId: string;
  round: number;
  kind: OfferKind;
  senderSide: PartySide;
  status: OfferStatus;
  closeReason: OfferCloseReason | null;
  pricePerUnitPaise: number;
  quantity: string;
  totalPaise: string;
  validityHours: number;
  expiresAt: string | null;
  needsReconfirm: boolean;
  createdAt: string;
  answeredAt: string | null;
}

/** `GET /admin/enquiries` page (the `AdminListingList` shape). */
export interface AdminEnquiryList {
  rows: AdminEnquiryRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** `GET /admin/enquiries/:threadId`: the offer chain without text. */
export interface AdminEnquiryDetail {
  row: AdminEnquiryRow;
  chain: AdminOfferChainEntry[];
  deals: Array<{ id: string; ref: number; status: DealStatus }>;
}

/** `GET /admin/deals`. */
export interface AdminDealRow {
  id: string;
  ref: number;
  threadId: string;
  listing: { id: string; ref: number; title: string };
  buyer: AdminPartyRef;
  seller: AdminPartyRef;
  status: DealStatus;
  pricePerUnitPaise: number;
  quantity: string;
  unitLabel: string;
  totalPaise: string;
  openDisputeId: string | null;
  acceptedAt: string;
  updatedAt: string;
}

/** `GET /admin/deals` page: `rows`, `total`, `page`, `pageSize` as the other admin lists, plus counts per status. */
export interface AdminDealList {
  rows: AdminDealRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<DealStatus, number>;
}

/** What a dispute is about (M14 R12): exactly one of a deal or a rental booking. */
export type DisputeSubject = { kind: 'deal'; dealId: string } | { kind: 'rental'; rentalBookingId: string };

/** `GET /admin/disputes`. */
export interface AdminDisputeRow {
  id: string;
  /** M14: the deal or the rental booking. */
  subject: DisputeSubject;
  /** Deal disputes only. */
  dealId: string | null;
  dealRef: number | null;
  /** Rental booking disputes only (`#700001…`). */
  rentalBookingRef: number | null;
  /** A rental dispute's category is a `RentalDisputeCategory`. */
  category: DisputeCategory | RentalDisputeCategory;
  status: DisputeStatus;
  outcome: DisputeOutcome | null;
  openedBySide: PartySide;
  buyer: AdminPartyRef;
  seller: AdminPartyRef;
  createdAt: string;
  resolvedAt: string | null;
}

/** `GET /admin/disputes` page. */
export interface AdminDisputeList {
  rows: AdminDisputeRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** `GET /admin/deals/:id`: structured notes only (no `notes_text`). */
export interface AdminDealDetail extends AdminDealRow {
  gstMode: GstPriceMode | null;
  notes: {
    paymentMethod: DealPaymentMethod | null;
    advancePaise: string | null;
    fulfilment: DealFulfilment | null;
    expectedOn: string | null;
    hasText: boolean;
  };
  handedOverAt: string | null;
  problemDeadlineAt: string | null;
  autoCompleteAt: string | null;
  completedAt: string | null;
  completedHow: DealCompletedHow | null;
  cancelledAt: string | null;
  cancelledBySide: DealCancelledBy | null;
  cancelReason: DealCancelReason | null;
  cancelRequest: { side: PartySide; reason: DealCancelReason | null; at: string } | null;
  timeline: DealTimelineEntry[];
  hold: { status: HoldStatus; quantity: string } | null;
  reviews: { buyerSubmitted: boolean; sellerSubmitted: boolean; published: boolean };
  disputes: AdminDisputeRow[];
}

/** `GET /admin/disputes/:id`. */
export interface AdminDisputeDetail extends AdminDisputeRow {
  description: string;
  photos: SignedPhoto[];
  messageToParties: string | null;
  internalNote: string | null;
  stockReturned: boolean | null;
  resolvedByAdminName: string | null;
  /** Deal disputes only; a rental dispute's booking is read from `/admin/rental-bookings/:id` (M14). */
  deal: AdminDealDetail | null;
  threadId: string;
}

/**
 * `POST /admin/disputes/:id/resolve` body. `stockReturned` is required to cancel a deal dispute; `400` if sent for a
 * rental one (M14 R12: a booking resolve never touches stock).
 */
export interface AdminDisputeResolveInput {
  outcome: DisputeOutcome;
  stockReturned?: boolean;
  /** Staff only, 3–500 characters. */
  internalNote: string;
  messageToParties?: string | null;
}

/** A message as stored (§16.3: the reader is staff, so unmasked), photos signed. Never revealed contact numbers. */
export interface AdminThreadMessage {
  id: string;
  seq: string;
  kind: MessageKind;
  senderSide: PartySide | null;
  senderName: string | null;
  text: string | null;
  photos: SignedPhoto[];
  scamFlag: boolean;
  system: { code: SystemLineCode; values: Record<string, string | number> } | null;
  enquiry: { quick: QuickEnquiry[]; quantity: string | null; note: string | null; machine: EnquiryMachine | null } | null;
  offerId: string | null;
  dealId: string | null;
  /** A `booking` card's rental booking ref (M14), else null. */
  bookingRef: number | null;
  createdAt: string;
}

/** `POST /admin/threads/:id/read` (§16.3). */
export interface AdminThreadRead {
  threadId: string;
  listing: { id: string; ref: number; title: string };
  buyer: AdminPartyRef;
  seller: AdminPartyRef;
  messages: AdminThreadMessage[];
}

/** `GET /admin/reports?target=conversation|review|part_request`. */
export interface AdminReportRow {
  id: string;
  target: 'conversation' | 'review' | 'part_request';
  targetId: string;
  /** F8 §14: part-request reports, the request and its name (masked), linking to its admin page. */
  partRequestId?: string;
  partRequestName?: string;
  reason: string;
  details: string | null;
  status: ReportStatus;
  reporter: AdminPartyRef;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
  /** Conversation reports: the two parties. */
  parties: { buyer: AdminPartyRef; seller: AdminPartyRef } | null;
  /** Review reports: the review as stored. */
  review: {
    id: string;
    reviewer: AdminPartyRef;
    reviewed: AdminPartyRef;
    ratings: ReviewRatings;
    text: string | null;
    replyText: string | null;
    hidden: boolean;
    replyHidden: boolean;
  } | null;
}

/** Deals by status and disputes with outcomes on the admin business page (§9.6, §16.1). */
export interface AdminBusinessDealHistory {
  byStatus: Record<DealStatus, number>;
  disputes: Array<{
    id: string;
    /** M14: deal disputes and rental booking disputes. */
    subject: DisputeSubject;
    dealId: string | null;
    dealRef: number | null;
    rentalBookingRef: number | null;
    /** A rental dispute's category is a `RentalDisputeCategory`. */
    category: DisputeCategory | RentalDisputeCategory;
    status: DisputeStatus;
    outcome: DisputeOutcome | null;
    createdAt: string;
    resolvedAt: string | null;
  }>;
}

// ─── F8: part requests, seller targeting and availability alerts (spec 2026-11-20-f8-part-requests-design) ───
// UI copy says "requirement"; code says `part_request`. `PART_REQUEST_STATUSES` is in the "part request" section above.

export const PART_REQUEST_ACTIONS = ['post', 'edit', 'renew', 'fulfil', 'close', 'expire', 'remove', 'restore'] as const;
export type PartRequestAction = (typeof PART_REQUEST_ACTIONS)[number];

/** The state machine (§9.1), enforced by the API's `writeRequestStatus`; `post` starts from no row. */
export const PART_REQUEST_TRANSITIONS: Record<
  PartRequestAction,
  { actor: 'buyer' | 'system' | 'admin'; from: readonly PartRequestStatus[] }
> = {
  post: { actor: 'buyer', from: [] },
  edit: { actor: 'buyer', from: ['active'] },
  renew: { actor: 'buyer', from: ['active', 'expired'] },
  fulfil: { actor: 'buyer', from: ['active'] },
  close: { actor: 'buyer', from: ['active'] },
  expire: { actor: 'system', from: ['active'] },
  remove: { actor: 'admin', from: ['active', 'fulfilled', 'closed', 'expired'] },
  restore: { actor: 'admin', from: ['removed'] },
};

/**
 * Where `action` takes a request in `from` (§9.1), or null when it isn't allowed. `post` starts from null; `edit`
 * keeps the status; `restore` goes to the stored `returnStatus`, except an `active` return already past its expiry,
 * which lands `expired` (§9.1, review Q8).
 */
export function partRequestTransition(
  from: PartRequestStatus | null,
  action: PartRequestAction,
  opts?: { returnStatus?: PartRequestStatus | null; pastExpiry?: boolean },
): PartRequestStatus | null {
  if (action === 'post') return from === null ? 'active' : null;
  if (from === null || !PART_REQUEST_TRANSITIONS[action].from.includes(from)) return null;
  switch (action) {
    case 'edit':
      return from;
    case 'renew':
      return 'active';
    case 'fulfil':
      return 'fulfilled';
    case 'close':
      return 'closed';
    case 'expire':
      return 'expired';
    case 'remove':
      return 'removed';
    case 'restore': {
      const back = opts?.returnStatus ?? null;
      if (back === null || back === 'removed') return null;
      return back === 'active' && opts?.pastExpiry ? 'expired' : back;
    }
  }
}

/** A part or a machine to buy (R1); rental requests wait for M14. */
export const PART_REQUEST_KINDS = ['part', 'machine'] as const;
export type PartRequestKind = (typeof PART_REQUEST_KINDS)[number];
export const PART_REQUEST_REACHES = ['radius_50', 'radius_200', 'state', 'all_india'] as const;
export type PartRequestReach = (typeof PART_REQUEST_REACHES)[number];
export const PART_REQUEST_REACH_KM = { radius_50: 50, radius_200: 200 } as const;
export const PART_REQUEST_AUDIENCES = ['verified_only', 'any_seller'] as const;
export type PartRequestAudience = (typeof PART_REQUEST_AUDIENCES)[number];
export const PART_REQUEST_CLOSE_REASONS = ['found_elsewhere', 'no_longer_needed', 'posted_by_mistake', 'other'] as const;
export type PartRequestCloseReason = (typeof PART_REQUEST_CLOSE_REASONS)[number];
export const PART_REQUEST_REPLY_STATUSES = ['pending', 'delivered', 'withdrawn', 'dropped'] as const;
export type PartRequestReplyStatus = (typeof PART_REQUEST_REPLY_STATUSES)[number];
/** §5.4: why a reply was dropped. Only `listing_removed` (the seller's own removal) is silent. */
export const PART_REQUEST_DROP_REASONS = [
  'listing_removed', 'listing_removed_by_team', 'listing_rejected', 'request_closed', 'request_expired',
  'request_removed', 'blocked', 'not_eligible', 'no_longer_fits',
] as const;
export type PartRequestDropReason = (typeof PART_REQUEST_DROP_REASONS)[number];
export const PART_REQUEST_MATCH_TIERS = ['part_number', 'name_fit', 'name', 'machine_fit'] as const;
export type PartRequestMatchTier = (typeof PART_REQUEST_MATCH_TIERS)[number];
/** Plan D12: a match found when a listing went live, or by the at-post backfill (never notified). */
export const PART_REQUEST_MATCH_SOURCES = ['listing_live', 'at_post'] as const;
export type PartRequestMatchSource = (typeof PART_REQUEST_MATCH_SOURCES)[number];
export const PART_REQUEST_FEEDBACK_REASONS = ['dont_sell_this', 'too_far', 'wrong_category', 'other'] as const;
export type PartRequestFeedbackReason = (typeof PART_REQUEST_FEEDBACK_REASONS)[number];
export const PART_REQUEST_REPORT_REASONS = ['spam', 'fake', 'contact_details', 'prohibited', 'other'] as const;
export type PartRequestReportReason = (typeof PART_REQUEST_REPORT_REASONS)[number];
export const PART_REQUEST_WORK_KINDS = ['target_request', 'listing_changed'] as const;
export type PartRequestWorkKind = (typeof PART_REQUEST_WORK_KINDS)[number];
/** Why a listing can't answer a request (§9.2), greyed in the reply picker. */
export const REPLY_FIT_REASONS = ['kind', 'category', 'side', 'condition', 'replied'] as const;
export type ReplyFitReason = (typeof REPLY_FIT_REASONS)[number];

/** Code constants (§5.11; settings in §16 are admin-tunable, these aren't). */
export const PART_REQUEST_LIMITS = {
  nameMin: 3,
  nameMax: 100,
  noteMax: 500,
  messageMax: 300,
  photosMax: 3,
  fitsMax: 5,
  minNameSimilarity: 0.5,
  listingsPageSize: 20,
  replyListingsPerCall: 3,
  compareMax: 10,
  demandIdsMax: 10,
  homeSellerItems: 3,
  backfillMax: 20,
  matchCandidatesMax: 200,
} as const;

/**
 * Whether a listing's side answers a request's side (§7.4, the one definition): Left ← Left / Pair; Right ← Right /
 * Pair; Pair ← Pair; a request with no side accepts anything. A Left / Right / Pair request never accepts a listing
 * with no side or `not_applicable`.
 */
export function requestSideAccepts(requestSide: PartSide | null, listingSide: PartSide | null): boolean {
  if (requestSide === null || requestSide === 'not_applicable') return true;
  if (requestSide === 'pair') return listingSide === 'pair';
  return listingSide === requestSide || listingSide === 'pair';
}

/** The derived "Matched" badge (R3): at least one delivered reply or auto match. */
export function isMatched(v: { deliveredReplyCount: number; matchCount: number }): boolean {
  return v.deliveredReplyCount > 0 || v.matchCount > 0;
}

/** Whole days left until `expiresAt`, rounded up (23 h → 1), never below 0. */
export function partRequestDaysLeft(expiresAt: string | Date, now: Date): number {
  const end = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt;
  const ms = end.getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / DAY_MS);
}

/** §15: the new error codes (the app's error copy test checks each has text in en / hi / gu). */
export const PART_REQUEST_ERROR_CODES = [
  'PART_REQUEST_NOT_FOUND',
  'PART_REQUEST_STALE',
  'PART_REQUEST_TRANSITION_NOT_ALLOWED',
  'PART_REQUEST_NOT_ACTIVE',
  'PART_REQUEST_OPEN_LIMIT',
  'PART_REQUEST_DAILY_LIMIT',
  'PART_REQUEST_MAX_DAYS',
  'VALIDITY_INVALID',
  'UNIT_INVALID',
  'CONDITION_INVALID',
  'REPLY_EXISTS',
  'REPLY_LIMIT',
  'REPLY_DAILY_LIMIT',
  'REPLY_LISTING_INVALID',
  'REPLY_NOT_FOUND',
  'REPLY_NOT_OPEN',
  'OWN_PART_REQUEST',
  'DEAL_INVALID',
] as const;
export type PartRequestErrorCode = (typeof PART_REQUEST_ERROR_CODES)[number];

// ─── F8 payloads and views (§12.2, §12.3, §14). Money in paise (JSON number); quantities as decimal strings. ───

/** One "fits" row of a request: brand → model → year range (§5.2). */
export interface PartRequestFitInput {
  brandId: string;
  modelId?: string | null;
  yearFrom?: number | null;
  yearTo?: number | null;
}

/** `POST /part-requests` body (Zod strict). */
export interface PartRequestInput {
  kind: PartRequestKind;
  categoryId: string;
  name: string;
  partNumber?: string | null;
  side?: PartSide | null;
  fits?: PartRequestFitInput[];
  specs?: Specs;
  quantity: string;
  unitId?: string | null;
  conditionIds?: string[];
  budgetPerUnitPaise?: number | null;
  budgetVisible?: boolean;
  /** `YYYY-MM-DD`, today … today + 365 (IST). */
  neededBy?: string | null;
  urgent?: boolean;
  reach: PartRequestReach;
  audience: PartRequestAudience;
  /** One of the three validity settings (`400 VALIDITY_INVALID`). */
  validityDays: number;
  photoKeys?: string[];
  note?: string | null;
}

/**
 * `PATCH /part-requests/:id`: the fields sent change; `version` guards (`409 PART_REQUEST_STALE`). Renew owns
 * validity. `photoKeys`, when sent, is the full final list: kept final keys plus new uploads.
 */
export type PartRequestPatch = { version: number } & Partial<Omit<PartRequestInput, 'kind' | 'validityDays'>>;

/**
 * What opens the form prefilled (§13.2). `categorySeedId`: a machine category that only opens the category picker
 * there (a machine category isn't a valid request category).
 */
export type PartRequestPrefill = Partial<
  Pick<PartRequestInput, 'kind' | 'categoryId' | 'name' | 'partNumber' | 'side' | 'fits' | 'quantity' | 'unitId'>
> & { source: 'no_results' | 'other_side' | 'post_tab' | 'copy'; categorySeedId?: string };

/** `GET /part-requests/options` (public; the three counts are null for a guest). */
export interface PartRequestOptions {
  validityDays: number[];
  defaultValidityDays: number;
  reachN: number;
  openLimit: number | null;
  openCount: number | null;
  postsLeftToday: number | null;
  maxDays: number;
}

export interface PartRequestFitView {
  brandId: string;
  brandName: string;
  modelId: string | null;
  modelName: string | null;
  yearFrom: number | null;
  yearTo: number | null;
}

/** What every reader of a request sees. `name` and `note` are masked (`maskContact`) for every reader. */
export interface PartRequestCommon {
  id: string;
  ref: number;
  kind: PartRequestKind;
  status: PartRequestStatus;
  /** The derived badge (`isMatched`). */
  matched: boolean;
  categoryId: string;
  categoryPath: { id: string; name: string }[];
  name: string;
  partNumber: string | null;
  side: PartSide | null;
  fits: PartRequestFitView[];
  specs: Specs;
  quantity: string;
  unit: { id: string; key: string; label: string };
  /** Empty = any condition. */
  conditionIds: string[];
  neededBy: string | null;
  urgent: boolean;
  reach: PartRequestReach;
  audience: PartRequestAudience;
  city: string | null;
  state: string | null;
  note: string | null;
  noteFlagged: boolean;
  photoCount: number;
  daysLeft: number;
  expiresAt: string;
  firstPostedAt: string;
  createdAt: string;
}

/** The buyer business's own view (`GET /part-requests/:id` as the buyer, and every buyer write's reply). */
export interface PartRequestBuyerView extends PartRequestCommon {
  role: 'buyer';
  version: number;
  /** The buyer's own final photo keys, for the edit form; never in a seller or admin view. */
  photoKeys: string[];
  budgetPerUnitPaise: number | null;
  budgetVisible: boolean;
  validityDays: number;
  closeReason: PartRequestCloseReason | null;
  fulfilledDealId: string | null;
  counts: { replies: number; matches: number; newReplies: number; newMatches: number };
  targetedCount: number;
  /** §9.4: a non-cancelled deal on a reply / match listing while the request is active. */
  fulfilPrompt: { dealId: string; businessName: string } | null;
  /** `first_posted_at + part_request_max_days`. */
  renewableUntil: string;
}

/** The buyer as a seller sees it (§12.3): never a phone, email, pincode, address or point. */
export interface PartRequestBuyerBlock {
  tradeName: string;
  city: string | null;
  verified: boolean;
  /** The business's `created_at` year. */
  memberSince: number;
}

/** A seller's reply on a request, as the replying business sees it (message masked). */
export interface SellerReplyView {
  id: string;
  listingId: string;
  listingTitle: string;
  status: PartRequestReplyStatus;
  dropReason: PartRequestDropReason | null;
  message: string | null;
  deliveredAt: string | null;
  withdrawnAt: string | null;
  droppedAt: string | null;
  seenByBuyer: boolean;
  createdAt: string;
}

/** An eligible seller's view (§6, §12.3). The budget is null when the buyer keeps it private. */
export interface PartRequestSellerView extends PartRequestCommon {
  role: 'seller';
  budgetPerUnitPaise: number | null;
  buyer: PartRequestBuyerBlock;
  /** Snapped whole km from the seller's business point. */
  distanceKm: number | null;
  inReach: boolean;
  targeted: boolean;
  notRelevant: boolean;
  replyCount: number;
  hasMatchingStock: boolean;
  myReplies: SellerReplyView[];
  /** The reader may act for their business (not a `viewer` member): reply, mark not relevant, report. */
  canAct: boolean;
  /** `canAct`, the request is active and the seller has reply slots left. */
  canReply: boolean;
  slotsLeft: number;
}

/** `GET /part-requests/:id`: by the API's `role`. */
export type PartRequestView = PartRequestBuyerView | PartRequestSellerView;

/** A row of My requirements. */
export interface MyPartRequestRow {
  id: string;
  name: string;
  kind: PartRequestKind;
  side: PartSide | null;
  quantity: string;
  unitLabel: string;
  firstFit: string | null;
  status: PartRequestStatus;
  matched: boolean;
  replyCount: number;
  matchCount: number;
  newCount: number;
  daysLeft: number;
  createdAt: string;
}

/** `GET /part-requests/mine?status=` tabs (plan D15: `closed` = closed + expired + removed). */
export const MY_PART_REQUEST_TABS = ['active', 'fulfilled', 'closed'] as const;
export type MyPartRequestTab = (typeof MY_PART_REQUEST_TABS)[number];

/** `GET /part-requests/mine`. */
export interface MyPartRequestsPage {
  items: MyPartRequestRow[];
  nextCursor: string | null;
  counts: { active: number; fulfilled: number; closed: number };
}

/** A row of "Buyers looking for your parts" (§12.3). */
export interface SellerPartRequestRow {
  id: string;
  name: string;
  kind: PartRequestKind;
  side: PartSide | null;
  quantity: string;
  unitLabel: string;
  firstFit: string | null;
  conditionIds: string[];
  budgetPerUnitPaise: number | null;
  neededBy: string | null;
  urgent: boolean;
  daysLeft: number;
  city: string | null;
  distanceKm: number | null;
  inReach: boolean;
  replyCount: number;
  targeted: boolean;
  hasMatchingStock: boolean;
  photoCount: number;
  buyer: PartRequestBuyerBlock;
  note: string | null;
  noteFlagged: boolean;
  myReplyCount: number;
  createdAt: string;
}

/** `GET /part-requests/for-sellers?tab=` (For you = `matched`). */
export const SELLER_PART_REQUEST_TABS = ['matched', 'all', 'replied'] as const;
export type SellerPartRequestTab = (typeof SELLER_PART_REQUEST_TABS)[number];

/** `GET /part-requests/for-sellers` (plan D15). */
export interface SellerPartRequestsPage {
  items: SellerPartRequestRow[];
  nextCursor: string | null;
  counts: { forYou: number; all: number; replied: number };
  /** The reader may act for their business (not a `viewer` member): the rows' Reply buttons show only then. */
  canAct: boolean;
}

/** A delivered reply as the buyer sees it (§12.2). */
export interface PartRequestReplyItem {
  replyId: string;
  card: ListingCard;
  seller: { businessId: string; name: string; verified: boolean; score: SellerScore | null };
  message: string | null;
  messageFlagged: boolean;
  /** The listing is public now. */
  live: boolean;
  deliveredAt: string;
  viewed: boolean;
}

export interface PartRequestMatchItem {
  listingId: string;
  card: ListingCard;
  tier: PartRequestMatchTier;
  distanceKm: number | null;
  seen: boolean;
  createdAt: string;
}

/** One column of Compare (§12.2), ≤ `PART_REQUEST_LIMITS.compareMax`. */
export interface CompareColumn {
  listingId: string;
  source: 'reply' | 'match';
  title: string;
  pricePerUnitPaise: number | null;
  priceOnRequest: boolean;
  availableQuantity: string | null;
  unitLabel: string | null;
  side: PartSide | null;
  conditionLabel: string | null;
  distanceKm: number | null;
  rating: number | null;
  reviewCount: number;
  verified: boolean;
  lowestPrice: boolean;
  contactAction: 'offer' | 'buy' | 'ask_price' | 'enquire';
}

/** One of the seller's listings in the reply picker (§9.2). */
export interface ReplyOption {
  listingId: string;
  card: ListingCard;
  fit: boolean;
  reason: ReplyFitReason | null;
}

/** `GET /part-requests/:id/reply-options`. */
export interface ReplyOptionsResponse {
  listings: ReplyOption[];
  slotsLeft: number;
  dailyLeft: number;
}

/** `POST /part-requests/:id/replies` body. */
export interface SendRepliesRequest {
  listingIds: string[];
  message?: string | null;
}

/** `GET /part-requests/:id/photos` (300 s URLs). */
export interface PartRequestPhotos {
  photos: { url: string; expiresAt: string }[];
}

/** `GET /part-requests/home` (§12.2, review Q6). */
export interface PartRequestHome {
  buyer: { partRequestId: string; name: string; side: PartSide | null; newCount: number; nearestKm: number | null } | null;
  seller: { newCount: number; items: SellerPartRequestRow[] } | null;
}

/** `GET /listings/:id/part-request-demand` (owner). */
export interface PartRequestDemand {
  count: number;
  partRequestIds: string[];
}

/** `GET /admin/part-requests` row (§14). */
export interface AdminPartRequestRow {
  id: string;
  ref: number;
  name: string;
  kind: PartRequestKind;
  /** Names joined with " › ". */
  categoryPath: string;
  buyer: { businessId: string; name: string };
  city: string | null;
  status: PartRequestStatus;
  targetedCount: number;
  replyCount: number;
  matchCount: number;
  openReports: number;
  createdAt: string;
  expiresAt: string;
}

/** `GET /admin/part-requests` page: `rows`, `total`, `page`, `pageSize` as the other admin lists. */
export interface AdminPartRequestList {
  rows: AdminPartRequestRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** `GET /admin/part-requests/:id` (§14): the buyer view's fields, note masked, no phone, no photo keys. */
export interface AdminPartRequestDetail extends Omit<PartRequestBuyerView, 'role' | 'fulfilPrompt' | 'photoKeys'> {
  buyer: { businessId: string; name: string };
  eligibleNow: number;
  targets: {
    businessId: string;
    name: string;
    rank: number;
    score: string;
    pushed: boolean;
    notifiedAt: string;
    openedAt: string | null;
    replied: boolean;
    notRelevant: boolean;
  }[];
  replies: {
    id: string;
    listingId: string;
    listingTitle: string;
    seller: { businessId: string; name: string };
    status: PartRequestReplyStatus;
    dropReason: PartRequestDropReason | null;
    message: string | null;
    createdAt: string;
  }[];
  matches: {
    listingId: string;
    listingTitle: string;
    seller: { businessId: string; name: string };
    tier: PartRequestMatchTier;
    distanceKm: number | null;
    pushed: boolean;
    createdAt: string;
  }[];
  reports: AdminReportRow[];
  removedAt: string | null;
  removedReason: string | null;
  returnStatus: PartRequestStatus | null;
}

// ─── M14: rental bookings (spec 2026-11-20-m14-rental-bookings-design) ───
// `RENTAL_BOOKING_STATUSES` is in the "deal" section above. Dates are IST calendar dates `YYYY-MM-DD`; money is
// integer paise as JSON numbers.

/** Waiting for an answer (§5.8): they hold no capacity. */
export const OPEN_RENTAL_STATUSES = ['requested', 'countered'] as const satisfies readonly RentalBookingStatus[];
/** Agreed and not finished (§7.2 "active"); `disputed` counts only while from `on_rent` for capacity (§5.7). */
export const ACTIVE_RENTAL_STATUSES = ['confirmed', 'on_rent', 'returned', 'disputed'] as const satisfies readonly RentalBookingStatus[];
/** No way out (§6.1). */
export const FINAL_RENTAL_STATUSES = [
  'completed', 'declined', 'withdrawn', 'expired', 'cancelled',
] as const satisfies readonly RentalBookingStatus[];

/** Whose answer an open booking waits for (`rental_bookings.turn`, null outside `requested` / `countered`). */
export const RENTAL_BOOKING_TURNS = ['owner', 'renter'] as const;
export type RentalTurn = (typeof RENTAL_BOOKING_TURNS)[number];

/** Who wrote a booking event or cancelled (`rental_actor_side`). Support acts as `admin`. */
export const RENTAL_ACTOR_SIDES = ['renter', 'owner', 'system', 'admin'] as const;
export type RentalActorSide = (typeof RENTAL_ACTOR_SIDES)[number];

export const RENTAL_COMPLETED_HOW = ['renter_confirmed', 'auto', 'support'] as const;
export type RentalCompletedHow = (typeof RENTAL_COMPLETED_HOW)[number];

/** Every status change of a booking (§6.1); `writeBookingStatus` checks each with `rentalBookingTransition`. */
export const RENTAL_BOOKING_ACTIONS = [
  'request', 'confirm', 'change', 'accept', 'decline', 'withdraw', 'expire', 'on_site', 'return', 'confirm_return',
  'auto_complete', 'cancel', 'problem', 'resolve_completed', 'resolve_cancelled', 'resume', 'admin_cancel',
  'system_decline', 'system_withdraw', 'system_cancel',
] as const;
export type RentalBookingAction = (typeof RENTAL_BOOKING_ACTIONS)[number];

/** Who takes an action: a party, the system (jobs, exits), an admin (cancel) or support (dispute resolve). */
export type RentalTransitionSide = 'renter' | 'owner' | 'system' | 'admin' | 'support';

const RENTAL_TRANSITIONS: Record<
  Exclude<RentalBookingAction, 'request' | 'change' | 'decline' | 'resume'>,
  { from: readonly RentalBookingStatus[]; sides: readonly RentalTransitionSide[]; to: RentalBookingStatus }
> = {
  confirm: { from: ['requested'], sides: ['owner'], to: 'confirmed' },
  accept: { from: ['countered'], sides: ['renter'], to: 'confirmed' },
  withdraw: { from: ['requested', 'countered'], sides: ['renter'], to: 'withdrawn' },
  expire: { from: ['requested', 'countered'], sides: ['system'], to: 'expired' },
  system_decline: { from: ['requested', 'countered'], sides: ['system'], to: 'declined' },
  system_withdraw: { from: ['requested', 'countered'], sides: ['system'], to: 'withdrawn' },
  system_cancel: { from: ['requested', 'countered', 'confirmed'], sides: ['system'], to: 'cancelled' },
  on_site: { from: ['confirmed'], sides: ['renter', 'owner'], to: 'on_rent' },
  cancel: { from: ['confirmed'], sides: ['renter', 'owner'], to: 'cancelled' },
  return: { from: ['on_rent'], sides: ['owner'], to: 'returned' },
  confirm_return: { from: ['returned'], sides: ['renter'], to: 'completed' },
  auto_complete: { from: ['returned'], sides: ['system'], to: 'completed' },
  problem: { from: ['on_rent', 'returned'], sides: ['renter', 'owner'], to: 'disputed' },
  resolve_completed: { from: ['disputed'], sides: ['support'], to: 'completed' },
  resolve_cancelled: { from: ['disputed'], sides: ['support'], to: 'cancelled' },
  admin_cancel: { from: ['requested', 'countered', 'confirmed'], sides: ['admin'], to: 'cancelled' },
};

/**
 * Where `action` by `side` takes a booking in `from` (§6.1), or null when it isn't allowed (`409
 * RENTAL_TRANSITION_NOT_ALLOWED`). `request` starts from null; `change` and `decline` are the answer of whoever's turn
 * it is (owner on `requested`, renter on `countered`); `resume` goes back to `opts.disputedFrom` (`on_rent` or
 * `returned`). Role (`viewer`), dates and limits are the service's checks.
 */
export function rentalBookingTransition(
  from: RentalBookingStatus | null,
  action: RentalBookingAction,
  side: RentalTransitionSide,
  opts?: { disputedFrom?: RentalBookingStatus | null },
): RentalBookingStatus | null {
  if (action === 'request') return from === null && side === 'renter' ? 'requested' : null;
  if (from === null) return null;
  if (action === 'change') {
    if (from === 'requested' && side === 'owner') return 'countered';
    if (from === 'countered' && side === 'renter') return 'requested';
    return null;
  }
  if (action === 'decline') {
    return (from === 'requested' && side === 'owner') || (from === 'countered' && side === 'renter') ? 'declined' : null;
  }
  if (action === 'resume') {
    const back = opts?.disputedFrom ?? null;
    return from === 'disputed' && side === 'support' && (back === 'on_rent' || back === 'returned') ? back : null;
  }
  const t = RENTAL_TRANSITIONS[action];
  return t.from.includes(from) && t.sides.includes(side) ? t.to : null;
}

/** IST date arithmetic on `YYYY-MM-DD` (no time zone involved: the calendar date is read as UTC midnight). */
function addIsoDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/**
 * Whose step it is (§6.6, the Deals tab badge): the owner on `requested`, on `confirmed` from the start date (mark on
 * site) and on `on_rent` from the end date (mark returned); the renter on `countered` and `returned` (confirm or
 * report). `today` is the IST date.
 */
export function rentalYourTurn(
  b: { status: RentalBookingStatus; startDate: string; endDate: string; turn: RentalTurn | null },
  side: 'renter' | 'owner',
  today: string,
): boolean {
  switch (b.status) {
    case 'requested':
    case 'countered':
      return b.turn === side;
    case 'confirmed':
      return side === 'owner' && today >= b.startDate;
    case 'on_rent':
      return side === 'owner' && today >= b.endDate;
    case 'returned':
      return side === 'renter';
    default:
      return false;
  }
}

/** The buttons a client shows on a Booking record (the server checks each again). */
export type RentalBookingActionKey =
  | 'confirm'
  | 'change'
  | 'decline'
  | 'accept'
  | 'withdraw'
  | 'on_site'
  | 'return'
  | 'confirm_return'
  | 'cancel'
  | 'report_problem'
  | 'edit_notes'
  | 'share_contact'
  | 'review';

/**
 * What the reader of `v` may do now (§6.1, §6.4): nothing for a `viewer`; proposal answers by turn (a change only
 * while `changesLeft > 0`); on site from `startDate − 1`; notes while `confirmed` / `on_rent` / `returned`.
 */
export function rentalBookingActions(v: RentalBookingView, today: string): RentalBookingActionKey[] {
  if (v.role === 'viewer') return [];
  const out: RentalBookingActionKey[] = [];
  const owner = v.side === 'owner';
  switch (v.status) {
    case 'requested':
      if (owner) {
        out.push('confirm');
        if (v.changesLeft > 0) out.push('change');
        out.push('decline');
      } else out.push('withdraw');
      break;
    case 'countered':
      if (!owner) {
        out.push('accept');
        if (v.changesLeft > 0) out.push('change');
        out.push('decline', 'withdraw');
      }
      break;
    case 'confirmed':
      // From the day before the start until the end date (after it the API refuses, `reason: 'ended'`).
      if (today >= addIsoDays(v.current.startDate, -1) && today <= v.current.endDate) out.push('on_site');
      out.push('cancel', 'edit_notes');
      break;
    case 'on_rent':
      if (owner) out.push('return');
      out.push('report_problem', 'edit_notes');
      break;
    case 'returned':
      if (!owner) out.push('confirm_return');
      out.push('report_problem', 'edit_notes');
      break;
    case 'completed':
      if (v.review?.eligible) out.push('review');
      break;
    default:
      break;
  }
  if (v.contact.canTick && !v.contact.mine) out.push('share_contact');
  return out;
}

/** Counts a request may ask for, per period (R1): hours on one day, days, weeks, months. */
export const rentalCountLimits: Record<RentalPeriod, { min: 1; max: number }> = {
  hour: { min: 1, max: 24 },
  day: { min: 1, max: 90 },
  week: { min: 1, max: 26 },
  month: { min: 1, max: 6 },
};

/** Calendar days one period covers (R1: a month is 30 days on the calendar; an hour booking is its start day). */
const PERIOD_CALENDAR_DAYS: Record<RentalPeriod, number> = { hour: 0, day: 1, week: 7, month: 30 };

/** The last day of a booking (R1): hour → the start date; day → start + n − 1; week → + 7n − 1; month → + 30n − 1. */
export function rentalEndDate(start: string, period: RentalPeriod, count: number): string {
  if (period === 'hour') return start;
  return addIsoDays(start, PERIOD_CALENDAR_DAYS[period] * count - 1);
}

/** Days an operator is paid for (R2, as `rentalDayEquivalent`): hour 1; day n; week 6n; month n × `monthDays`. */
export function operatorDays(period: RentalPeriod, count: number, monthDays: number): number {
  switch (period) {
    case 'hour':
      return 1;
    case 'day':
      return count;
    case 'week':
      return count * 6;
    case 'month':
      return count * monthDays;
  }
}

/**
 * Whether a request meets the listing's minimum duration (§6.2): an hour minimum is met by any day / week / month
 * request or by enough hours; a day / week / month minimum is never met by hours and otherwise compares calendar
 * days (day 1, week 7, month 30).
 */
export function meetsRentalMinimum(
  terms: { minDuration: number | null; minDurationPeriod: RentalPeriod | null },
  period: RentalPeriod,
  count: number,
): boolean {
  const min = terms.minDuration;
  const minPeriod = terms.minDurationPeriod;
  if (min == null || minPeriod == null) return true;
  if (minPeriod === 'hour') return period !== 'hour' || count >= min;
  if (period === 'hour') return false;
  return PERIOD_CALENDAR_DAYS[period] * count >= PERIOD_CALENDAR_DAYS[minPeriod] * min;
}

/** The listing's rental terms as a booking stores them at request (`rental_bookings.terms_snapshot`). */
export type RentalTermsSnapshot = Pick<
  RentalTerms,
  | 'rateHourPaise'
  | 'rateDayPaise'
  | 'rateWeekPaise'
  | 'rateMonthPaise'
  | 'shiftHours'
  | 'monthDays'
  | 'operator'
  | 'operatorRateDayPaise'
  | 'fuel'
  | 'transport'
  | 'transportChargePaise'
  | 'depositPaise'
  | 'minDuration'
  | 'minDurationPeriod'
  | 'serviceRadiusKm'
>;

const RATE_OF: Record<RentalPeriod, keyof RentalRates> = {
  hour: 'rateHourPaise',
  day: 'rateDayPaise',
  week: 'rateWeekPaise',
  month: 'rateMonthPaise',
};

/**
 * The choices the listing leaves to the renter (R1): operator `included` / `mandatory` → with, `not_available` /
 * unset → without, `optional` → the request's; transport `owner_delivers` → delivered, `renter_picks_up` / unset →
 * picked up, `either` → the request's.
 */
export function resolveRentalChoices(
  terms: Pick<RentalTermsSnapshot, 'operator' | 'transport'>,
  req: { withOperator?: boolean; ownerDelivers?: boolean },
): { withOperator: boolean; ownerDelivers: boolean } {
  const withOperator =
    terms.operator === 'included' || terms.operator === 'mandatory'
      ? true
      : terms.operator === 'optional'
        ? req.withOperator === true
        : false;
  const ownerDelivers =
    terms.transport === 'owner_delivers' ? true : terms.transport === 'either' ? req.ownerDelivers === true : false;
  return { withOperator, ownerDelivers };
}

/**
 * The server's estimate (R2), integer paise; null when the listing doesn't price `period`. Rent = rate × count ×
 * machines; operator money only for an `optional` operator chosen (operator day rate × `operatorDays` × machines);
 * transport only when the owner delivers and a charge is set (× 2 each way × machines). Fuel, overtime, deposit and
 * GST are terms, never added. `days` = the operator days.
 */
export function rentalEstimate(
  terms: RentalTermsSnapshot,
  req: { period: RentalPeriod; count: number; machines: number; withOperator: boolean; ownerDelivers: boolean },
): { days: number; rentPaise: number; operatorPaise: number; transportPaise: number; totalPaise: number } | null {
  const rate = terms[RATE_OF[req.period]];
  if (rate == null) return null;
  const days = operatorDays(req.period, req.count, terms.monthDays);
  const rentPaise = rate * req.count * req.machines;
  const operatorPaise =
    terms.operator === 'optional' && req.withOperator ? (terms.operatorRateDayPaise ?? 0) * days * req.machines : 0;
  const transportPaise =
    req.ownerDelivers && terms.transportChargePaise != null ? terms.transportChargePaise * 2 * req.machines : 0;
  return { days, rentPaise, operatorPaise, transportPaise, totalPaise: rentPaise + operatorPaise + transportPaise };
}

// Reasons (§5.8).
export const RENTAL_DECLINE_REASONS = ['dates_unavailable', 'site_too_far', 'terms', 'other'] as const;
export type RentalDeclineReason = (typeof RENTAL_DECLINE_REASONS)[number];
export const RENTAL_CANCEL_REASONS_RENTER = ['plans_changed', 'found_another', 'owner_not_responding', 'other'] as const;
export const RENTAL_CANCEL_REASONS_OWNER = ['machine_unavailable', 'breakdown', 'renter_not_responding', 'other'] as const;
/** System and staff exits: listing removed, block, suspended owner / renter, GST lost, support, admin cancel. */
export const RENTAL_CANCEL_REASONS_SYSTEM = [
  'listing_removed', 'blocked', 'owner_inactive', 'owner_gst', 'renter_inactive', 'support_closed', 'admin',
] as const;
export type RentalSystemReason = (typeof RENTAL_CANCEL_REASONS_SYSTEM)[number];
export type RentalCancelReason =
  | (typeof RENTAL_CANCEL_REASONS_RENTER)[number]
  | (typeof RENTAL_CANCEL_REASONS_OWNER)[number]
  | RentalSystemReason;
/** Why the owner's final amount differs from the agreed total (§6.4). */
export const RENTAL_FINAL_REASONS = ['extra_time', 'overtime', 'fuel', 'transport', 'damage', 'discount', 'other'] as const;
export type RentalFinalReason = (typeof RENTAL_FINAL_REASONS)[number];
/** An owner's calendar block (R5); `booked_outside` replaces the retired "Mark rented". */
export const RENTAL_BLOCK_REASONS = ['maintenance', 'booked_outside', 'other'] as const;
export type RentalBlockReason = (typeof RENTAL_BLOCK_REASONS)[number];
export const RENTAL_DISPUTE_CATEGORIES = [
  'not_as_described', 'breakdown', 'damage', 'hours_or_amount', 'no_show', 'other',
] as const;
export type RentalDisputeCategory = (typeof RENTAL_DISPUTE_CATEGORIES)[number];
/** Timeline events (§5.3); `values` never carry text a user typed. */
export const RENTAL_EVENT_CODES = [
  'requested', 'changed_by_owner', 'changed_by_renter', 'confirmed', 'change_accepted', 'declined', 'withdrawn',
  'expired', 'on_site', 'returned', 'return_confirmed', 'auto_completed', 'cancelled', 'problem_reported',
  'dispute_resolved', 'notes_changed', 'contact_shared',
] as const;
export type RentalEventCode = (typeof RENTAL_EVENT_CODES)[number];

/** Bounds (plan Global constraints "Exact numbers"). */
export const RENTAL_LIMITS = {
  /** A change's message (seq > 1). */
  messageMax: 300,
  /** The request's note (version 1's message). */
  requestNoteMax: 500,
  notesMax: 500,
  damageNoteMax: 500,
  /** Cancel and final-amount notes. */
  shortNoteMax: 300,
  siteAddressMax: 200,
  blockNoteMax: 200,
  blockRangeMaxDays: 366,
  photosMax: 3,
  hourMeterMax: 1_000_000,
  machinesMax: 1000,
  availabilityMaxDays: 92,
  availabilityDefaultDays: 30,
  freeOnMaxDays: 90,
  pageSize: 20,
  refStart: 700001,
} as const;

/** §17: the new error codes (`RENTAL_NEEDS_GST`, `OFFERS_NOT_FOR_RENTALS` and `PINCODE_UNKNOWN` exist already). */
export const RENTAL_ERROR_CODES = [
  'RENTAL_PERIOD_NOT_OFFERED',
  'RENTAL_COUNT_INVALID',
  'RENTAL_MACHINES_INVALID',
  'RENTAL_DATES_INVALID',
  'BELOW_MINIMUM',
  'RENTAL_DATES_TAKEN',
  'RENTAL_QUANTITY_BOOKED',
  'RENTAL_OPEN_LIMIT',
  'RENTAL_DAILY_LIMIT',
  'RENTAL_REQUEST_OPEN',
  'RENTAL_CHANGE_LIMIT',
  'RENTAL_TRANSITION_NOT_ALLOWED',
  'RENTAL_BOOKING_STALE',
  'RENTAL_TOO_EARLY',
  'HOUR_METER_INVALID',
  'FINAL_REASON_REQUIRED',
  'LISTING_HAS_OPEN_BOOKINGS',
  'LISTING_NOT_BOOKABLE',
  'RENTAL_BOOKING_NOT_FOUND',
] as const;
export type RentalErrorCode = (typeof RENTAL_ERROR_CODES)[number];

// ─── M14 payloads and views (§13.2). Key names fixed by plan C0-1. ───

/** `POST /listings/:id/bookings` body (§6.2). Operator / transport only where the listing offers a choice. */
export interface RentalRequestInput {
  startDate: string;
  period: RentalPeriod;
  count: number;
  machines: number;
  withOperator?: boolean;
  ownerDelivers?: boolean;
  sitePincode: string;
  /** ≤ 200, private until confirmed, masked until the reveal (§8). */
  siteAddress?: string;
  /** ≤ 500, masked, scam-checked. */
  note?: string;
}

/** `POST /rental-bookings/:id/change` body: answers version `versionSeq` (`409 RENTAL_BOOKING_STALE` otherwise). */
export interface RentalChangeInput {
  versionSeq: number;
  startDate: string;
  period: RentalPeriod;
  count: number;
  machines: number;
  withOperator?: boolean;
  ownerDelivers?: boolean;
  /** Owner only (§6.3): its own total, 0 … 10¹⁰. */
  totalPaise?: number;
  /** ≤ 300. */
  message?: string;
}

/** `POST /rentals/estimate` body: a request's terms for one listing, without the site address and note. */
export interface RentalEstimateRequest {
  listingId: string;
  startDate: string;
  period: RentalPeriod;
  count: number;
  machines: number;
  withOperator?: boolean;
  ownerDelivers?: boolean;
  /** For `beyondServiceRadius`; the distance itself is never returned. */
  sitePincode?: string;
}

export interface RentalEstimateResult {
  endDate: string;
  days: number;
  rentPaise: number;
  operatorPaise: number;
  transportPaise: number;
  totalPaise: number;
  /** The asked machines are free on every day (indicative until the owner confirms). */
  free: boolean;
  minimumMet: boolean;
  /** Null without a site pincode or a service radius. */
  beyondServiceRadius: boolean | null;
  withOperator: boolean;
  ownerDelivers: boolean;
}

/** One proposal (`rental_booking_versions`, §5.2). `message` masked per reader. */
export interface RentalVersionView {
  seq: number;
  proposedBy: 'renter' | 'owner';
  startDate: string;
  endDate: string;
  period: RentalPeriod;
  count: number;
  machines: number;
  withOperator: boolean;
  ownerDelivers: boolean;
  estimatePaise: number;
  totalPaise: number;
  message: string | null;
  messageFlagged: boolean;
  createdAt: string;
}

/** The Booking record (`GET /rental-bookings/:id`), per reader (plan D4). Text masked; site address per §8. */
export interface RentalBookingView {
  id: string;
  ref: number;
  side: 'renter' | 'owner';
  role: MemberRole;
  status: RentalBookingStatus;
  turn: RentalTurn | null;
  listing: { id: string; title: string; thumbUrl: string | null; kind: 'machine_rental' };
  counterpart: { businessId: string; tradeName: string; verified: boolean; city: string | null };
  current: RentalVersionView;
  versions: RentalVersionView[];
  changeCount: number;
  changesLeft: number;
  replyDueAt: string | null;
  agreedTotalPaise: number | null;
  finalAmountPaise: number | null;
  finalAmountReason: RentalFinalReason | null;
  finalAmountNote: string | null;
  terms: RentalTermsSnapshot;
  site: {
    pincode: string;
    city: string;
    state: string;
    /** Renter always; owner from `confirmed` on, masked until the reveal; null for a viewer before it. */
    address: string | null;
    /** Owner only (whole km from the machine's base); null for the renter. */
    distanceKm: number | null;
    beyondServiceRadius: boolean | null;
  };
  onSite: { at: string; bySide: 'renter' | 'owner'; hourMeter: number | null; photoCount: number } | null;
  returned: { at: string; hourMeter: number | null; damageNote: string | null; photoCount: number } | null;
  autoCompleteAt: string | null;
  completedAt: string | null;
  completedHow: RentalCompletedHow | null;
  cancelled: { at: string; bySide: RentalActorSide; reason: RentalCancelReason | null; note: string | null } | null;
  declineReason: RentalDeclineReason | RentalSystemReason | null;
  notes: {
    paymentMethod: DealPaymentMethod | null;
    advancePaise: number | null;
    depositPaise: number | null;
    depositReturned: boolean | null;
    /** `HH:MM`. */
    expectedOnSiteTime: string | null;
    text: string | null;
    textFlagged: boolean;
    updatedAt: string | null;
    version: number;
  };
  timeline: { code: RentalEventCode; actorSide: RentalActorSide; at: string; values: Record<string, string | number | boolean | null> }[];
  contact: ContactState;
  review: ReviewState | null;
  dispute: { id: string; status: DisputeStatus; outcome: DisputeOutcome | null } | null;
  threadId: string;
  /** §6.4: a booking still out on this listing that collides with this one. */
  clashWith: { id: string; ref: number } | null;
  actions: RentalBookingActionKey[];
}

/** A `booking` card in the thread (§8). */
export interface RentalBookingCardView {
  id: string;
  ref: number;
  status: RentalBookingStatus;
  turn: RentalTurn | null;
  current: RentalVersionView;
  listingTitle: string;
}

/** A row of the Deals tab's Rentals list. */
export interface RentalBookingListRow {
  id: string;
  ref: number;
  side: 'renter' | 'owner';
  status: RentalBookingStatus;
  yourTurn: boolean;
  listingTitle: string;
  thumbUrl: string | null;
  counterpartName: string;
  startDate: string;
  endDate: string;
  machines: number;
  /** The agreed total, else the open version's total. */
  totalPaise: number | null;
  updatedAt: string;
}

export const RENTAL_BOOKING_TABS = ['active', 'completed', 'cancelled'] as const;
export type RentalBookingTab = (typeof RENTAL_BOOKING_TABS)[number];
export const RENTAL_BOOKING_SIDE_FILTERS = ['all', 'renter', 'owner'] as const;
export type RentalBookingSideFilter = (typeof RENTAL_BOOKING_SIDE_FILTERS)[number];

/** `GET /rental-bookings?tab=&side=&listingId=&cursor=`. */
export interface RentalBookingsQuery {
  tab: RentalBookingTab;
  side: RentalBookingSideFilter;
  listingId?: string;
  cursor?: string;
}

export interface RentalBookingsPage {
  items: RentalBookingListRow[];
  nextCursor: string | null;
  counts: { active: number; completed: number; cancelled: number };
  yourTurn: number;
}

/** The public availability strip (R13): never who or how many. */
export interface RentalAvailabilityDay {
  date: string;
  state: 'free' | 'partial' | 'full';
}

/** The owner's calendar day: machines out and free. */
export interface RentalCalendarDay {
  date: string;
  out: number;
  free: number;
}

export interface RentalBlockView {
  id: string;
  startDate: string;
  endDate: string;
  machines: number;
  reason: RentalBlockReason;
  /** Owner and admins only. */
  note: string | null;
}

/** `POST /listings/:id/rental-blocks`, `PATCH /rental-blocks/:id`. */
export interface RentalBlockInput {
  startDate: string;
  endDate: string;
  machines: number;
  reason: RentalBlockReason;
  note?: string;
}

/** `GET /listings/:id/calendar` (owner, §7.3). */
export interface RentalCalendar {
  listingId: string;
  quantity: number;
  /** The reader's role in the owner business: a `viewer` reads only (block writes `403 VIEWER_READ_ONLY`). */
  memberRole: MemberRole;
  days: RentalCalendarDay[];
  bookings: {
    id: string;
    ref: number;
    status: RentalBookingStatus;
    startDate: string;
    endDate: string;
    /**
     * The days capacity counts it on (§5.7): from the earlier of its start and its on-site day, to its end, or to today
     * while the machine is still out (`on_rent`, or disputed from it). The calendar lists a booking on these days.
     */
    spanStart: string;
    spanEnd: string;
    machines: number;
    renterName: string;
  }[];
  blocks: RentalBlockView[];
}

/**
 * `GET /rental-bookings/:id/photos` (party only, plan A1-4): the booking's private photos as signed URLs (300 s). `problem`
 * only when a problem with photos was reported.
 */
export interface RentalBookingPhotos {
  onSite: string[];
  returned: string[];
  problem?: string[];
}

/** `ListingOwnerView.bookingSummary` (plan D14). */
export interface RentalBookingSummary {
  openRequests: number;
  activeBookings: number;
  outToday: number;
  nextBooking: { id: string; ref: number; startDate: string; endDate: string; machines: number } | null;
}

/** `GET /admin/rental-bookings` row (§15). */
export interface AdminRentalBookingRow {
  id: string;
  ref: number;
  listing: { id: string; title: string };
  renter: { businessId: string; name: string };
  owner: { businessId: string; name: string };
  startDate: string;
  endDate: string;
  machines: number;
  status: RentalBookingStatus;
  agreedTotalPaise: number | null;
  updatedAt: string;
}

/** `GET /admin/rental-bookings` page. */
export interface AdminRentalBookingList {
  rows: AdminRentalBookingRow[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * `GET /admin/rental-bookings/:id` (§15): the owner view's fields with the site address unmasked to staff (my call
 * 11), every version, events with admin actors, the photo keys, the dispute and the reviews' state.
 */
export interface AdminRentalBookingDetail
  extends Omit<RentalBookingView, 'side' | 'role' | 'counterpart' | 'contact' | 'review' | 'actions' | 'timeline'> {
  renter: { businessId: string; name: string };
  owner: { businessId: string; name: string };
  events: {
    code: RentalEventCode;
    actorSide: RentalActorSide;
    actorAdminName: string | null;
    at: string;
    values: Record<string, string | number | boolean | null>;
  }[];
  /** On-site and return photos as signed URLs valid for 300 s (a photo is left out while storage is unavailable). */
  photos: { onSite: string[]; returned: string[] };
  reviews: { renterSubmitted: boolean; ownerSubmitted: boolean; published: boolean };
}

/** App route `RequestBooking` (plan C0-5): `change` mode sends `POST /rental-bookings/:id/change`. */
export interface RequestBookingParams {
  listingId: string;
  prefill?: Partial<RentalRequestInput>;
  change?: { bookingId: string; versionSeq: number };
}
