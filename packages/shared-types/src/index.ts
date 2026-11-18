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
/** One account can buy, sell, or both (scope F1: "One account can Buy + Sell"). */
export const BUSINESS_ROLES = ['buy', 'sell', 'both'] as const;
export type BusinessRole = (typeof BUSINESS_ROLES)[number];

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
