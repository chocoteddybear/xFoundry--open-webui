import { describe, expect, it } from 'vitest';
import {
	createLiveSession,
	failLiveSession,
	markLiveSessionStopped,
	reduceLiveSession,
	tokensPerSecond,
	type LiveSessionState
} from './reducer';
import type { SSEMessage } from './sse';

const step = (id: string, status: string, label?: string, messageId = 'm7'): SSEMessage => ({
	event: 'widget_delta',
	data: { messageId, type: 'step', id, status, ...(label ? { label } : {}) }
});
const metric = (key: string, value: unknown, label?: string): SSEMessage => ({
	event: 'widget_delta',
	data: { messageId: 'm7', type: 'metric', key, value, ...(label ? { label } : {}) }
});
const done: SSEMessage = { event: 'widget_done', data: { messageId: 'm7' } };
const error = (message?: string): SSEMessage => ({
	event: 'widget_error',
	data: { messageId: 'm7', ...(message ? { message } : {}) }
});

const run = (messages: SSEMessage[], state = createLiveSession('A', 'm7', 0)) => {
	const outcomes: string[] = [];
	for (const message of messages) {
		const result = reduceLiveSession(state, message, 1000);
		state = result.state;
		outcomes.push(result.outcome);
	}
	return { state, outcomes };
};

const deepFreeze = <T>(value: T): T => {
	if (value && typeof value === 'object') {
		Object.values(value).forEach(deepFreeze);
		Object.freeze(value);
	}
	return value;
};

const SCRIPT: SSEMessage[] = [
	step('understand', 'running', 'Understanding the question'),
	metric('tokens', 0, 'Tokens'),
	step('understand', 'complete'),
	step('retrieval', 'running', 'Searching docs'),
	metric('sources', 3, 'Sources'),
	step('retrieval', 'complete'),
	metric('tokens', 212, 'Tokens'),
	metric('confidence', 0.82, 'Confidence'),
	done
];

describe('createLiveSession', () => {
	it('starts empty in the starting status', () => {
		const state = createLiveSession('A', 'm7', 5);
		expect(state).toMatchObject({
			chatId: 'A',
			messageId: 'm7',
			status: 'starting',
			steps: [],
			metrics: {},
			error: null,
			startedAt: 5,
			endedAt: null
		});
	});
});

describe('reduceLiveSession', () => {
	it('moves to streaming on the first delta and adds the step', () => {
		const { state, outcomes } = run([step('retrieval', 'running', 'Searching docs')]);
		expect(outcomes).toEqual(['applied']);
		expect(state.status).toBe('streaming');
		expect(state.steps).toEqual([{ id: 'retrieval', label: 'Searching docs', status: 'running' }]);
	});

	it('updates a step in place and keeps its label when the update has none', () => {
		const { state } = run([
			step('a', 'running', 'First'),
			step('b', 'running', 'Second'),
			step('a', 'complete')
		]);
		expect(state.steps).toEqual([
			{ id: 'a', label: 'First', status: 'complete' },
			{ id: 'b', label: 'Second', status: 'running' }
		]);
	});

	it('falls back to the step id when no label was ever sent', () => {
		expect(run([step('draft', 'running')]).state.steps[0].label).toBe('draft');
	});

	it('sets and updates metrics, keeping the first label', () => {
		const { state } = run([metric('tokens', 10, 'Tokens'), metric('tokens', 20)]);
		expect(state.metrics).toEqual({ tokens: { label: 'Tokens', value: 20 } });
	});

	it('finishes the full script', () => {
		const { state, outcomes } = run(SCRIPT);
		expect(outcomes.every((outcome) => outcome === 'applied')).toBe(true);
		expect(state.status).toBe('complete');
		expect(state.endedAt).toBe(1000);
		expect(state.steps.map((s) => s.status)).toEqual(['complete', 'complete']);
		expect(state.metrics.tokens.value).toBe(212);
		expect(state.metrics.confidence.value).toBe(0.82);
	});

	it('marks running steps complete on widget_done', () => {
		const { state } = run([step('draft', 'running'), done]);
		expect(state.steps[0].status).toBe('complete');
	});

	it('stores the error and marks running steps as failed on widget_error', () => {
		const { state } = run([
			step('retrieval', 'complete'),
			step('draft', 'running'),
			error('Upstream timed out')
		]);
		expect(state.status).toBe('error');
		expect(state.error).toBe('Upstream timed out');
		expect(state.retryable).toBe(true);
		expect(state.steps.map((s) => s.status)).toEqual(['complete', 'error']);
	});

	it('uses a default error text when widget_error has no message', () => {
		expect(run([error()]).state.error).toBe('The live session failed');
	});

	describe('duplicates', () => {
		it('ignores a repeated step status and a repeated metric value', () => {
			const { state, outcomes } = run([
				step('a', 'running', 'A'),
				step('a', 'running', 'A'),
				step('a', 'running'),
				metric('tokens', 5),
				metric('tokens', 5)
			]);
			expect(outcomes).toEqual(['applied', 'duplicate', 'duplicate', 'applied', 'duplicate']);
			expect(state.ignored.duplicate).toBe(3);
			expect(state.steps).toHaveLength(1);
		});

		it('gives the same final state when every event arrives twice', () => {
			const once = run(SCRIPT).state;
			const twice = run(SCRIPT.flatMap((message) => [message, message])).state;
			expect({ ...twice, ignored: once.ignored }).toEqual(once);
		});
	});

	it('ignores anything after the session finished', () => {
		const afterDone = run([done, step('late', 'running'), done, error('x')]);
		expect(afterDone.state.status).toBe('complete');
		expect(afterDone.state.steps).toEqual([]);
		expect(afterDone.outcomes.slice(1)).toEqual(['late', 'late', 'late']);

		const afterError = run([error('boom'), done]);
		expect(afterError.state.status).toBe('error');
		expect(afterError.outcomes).toEqual(['applied', 'late']);
	});

	it('counts malformed messages and leaves the state as it was', () => {
		const { state, outcomes } = run([{ event: 'widget_delta', raw: '{"broken', malformed: true }]);
		expect(outcomes).toEqual(['malformed']);
		expect(state.status).toBe('starting');
		expect(state.ignored.malformed).toBe(1);
	});

	it.each([
		['no data', { event: 'widget_delta', data: null }],
		['data is not an object', { event: 'widget_delta', data: 'text' }],
		[
			'missing messageId',
			{ event: 'widget_delta', data: { type: 'step', id: 'a', status: 'running' } }
		],
		['unknown event', { event: 'widget_tick', data: { messageId: 'm7' } }],
		['unknown delta type', { event: 'widget_delta', data: { messageId: 'm7', type: 'log' } }],
		[
			'step without id',
			{ event: 'widget_delta', data: { messageId: 'm7', type: 'step', status: 'running' } }
		],
		['unknown step status', step('a', 'paused')],
		[
			'metric without key',
			{ event: 'widget_delta', data: { messageId: 'm7', type: 'metric', value: 1 } }
		],
		['metric with an object value', metric('tokens', { n: 1 })]
	] as [string, SSEMessage][])('rejects an invalid message: %s', (_, message) => {
		const { state, outcomes } = run([message]);
		expect(outcomes).toEqual(['invalid']);
		expect(state.status).toBe('starting');
		expect(state.ignored.invalid).toBe(1);
	});

	it('ignores events for another message', () => {
		const { state, outcomes } = run([step('a', 'running', 'A', 'm8')]);
		expect(outcomes).toEqual(['other-message']);
		expect(state.steps).toEqual([]);
		expect(state.ignored['other-message']).toBe(1);
	});

	it('never mutates the state it receives', () => {
		const start = deepFreeze(createLiveSession('A', 'm7', 0));
		expect(() =>
			run([...SCRIPT, done, { event: 'x', raw: '', malformed: true }], start)
		).not.toThrow();
		expect(start.status).toBe('starting');
	});
});

describe('failLiveSession', () => {
	it('ends a running session with the given error', () => {
		const running = run([step('draft', 'running')]).state;
		const failed = failLiveSession(running, 'Stopped', 50);
		expect(failed).toMatchObject({ status: 'error', error: 'Stopped', endedAt: 50 });
		expect(failed.steps[0].status).toBe('error');
	});

	it('is retryable by default, and not when the caller says so (Stop, model error)', () => {
		const running = run([step('draft', 'running')]).state;
		expect(failLiveSession(running, 'Network down').retryable).toBe(true);
		expect(failLiveSession(running, 'Stopped', 50, false).retryable).toBe(false);
		expect(createLiveSession('A', 'm7').retryable).toBe(false);
	});

	it('returns a finished session unchanged', () => {
		const finished: LiveSessionState = run(SCRIPT).state;
		expect(failLiveSession(finished, 'Stopped')).toBe(finished);
	});

	it('does not mark the session as stopped', () => {
		const running = run([step('draft', 'running')]).state;
		expect(failLiveSession(running, 'Network down').stopped).toBe(false);
	});
});

describe('markLiveSessionStopped', () => {
	it('ends a running session as stopped and not retryable', () => {
		const running = run([step('draft', 'running')]).state;
		const stopped = markLiveSessionStopped(running, 50);
		expect(stopped).toMatchObject({
			status: 'error',
			error: 'Stopped',
			stopped: true,
			retryable: false,
			endedAt: 50
		});
		expect(stopped.steps[0].status).toBe('error');
	});

	it('returns a finished session unchanged', () => {
		const finished: LiveSessionState = run(SCRIPT).state;
		expect(markLiveSessionStopped(finished)).toBe(finished);
	});
});

describe('tokensPerSecond', () => {
	const withTokens = (value: number | string, startedAt: number, endedAt: number | null) => ({
		...createLiveSession('A', 'm7', startedAt),
		metrics: { tokens: { label: 'Tokens', value } },
		endedAt
	});

	it('averages tokens over the whole session, rounded', () => {
		expect(tokensPerSecond(withTokens(212, 0, 9300))).toBe(23);
	});

	it('uses now while the session is still running', () => {
		expect(tokensPerSecond(withTokens(100, 0, null), 4000)).toBe(25);
	});

	it('is null without a numeric token count or in the first second', () => {
		expect(tokensPerSecond(createLiveSession('A', 'm7', 0), 5000)).toBeNull();
		expect(tokensPerSecond(withTokens('many', 0, 5000))).toBeNull();
		expect(tokensPerSecond(withTokens(0, 0, 5000))).toBeNull();
		expect(tokensPerSecond(withTokens(40, 0, 900))).toBeNull();
	});
});
