import type { Socket } from 'socket.io-client';
import type { Readable } from 'svelte/store';
import { chatLive, setChatLive, socketState } from './store';

type ChatEvent = {
	chat_id?: unknown;
	data?: { type?: unknown; data?: { activeViewers?: unknown; status?: unknown } };
};

export const handleLiveEvent = (event: ChatEvent) => {
	const chatId = event?.chat_id;
	const type = event?.data?.type;
	const data = event?.data?.data;
	if (typeof chatId !== 'string' || !data) return;

	if (type === 'live:presence' && typeof data.activeViewers === 'number') {
		setChatLive(chatId, { activeViewers: data.activeViewers });
	} else if (type === 'live:session_status' && typeof data.status === 'string') {
		setChatLive(chatId, { sessionStatus: data.status });
	}
};

export const bindLiveSocket = (socket: Socket) => {
	socketState.set(socket.connected ? 'connected' : 'offline');

	const onConnect = () => socketState.set('connected');
	const onDisconnect = () => {
		// socket.active is true while socket.io will retry on its own.
		socketState.set(socket.active ? 'reconnecting' : 'offline');
		// Viewer counts are unknown until the chat room is joined again after reconnecting.
		chatLive.set({});
	};
	const onReconnectAttempt = () => socketState.set('reconnecting');
	const onReconnectFailed = () => socketState.set('offline');

	socket.on('connect', onConnect);
	socket.on('disconnect', onDisconnect);
	socket.on('events', handleLiveEvent);
	// Reconnect events are emitted by the Manager (socket.io), not by the Socket itself.
	socket.io.on('reconnect_attempt', onReconnectAttempt);
	socket.io.on('reconnect_failed', onReconnectFailed);

	return () => {
		socket.off('connect', onConnect);
		socket.off('disconnect', onDisconnect);
		socket.off('events', handleLiveEvent);
		socket.io.off('reconnect_attempt', onReconnectAttempt);
		socket.io.off('reconnect_failed', onReconnectFailed);
	};
};

// Follows the app's socket store, so the listeners move to a new socket if the app replaces it.
export const followSocketStore = (store: Readable<Socket | null>) => {
	let unbind = () => {};
	const unsubscribe = store.subscribe((socket) => {
		unbind();
		if (socket) {
			unbind = bindLiveSocket(socket);
		} else {
			unbind = () => {};
			socketState.set('offline');
		}
	});
	return () => {
		unsubscribe();
		unbind();
	};
};
