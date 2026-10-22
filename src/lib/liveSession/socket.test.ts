import { beforeEach, describe, expect, it } from 'vitest';
import { get, writable } from 'svelte/store';
import type { Socket } from 'socket.io-client';
import { bindLiveSocket, followSocketStore, handleLiveEvent } from './socket';
import { chatLive, socketState } from './store';

type Handler = (...args: any[]) => void;

class FakeEmitter {
	handlers = new Map<string, Set<Handler>>();
	on(event: string, handler: Handler) {
		if (!this.handlers.has(event)) this.handlers.set(event, new Set());
		this.handlers.get(event)!.add(handler);
		return this;
	}
	off(event: string, handler: Handler) {
		this.handlers.get(event)?.delete(handler);
		return this;
	}
	fire(event: string, ...args: unknown[]) {
		this.handlers.get(event)?.forEach((handler) => handler(...args));
	}
	count() {
		return [...this.handlers.values()].reduce((total, set) => total + set.size, 0);
	}
}

class FakeSocket extends FakeEmitter {
	connected = false;
	active = true;
	io = new FakeEmitter();
}

const asSocket = (fake: FakeSocket) => fake as unknown as Socket;
const presence = (chatId: string, activeViewers: unknown) => ({
	chat_id: chatId,
	shared: true,
	data: { type: 'live:presence', data: { chatId, activeViewers } }
});
const status = (chatId: string, value: unknown) => ({
	chat_id: chatId,
	shared: true,
	data: { type: 'live:session_status', data: { chatId, status: value } }
});

beforeEach(() => {
	chatLive.set({});
	socketState.set('offline');
});

describe('handleLiveEvent', () => {
	it('stores viewers and session status per chat', () => {
		handleLiveEvent(presence('A', 3));
		handleLiveEvent(status('A', 'streaming'));
		handleLiveEvent(presence('B', 1));
		expect(get(chatLive)).toEqual({
			A: { activeViewers: 3, sessionStatus: 'streaming' },
			B: { activeViewers: 1, sessionStatus: null }
		});
	});

	it('ignores other event types and payloads with the wrong shape', () => {
		handleLiveEvent({ chat_id: 'A', data: { type: 'chat:presence', data: { activeViewers: 2 } } });
		handleLiveEvent(presence('A', '3'));
		handleLiveEvent(status('A', 42));
		handleLiveEvent({ data: { type: 'live:presence', data: { activeViewers: 1 } } });
		handleLiveEvent({ chat_id: 'A' });
		handleLiveEvent(null as never);
		expect(get(chatLive)).toEqual({});
	});
});

describe('bindLiveSocket', () => {
	it('starts from the socket current state', () => {
		const fake = new FakeSocket();
		fake.connected = true;
		bindLiveSocket(asSocket(fake));
		expect(get(socketState)).toBe('connected');
	});

	it('follows connect, disconnect, reconnect attempts and reconnect failure', () => {
		const fake = new FakeSocket();
		bindLiveSocket(asSocket(fake));
		expect(get(socketState)).toBe('offline');

		fake.fire('connect');
		expect(get(socketState)).toBe('connected');

		fake.fire('disconnect', 'transport close');
		expect(get(socketState)).toBe('reconnecting');

		fake.io.fire('reconnect_attempt', 1);
		expect(get(socketState)).toBe('reconnecting');

		fake.io.fire('reconnect_failed');
		expect(get(socketState)).toBe('offline');

		fake.fire('connect');
		expect(get(socketState)).toBe('connected');
	});

	it('is offline after a disconnect that socket.io will not retry', () => {
		const fake = new FakeSocket();
		bindLiveSocket(asSocket(fake));
		fake.active = false;
		fake.fire('disconnect', 'io client disconnect');
		expect(get(socketState)).toBe('offline');
	});

	it('listens for reconnect events on the Manager, not on the socket', () => {
		const fake = new FakeSocket();
		bindLiveSocket(asSocket(fake));
		fake.fire('connect');
		fake.fire('reconnect_attempt', 1);
		expect(get(socketState)).toBe('connected');
		fake.io.fire('reconnect_attempt', 1);
		expect(get(socketState)).toBe('reconnecting');
	});

	it('receives live events and forgets viewer counts on disconnect', () => {
		const fake = new FakeSocket();
		bindLiveSocket(asSocket(fake));
		fake.fire('events', presence('A', 2));
		expect(get(chatLive).A.activeViewers).toBe(2);

		fake.fire('disconnect', 'transport close');
		expect(get(chatLive)).toEqual({});

		fake.fire('connect');
		fake.fire('events', presence('A', 1));
		expect(get(chatLive).A.activeViewers).toBe(1);
	});

	it('removes every listener it added', () => {
		const fake = new FakeSocket();
		const unbind = bindLiveSocket(asSocket(fake));
		expect(fake.count() + fake.io.count()).toBe(5);
		unbind();
		expect(fake.count() + fake.io.count()).toBe(0);
	});
});

describe('followSocketStore', () => {
	it('moves the listeners when the app replaces its socket, and cleans up', () => {
		const first = new FakeSocket();
		const second = new FakeSocket();
		second.connected = true;
		const store = writable<Socket | null>(null);

		const stop = followSocketStore(store);
		expect(get(socketState)).toBe('offline');

		store.set(asSocket(first));
		expect(first.count()).toBe(3);

		store.set(asSocket(second));
		expect(first.count() + first.io.count()).toBe(0);
		expect(get(socketState)).toBe('connected');

		first.fire('disconnect', 'transport close');
		expect(get(socketState)).toBe('connected');

		stop();
		expect(second.count() + second.io.count()).toBe(0);
	});
});
