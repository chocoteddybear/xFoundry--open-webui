import { WEBUI_API_BASE_URL } from '$lib/constants';
import { createSSEParser } from './sse';
import { createLiveSession, failLiveSession, isFinished, reduceLiveSession } from './reducer';
import {
	getLiveSession,
	liveSessionKey,
	removeLiveSessions,
	setLiveSession,
	updateLiveSession
} from './store';

export type StartOptions = {
	token: string;
	faults?: string[];
	fail?: boolean;
	delayMs?: number;
	baseUrl?: string;
};

type Run = { id: number; controller: AbortController };

const runs = new Map<string, Run>();
let nextRunId = 0;

// Every callback checks it still owns the key, so a slow chunk from an aborted or replaced run
// can never write into the widget of a newer run.
const isCurrent = (key: string, run: Run) => runs.get(key) === run;

const fail = (key: string, error: string) =>
	updateLiveSession(key, (state) => failLiveSession(state, error));

export const startLiveSession = async (
	chatId: string,
	messageId: string,
	options: StartOptions
) => {
	const key = liveSessionKey(chatId, messageId);
	runs.get(key)?.controller.abort();

	const run: Run = { id: ++nextRunId, controller: new AbortController() };
	runs.set(key, run);
	setLiveSession(createLiveSession(chatId, messageId));

	const params = new URLSearchParams({ chat_id: chatId, message_id: messageId });
	if (options.faults?.length) params.set('faults', options.faults.join(','));
	if (options.fail) params.set('fail', 'true');
	if (options.delayMs !== undefined) params.set('delay_ms', String(options.delayMs));

	const parser = createSSEParser((message) => {
		if (isCurrent(key, run)) {
			updateLiveSession(key, (state) => reduceLiveSession(state, message).state);
		}
	});

	try {
		const res = await fetch(
			`${options.baseUrl ?? WEBUI_API_BASE_URL}/live-session/stream?${params}`,
			{
				headers: { Accept: 'text/event-stream', authorization: `Bearer ${options.token}` },
				signal: run.controller.signal
			}
		);
		if (!isCurrent(key, run)) return;
		if (!res.ok || !res.body) {
			fail(key, `Live session unavailable (HTTP ${res.status})`);
			return;
		}

		const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
		while (true) {
			const { value, done } = await reader.read();
			if (done || !isCurrent(key, run)) break;
			parser.push(value);
		}
		parser.end();

		const state = getLiveSession(key);
		if (isCurrent(key, run) && state && !isFinished(state)) {
			fail(key, 'The live session ended unexpectedly');
		}
	} catch (error) {
		if (!run.controller.signal.aborted && isCurrent(key, run)) {
			fail(key, 'Lost connection to the live session');
		}
	} finally {
		if (isCurrent(key, run)) runs.delete(key);
	}
};

export const stopLiveSession = (chatId: string, messageId: string, reason = 'Stopped') => {
	const key = liveSessionKey(chatId, messageId);
	const run = runs.get(key);
	if (run) {
		runs.delete(key);
		run.controller.abort();
	}
	fail(key, reason);
};

// Used when the user leaves a chat: streams are closed and their widgets removed, nothing is kept.
export const closeChatLiveSessions = (chatId: string) => {
	for (const [key, run] of runs) {
		if (key.startsWith(`${chatId}:`)) {
			runs.delete(key);
			run.controller.abort();
		}
	}
	removeLiveSessions(chatId);
};

export const isLiveSessionRunning = (chatId: string, messageId: string) =>
	runs.has(liveSessionKey(chatId, messageId));
