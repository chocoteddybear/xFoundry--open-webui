import { get } from 'svelte/store';
import { WEBUI_API_BASE_URL } from '$lib/constants';
import { config } from '$lib/stores';
import { startLiveSession } from './controller';
import { isFinished, type LiveSessionState, type LiveSnapshot } from './reducer';
import { liveSessions } from './store';

export const isLiveSessionEnabled = () => get(config)?.features?.enable_live_session_mock === true;

export const startMessageLiveSession = (chatId: string, messageId: string) => {
	if (!chatId || !messageId || !isLiveSessionEnabled()) return;
	void startLiveSession(chatId, messageId, { token: localStorage.token });
};

export const saveLiveSessionSnapshot = async (
	token: string,
	chatId: string,
	messageId: string,
	snapshot: LiveSnapshot
) => {
	const res = await fetch(`${WEBUI_API_BASE_URL}/live-session/snapshot`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', authorization: `Bearer ${token}` },
		body: JSON.stringify({ chat_id: chatId, message_id: messageId, snapshot })
	});
	if (!res.ok) throw new Error(`Saving the live session failed (HTTP ${res.status})`);
};

// Calls `onFinished` once per session when it reaches complete or error. Sessions removed before
// they finish (leaving the chat) are never reported.
export const onLiveSessionFinished = (onFinished: (state: LiveSessionState) => void) => {
	const reported = new Set<string>();
	return liveSessions.subscribe((sessions) => {
		for (const [key, state] of Object.entries(sessions)) {
			if (isFinished(state) && !reported.has(key)) {
				reported.add(key);
				onFinished(state);
			}
		}
	});
};
