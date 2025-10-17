<script lang="ts">
	import { onMount } from 'svelte';
	import type { TransferEvent } from '$lib/indexer/stables.indexer';
	import { stablecoinsMap } from '$lib/config/stablecoins';
	import { Chart, registerables } from 'chart.js';

	Chart.register(...registerables);

	let events = $state<TransferEvent[]>([]);
	let aggregatedByContract = $state<Record<string, bigint>>({});
	let updatedContracts = $state<Set<string>>(new Set());
	let eventCount = $state(0);
	let isConnected = $state(false);

	let chartCanvas: HTMLCanvasElement | undefined = $state();
	let chartInstance: Chart | null = null;

	// Prepare chart data
	let chartData = $derived.by(() => {
		const data = Object.entries(aggregatedByContract).map(([contract, total]) => {
			const stablecoin = stablecoinsMap.get(contract);
			const value = Number(total) / 10 ** (stablecoin?.decimals ?? 0);
			return {
				name: stablecoin?.symbol ?? 'Unknown',
				value: value,
				contract: contract
			};
		});

		return {
			labels: data.map((d) => d.name),
			datasets: [
				{
					label: 'Transfer Volume',
					data: data.map((d) => d.value),
					backgroundColor: 'rgba(59, 130, 246, 0.8)',
					borderColor: 'rgba(59, 130, 246, 1)',
					borderWidth: 1,
					borderRadius: 4
				}
			]
		};
	});

	// Initialize and update chart when canvas or data changes
	$effect(() => {
		if (chartCanvas && chartData.labels.length > 0) {
			if (!chartInstance) {
				// Initialize chart
				chartInstance = new Chart(chartCanvas, {
					type: 'bar',
					data: chartData,
					options: {
						responsive: true,
						maintainAspectRatio: false,
						plugins: {
							legend: {
								display: false
							},
							tooltip: {
								backgroundColor: 'rgba(15, 23, 42, 0.9)',
								titleColor: 'rgba(148, 163, 184, 1)',
								bodyColor: 'rgba(255, 255, 255, 1)',
								borderColor: 'rgba(51, 65, 85, 1)',
								borderWidth: 1,
								padding: 12,
								displayColors: false,
								callbacks: {
									label: function (context: any) {
										return formatNumber(context.parsed.y);
									}
								}
							}
						},
						scales: {
							y: {
								beginAtZero: true,
								grid: {
									color: 'rgba(51, 65, 85, 0.3)'
								},
								ticks: {
									color: 'rgba(148, 163, 184, 1)'
								}
							},
							x: {
								grid: {
									display: false
								},
								ticks: {
									color: 'rgba(148, 163, 184, 1)'
								}
							}
						}
					}
				});
			} else {
				// Update existing chart
				chartInstance.data = chartData;
				chartInstance.update('none');
			}
		}
	});

	// Track value changes for animations
	function highlightUpdate(contract: string) {
		updatedContracts.add(contract);
		updatedContracts = updatedContracts;

		setTimeout(() => {
			updatedContracts.delete(contract);
			updatedContracts = updatedContracts;
		}, 1000);
	}

	onMount(() => {

		const eventSource = new EventSource('/api/stables');

		eventSource.onopen = () => {
			isConnected = true;
		};

		eventSource.onmessage = (event) => {
			const transfers = JSON.parse(event.data) as TransferEvent[];
			eventCount += transfers.length;

			// Aggregate values by contract
			const updated = { ...aggregatedByContract };
			transfers.forEach((transfer) => {
				const contract = transfer.contract.toLowerCase();
				const value = BigInt(transfer.event.value);

				if (!updated[contract]) {
					updated[contract] = 0n;
				}
				updated[contract] += value;
				highlightUpdate(contract);
			});
			aggregatedByContract = updated;

			// Keep only recent events for performance
			events = [...transfers, ...events].slice(0, 100);
		};

		eventSource.onerror = (error) => {
			console.error('EventSource error:', error);
			isConnected = false;
			eventSource.close();
		};

		return () => {
			if (chartInstance) {
				chartInstance.destroy();
			}
			eventSource.close();
		};
	});

	function formatNumber(value: number): string {
		return new Intl.NumberFormat('en-US', {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2
		}).format(value);
	}

	function formatTimestamp(timestamp: Date): string {
		const date = new Date(timestamp);
		const day = date.getDate();
		const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
		const month = months[date.getMonth()];
		const year = date.getFullYear();
		const hours = String(date.getHours()).padStart(2, '0');
		const minutes = String(date.getMinutes()).padStart(2, '0');
		const seconds = String(date.getSeconds()).padStart(2, '0');

		return `${day}-${month}-${year} ${hours}:${minutes}:${seconds}`;
	}

	function getTimeAgo(timestamp: Date): string {
		const now = new Date();
		const diffMs = now.getTime() - new Date(timestamp).getTime();
		const diffSec = Math.floor(diffMs / 1000);
		const diffMin = Math.floor(diffSec / 60);
		const diffHr = Math.floor(diffMin / 60);
		const diffDay = Math.floor(diffHr / 24);

		if (diffSec < 60) return `${diffSec}s ago`;
		if (diffMin < 60) return `${diffMin}m ago`;
		if (diffHr < 24) return `${diffHr}h ago`;
		return `${diffDay}d ago`;
	}
</script>

<div class="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
	<div class="container mx-auto max-w-6xl px-4 py-8">
		<!-- Header -->
		<div class="mb-8">
			<h1
				class="mb-2 bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-4xl font-bold text-transparent text-white"
			>
				Stablecoin Transfer Tracker
			</h1>
			<div class="flex items-center gap-4 text-sm">
				<div class="flex items-center gap-2">
					<div
						class={`h-2 w-2 rounded-full ${isConnected ? 'animate-pulse bg-green-500' : 'bg-red-500'}`}
					></div>
					<span class="text-slate-400">{isConnected ? 'Live' : 'Disconnected'}</span>
				</div>
				<span class="text-slate-500">•</span>
				<span class="text-slate-400">{eventCount.toLocaleString()} events processed</span>
			</div>
		</div>

		<!-- Stats Footer -->
		<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
			<div class="rounded-xl border border-slate-800/30 bg-slate-900/30 px-4 py-3 backdrop-blur-xl">
				<div class="mb-1 text-xs tracking-wider text-slate-500 uppercase">Active Contracts</div>
				<div class="text-2xl font-bold text-white">{Object.keys(aggregatedByContract).length}</div>
			</div>
			<div class="rounded-xl border border-slate-800/30 bg-slate-900/30 px-4 py-3 backdrop-blur-xl">
				<div class="mb-1 text-xs tracking-wider text-slate-500 uppercase">Total Events</div>
				<div class="text-2xl font-bold text-white">{eventCount.toLocaleString()}</div>
			</div>
			<div class="rounded-xl border border-slate-800/30 bg-slate-900/30 px-4 py-3 backdrop-blur-xl">
				<div class="mb-1 text-xs tracking-wider text-slate-500 uppercase">Buffer Size</div>
				<div class="text-2xl font-bold text-white">{events.length}</div>
			</div>
		</div>

		<!-- Bar Chart Card -->
		<div
			class="mt-6 overflow-hidden rounded-2xl border border-slate-800/50 bg-slate-900/50 shadow-2xl backdrop-blur-xl"
		>
			<div class="border-b border-slate-800/50 px-6 py-4">
				<h2 class="text-xl font-semibold text-white">Volume by Asset</h2>
			</div>

			<div class="px-6 py-8">
				{#if Object.keys(aggregatedByContract).length === 0}
					<div class="flex flex-col items-center gap-3 py-12 text-slate-500">
						<div
							class="flex h-12 w-12 items-center justify-center rounded-full bg-slate-800/50"
						>
							<svg
								class="h-6 w-6 text-slate-600"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
								/>
							</svg>
						</div>
						<span>Waiting for transfer data...</span>
					</div>
				{:else}
					<div class="h-80">
						<canvas bind:this={chartCanvas}></canvas>
					</div>
				{/if}
			</div>
		</div>

		<!-- Table Card -->
		<div
			class="mt-6 overflow-hidden rounded-2xl border border-slate-800/50 bg-slate-900/50 shadow-2xl backdrop-blur-xl"
		>
			<div class="border-b border-slate-800/50 px-6 py-4">
				<h2 class="text-xl font-semibold text-white">Aggregated Transfer Values</h2>
			</div>

			<div class="overflow-x-auto">
				<table class="w-full">
					<thead>
						<tr class="border-b border-slate-800/50">
							<th
								class="px-6 py-4 text-left text-xs font-medium tracking-wider text-slate-400 uppercase"
							>
								Asset
							</th>
							<th
								class="px-6 py-4 text-right text-xs font-medium tracking-wider text-slate-400 uppercase"
							>
								Total Volume
							</th>
							<th
								class="px-6 py-4 text-right text-xs font-medium tracking-wider text-slate-400 uppercase"
							>
								Contract
							</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-800/30">
						{#if Object.entries(aggregatedByContract).length === 0}
							<tr>
								<td colspan="3" class="px-6 py-12 text-center text-slate-500">
									<div class="flex flex-col items-center gap-3">
										<div
											class="flex h-12 w-12 items-center justify-center rounded-full bg-slate-800/50"
										>
											<svg
												class="h-6 w-6 text-slate-600"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
												/>
											</svg>
										</div>
										<span>Waiting for transfer events...</span>
									</div>
								</td>
							</tr>
						{:else}
							{#each Object.entries(aggregatedByContract) as [contract, total]}
								{@const stablecoin = stablecoinsMap.get(contract)}
								{@const formattedValue = Number(total) / 10 ** (stablecoin?.decimals ?? 0)}
								{@const isUpdating = updatedContracts.has(contract)}
								<tr
									class="transition-all duration-300 hover:bg-slate-800/30 {isUpdating
										? 'bg-blue-500/10'
										: ''}"
								>
									<td class="px-6 py-4">
										<div class="flex items-center gap-3">
											<div
												class="flex h-10 w-10 items-center justify-center rounded-full border border-blue-500/30 bg-gradient-to-br from-blue-500/20 to-purple-500/20 text-lg font-semibold text-blue-400"
											>
												{stablecoin?.symbol?.[0] ?? '?'}
											</div>
											<div>
												<div class="text-sm font-medium text-white">
													{stablecoin?.symbol ?? 'Unknown'}
												</div>
												<div class="text-xs text-slate-500">{stablecoin?.type ?? contract}</div>
											</div>
										</div>
									</td>
									<td class="px-6 py-4 text-right">
										<div
											class={`text-lg font-semibold transition-colors duration-300 ${isUpdating ? 'text-green-400' : 'text-white'}`}
										>
											{formatNumber(formattedValue)}
										</div>
										<div class="text-xs text-slate-500">{stablecoin?.symbol ?? ''}</div>
									</td>
									<td class="px-6 py-4 text-right">
										<code class="rounded bg-slate-800/50 px-2 py-1 text-xs text-slate-400">
											{contract.slice(0, 6)}...{contract.slice(-4)}
										</code>
									</td>
								</tr>
							{/each}
						{/if}
					</tbody>
				</table>
			</div>
		</div>

		<!-- Latest Transactions Table -->
		<div
			class="mt-6 overflow-hidden rounded-2xl border border-slate-800/50 bg-slate-900/50 shadow-2xl backdrop-blur-xl"
		>
			<div class="border-b border-slate-800/50 px-6 py-4">
				<h2 class="text-xl font-semibold text-white">Latest Transactions</h2>
			</div>

			<div class="overflow-x-auto">
				<table class="w-full">
					<thead>
						<tr class="border-b border-slate-800/50">
							<th
								class="px-6 py-4 text-left text-xs font-medium tracking-wider text-slate-400 uppercase"
							>
								Asset
							</th>
							<th
								class="px-6 py-4 text-left text-xs font-medium tracking-wider text-slate-400 uppercase"
							>
								From
							</th>
							<th
								class="px-6 py-4 text-left text-xs font-medium tracking-wider text-slate-400 uppercase"
							>
								To
							</th>
						<th
							class="px-6 py-4 text-right text-xs font-medium tracking-wider text-slate-400 uppercase"
						>
							Amount
						</th>
						<th
							class="px-6 py-4 text-left text-xs font-medium tracking-wider text-slate-400 uppercase"
						>
							Timestamp
						</th>
						<th
							class="px-6 py-4 text-right text-xs font-medium tracking-wider text-slate-400 uppercase"
						>
							Block
						</th>
						<th
							class="px-6 py-4 text-right text-xs font-medium tracking-wider text-slate-400 uppercase"
						>
							Time
						</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-800/30">
						{#if events.length === 0}
							<tr>
								<td colspan="7" class="px-6 py-12 text-center text-slate-500">
									<div class="flex flex-col items-center gap-3">
										<div
											class="flex h-12 w-12 items-center justify-center rounded-full bg-slate-800/50"
										>
											<svg
												class="h-6 w-6 text-slate-600"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
												/>
											</svg>
										</div>
										<span>Waiting for transactions...</span>
									</div>
								</td>
							</tr>
						{:else}
							{#each events.slice(0, 20) as transfer}
								{@const stablecoin = stablecoinsMap.get(transfer.contract.toLowerCase())}
								{@const amount = Number(transfer.event.value) / 10 ** (stablecoin?.decimals ?? 0)}
								{@const formattedTimestamp = formatTimestamp(transfer.timestamp)}
								{@const timeAgo = getTimeAgo(transfer.timestamp)}
								<tr class="transition-all duration-300 hover:bg-slate-800/30">
									<td class="px-6 py-4">
										<div class="flex items-center gap-2">
											<div
												class="flex h-8 w-8 items-center justify-center rounded-full border border-blue-500/30 bg-gradient-to-br from-blue-500/20 to-purple-500/20 text-sm font-semibold text-blue-400"
											>
												{stablecoin?.symbol?.[0] ?? '?'}
											</div>
											<span class="text-sm font-medium text-white"
												>{stablecoin?.symbol ?? 'Unknown'}</span
											>
										</div>
									</td>
									<td class="px-6 py-4">
										<code class="text-xs text-slate-400">
											{transfer.event.from.slice(0, 6)}...{transfer.event.from.slice(-4)}
										</code>
									</td>
									<td class="px-6 py-4">
										<code class="text-xs text-slate-400">
											{transfer.event.to.slice(0, 6)}...{transfer.event.to.slice(-4)}
										</code>
									</td>
								<td class="px-6 py-4 text-right">
									<div class="text-sm font-semibold text-white">
										{formatNumber(amount)}
									</div>
								</td>
								<td class="px-6 py-4">
									<div class="text-sm text-slate-400">{formattedTimestamp}</div>
								</td>
								<td class="px-6 py-4 text-right">
									<div class="text-sm text-slate-400">
										{transfer.blockNumber.toLocaleString()}
									</div>
								</td>
								<td class="px-6 py-4 text-right">
									<div class="text-sm text-slate-400">{timeAgo}</div>
								</td>
								</tr>
							{/each}
						{/if}
					</tbody>
				</table>
			</div>
		</div>
	</div>
</div>

<style>
	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.5;
		}
	}
</style>
