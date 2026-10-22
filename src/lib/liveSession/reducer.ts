import type { SSEMessage } from './sse';

export type LiveStatus = 'starting' | 'streaming' | 'complete' | 'error';
export type StepStatus = 'running' | 'complete' | 'error';

export type LiveStep = { id: string; label: string; status: StepStatus };
export type LiveMetric = { label: string; value: number | string };

export type Outcome = 'applied' | 'duplicate' | 'late' | 'malformed' | 'invalid' | 'other-message';

export type LiveSessionState = {
	chatId: string;
	messageId: string;
	status: LiveStatus;
	steps: LiveStep[];
	metrics: Record<string, LiveMetric>;
	error: string | null;
	startedAt: number;
	endedAt: number | null;
	ignored: Record<Exclude<Outcome, 'applied'>, number>;
};

const STEP_STATUSES: StepStatus[] = ['running', 'complete', 'error'];

export const createLiveSession = (
	chatId: string,
	messageId: string,
	now = Date.now()
): LiveSessionState => ({
	chatId,
	messageId,
	status: 'starting',
	steps: [],
	metrics: {},
	error: null,
	startedAt: now,
	endedAt: null,
	ignored: { duplicate: 0, late: 0, malformed: 0, invalid: 0, 'other-message': 0 }
});

export const isFinished = (state: LiveSessionState) =>
	state.status === 'complete' || state.status === 'error';

const ignore = (state: LiveSessionState, outcome: Exclude<Outcome, 'applied'>) => ({
	state: { ...state, ignored: { ...state.ignored, [outcome]: state.ignored[outcome] + 1 } },
	outcome
});

const applied = (state: LiveSessionState) => ({ state, outcome: 'applied' as const });

const finish = (
	state: LiveSessionState,
	status: 'complete' | 'error',
	error: string | null,
	now: number
): LiveSessionState => ({
	...state,
	status,
	error,
	endedAt: now,
	steps: state.steps.map((step) =>
		step.status === 'running' ? { ...step, status: status === 'complete' ? 'complete' : 'error' } : step
	)
});

export const reduceLiveSession = (
	state: LiveSessionState,
	message: SSEMessage,
	now = Date.now()
): { state: LiveSessionState; outcome: Outcome } => {
	if (isFinished(state)) return ignore(state, 'late');
	if (message.malformed) return ignore(state, 'malformed');

	const data = message.data as Record<string, unknown> | null;
	if (!data || typeof data !== 'object' || typeof data.messageId !== 'string') {
		return ignore(state, 'invalid');
	}
	if (data.messageId !== state.messageId) return ignore(state, 'other-message');

	if (message.event === 'widget_done') return applied(finish(state, 'complete', null, now));

	if (message.event === 'widget_error') {
		const error = typeof data.message === 'string' ? data.message : 'The live session failed';
		return applied(finish(state, 'error', error, now));
	}

	if (message.event !== 'widget_delta') return ignore(state, 'invalid');

	if (data.type === 'step') {
		const { id, label, status } = data;
		if (typeof id !== 'string' || !STEP_STATUSES.includes(status as StepStatus)) {
			return ignore(state, 'invalid');
		}
		const existing = state.steps.find((step) => step.id === id);
		const nextLabel = typeof label === 'string' ? label : (existing?.label ?? id);
		if (existing && existing.status === status && existing.label === nextLabel) {
			return ignore(state, 'duplicate');
		}
		const step: LiveStep = { id, label: nextLabel, status: status as StepStatus };
		const steps = existing
			? state.steps.map((current) => (current.id === id ? step : current))
			: [...state.steps, step];
		return applied({ ...state, status: 'streaming', steps });
	}

	if (data.type === 'metric') {
		const { key, label, value } = data;
		if (typeof key !== 'string' || (typeof value !== 'number' && typeof value !== 'string')) {
			return ignore(state, 'invalid');
		}
		const existing = state.metrics[key];
		if (existing && existing.value === value) return ignore(state, 'duplicate');
		const metric = { label: typeof label === 'string' ? label : (existing?.label ?? key), value };
		return applied({ ...state, status: 'streaming', metrics: { ...state.metrics, [key]: metric } });
	}

	return ignore(state, 'invalid');
};

// For failures that do not come from the stream itself: Stop pressed, network error, server error.
export const failLiveSession = (
	state: LiveSessionState,
	error: string,
	now = Date.now()
): LiveSessionState => (isFinished(state) ? state : finish(state, 'error', error, now));
