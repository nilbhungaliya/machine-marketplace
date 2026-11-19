import { inArray, sql } from 'drizzle-orm';
import { normalizePartName, type Specs } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import {
  brands,
  categories,
  conditions,
  listingFitments,
  listingMachines,
  listings,
  machineModels,
  templateFieldOptions,
  templateFields,
} from '../../db/schema.js';
import { centroidSql } from '../listings/listing-validate.service.js';
import { compactPartNumber, normalizeSearchText } from './normalize.js';

// The only writer of the listings' search columns (F4 + F5 spec §4.1, §5.2): `search_title_text`, `search_text`,
// `search_point` and `search_refreshed_at`. Listing writes call `refreshListingSearch` in their own transaction; catalogue
// changes queue a background job (`refresh-jobs.ts`) that calls it in batches.

type Conn = Db | Tx;

/** Everything one listing's search text is built from (names already resolved). */
export interface SearchInputs {
  title: string | null;
  partNumber: string | null;
  partBrandName: string | null;
  /** The category path's names, root first (machine category › machine type › part group). */
  categoryNames: string[];
  fitments: Array<{ brandName: string | null; modelName: string | null; modelOther: string | null }>;
  machine: { brandName: string | null; brandOther: string | null; modelName: string | null; modelOther: string | null } | null;
  /** Spec values as text: the option label for select fields, the raw text / number otherwise. */
  specValues: string[];
  conditionLabel: string | null;
}

const join = (parts: Array<string | null | undefined>): string =>
  parts
    .map((p) => normalizeSearchText(p))
    .filter((p) => p !== '')
    .join(' ');

/**
 * Pure (§4.1): `searchTitleText` = title (the listing's `title_norm`: no side words), the part number in two forms (spaced "ab 123 x" and compact "ab123x"), the part
 * brand and the category path names; `searchText` = `searchTitleText` followed by fitment and machine brand / model
 * names (and their "Other" texts), spec values and the condition label. Never the description and never side words
 * (the side is a filter, R8).
 */
export function buildSearchColumns(input: SearchInputs): { searchTitleText: string; searchText: string } {
  const compact = compactPartNumber(input.partNumber);
  const spaced = normalizeSearchText(input.partNumber);
  const searchTitleText = join([
    input.title,
    spaced,
    compact !== spaced ? compact : null,
    input.partBrandName,
    ...input.categoryNames,
  ]);
  const rest = join([
    ...input.fitments.flatMap((f) => [f.brandName, f.modelName, f.modelOther]),
    input.machine?.brandName,
    input.machine?.brandOther,
    input.machine?.modelName,
    input.machine?.modelOther,
    ...input.specValues,
    input.conditionLabel,
  ]);
  return { searchTitleText, searchText: rest === '' ? searchTitleText : searchTitleText === '' ? rest : `${searchTitleText} ${rest}` };
}

/** Spec values as text (§4.1): select keys become their option labels (any status), numbers and text stay as they are. */
export function specValuesOf(
  specs: Specs,
  fields: Map<string, { type: string; options: Map<string, string> }>,
): string[] {
  const out: string[] = [];
  for (const key of Object.keys(specs).sort()) {
    const field = fields.get(key);
    if (!field) continue;
    const value = specs[key];
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) {
      if (v === null || v === undefined || v === '') continue;
      if (field.type === 'single_select' || field.type === 'multi_select') out.push(field.options.get(String(v)) ?? String(v));
      else out.push(String(v));
    }
  }
  return out;
}

/** Path prefixes of a category path: "a/b/c" → ["a", "a/b", "a/b/c"]. */
function pathPrefixes(path: string): string[] {
  const parts = path.split('/');
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
}

/**
 * Rebuilds the search columns of these listings (§5.2) in the caller's transaction: reads each listing's category path,
 * part brand, fitments, machine details, spec option labels and condition, writes both texts, `search_point` = its
 * `point`, else the centroid of its pincode's offices (R5), and `search_refreshed_at = now()`. Unknown ids are ignored.
 */
export async function refreshListingSearch(tx: Conn, listingIds: string[]): Promise<void> {
  const ids = [...new Set(listingIds)];
  if (ids.length === 0) return;
  const rows = await tx
    .select({
      id: listings.id,
      title: listings.title,
      titleNorm: listings.titleNorm,
      partNumber: listings.partNumber,
      partBrandId: listings.partBrandId,
      categoryId: listings.categoryId,
      specs: listings.specs,
      conditionId: listings.conditionId,
    })
    .from(listings)
    .where(inArray(listings.id, ids));
  if (rows.length === 0) return;

  // Categories: each listing's node, then every node on its path.
  const nodeIds = [...new Set(rows.map((r) => r.categoryId).filter((x): x is string => x !== null))];
  const nodes = nodeIds.length
    ? await tx.select({ id: categories.id, path: categories.path }).from(categories).where(inArray(categories.id, nodeIds))
    : [];
  const nodePath = new Map(nodes.map((n) => [n.id, n.path]));
  const allPaths = [...new Set(nodes.flatMap((n) => pathPrefixes(n.path)))];
  const pathRows = allPaths.length
    ? await tx.select({ id: categories.id, path: categories.path, name: categories.name }).from(categories).where(inArray(categories.path, allPaths))
    : [];
  const byPath = new Map(pathRows.map((p) => [p.path, p]));

  // Template fields of every node on those paths, any status, with their options.
  const pathNodeIds = pathRows.map((p) => p.id);
  const fieldRows = pathNodeIds.length
    ? await tx
        .select({ id: templateFields.id, categoryId: templateFields.categoryId, key: templateFields.key, type: templateFields.type })
        .from(templateFields)
        .where(inArray(templateFields.categoryId, pathNodeIds))
    : [];
  const optionRows = fieldRows.length
    ? await tx
        .select({ fieldId: templateFieldOptions.fieldId, key: templateFieldOptions.key, label: templateFieldOptions.label })
        .from(templateFieldOptions)
        .where(inArray(templateFieldOptions.fieldId, fieldRows.map((f) => f.id)))
    : [];
  const optionsByField = new Map<string, Map<string, string>>();
  for (const o of optionRows) {
    const m = optionsByField.get(o.fieldId) ?? new Map<string, string>();
    m.set(o.key, o.label);
    optionsByField.set(o.fieldId, m);
  }
  const fieldsByNode = new Map<string, Array<(typeof fieldRows)[number]>>();
  for (const f of fieldRows) fieldsByNode.set(f.categoryId, [...(fieldsByNode.get(f.categoryId) ?? []), f]);

  const fitmentRows = await tx
    .select({ listingId: listingFitments.listingId, brandName: brands.name, modelName: machineModels.name, modelOther: listingFitments.modelOther })
    .from(listingFitments)
    .leftJoin(brands, sql`${brands.id} = ${listingFitments.brandId}`)
    .leftJoin(machineModels, sql`${machineModels.id} = ${listingFitments.modelId}`)
    .where(inArray(listingFitments.listingId, ids))
    .orderBy(listingFitments.listingId, listingFitments.sortOrder);
  const machineRows = await tx
    .select({
      listingId: listingMachines.listingId,
      brandName: brands.name,
      brandOther: listingMachines.brandOther,
      modelName: machineModels.name,
      modelOther: listingMachines.modelOther,
    })
    .from(listingMachines)
    .leftJoin(brands, sql`${brands.id} = ${listingMachines.brandId}`)
    .leftJoin(machineModels, sql`${machineModels.id} = ${listingMachines.modelId}`)
    .where(inArray(listingMachines.listingId, ids));
  const brandIds = [...new Set(rows.map((r) => r.partBrandId).filter((x): x is string => x !== null))];
  const brandRows = brandIds.length ? await tx.select({ id: brands.id, name: brands.name }).from(brands).where(inArray(brands.id, brandIds)) : [];
  const conditionIds = [...new Set(rows.map((r) => r.conditionId).filter((x): x is string => x !== null))];
  const conditionRows = conditionIds.length
    ? await tx.select({ id: conditions.id, label: conditions.label }).from(conditions).where(inArray(conditions.id, conditionIds))
    : [];

  const brandName = new Map(brandRows.map((b) => [b.id, b.name]));
  const conditionLabel = new Map(conditionRows.map((c) => [c.id, c.label]));
  const machines = new Map(machineRows.map((m) => [m.listingId, m]));
  const fitments = new Map<string, Array<(typeof fitmentRows)[number]>>();
  for (const f of fitmentRows) fitments.set(f.listingId, [...(fitments.get(f.listingId) ?? []), f]);

  const outIds: string[] = [];
  const titles: string[] = [];
  const texts: string[] = [];
  for (const row of rows) {
    const path = row.categoryId ? nodePath.get(row.categoryId) : undefined;
    const pathNodes = path ? pathPrefixes(path).map((p) => byPath.get(p)).filter((n): n is NonNullable<typeof n> => n !== undefined) : [];
    const fields = new Map<string, { type: string; options: Map<string, string> }>();
    // Root first, so a deeper node's field of the same key wins.
    for (const node of pathNodes) {
      for (const f of fieldsByNode.get(node.id) ?? []) fields.set(f.key, { type: f.type, options: optionsByField.get(f.id) ?? new Map() });
    }
    const m = machines.get(row.id);
    const built = buildSearchColumns({
      // F2's part name: side words (en / hi / gu) already removed, so "Tie rod end LH" stores no "lh" (§4.1).
      title: row.titleNorm ?? (row.title ? normalizePartName(row.title) : null),
      partNumber: row.partNumber,
      partBrandName: row.partBrandId ? (brandName.get(row.partBrandId) ?? null) : null,
      categoryNames: pathNodes.map((n) => n.name),
      fitments: (fitments.get(row.id) ?? []).map((f) => ({ brandName: f.brandName, modelName: f.modelName, modelOther: f.modelOther })),
      machine: m ? { brandName: m.brandName, brandOther: m.brandOther, modelName: m.modelName, modelOther: m.modelOther } : null,
      specValues: specValuesOf(row.specs ?? {}, fields),
      conditionLabel: row.conditionId ? (conditionLabel.get(row.conditionId) ?? null) : null,
    });
    outIds.push(row.id);
    titles.push(built.searchTitleText);
    texts.push(built.searchText);
  }

  await tx.execute(sql`
    UPDATE listings AS l
    SET search_title_text = v.title,
        search_text = v.body,
        search_point = COALESCE(l.point, ${centroidSql(sql`l.pincode`)}),
        search_refreshed_at = now()
    FROM unnest(${sql.param(outIds)}::uuid[], ${sql.param(titles)}::text[], ${sql.param(texts)}::text[]) AS v(id, title, body)
    WHERE l.id = v.id`);
}
