/**
 * Socket.IO room names, in one place: a mismatch between the room a socket JOINS
 * and the room an emit TARGETS fails silently.
 */

/** One user's sockets (all their devices) on the /user namespace. */
export const userRoom = (userId: string) => `user:${userId}`;

/** Everyone in a business — offers, chats and deals belong to the business. */
export const businessRoom = (businessId: string) => `business:${businessId}`;

/** A chat thread (one listing × one buyer), joined while the thread is open. */
export const threadRoom = (threadId: string) => `thread:${threadId}`;

/** Every admin on the /admin namespace. */
export const ADMIN_ALL_ROOM = 'admin:all';

/** One admin role's sockets, e.g. moderators for a new listing in the queue. */
export const adminRoleRoom = (role: string) => `admin:role:${role}`;

/** One admin's own sockets. */
export const adminUserRoom = (adminId: string) => `admin:user:${adminId}`;
