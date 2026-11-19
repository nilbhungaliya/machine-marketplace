import { describe, expect, it, vi } from 'vitest';

vi.mock('./push', () => ({
  markPushAsked: vi.fn(),
  openPushExplainer: vi.fn(),
  readPushAskState: vi.fn(),
  registerForPush: vi.fn(),
}));

import { markPushAsked, openPushExplainer, readPushAskState } from './push';
import { askPushOnce, PUSH_ASK_TRIGGERS, shouldAskPush } from './push-ask';

const fresh = { asked: false, granted: false, canAskAgain: true };

describe('shouldAskPush (§11.6)', () => {
  it.each(PUSH_ASK_TRIGGERS)('shows the explainer once on %s', (trigger) => {
    expect(shouldAskPush({ trigger, ...fresh })).toBe('explain');
    expect(shouldAskPush({ trigger, ...fresh, asked: true })).toBe('none');
  });

  it('never at app start or for an unknown trigger', () => {
    expect(shouldAskPush({ trigger: 'start', ...fresh })).toBe('none');
    expect(shouldAskPush({ trigger: 'start', ...fresh, granted: true })).toBe('none');
  });

  it('registers quietly when the phone already allows notifications', () => {
    expect(shouldAskPush({ trigger: 'chats', ...fresh, granted: true })).toBe('register');
    expect(shouldAskPush({ trigger: 'chats', asked: true, granted: true, canAskAgain: false })).toBe('register');
  });

  it("doesn't explain after a firm no (Android can't ask again)", () => {
    expect(shouldAskPush({ trigger: 'offer', ...fresh, canAskAgain: false })).toBe('none');
  });
});

describe('askPushOnce', () => {
  it('spends the one ask only when the explainer opened', async () => {
    vi.mocked(readPushAskState).mockResolvedValue(fresh);
    vi.mocked(openPushExplainer).mockReturnValueOnce(false);
    await askPushOnce('publish');
    expect(markPushAsked).not.toHaveBeenCalled();

    vi.mocked(openPushExplainer).mockReturnValueOnce(true);
    await askPushOnce('publish');
    expect(markPushAsked).toHaveBeenCalledTimes(1);
  });
});
