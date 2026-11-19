import type {
  ApiSuccess, BlockedBusinessItem, ContactPhoneState, ContactPhoneView, ConversationReportReason, InboxFilter, InboxPage, QuickEnquiry, SignedPhoto,
  ThreadDetail, ThreadMessage,
} from '@mpm/shared-types';
import api from './api';

// One function per chat endpoint the app calls (F6 + F7 spec §12.2; `apps/api/src/routes/{threads,blocks,
// contact-phone}.ts`). Errors are axios errors: map them with `lib/f6-errors.ts`. Writes a retry could double take an
// `Idempotency-Key` (one uuid per tap, reused on retry; plan P11).

const data = <T>(p: Promise<{ data: ApiSuccess<T> }>): Promise<T> => p.then((r) => r.data.data);
const idem = (key: string | undefined) => (key ? { headers: { 'Idempotency-Key': key } } : {});

// ─── Threads ───

/** GET /threads → 20 rows a page, keyset cursor, `counts.yourTurn`. */
export function fetchThreads(filter: InboxFilter, archived: boolean, cursor?: string): Promise<InboxPage> {
  return data(api.get<ApiSuccess<InboxPage>>('/threads', { params: { filter, archived: String(archived), ...(cursor ? { cursor } : {}) } }));
}

/** GET /threads/:id → the thread screen (404 `THREAD_NOT_FOUND` for outsiders). */
export function fetchThread(id: string): Promise<ThreadDetail> {
  return data(api.get<ApiSuccess<ThreadDetail>>(`/threads/${id}`));
}

/** GET /threads/:id/messages?before=<seq> → 30 messages, newest first, masked for this reader. */
export function fetchMessages(id: string, before?: string): Promise<ThreadMessage[]> {
  return data(api.get<ApiSuccess<ThreadMessage[]>>(`/threads/${id}/messages`, { params: before ? { before } : {} }));
}

export interface SendMessageBody {
  clientMessageId: string;
  text: string | null;
  photoKeys?: string[];
}

/** POST /threads/:id/messages. `clientMessageId` doubles as the Idempotency-Key: a retry returns the stored message. */
export function sendMessage(id: string, body: SendMessageBody): Promise<ThreadMessage> {
  // Photos are re-encoded on the server before the reply: longer than the default 15 s.
  return data(api.post<ApiSuccess<ThreadMessage>>(`/threads/${id}/messages`, body, { ...idem(body.clientMessageId), timeout: 60_000 }));
}

/** POST /threads/:id/photos/presign → a signed PUT for one photo (300 s). */
export function presignThreadPhoto(id: string, contentType: string, contentLength: number): Promise<{ url: string; key: string; expiresAt: string }> {
  return data(api.post<ApiSuccess<{ url: string; key: string; expiresAt: string }>>(`/threads/${id}/photos/presign`, { contentType, contentLength }));
}

/** GET /threads/:id/messages/:messageId/photos → fresh signed URLs. */
export function fetchMessagePhotos(id: string, messageId: string): Promise<SignedPhoto[]> {
  return data(api.get<ApiSuccess<{ photos: SignedPhoto[] }>>(`/threads/${id}/messages/${messageId}/photos`)).then((r) => r.photos);
}

/** POST /threads/:id/read { seq } → `{ unread }`. Viewers too. */
export function markThreadRead(id: string, seq: string): Promise<{ unread: number }> {
  return data(api.post<ApiSuccess<{ unread: number }>>(`/threads/${id}/read`, { seq }));
}

/** PUT / DELETE /threads/:id/archive (per user; viewers too, P15). */
export function setThreadArchived(id: string, archived: boolean): Promise<{ archived: boolean }> {
  return archived
    ? data(api.put<ApiSuccess<{ archived: boolean }>>(`/threads/${id}/archive`))
    : data(api.delete<ApiSuccess<{ archived: boolean }>>(`/threads/${id}/archive`));
}

/** POST /threads/:id/share-contact → `{ revealed, number }` (§6.6). */
export function shareContact(id: string, idempotencyKey: string): Promise<{ revealed: boolean; number: string | null }> {
  return data(api.post<ApiSuccess<{ revealed: boolean; number: string | null }>>(`/threads/${id}/share-contact`, undefined, idem(idempotencyKey)));
}

/** POST /threads/:id/report (§6.12). `409 REPORT_EXISTS`, `429 REPORT_LIMIT`. */
export function reportThread(id: string, body: { reason: ConversationReportReason; details: string | null; block: boolean }): Promise<{ reported: true }> {
  return data(api.post<ApiSuccess<{ reported: true }>>(`/threads/${id}/report`, body));
}

/** POST /threads/:id/block (§6.11). */
export function blockThread(id: string): Promise<{ blocked: true }> {
  return data(api.post<ApiSuccess<{ blocked: true }>>(`/threads/${id}/block`));
}

// ─── Enquiry (§6.1, §6.3) ───

export interface EnquiryBody {
  quick: QuickEnquiry[];
  quantity: string | null;
  note: string | null;
  fit: { brandId: string; modelId: string | null; year: number | null } | null;
}

/** POST /listings/:id/enquiry → `{ threadId, message }`. */
export function sendEnquiry(listingId: string, body: EnquiryBody, idempotencyKey: string): Promise<{ threadId: string; message: ThreadMessage }> {
  return data(api.post<ApiSuccess<{ threadId: string; message: ThreadMessage }>>(`/listings/${listingId}/enquiry`, body, idem(idempotencyKey)));
}

// ─── Blocks (§6.11) ───

export function fetchBlocks(): Promise<BlockedBusinessItem[]> {
  return data(api.get<ApiSuccess<{ items: BlockedBusinessItem[] }>>('/users/me/blocks')).then((r) => r.items);
}

export function unblockBusiness(businessId: string): Promise<{ blocked: false }> {
  return data(api.delete<ApiSuccess<{ blocked: false }>>(`/users/me/blocks/${businessId}`));
}

// ─── Business contact number (§5.12, owner only) ───

/** GET /businesses/me/contact-phone → the reader's view: the owner gets the number, any other member `canEdit: false`. */
export function fetchContactPhone(): Promise<ContactPhoneView> {
  return data(api.get<ApiSuccess<ContactPhoneView>>('/businesses/me/contact-phone'));
}

/** POST /businesses/me/contact-phone/otp/send { phone } → `{ resendAfter, devCode? }` (devCode outside production). */
export function sendContactPhoneOtp(phone: string): Promise<{ resendAfter: number; devCode?: string }> {
  return data(api.post<ApiSuccess<{ resendAfter: number; devCode?: string }>>('/businesses/me/contact-phone/otp/send', { phone }));
}

export function verifyContactPhone(code: string): Promise<ContactPhoneState> {
  return data(api.post<ApiSuccess<ContactPhoneState>>('/businesses/me/contact-phone/otp/verify', { code }));
}

export function removeContactPhone(): Promise<ContactPhoneState> {
  return data(api.delete<ApiSuccess<ContactPhoneState>>('/businesses/me/contact-phone'));
}
