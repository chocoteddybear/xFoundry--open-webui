<script lang="ts">
	import { getContext, onDestroy } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';

	import { isFinished, type LiveMetric } from '$lib/liveSession/reducer';
	import { chatLiveFor, liveSessionFor, socketState } from '$lib/liveSession/store';
	import Check from '$lib/components/icons/Check.svelte';
	import XMark from '$lib/components/icons/XMark.svelte';
	import ChevronDown from '$lib/components/icons/ChevronDown.svelte';

	const i18n: Writable<i18nType> = getContext('i18n');

	export let chatId: string;
	export let messageId: string;
	export let onRetry: (() => void) | null = null;

	$: session = liveSessionFor(chatId, messageId);
	$: chatInfo = chatLiveFor(chatId);
	$: bodyId = `live-session-${messageId}`;

	let compact = false;
	let userToggled = false;
	$: if ($session?.status === 'complete' && !userToggled) compact = true;

	let now = Date.now();
	let timer: ReturnType<typeof setInterval> | null = null;
	$: running = !!$session && !isFinished($session);
	$: if (running && !timer) {
		timer = setInterval(() => (now = Date.now()), 200);
	} else if (!running && timer) {
		clearInterval(timer);
		timer = null;
	}
	onDestroy(() => timer && clearInterval(timer));

	$: elapsed = $session ? (($session.endedAt ?? now) - $session.startedAt) / 1000 : 0;
	$: currentStep = $session?.steps.find((step) => step.status === 'running') ?? null;

	const STATUS_LABEL = {
		starting: 'Starting',
		streaming: 'Streaming',
		complete: 'Complete',
		error: 'Error'
	};
	const SOCKET_LABEL = {
		connected: 'Live',
		reconnecting: 'Reconnecting',
		offline: 'Offline'
	};

	const formatMetric = (key: string, metric: LiveMetric) => {
		if (key === 'confidence' && typeof metric.value === 'number' && metric.value <= 1) {
			return `${Math.round(metric.value * 100)}%`;
		}
		return typeof metric.value === 'number' ? metric.value.toLocaleString() : metric.value;
	};
</script>

{#if $session}
	<div
		class="my-1.5 w-full max-w-xl rounded-xl border text-xs text-gray-700 dark:text-gray-300 bg-gray-50/70 dark:bg-gray-850/40 {$session.status ===
		'error'
			? 'border-red-200 dark:border-red-900/60'
			: 'border-gray-100 dark:border-gray-800'}"
		role="group"
		aria-label={$i18n.t('Live session')}
		data-status={$session.status}
	>
		<div class="flex items-start gap-2 px-3 py-2">
			<div class="flex flex-1 min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
				<span class="flex items-center gap-1.5 font-medium" aria-live="polite">
					<span class="relative flex size-2">
						{#if $session.status === 'streaming'}
							<span
								class="absolute inline-flex size-full rounded-full bg-blue-400 opacity-60 motion-safe:animate-ping"
							></span>
						{/if}
						<span
							class="relative inline-flex size-2 rounded-full {$session.status === 'starting'
								? 'bg-gray-400 motion-safe:animate-pulse'
								: $session.status === 'streaming'
									? 'bg-blue-500'
									: $session.status === 'complete'
										? 'bg-green-500'
										: 'bg-red-500'}"
						></span>
					</span>
					{$i18n.t(STATUS_LABEL[$session.status])}
				</span>

				<span class="tabular-nums text-gray-500 dark:text-gray-400">{elapsed.toFixed(1)}s</span>

				{#if compact}
					<span class="flex-1 min-w-0 truncate text-gray-500 dark:text-gray-400">
						{#if currentStep}
							{currentStep.label}
						{:else if $session.steps.length}
							{$i18n.t('{{COUNT}} steps', { COUNT: $session.steps.length })}
						{/if}
						{#if $session.metrics.tokens}
							· {$i18n.t('{{COUNT}} tokens', { COUNT: $session.metrics.tokens.value })}
						{/if}
					</span>
				{:else}
					<span class="flex-1"></span>
				{/if}

				<span
					class="flex items-center gap-1 text-gray-500 dark:text-gray-400"
					title={$i18n.t('Realtime connection')}
				>
					<span
						class="inline-flex size-1.5 rounded-full {$socketState === 'connected'
							? 'bg-green-500'
							: $socketState === 'reconnecting'
								? 'bg-yellow-500 motion-safe:animate-pulse'
								: 'bg-red-500'}"
					></span>
					{$i18n.t(SOCKET_LABEL[$socketState])}
				</span>

				<span
					class="text-gray-500 dark:text-gray-400 {$socketState === 'connected'
						? ''
						: 'opacity-50'}"
					title={$chatInfo.sessionStatus
						? $i18n.t('Chat session: {{STATUS}}', { STATUS: $chatInfo.sessionStatus })
						: undefined}
				>
					{#if $socketState === 'connected' && $chatInfo.activeViewers !== null}
						{$i18n.t('{{COUNT}} viewing', { COUNT: $chatInfo.activeViewers })}
					{:else}
						{$i18n.t('Viewers unknown')}
					{/if}
				</span>
			</div>

			<button
				class="shrink-0 p-0.5 -mr-1 rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
				aria-expanded={!compact}
				aria-controls={bodyId}
				aria-label={compact
					? $i18n.t('Show live session details')
					: $i18n.t('Hide live session details')}
				on:click={() => {
					compact = !compact;
					userToggled = true;
				}}
			>
				<ChevronDown
					className="size-3.5 transition {compact ? '' : 'rotate-180'}"
					strokeWidth="2"
				/>
			</button>
		</div>

		{#if !compact}
			<div id={bodyId} class="flex flex-col gap-2 px-3 pb-2.5">
				{#if $session.status === 'starting'}
					<div class="text-gray-500 dark:text-gray-400">
						{$i18n.t('Waiting for the first update…')}
					</div>
				{/if}

				{#if $session.steps.length}
					<ol class="flex flex-col gap-1">
						{#each $session.steps as step (step.id)}
							<li class="flex items-center gap-2">
								{#if step.status === 'running'}
									<span
										class="size-3 shrink-0 rounded-full border-[1.5px] border-blue-500 border-t-transparent motion-safe:animate-spin"
										aria-hidden="true"
									></span>
								{:else if step.status === 'complete'}
									<Check
										className="size-3 shrink-0 text-green-600 dark:text-green-500"
										strokeWidth="3"
									/>
								{:else}
									<XMark
										className="size-3 shrink-0 text-red-600 dark:text-red-500"
										strokeWidth="3"
									/>
								{/if}
								<span class="flex-1 min-w-0 truncate">{step.label}</span>
								<span class="sr-only">{$i18n.t(step.status)}</span>
							</li>
						{/each}
					</ol>
				{/if}

				{#if Object.keys($session.metrics).length}
					<div class="flex flex-wrap gap-1.5">
						{#each Object.entries($session.metrics) as [key, metric] (key)}
							<span
								class="flex items-center gap-1 rounded-md px-1.5 py-0.5 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800"
							>
								<span class="text-gray-500 dark:text-gray-400">{metric.label}</span>
								<span class="font-medium tabular-nums">{formatMetric(key, metric)}</span>
							</span>
						{/each}
					</div>
				{/if}

				{#if $session.status === 'error'}
					<div
						class="flex items-center gap-2 rounded-lg px-2 py-1.5 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400"
						role="alert"
					>
						<span class="flex-1 min-w-0">{$session.error}</span>
						{#if onRetry && $session.retryable}
							<button
								class="shrink-0 px-2 py-0.5 rounded-md font-medium bg-white/70 dark:bg-gray-900/60 hover:bg-white dark:hover:bg-gray-900 transition"
								on:click={onRetry}
							>
								{$i18n.t('Retry')}
							</button>
						{/if}
					</div>
				{/if}
			</div>
		{/if}
	</div>
{/if}
