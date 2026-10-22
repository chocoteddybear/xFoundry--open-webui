import { get } from 'svelte/store';
import { config } from '$lib/stores';
import { startLiveSession } from './controller';

export const isLiveSessionEnabled = () => get(config)?.features?.enable_live_session_mock === true;

export const startMessageLiveSession = (chatId: string, messageId: string) => {
	if (!chatId || !messageId || !isLiveSessionEnabled()) return;
	void startLiveSession(chatId, messageId, { token: localStorage.token });
};
