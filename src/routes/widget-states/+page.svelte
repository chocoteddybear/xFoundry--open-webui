<script lang="ts">
	// Demo-only page (demo/deploy branch): every Live Session Widget state on one screen, plus
	// buttons that play the real mock SSE stream through the real parser, reducer and store.
	import { onMount } from 'svelte';
	import LiveSessionWidget from '$lib/components/chat/Messages/ResponseMessage/LiveSessionWidget.svelte';
	import { createLiveSession, failLiveSession, reduceLiveSession } from '$lib/liveSession/reducer';
	import { startLiveSession } from '$lib/liveSession/controller';
	import {
		setChatLive,
		setLiveSession,
		socketState,
		type SocketState
	} from '$lib/liveSession/store';
	import type { SSEMessage } from '$lib/liveSession/sse';

	const CHAT = 'widget-states';

	const step = (messageId: string, id: string, status: string, label?: string): SSEMessage => ({
		event: 'widget_delta',
		data: { messageId, type: 'step', id, status, label }
	});
	const metric = (messageId: string, key: string, label: string, value: number): SSEMessage => ({
		event: 'widget_delta',
		data: { messageId, type: 'metric', key, label, value }
	});
	const build = (messageId: string, messages: SSEMessage[], ageMs: number) => {
		let state = createLiveSession(CHAT, messageId, Date.now() - ageMs);
		for (const message of messages) state = reduceLiveSession(state, message).state;
		return state;
	};

	const STATES = [
		{ id: 'starting', title: 'Starting', note: 'Request sent, waiting for the first event.' },
		{ id: 'streaming', title: 'Streaming', note: 'Steps and metrics arrive live.' },
		{
			id: 'complete',
			title: 'Complete',
			note: 'Collapses itself to one line; click the arrow to expand.'
		},
		{
			id: 'error',
			title: 'Error (stream failed)',
			note: 'The widget stream failed, so Retry is offered.'
		},
		{
			id: 'stopped',
			title: 'Stopped',
			note: 'The user pressed Stop; Regenerate is the action, not Retry.'
		}
	];

	const SOCKET_STATES: SocketState[] = ['connected', 'reconnecting', 'offline'];

	const LIVE_RUNS = [
		{ label: 'Normal stream', options: {} },
		{ label: 'Broken data', options: { faults: ['split', 'malformed', 'duplicate'] } },
		{ label: 'Fails halfway', options: { fail: true } }
	];

	const playLive = (options: { faults?: string[]; fail?: boolean }) => {
		void startLiveSession(CHAT, 'live', {
			token: localStorage.token ?? '',
			delayMs: 500,
			...options
		});
	};

	onMount(() => {
		socketState.set('connected');
		setChatLive(CHAT, { activeViewers: 2, sessionStatus: 'streaming' });
		setLiveSession(createLiveSession(CHAT, 'starting'));
		setLiveSession(
			build(
				'streaming',
				[
					step('streaming', 'understand', 'complete', 'Understanding the question'),
					step('streaming', 'retrieval', 'running', 'Searching docs'),
					metric('streaming', 'tokens', 'Tokens', 74),
					metric('streaming', 'sources', 'Sources', 3)
				],
				4200
			)
		);
		setLiveSession(
			build(
				'complete',
				[
					step('complete', 'understand', 'complete', 'Understanding the question'),
					step('complete', 'retrieval', 'complete', 'Searching docs'),
					step('complete', 'draft', 'complete', 'Drafting the answer'),
					metric('complete', 'tokens', 'Tokens', 212),
					metric('complete', 'sources', 'Sources', 3),
					metric('complete', 'confidence', 'Confidence', 0.82),
					{ event: 'widget_done', data: { messageId: 'complete' } }
				],
				9300
			)
		);
		setLiveSession(
			build(
				'error',
				[
					step('error', 'understand', 'complete', 'Understanding the question'),
					step('error', 'draft', 'running', 'Drafting the answer'),
					metric('error', 'tokens', 'Tokens', 38),
					{ event: 'widget_error', data: { messageId: 'error', message: 'Upstream timed out' } }
				],
				6100
			)
		);
		setLiveSession(
			failLiveSession(
				build('stopped', [step('stopped', 'draft', 'running', 'Drafting the answer')], 2500),
				'Stopped',
				Date.now(),
				false
			)
		);
	});
</script>

<svelte:head>
	<title>Live Session Widget states</title>
</svelte:head>

<div
	class="h-screen overflow-y-auto bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-4 py-6 sm:px-6"
>
	<div class="max-w-3xl mx-auto flex flex-col gap-8">
		<header class="flex flex-col gap-2">
			<h1 class="text-xl font-semibold">Live Session Widget — states</h1>
			<p class="text-sm text-gray-600 dark:text-gray-400">
				Every state of the widget on one page. The cards below use fixed example data; the “Live”
				section plays the real mock stream from the backend through the real parser, reducer and
				store. In a chat, the widget appears under each new assistant answer.
			</p>
		</header>

		<section class="flex flex-wrap items-center gap-2 text-sm">
			<span class="font-medium">WebSocket state:</span>
			{#each SOCKET_STATES as state}
				<button
					class="px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 {$socketState ===
					state
						? 'bg-gray-100 dark:bg-gray-800'
						: ''}"
					aria-pressed={$socketState === state}
					on:click={() => socketState.set(state)}>{state}</button
				>
			{/each}
			<button
				class="ml-auto px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700"
				on:click={() => document.documentElement.classList.toggle('dark')}>Toggle dark mode</button
			>
		</section>

		<section class="flex flex-col gap-3">
			<h2 class="font-semibold">Live — real mock stream</h2>
			<p class="text-sm text-gray-600 dark:text-gray-400">
				Needs an Open WebUI login in this browser. “Broken data” sends split chunks, malformed JSON
				and duplicates; the widget must still finish cleanly. “Fails halfway” ends with an error and
				offers Retry.
			</p>
			<div class="flex flex-wrap gap-2">
				{#each LIVE_RUNS as run}
					<button
						class="px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-900 text-white dark:bg-white dark:text-gray-900"
						on:click={() => playLive(run.options)}>{run.label}</button
					>
				{/each}
			</div>
			<LiveSessionWidget chatId={CHAT} messageId="live" onRetry={() => playLive({})} />
		</section>

		{#each STATES as state}
			<section class="flex flex-col gap-1">
				<h2 class="font-semibold">{state.title}</h2>
				<p class="text-sm text-gray-600 dark:text-gray-400">{state.note}</p>
				<LiveSessionWidget chatId={CHAT} messageId={state.id} onRetry={() => playLive({})} />
			</section>
		{/each}
	</div>
</div>
