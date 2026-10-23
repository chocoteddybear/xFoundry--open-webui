import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import {
	closeChatLiveSessions,
	isLiveSessionRunning,
	startLiveSession,
	stopLiveSession,
	stopMessageLiveSessions
} from './controller';
import { liveSessions } from './store';

const sse = (event: string, data: object) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const step = (messageId: string, id: string, status: string) =>
	sse('widget_delta', { messageId, type: 'step', id, status, label: id });
const tokens = (messageId: string, value: number) =>
	sse('widget_delta', { messageId, type: 'metric', key: 'tokens', label: 'Tokens', value });
const done = (messageId: string) => sse('widget_done', { messageId });

type MockStream = {
	push: (text: string) => void;
	close: () => void;
	aborted: boolean;
	url: string;
	headers: Record<string, string>;
};

// Each fetch call gets a stream the test writes into by hand, so it controls exactly when
// every chunk arrives and can check what happens after abort().
let streams: MockStream[] = [];
let nextStatus = 200;
// When true, abort() does not stop the fake stream: it models chunks that were already on their
// way to the page, which is exactly the case the controller's "current run" check guards.
let deliverAfterAbort = false;

const mockFetch = vi.fn(async (url: string, init: RequestInit) => {
	let controller!: ReadableStreamDefaultController<Uint8Array>;
	const body = new ReadableStream<Uint8Array>({ start: (c) => (controller = c) });
	const stream: MockStream = {
		push: (text) => {
			if (!stream.aborted || deliverAfterAbort) controller.enqueue(new TextEncoder().encode(text));
		},
		close: () => {
			if (!stream.aborted || deliverAfterAbort) controller.close();
		},
		aborted: false,
		url,
		headers: init.headers as Record<string, string>
	};
	init.signal?.addEventListener('abort', () => {
		stream.aborted = true;
		if (!deliverAfterAbort)
			controller.error(new DOMException('The operation was aborted.', 'AbortError'));
	});
	streams.push(stream);
	return new Response(nextStatus === 200 ? body : null, { status: nextStatus });
});

const session = (key: string) => get(liveSessions)[key];
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
const options = { token: 'tkn', baseUrl: 'http://test/api/v1' };

beforeEach(() => {
	streams = [];
	nextStatus = 200;
	deliverAfterAbort = false;
	liveSessions.set({});
	vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
	vi.unstubAllGlobals();
	mockFetch.mockClear();
});

describe('startLiveSession', () => {
	it('creates the session, calls the stream endpoint and applies the events', async () => {
		const running = startLiveSession('A', 'm1', {
			...options,
			faults: ['split', 'duplicate'],
			fail: true,
			delayMs: 0
		});
		expect(session('A:m1').status).toBe('starting');
		await settle();

		const [stream] = streams;
		const url = new URL(stream.url);
		expect(url.pathname).toBe('/api/v1/live-session/stream');
		expect(Object.fromEntries(url.searchParams)).toEqual({
			chat_id: 'A',
			message_id: 'm1',
			faults: 'split,duplicate',
			fail: 'true',
			delay_ms: '0'
		});
		expect(stream.headers.authorization).toBe('Bearer tkn');

		stream.push(step('m1', 'retrieval', 'running'));
		await settle();
		expect(session('A:m1').status).toBe('streaming');
		expect(isLiveSessionRunning('A', 'm1')).toBe(true);

		stream.push(tokens('m1', 42) + done('m1'));
		stream.close();
		await running;
		expect(session('A:m1')).toMatchObject({
			status: 'complete',
			metrics: { tokens: { value: 42 } }
		});
		expect(isLiveSessionRunning('A', 'm1')).toBe(false);
	});

	it('reassembles events split across chunks', async () => {
		const running = startLiveSession('A', 'm1', options);
		await settle();
		const text = step('m1', 'draft', 'running') + done('m1');
		for (let i = 0; i < text.length; i += 3) streams[0].push(text.slice(i, i + 3));
		streams[0].close();
		await running;
		expect(session('A:m1').status).toBe('complete');
	});

	it('shows an error when the server refuses the request', async () => {
		nextStatus = 401;
		await startLiveSession('A', 'm1', options);
		expect(session('A:m1')).toMatchObject({
			status: 'error',
			error: 'Live session unavailable (HTTP 401)',
			retryable: true
		});
	});

	it('shows an error when the stream ends without widget_done', async () => {
		const running = startLiveSession('A', 'm1', options);
		await settle();
		streams[0].push(step('m1', 'draft', 'running'));
		streams[0].close();
		await running;
		expect(session('A:m1')).toMatchObject({
			status: 'error',
			error: 'The live session ended unexpectedly'
		});
	});

	it('shows an error when the network fails', async () => {
		mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
		await startLiveSession('A', 'm1', options);
		expect(session('A:m1')).toMatchObject({
			status: 'error',
			error: 'Lost connection to the live session'
		});
	});

	it('replaces an older run for the same message; late chunks from the old run are ignored', async () => {
		const first = startLiveSession('A', 'm1', options);
		await settle();
		const second = startLiveSession('A', 'm1', options);
		await settle();
		expect(streams[0].aborted).toBe(true);

		streams[0].push(tokens('m1', 999));
		streams[1].push(tokens('m1', 7) + done('m1'));
		streams[1].close();
		await Promise.all([first, second]);
		expect(session('A:m1')).toMatchObject({
			status: 'complete',
			metrics: { tokens: { value: 7 } }
		});
	});

	it('drops chunks the old run still receives after it was replaced', async () => {
		deliverAfterAbort = true;
		const first = startLiveSession('A', 'm1', options);
		await settle();
		const second = startLiveSession('A', 'm1', options);
		await settle();

		streams[0].push(step('m1', 'stale', 'running') + tokens('m1', 999));
		await settle();
		expect(session('A:m1')).toMatchObject({ status: 'starting', steps: [], metrics: {} });

		streams[0].close();
		streams[1].push(done('m1'));
		streams[1].close();
		await Promise.all([first, second]);
		expect(session('A:m1')).toMatchObject({ status: 'complete', steps: [], metrics: {} });
	});

	it('drops chunks that arrive after the chat was closed', async () => {
		deliverAfterAbort = true;
		const running = startLiveSession('A', 'm1', options);
		await settle();
		closeChatLiveSessions('A');
		const restarted = startLiveSession('A', 'm1', options);
		await settle();

		streams[0].push(tokens('m1', 999));
		streams[0].close();
		await running;
		expect(session('A:m1').metrics).toEqual({});

		streams[1].push(done('m1'));
		streams[1].close();
		await restarted;
	});
});

describe('stopLiveSession', () => {
	it('aborts the stream, marks the session stopped and ignores anything sent afterwards', async () => {
		const running = startLiveSession('A', 'm1', options);
		await settle();
		streams[0].push(step('m1', 'draft', 'running'));
		await settle();

		stopLiveSession('A', 'm1');
		streams[0].push(done('m1'));
		await running;

		expect(streams[0].aborted).toBe(true);
		expect(session('A:m1')).toMatchObject({
			status: 'error',
			error: 'Stopped',
			retryable: false,
			stopped: true
		});
		expect(session('A:m1').steps[0].status).toBe('error');
		expect(isLiveSessionRunning('A', 'm1')).toBe(false);
	});

	it('leaves a finished session as it was', async () => {
		const running = startLiveSession('A', 'm1', options);
		await settle();
		streams[0].push(done('m1'));
		streams[0].close();
		await running;
		stopLiveSession('A', 'm1');
		expect(session('A:m1').status).toBe('complete');
	});
});

describe('stopMessageLiveSessions', () => {
	it('stops only the runs for the given message ids, whatever chat they belong to', async () => {
		const a = startLiveSession('local:abc', 'm1', options);
		const b = startLiveSession('B', 'm2', options);
		const c = startLiveSession('B', 'm3', options);
		await settle();

		stopMessageLiveSessions(['m1', 'm2'], 'Ollama: 500');
		await Promise.all([a, b]);

		expect(session('local:abc:m1')).toMatchObject({
			status: 'error',
			error: 'Ollama: 500',
			retryable: false,
			stopped: false
		});
		expect(session('B:m2')).toMatchObject({ status: 'error', error: 'Ollama: 500' });
		expect(streams.map((stream) => stream.aborted)).toEqual([true, true, false]);

		streams[2].push(done('m3'));
		streams[2].close();
		await c;
		expect(session('B:m3').status).toBe('complete');
	});
});

describe('closeChatLiveSessions', () => {
	it('aborts and removes only the sessions of that chat', async () => {
		const a = startLiveSession('A', 'm1', options);
		const b1 = startLiveSession('B', 'm2', options);
		const b2 = startLiveSession('B', 'm3', options);
		await settle();

		closeChatLiveSessions('B');
		await Promise.all([b1, b2]);

		expect(streams.map((stream) => stream.aborted)).toEqual([false, true, true]);
		expect(Object.keys(get(liveSessions))).toEqual(['A:m1']);
		expect(isLiveSessionRunning('A', 'm1')).toBe(true);

		streams[0].push(done('m1'));
		streams[0].close();
		await a;
		expect(session('A:m1').status).toBe('complete');
	});

	it('keeps chats whose id only starts with the same text', async () => {
		const running = startLiveSession('AB', 'm1', options);
		await settle();
		closeChatLiveSessions('A');
		expect(streams[0].aborted).toBe(false);
		streams[0].push(done('m1'));
		streams[0].close();
		await running;
		expect(session('AB:m1').status).toBe('complete');
	});
});
