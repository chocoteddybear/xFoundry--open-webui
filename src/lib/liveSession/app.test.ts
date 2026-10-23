import { afterEach, describe, expect, it, vi } from 'vitest';
import { onLiveSessionFinished } from './app';
import { createLiveSession, failLiveSession, type LiveSessionState } from './reducer';
import { liveSessions, removeLiveSessions, setLiveSession } from './store';

afterEach(() => liveSessions.set({}));

describe('onLiveSessionFinished', () => {
	it('reports each session once, when it finishes', () => {
		const finished: LiveSessionState[] = [];
		const stop = onLiveSessionFinished((state) => finished.push(state));

		const running = createLiveSession('A', 'm1', 0);
		setLiveSession(running);
		expect(finished).toHaveLength(0);

		setLiveSession(failLiveSession(running, 'Network down', 10));
		setLiveSession(createLiveSession('A', 'm2', 0));
		expect(finished.map((state) => state.messageId)).toEqual(['m1']);

		stop();
	});

	it('does not report sessions removed before they finish', () => {
		const onFinished = vi.fn();
		const stop = onLiveSessionFinished(onFinished);
		setLiveSession(createLiveSession('A', 'm1', 0));
		removeLiveSessions('A');
		expect(onFinished).not.toHaveBeenCalled();
		stop();
	});
});
