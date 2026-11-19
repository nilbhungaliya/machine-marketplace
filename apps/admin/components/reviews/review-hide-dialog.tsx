'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { ReasonDialog } from '@/components/ui/reason-dialog';
import { explainReviewError, moderateReview, type ReviewModerationAction } from '@/lib/reviews-admin-api';

export interface ModeratedReview {
  id: string;
  hidden: boolean;
  replyText: string | null;
  replyHidden: boolean;
}

const optionCls =
  'flex cursor-pointer items-start gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60';

/**
 * Hide a review, or only the seller's reply to it, or unhide a hidden review (F6 + F7 spec §10.6), with a reason
 * (3–500, audit-logged). A hidden review leaves the seller's score at once and shows its author "Hidden by our team".
 * Moderators only (the API's role). Mount it only while open.
 */
export function ReviewHideDialog({ review, onClose, onDone }: {
  review: ModeratedReview;
  onClose: () => void;
  /** After a change, or a refusal that means the review changed meanwhile: reload. */
  onDone: () => void;
}) {
  const canHideReply = !review.hidden && review.replyText !== null && !review.replyHidden;
  const [action, setAction] = useState<ReviewModerationAction>(review.hidden ? 'unhide' : 'hide');

  return (
    <ReasonDialog
      title={review.hidden ? 'Unhide this review' : 'Hide this review'}
      description={review.hidden
        ? 'It shows again on the seller’s page and counts in the score.'
        : 'Hiding the review takes it out of the seller’s score at once. Hiding only the reply keeps the review.'}
      submitLabel={action === 'unhide' ? 'Unhide review' : action === 'hide_reply' ? 'Hide reply' : 'Hide review'}
      submitVariant={action === 'unhide' ? 'primary' : 'danger'}
      onClose={onClose}
      onSubmit={async (reason) => {
        try {
          await moderateReview(review.id, action, reason);
          toast.success(action === 'unhide' ? 'Review shown again' : action === 'hide_reply' ? 'Reply hidden' : 'Review hidden');
        } catch (err) {
          const { message, stale } = explainReviewError(err);
          toast.error(message);
          if (!stale) return false;
        }
        onDone();
        return true;
      }}
    >
      {!review.hidden && (
        <fieldset>
          <legend className="sr-only">What to hide</legend>
          <div className="grid gap-2">
            <label className={optionCls}>
              <input type="radio" name="review-hide" className="mt-1" checked={action === 'hide'} onChange={() => setAction('hide')} />
              <span>
                <span className="block font-bold text-gray-900">Hide the review</span>
                <span className="block text-[13px] text-gray-600">With its reply.</span>
              </span>
            </label>
            <label className={optionCls}>
              <input
                type="radio"
                name="review-hide"
                className="mt-1"
                checked={action === 'hide_reply'}
                disabled={!canHideReply}
                onChange={() => setAction('hide_reply')}
              />
              <span>
                <span className="block font-bold text-gray-900">Hide only the reply</span>
                <span className="block text-[13px] text-gray-600">
                  {review.replyText === null ? 'The seller hasn’t replied.' : review.replyHidden ? 'The reply is already hidden.' : 'The review stays.'}
                </span>
              </span>
            </label>
          </div>
        </fieldset>
      )}
    </ReasonDialog>
  );
}
