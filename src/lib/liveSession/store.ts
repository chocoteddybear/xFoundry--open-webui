import { get, readable, writable, type Readable } from 'svelte/store';
import type { LiveSessionState } from './reducer';

export type SocketState = 'connected' | 'reconnecting' | 'offline';
export type ChatLiveInfo = { activeViewers: number | null; sessionStatus: string | null };

const MAX_SESSIONS = 50;
const NO_CHAT_INFO: ChatLiveInfo = Object.freeze({ activeViewers: null, sessionStatus: null });

export const liveSessionKey = (chatId: string, messageId: string) => `${chatId}:${messageId}`;

export const liveSessions = writable<Record<string, LiveSessionState>>({});
export const socketState = writable<SocketState>('offline');
export const chatLive = writable<Record<string, ChatLiveInfo>>({});

// Svelte stores treat every object as changed, so a plain derived() would wake every widget on
// any session's update. This only notifies when the selected entry is a different object.
const select = <S, T>(source: Readable<S>, pick: (value: S) => T): Readable<T> =>
	readable(pick(get(source)), (set) => {
		let last: T | undefined;
		return source.subscribe((value) => {
			const next = pick(value);
			if (next !== last) {
				last = next;
				set(next);
			}
		});
	});

export const setLiveSession = (state: LiveSessionState) => {
	liveSessions.update((sessions) => {
		const next = { ...sessions, [liveSessionKey(state.chatId, state.messageId)]: state };
		const keys = Object.keys(next);
		if (keys.length <= MAX_SESSIONS) return next;
		// Only the newest sessions are kept so a long-lived tab does not grow without limit.
		keys
			.sort((a, b) => next[a].startedAt - next[b].startedAt)
			.slice(0, keys.length - MAX_SESSIONS)
			.forEach((key) => delete next[key]);
		return next;
	});
};

export const updateLiveSession = (
	key: string,
	update: (state: LiveSessionState) => LiveSessionState
) => {
	const current = get(liveSessions)[key];
	if (!current) return;
	const next = update(current);
	if (next !== current) liveSessions.update((sessions) => ({ ...sessions, [key]: next }));
};

export const getLiveSession = (key: string): LiveSessionState | undefined => get(liveSessions)[key];

export const liveSessionFor = (chatId: string, messageId: string): Readable<LiveSessionState | null> =>
	select(liveSessions, (sessions) => sessions[liveSessionKey(chatId, messageId)] ?? null);

export const setChatLive = (chatId: string, info: Partial<ChatLiveInfo>) => {
	chatLive.update((chats) => ({ ...chats, [chatId]: { ...(chats[chatId] ?? NO_CHAT_INFO), ...info } }));
};

export const chatLiveFor = (chatId: string): Readable<ChatLiveInfo> =>
	select(chatLive, (chats) => chats[chatId] ?? NO_CHAT_INFO);
