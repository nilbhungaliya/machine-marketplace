import { sql, type SQL } from 'drizzle-orm';
import { LISTING_KINDS, type ListingKind, type SearchFacets, type SpecFacet } from '@mpm/shared-types';
import type { Tx } from '../../db/index.js';
import { listings } from '../../db/schema.js';
import { deliversSql, gstSql, sideFilterSql, whereSql, type FilterParts, type SpecFieldInPlay } from './filters.js';

// Disjunctive facets, first page only (F4 + F5 spec §5.9): each group is counted with every filter except its own. The
// queries run one after another on the search transaction's connection, so they see its trigram threshold (§5.4).

const STATES_TOP = 10;

/** Counts of every facet group for the matched listings (`match`: the full or partial text match, or null). */
export async function computeFacets(
  tx: Tx,
  parts: FilterParts,
  kinds: readonly ListingKind[],
  match: SQL | null,
  specFields: SpecFieldInPlay[],
): Promise<SearchFacets> {
  // Kinds (grouped).
  const { rows: kindRows } = await tx.execute<{ kind: ListingKind; n: number }>(sql`
    SELECT ${listings.kind} AS kind, count(*)::int AS n FROM listings
    WHERE ${whereSql(parts, kinds, [match], ['kinds'])}
    GROUP BY ${listings.kind}`);
  const kindCounts = Object.fromEntries(LISTING_KINDS.map((k) => [k, 0])) as Record<ListingKind, number>;
  for (const r of kindRows) kindCounts[r.kind] = Number(r.n);

  // Side, GST verified and delivers in one scalar query: each count leaves out its own group, keeps the other two.
  const g = (name: 'side' | 'gst' | 'delivers'): SQL => parts.groups.get(name) ?? sql`true`;
  const { rows: scalar } = await tx.execute<{ left: number; right: number; pair: number; gst: number; delivers: number }>(sql`
    SELECT
      count(*) FILTER (WHERE ${sideFilterSql('left')} AND ${g('gst')} AND ${g('delivers')})::int AS left,
      count(*) FILTER (WHERE ${sideFilterSql('right')} AND ${g('gst')} AND ${g('delivers')})::int AS right,
      count(*) FILTER (WHERE ${sideFilterSql('pair')} AND ${g('gst')} AND ${g('delivers')})::int AS pair,
      count(*) FILTER (WHERE ${g('side')} AND ${gstSql} AND ${g('delivers')})::int AS gst,
      count(*) FILTER (WHERE ${g('side')} AND ${g('gst')} AND ${deliversSql})::int AS delivers
    FROM listings
    WHERE ${whereSql(parts, kinds, [match], ['side', 'gst', 'delivers'])}`);
  const s = scalar[0]!;

  // Conditions.
  const { rows: conditionRows } = await tx.execute<{ id: string; label: string; n: number }>(sql`
    SELECT c.id, c.label, count(*)::int AS n
    FROM listings JOIN conditions c ON c.id = ${listings.conditionId}
    WHERE ${whereSql(parts, kinds, [match], ['conditions'])}
    GROUP BY c.id, c.label, c.sort_order
    ORDER BY c.sort_order, c.label`);

  // States, top 10.
  const { rows: stateRows } = await tx.execute<{ state: string; n: number }>(sql`
    SELECT ${listings.state} AS state, count(*)::int AS n FROM listings
    WHERE ${whereSql(parts, kinds, [match], ['states'])} AND ${listings.state} IS NOT NULL
    GROUP BY ${listings.state}
    ORDER BY n DESC, state
    LIMIT ${STATES_TOP}`);

  // Spec fields of the category in play.
  const specs: SpecFacet[] = [];
  for (const field of specFields) {
    const where = whereSql(parts, kinds, [match], [`spec:${field.key}`]);
    const v = sql`(${listings.specs} -> ${field.key})`;
    if (field.type === 'number') {
      const n = sql`(CASE WHEN jsonb_typeof(${v}) = 'number' THEN (${v})::text::numeric END)`;
      const { rows } = await tx.execute<{ min: string | null; max: string | null }>(sql`
        SELECT min(${n})::text AS min, max(${n})::text AS max FROM listings WHERE ${where}`);
      const r = rows[0];
      specs.push({
        key: field.key,
        label: field.label,
        type: 'number',
        unit: field.unit,
        min: r?.min == null ? null : Number(r.min),
        max: r?.max == null ? null : Number(r.max),
      });
    } else {
      const { rows } = await tx.execute<{ key: string; n: number }>(sql`
        SELECT o.key, count(*)::int AS n
        FROM listings, LATERAL jsonb_array_elements_text(CASE jsonb_typeof(${v})
          WHEN 'array' THEN ${v} WHEN 'string' THEN jsonb_build_array(${v}) ELSE '[]'::jsonb END) AS o(key)
        WHERE ${where}
        GROUP BY o.key`);
      const counts = new Map(rows.map((r) => [r.key, Number(r.n)]));
      specs.push({
        key: field.key,
        label: field.label,
        type: 'select',
        options: field.options.map((o) => ({ key: o.key, label: o.label, count: counts.get(o.key) ?? 0 })),
      });
    }
  }

  return {
    kinds: kindCounts,
    side: { left: Number(s.left), right: Number(s.right), pair: Number(s.pair) },
    conditions: conditionRows.map((r) => ({ id: r.id, label: r.label, count: Number(r.n) })),
    gstVerified: Number(s.gst),
    delivers: Number(s.delivers),
    states: stateRows.map((r) => ({ state: r.state, count: Number(r.n) })),
    specs,
  };
}
