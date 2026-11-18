import type { Specs, TemplateKind } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { checkSpecs, type SpecCheckResult } from '../../lib/spec-check.js';
import { loadTemplate } from './read.service.js';

/**
 * Validates listing specs against a node's effective template for the listing kind: `part` at a part group, `machine` at a
 * machine type. Retired fields and options are loaded so they are reported as `retired`; pass the listing's stored specs as
 * `previousSpecs` when editing so unchanged retired values still pass. Throws NotFoundError at the wrong level, for an unknown
 * id, or when the node or an ancestor is inactive. Pass `allowInactive: true` only when editing a listing that already sits on
 * this node (M5), so a node deactivated since it was listed doesn't block the edit; a new listing never gets it.
 */
export async function validateSpecs(
  db: Db | Tx,
  nodeId: string,
  kind: TemplateKind,
  specs: Specs,
  previousSpecs?: Specs,
  opts: { allowInactive?: boolean } = {},
): Promise<SpecCheckResult> {
  const template = await loadTemplate(db, nodeId, kind, { includeRetired: true, allowInactive: opts.allowInactive ?? false });
  return checkSpecs(template, specs, previousSpecs);
}
