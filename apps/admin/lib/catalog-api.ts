import type {
  AdminCategoryDetail, Brand, BrandWithModels, CatalogStatus, CategoryIcon, CategoryNode, Condition, FieldAppliesTo,
  FieldOption, FieldType, MachineModel, MasterData, TemplateField, Unit,
} from '@mpm/shared-types';
import { api } from './api';

// Typed calls to the admin catalogue API (scope A4). Each returns the endpoint's `data`.

// ─── category tree ───

export interface CreateCategoryInput {
  /** null creates a machine category. */
  parentId: string | null;
  name: string;
  /** Omitted: the API derives it from the name. */
  slug?: string;
  /** Machine categories only. */
  icon?: CategoryIcon;
}

export interface UpdateCategoryPatch {
  name?: string;
  slug?: string;
  icon?: CategoryIcon | null;
  isActive?: boolean;
  /** null: inherit from the parent. */
  hasSides?: boolean | null;
  /** null: inherit from the parent. */
  sideConvention?: string | null;
}

/** Every node, inactive ones included. */
export const fetchAdminTree = () => api.get<CategoryNode[]>('/admin/categories');

export const fetchCategoryDetail = (id: string) => api.get<AdminCategoryDetail>(`/admin/categories/${id}`);

export const createCategory = (input: CreateCategoryInput) => api.post<CategoryNode>('/admin/categories', input);

export const updateCategory = (id: string, patch: UpdateCategoryPatch) =>
  api.patch<CategoryNode>(`/admin/categories/${id}`, patch);

/** A machine type to another machine category, or a part group to another machine type (MOVE_NOT_ALLOWED otherwise). */
export const moveCategory = (id: string, parentId: string) =>
  api.post<CategoryNode>(`/admin/categories/${id}/move`, { parentId });

/** `orderedIds` must be exactly the current children of `parentId` (null = categories), or the API answers STALE_ORDER. */
export const reorderSiblings = (parentId: string | null, orderedIds: string[]) =>
  api.post<null>('/admin/categories/reorder', { parentId, orderedIds });

/** 409 NODE_IN_USE when anything references the node. */
export const deleteCategory = (id: string) => api.delete<null>(`/admin/categories/${id}`);

// ─── template fields ───

export interface CreateFieldInput {
  key: string;
  label: string;
  helpText?: string | null;
  type: FieldType;
  /** Defaults to 'both'. Fixed once the field exists. */
  appliesTo?: FieldAppliesTo;
  /** Number fields only. */
  unit?: string | null;
  min?: number | null;
  max?: number | null;
  required?: boolean;
  filterable?: boolean;
  /** 1–6 or null; unique across every template the field takes part in (RANK_TAKEN). */
  highlightRank?: number | null;
}

/** Key, type and applies-to are fixed once a field exists. */
export type UpdateFieldPatch = Partial<Omit<CreateFieldInput, 'key' | 'type' | 'appliesTo'>> & { status?: CatalogStatus };

/** Goes last among the node's fields. KEY_TAKEN / RANK_TAKEN / FIELD_INVALID on a clash. */
export const createField = (categoryId: string, input: CreateFieldInput) =>
  api.post<TemplateField>(`/admin/categories/${categoryId}/fields`, input);

export const updateField = (id: string, patch: UpdateFieldPatch) => api.patch<TemplateField>(`/admin/fields/${id}`, patch);

/** `orderedIds` must be every field of the node, retired ones included. */
export const reorderFields = (categoryId: string, orderedIds: string[]) =>
  api.post<null>(`/admin/categories/${categoryId}/fields/reorder`, { orderedIds });

export const createOption = (fieldId: string, input: { key: string; label: string }) =>
  api.post<FieldOption>(`/admin/fields/${fieldId}/options`, input);

export const updateOption = (id: string, patch: { label?: string; status?: CatalogStatus }) =>
  api.patch<FieldOption>(`/admin/options/${id}`, patch);

/** `orderedIds` must be every option of the field, retired ones included. */
export const reorderOptions = (fieldId: string, orderedIds: string[]) =>
  api.post<null>(`/admin/fields/${fieldId}/options/reorder`, { orderedIds });

// ─── brands and models ───

/** Every brand with all its models, inactive ones included. */
export const fetchAdminBrands = () => api.get<BrandWithModels[]>('/admin/brands');

export interface CreateBrandInput {
  key: string;
  name: string;
  /** Omitted: the API derives it from the name. */
  slug?: string;
  makesMachines: boolean;
  makesParts: boolean;
}

export interface UpdateBrandPatch {
  name?: string;
  slug?: string;
  makesMachines?: boolean;
  makesParts?: boolean;
  needsReview?: boolean;
  isActive?: boolean;
}

/** Goes last. KEY_TAKEN / SLUG_TAKEN on a clash; FIELD_INVALID when it makes neither machines nor parts. */
export const createBrand = (input: CreateBrandInput) => api.post<Brand>('/admin/brands', input);

export const updateBrand = (id: string, patch: UpdateBrandPatch) => api.patch<Brand>(`/admin/brands/${id}`, patch);

/** `orderedIds` must be every brand, inactive ones included (STALE_ORDER otherwise). */
export const reorderBrands = (orderedIds: string[]) => api.post<null>('/admin/brands/reorder', { orderedIds });

/** 409 BRAND_IN_USE while it has models (or other references). */
export const deleteBrand = (id: string) => api.delete<null>(`/admin/brands/${id}`);

export interface CreateModelInput {
  brandId: string;
  machineTypeId: string;
  key: string;
  name: string;
}

/**
 * KEY_TAKEN (key used by the brand), NAME_TAKEN (name used for the brand and machine type),
 * NOT_A_MACHINE_TYPE, BRAND_NOT_MACHINE_MAKER.
 */
export const createModel = (input: CreateModelInput) => api.post<MachineModel>('/admin/models', input);

export const updateModel = (id: string, patch: { name?: string; needsReview?: boolean; isActive?: boolean }) =>
  api.patch<MachineModel>(`/admin/models/${id}`, patch);

/** To another brand, machine type or both; same codes as createModel. */
export const moveModel = (id: string, to: { brandId?: string; machineTypeId?: string }) =>
  api.post<MachineModel>(`/admin/models/${id}/move`, to);

/** `orderedIds` must be every model of the brand, inactive ones included. */
export const reorderModels = (brandId: string, orderedIds: string[]) =>
  api.post<null>(`/admin/brands/${brandId}/models/reorder`, { orderedIds });

export const deleteModel = (id: string) => api.delete<null>(`/admin/models/${id}`);

// ─── master data ───

/** Units and conditions, inactive rows included. */
export const fetchAdminMasterData = () => api.get<MasterData>('/admin/master-data');

// Keys are fixed once created (KEY_TAKEN on a clash). Reorders take every id of the list (STALE_ORDER otherwise).

export const createUnit = (input: { key: string; label: string; decimals: number }) =>
  api.post<Unit>('/admin/master-data/units', input);
export const updateUnit = (id: string, patch: { label?: string; decimals?: number; isActive?: boolean }) =>
  api.patch<Unit>(`/admin/master-data/units/${id}`, patch);
export const reorderUnits = (orderedIds: string[]) => api.post<null>('/admin/master-data/units/reorder', { orderedIds });

export const createCondition = (input: { key: string; label: string; description?: string | null }) =>
  api.post<Condition>('/admin/master-data/conditions', input);
export const updateCondition = (id: string, patch: { label?: string; description?: string | null; isActive?: boolean }) =>
  api.patch<Condition>(`/admin/master-data/conditions/${id}`, patch);
export const reorderConditions = (orderedIds: string[]) =>
  api.post<null>('/admin/master-data/conditions/reorder', { orderedIds });

// ─── export ───

export type ExportSheet = 'tree' | 'fields' | 'brands-models' | 'master-data';

export function downloadExport(sheet: ExportSheet): Promise<void> {
  const date = new Date().toISOString().slice(0, 10);
  return api.download(`/admin/catalog/export/${sheet}`, `catalogue-${sheet}-${date}.csv`);
}
