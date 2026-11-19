import type { DealAction, DealStatus, MemberRole, PartySide } from '@mpm/shared-types';

/**
 * What one side may do on a deal right now (F6 + F7 spec §9.2, §9.5, §9.6; ported from textile
 * `services/deals/deal-view.ts` `dealActions`, without payments, dispatch or samples). Pure: `now` is the database
 * clock, read by the caller (plan Global constraints, P10).
 *
 * - `agreed`: the seller hands over or cancels, the buyer cancels; both edit the notes.
 * - `handed_over`: the buyer confirms received, or reports a problem until `problem_deadline_at`; the seller reports a
 *   problem until completion (§26 19); both edit the notes; with no cancel request either side requests one; with one,
 *   the requester can clear it and the other side can accept or clear it (§9.5, §27 30).
 * - `disputed`, `completed`, `cancelled`: nothing (support resolves a dispute; the final ones are final).
 * - A `viewer` never acts (R3).
 *
 * `share_contact` and `review` depend on consent and review state, so the Deal record view adds them (`deal-view.ts`).
 */
export type DealActionInput = {
  status: DealStatus;
  problemDeadlineAt: Date | null;
  cancelRequestedSide: PartySide | null;
};

/** The state-machine actions (`share_contact` and `review` are the view's). */
export type DealStepAction = Exclude<DealAction, 'share_contact' | 'review'>;

export function dealActions(deal: DealActionInput, side: PartySide, role: MemberRole, now: Date): DealStepAction[] {
  if (role === 'viewer') return [];
  if (deal.status === 'agreed') {
    return side === 'seller' ? ['hand_over', 'cancel', 'edit_notes'] : ['cancel', 'edit_notes'];
  }
  if (deal.status !== 'handed_over') return [];

  const actions: DealStepAction[] = [];
  if (side === 'buyer') {
    actions.push('confirm_received');
    if (problemWindowOpen(deal, now)) actions.push('report_problem');
  } else {
    actions.push('report_problem');
  }
  actions.push('edit_notes');
  if (deal.cancelRequestedSide === null) actions.push('request_cancel');
  else if (deal.cancelRequestedSide === side) actions.push('clear_cancel_request');
  else actions.push('accept_cancel_request', 'clear_cancel_request');
  return actions;
}

/** The buyer's report window (§9.2): open while `now` is before `problem_deadline_at`. */
export function problemWindowOpen(deal: Pick<DealActionInput, 'problemDeadlineAt'>, now: Date): boolean {
  return deal.problemDeadlineAt !== null && now.getTime() < deal.problemDeadlineAt.getTime();
}
