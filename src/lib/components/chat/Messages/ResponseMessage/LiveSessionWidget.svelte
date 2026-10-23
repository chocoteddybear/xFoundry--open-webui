<script lang="ts">
	import { getContext, onDestroy } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';

	import {
		fromSnapshot,
		isFinished,
		tokensPerSecond,
		type LiveMetric
	} from '$lib/liveSession/reducer';
	import { chatLiveFor, liveSessionFor, socketState } from '$lib/liveSession/store';
	import Check from '$lib/components/icons/Check.svelte';
	import XMark from '$lib/components/icons/XMark.svelte';
	import ChevronDown from '$lib/components/icons/ChevronDown.svelte';
	import ArrowPath from '$lib/components/icons/ArrowPath.svelte';
	import Users from '$lib/components/icons/Users.svelte';

	const i18n: Writable<i18nType> = getContext('i18n');

	export let chatId: string;
	export let messageId: string;
	export let onRetry: (() => void) | null = null;
	// The finished state saved with the message; shown when there is no live session (after a reload).
	export let snapshot: unknown = null;

	$: session = liveSessionFor(chatId, messageId);
	$: view = $session ?? fromSnapshot(chatId, messageId, snapshot);
	$: chatInfo = chatLiveFor(chatId);
	$: bodyId = `live-session-${messageId}`;

	let compact = false;
	let userToggled = false;
	$: if (view && (view.status === 'complete' || !$session) && !userToggled) compact = true;

	let now = Date.now();
	let timer: ReturnType<typeof setInterval> | null = null;
	$: running = !!view && !isFinished(view);
	$: if (running && !timer) {
		timer = setInterval(() => (now = Date.now()), 200);
	} else if (!running && timer) {
		clearInterval(timer);
		timer = null;
	}
	onDestroy(() => timer && clearInterval(timer));

	$: elapsed = view ? ((view.endedAt ?? now) - view.startedAt) / 1000 : 0;
	$: stopped = !!view?.stopped;
	$: failed = view?.status === 'error' && !stopped;
	$: tokens = typeof view?.metrics.tokens?.value === 'number' ? view.metrics.tokens.value : null;
	$: rate = view ? tokensPerSecond(view, now) : null;
	$: quiet = compact && !running;
	$: showConnection = !(quiet && $socketState === 'connected');

	const STATUS_LABEL = {
		starting: 'Starting',
		streaming: 'Streaming',
		complete: 'Complete',
		error: 'Error'
	};

	const formatDuration = (seconds: number) => {
		if (seconds < 60) return `${seconds.toFixed(1)}s`;
		const m = Math.floor(seconds / 60);
		return `${m}m ${String(Math.floor(seconds % 60)).padStart(2, '0')}s`;
	};

	const formatMetric = (key: string, metric: LiveMetric) => {
		if (key === 'confidence' && typeof metric.value === 'number' && metric.value <= 1) {
			return `${Math.round(metric.value * 100)}%`;
		}
		return typeof metric.value === 'number' ? metric.value.toLocaleString() : metric.value;
	};
</script>

{#if view}
	<div
		class="my-1.5 w-full rounded-xl border bg-gray-50/60 dark:bg-gray-850/40 text-xs text-gray-600 dark:text-gray-400 {compact
			? 'border-transparent'
			: 'border-gray-100 dark:border-gray-800'}"
		role="group"
		aria-label={$i18n.t('Live session')}
		data-status={view.status}
	>
		<button
			type="button"
			class="flex min-h-9 w-full items-center gap-2 px-3 py-1 text-left rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
			aria-expanded={!compact}
			aria-controls={bodyId}
			on:click={() => {
				compact = !compact;
				userToggled = true;
			}}
		>
			<span class="flex size-3.5 shrink-0 items-center justify-center" aria-hidden="true">
				{#if view.status === 'starting'}
					<span class="size-1.5 rounded-full bg-gray-400 motion-safe:animate-pulse"></span>
				{:else if view.status === 'streaming'}
					<span
						class="size-3 rounded-full border-[1.5px] border-blue-500/25 border-t-blue-500 motion-safe:animate-spin"
					></span>
				{:else if view.status === 'complete'}
					<Check className="size-3.5 text-gray-400 dark:text-gray-500" strokeWidth="2.5" />
				{:else if stopped}
					<span class="size-2 rounded-[2px] bg-gray-400 dark:bg-gray-500"></span>
				{:else}
					<XMark className="size-3.5 text-red-500" strokeWidth="2.5" />
				{/if}
			</span>

			<span class="flex flex-1 min-w-0 items-baseline gap-1.5 whitespace-nowrap">
				<span
					class="font-medium {failed
						? 'text-red-600 dark:text-red-400'
						: 'text-gray-800 dark:text-gray-200'}"
					aria-live="polite"
				>
					{stopped ? $i18n.t('Stopped') : $i18n.t(STATUS_LABEL[view.status])}
				</span>
				<span class="tabular-nums">{formatDuration(elapsed)}</span>
				{#if compact && tokens !== null}
					<span class="truncate tabular-nums text-gray-500">
						· {$i18n.t('{{COUNT}} tokens', { COUNT: tokens.toLocaleString() })}{rate
							? ` · ${$i18n.t('{{COUNT}} tokens/s', { COUNT: rate })}`
							: ''}
					</span>
				{/if}
			</span>

			{#if showConnection}
				<span
					class="flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 {$socketState ===
					'connected'
						? ''
						: $socketState === 'reconnecting'
							? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
							: 'bg-red-500/10 text-red-600 dark:text-red-400'}"
					title={$chatInfo.sessionStatus
						? $i18n.t('Chat session: {{STATUS}}', { STATUS: $chatInfo.sessionStatus })
						: $i18n.t('Realtime connection')}
				>
					{#if $socketState === 'connected'}
						<span class="size-1.5 rounded-full bg-green-500" aria-hidden="true"></span>
						<span class="sr-only">{$i18n.t('Connected')},</span>
						<Users className="size-3.5 ml-0.5" strokeWidth="1.75" />
						<span class="tabular-nums">
							{#if $chatInfo.activeViewers !== null}
								{$chatInfo.activeViewers}<span class="max-sm:hidden">{' '}{$i18n.t('viewing')}</span
								>
							{:else}
								{$i18n.t('Viewers unknown')}
							{/if}
						</span>
					{:else}
						<span
							class="size-1.5 rounded-full {$socketState === 'reconnecting'
								? 'bg-amber-500 motion-safe:animate-pulse'
								: 'bg-red-500'}"
							aria-hidden="true"
						></span>
						{$socketState === 'reconnecting' ? $i18n.t('Reconnecting…') : $i18n.t('Offline')}
					{/if}
				</span>
			{/if}

			<ChevronDown
				className="size-3.5 shrink-0 text-gray-400 transition-transform {compact
					? ''
					: 'rotate-180'}"
				strokeWidth="2"
			/>
			<span class="sr-only">
				{compact ? $i18n.t('Show live session details') : $i18n.t('Hide live session details')}
			</span>
		</button>

		{#if !compact}
			<div id={bodyId} class="flex flex-col gap-3 px-3 pb-3">
				{#if view.status === 'starting'}
					<div class="flex flex-col gap-1.5 pl-[1.375rem]" aria-hidden="true">
						<span
							class="h-2 w-40 rounded-full bg-gray-200/80 dark:bg-gray-800 motion-safe:animate-pulse"
						></span>
						<span
							class="h-2 w-24 rounded-full bg-gray-200/80 dark:bg-gray-800 motion-safe:animate-pulse"
						></span>
					</div>
					<span class="sr-only">{$i18n.t('Waiting for the first update…')}</span>
				{/if}

				{#if view.steps.length}
					<ol class="flex flex-col">
						{#each view.steps as step, i (step.id)}
							<li class="relative flex items-center gap-2 py-[3px]">
								{#if i < view.steps.length - 1}
									<span
										class="absolute left-[6.5px] top-[17px] h-[calc(100%-12px)] w-px bg-gray-200 dark:bg-gray-700"
										aria-hidden="true"
									></span>
								{/if}
								<span class="flex size-3.5 shrink-0 items-center justify-center" aria-hidden="true">
									{#if step.status === 'running'}
										<span
											class="size-3 rounded-full border-[1.5px] border-blue-500/25 border-t-blue-500 motion-safe:animate-spin"
										></span>
									{:else if step.status === 'complete'}
										<Check className="size-3 text-gray-400 dark:text-gray-500" strokeWidth="2.5" />
									{:else if stopped}
										<span class="size-1.5 rounded-full bg-gray-300 dark:bg-gray-600"></span>
									{:else}
										<XMark className="size-3 text-red-500" strokeWidth="2.5" />
									{/if}
								</span>
								<span
									class="flex-1 min-w-0 truncate {step.status === 'running'
										? 'text-gray-900 dark:text-gray-100'
										: step.status === 'error' && !stopped
											? 'text-red-600 dark:text-red-400'
											: ''}">{step.label}</span
								>
								<span class="sr-only"
									>{$i18n.t(stopped && step.status === 'error' ? 'stopped' : step.status)}</span
								>
							</li>
						{/each}
					</ol>
				{/if}

				{#if Object.keys(view.metrics).length}
					<dl
						class="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-x-3 gap-y-2 border-t border-gray-100 dark:border-gray-800 pt-2.5"
					>
						{#each Object.entries(view.metrics) as [key, metric] (key)}
							<div class="flex flex-col-reverse">
								<dt class="text-[11px] text-gray-500">{metric.label}</dt>
								<dd class="text-sm font-medium tabular-nums text-gray-900 dark:text-gray-100">
									{formatMetric(key, metric)}
								</dd>
							</div>
						{/each}
						{#if rate}
							<div class="flex flex-col-reverse">
								<dt
									class="text-[11px] text-gray-500"
									title={$i18n.t('Average over the whole session')}
								>
									{$i18n.t('Avg tokens/s')}
								</dt>
								<dd class="text-sm font-medium tabular-nums text-gray-900 dark:text-gray-100">
									{rate}
								</dd>
							</div>
						{/if}
					</dl>
				{/if}

				{#if failed}
					<div class="flex items-center gap-3 text-red-600 dark:text-red-400" role="alert">
						<span class="flex-1 min-w-0">{view.error}</span>
						{#if onRetry && view.retryable}
							<button
								type="button"
								class="flex shrink-0 items-center gap-1 rounded-lg border border-gray-200 dark:border-gray-700 px-2 py-1 font-medium text-gray-800 dark:text-gray-200 hover:bg-white dark:hover:bg-gray-800 transition"
								on:click={onRetry}
							>
								<ArrowPath className="size-3" strokeWidth="2" />
								{$i18n.t('Retry')}
							</button>
						{/if}
					</div>
				{:else if stopped}
					<div class="text-gray-500">{$i18n.t('Stopped before the answer finished.')}</div>
				{/if}
			</div>
		{/if}
	</div>
{/if}
