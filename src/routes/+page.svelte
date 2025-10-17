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

	let chartData = $derived.by(() => {
		const data = Object.entries(aggregatedByContract).map(([contract, total]) => {
			const stablecoin = stablecoinsMap.get(contract);
			const decimals = stablecoin && 'decimals' in stablecoin ? stablecoin.decimals : 18;
			const symbol = stablecoin && 'symbol' in stablecoin ? stablecoin.symbol : 'Unknown';
			const value = Number(total) / 10 ** decimals;
			return {
				name: symbol,
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
					backgroundColor: 'rgba(255, 255, 255, 0.15)',
					borderColor: 'rgba(255, 255, 255, 0.3)',
					borderWidth: 1,
					borderRadius: 0
				}
			]
		};
	});

	$effect(() => {
		if (chartCanvas && chartData.labels.length > 0) {
			if (!chartInstance) {
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
							backgroundColor: 'rgba(0, 0, 0, 0.95)',
							titleColor: 'rgba(255, 255, 255, 0.8)',
							bodyColor: 'rgba(255, 255, 255, 0.6)',
							borderColor: 'rgba(255, 255, 255, 0.2)',
							borderWidth: 1,
							padding: 8,
							displayColors: false,
							titleFont: {
								family: 'monospace',
								size: 10,
								weight: 'bold'
							},
							bodyFont: {
								family: 'monospace',
								size: 10
							},
							callbacks: {
								label: function (context: any) {
									return 'VOL: ' + formatNumber(context.parsed.y);
								}
							}
						}
						},
						scales: {
							y: {
								beginAtZero: true,
								grid: {
									color: 'rgba(255, 255, 255, 0.05)',
									lineWidth: 1
								},
								ticks: {
									color: 'rgba(255, 255, 255, 0.4)',
									font: {
										family: 'monospace',
										size: 9
									}
								},
								border: {
									color: 'rgba(255, 255, 255, 0.1)'
								}
							},
							x: {
								grid: {
									display: false
								},
								ticks: {
									color: 'rgba(255, 255, 255, 0.4)',
									font: {
										family: 'monospace',
										size: 9
									}
								},
								border: {
									color: 'rgba(255, 255, 255, 0.1)'
								}
							}
						}
					}
				});
			} else {
				chartInstance.data = chartData;
				chartInstance.update('none');
			}
		}
	});

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

<div class="min-h-screen bg-black font-mono">
	<div class="container mx-auto max-w-7xl px-4 py-6">
		<!-- Tactical Frame Top -->
		<div class="absolute left-3 top-3 h-8 w-8 border-l border-t border-white/20"></div>
		<div class="absolute right-3 top-3 h-8 w-8 border-r border-t border-white/20"></div>
		<div class="absolute bottom-3 left-3 h-8 w-8 border-b border-l border-white/20"></div>
		<div class="absolute bottom-3 right-3 h-8 w-8 border-b border-r border-white/20"></div>

		<!-- Header -->
		<div class="mb-6 border-b border-white/5 pb-4">
			<div class="mb-2 flex items-center justify-between">
				<h1 class="text-sm font-semibold tracking-widest text-white/90 uppercase">
					STABLECOIN TRANSFER TRACKER
				</h1>
				<div class="text-[10px] text-white/40">
					Last Update {new Date().toLocaleString('en-US', {
						hour12: false,
						year: 'numeric',
						month: '2-digit',
						day: '2-digit',
						hour: '2-digit',
						minute: '2-digit'
					})}
				</div>
			</div>
			<div class="flex items-center gap-4 text-[10px] uppercase tracking-wider">
				<div class="flex items-center gap-2">
					<span class="text-white/40">Status:</span>
					<span class={isConnected ? 'text-orange-500' : 'text-red-500'}>
						{isConnected ? '● LIVE FEED ACTIVE' : '○ DISCONNECTED'}
					</span>
				</div>
				<div class="h-2 w-px bg-white/10"></div>
				<div class="flex items-center gap-2">
					<span class="text-white/40">Events Processed:</span>
					<span class="text-white/80">{eventCount.toLocaleString()}</span>
				</div>
			</div>
		</div>

		<!-- Intelligence Stats -->
		<div class="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
			<div class="border border-white/5 bg-white/[0.02] p-3">
				<div class="mb-1 flex items-center justify-between">
					<div class="text-[10px] tracking-widest text-white/40 uppercase">Active Targets</div>
					<div class="h-px flex-1 bg-white/5 mx-2"></div>
				</div>
				<div class="text-2xl font-bold tabular-nums text-white/90">
					{Object.keys(aggregatedByContract).length}
				</div>
			</div>
			<div class="border border-white/5 bg-white/[0.02] p-3">
				<div class="mb-1 flex items-center justify-between">
					<div class="text-[10px] tracking-widest text-white/40 uppercase">Total Intercepts</div>
					<div class="h-px flex-1 bg-white/5 mx-2"></div>
				</div>
				<div class="text-2xl font-bold tabular-nums text-white/90">
					{eventCount.toLocaleString()}
				</div>
			</div>
			<div class="border border-white/5 bg-white/[0.02] p-3">
				<div class="mb-1 flex items-center justify-between">
					<div class="text-[10px] tracking-widest text-white/40 uppercase">Live Buffer</div>
					<div class="h-px flex-1 bg-white/5 mx-2"></div>
				</div>
				<div class="text-2xl font-bold tabular-nums text-white/90">{events.length}</div>
			</div>
		</div>

		<!-- Volume Analysis -->
		<div class="mb-4 border border-white/5 bg-white/[0.01]">
			<div class="border-b border-white/5 px-4 py-2">
				<h2 class="text-[11px] font-semibold uppercase tracking-widest text-white/60">
					Transfer Volume Analysis
				</h2>
			</div>

			<div class="px-4 py-4">
				{#if Object.keys(aggregatedByContract).length === 0}
					<div class="flex flex-col items-center gap-2 py-8 text-white/30">
						<div class="text-4xl animate-pulse text-orange-500/60">◉</div>
						<div class="text-[10px] uppercase tracking-widest">
							» Awaiting Intelligence Data...
						</div>
					</div>
				{:else}
					<div class="h-64">
						<canvas bind:this={chartCanvas}></canvas>
					</div>
				{/if}
			</div>
		</div>

		<!-- Target Aggregation -->
		<div class="mb-4 border border-white/5 bg-white/[0.01]">
			<div class="border-b border-white/5 px-4 py-2">
				<h2 class="text-[11px] font-semibold uppercase tracking-widest text-white/60">
					Aggregated Target Values
				</h2>
			</div>

			<div class="overflow-x-auto">
				<table class="w-full">
					<thead>
						<tr class="border-b border-white/5">
							<th class="px-4 py-2 text-left text-[10px] font-medium tracking-widest text-white/40 uppercase">
								Asset ID
							</th>
							<th class="px-4 py-2 text-right text-[10px] font-medium tracking-widest text-white/40 uppercase">
								Total Volume
							</th>
							<th class="px-4 py-2 text-right text-[10px] font-medium tracking-widest text-white/40 uppercase">
								Contract Address
							</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-white/5">
						{#if Object.entries(aggregatedByContract).length === 0}
							<tr>
								<td colspan="3" class="px-4 py-8 text-center text-white/30">
									<div class="flex flex-col items-center gap-2">
										<div class="text-3xl animate-pulse text-orange-500/60">◉</div>
										<span class="text-[10px] uppercase tracking-widest">Scanning for activity...</span>
									</div>
								</td>
							</tr>
						{:else}
							{#each Object.entries(aggregatedByContract) as [contract, total]}
								{@const stablecoin = stablecoinsMap.get(contract)}
								{@const decimals = stablecoin && 'decimals' in stablecoin ? stablecoin.decimals : 18}
								{@const symbol = stablecoin && 'symbol' in stablecoin ? stablecoin.symbol : 'UNKNOWN'}
								{@const coinType = stablecoin && 'type' in stablecoin ? stablecoin.type : 'unidentified'}
								{@const formattedValue = Number(total) / 10 ** decimals}
								{@const isUpdating = updatedContracts.has(contract)}
								<tr
									class="transition-all duration-300 hover:bg-white/[0.02] {isUpdating
										? 'bg-orange-500/5'
										: ''}"
								>
									<td class="px-4 py-2">
										<div class="flex items-center gap-2">
											<div class="flex h-6 w-6 items-center justify-center border border-white/10 text-[10px] font-bold text-white/60">
												{symbol[0]}
											</div>
											<div>
												<div class="text-[11px] font-semibold text-white/80">
													{symbol}
												</div>
												<div class="text-[9px] text-white/30 uppercase">{coinType}</div>
											</div>
										</div>
									</td>
									<td class="px-4 py-2 text-right">
										<div
											class={`text-sm font-semibold tabular-nums transition-colors duration-300 ${isUpdating ? 'text-orange-500' : 'text-white/80'}`}
										>
											{formatNumber(formattedValue)}
										</div>
										<div class="text-[9px] text-white/30">{symbol}</div>
									</td>
									<td class="px-4 py-2 text-right">
										<code class="text-[10px] text-white/50">
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

		<!-- Live Transaction Feed -->
		<div class="border border-white/5 bg-white/[0.01]">
			<div class="border-b border-white/5 px-4 py-2">
				<div class="flex items-center gap-3">
					<h2 class="text-[11px] font-semibold uppercase tracking-widest text-white/60">
						Live Transaction Feed
					</h2>
					<div class="ml-auto text-[9px] text-white/30">
						[Displaying Top 20 Recent Intercepts]
					</div>
				</div>
			</div>

			<div class="overflow-x-auto">
				<table class="w-full">
					<thead>
						<tr class="border-b border-white/5">
							<th class="px-4 py-2 text-left text-[10px] font-medium tracking-widest text-white/40 uppercase">
								Asset
							</th>
							<th class="px-4 py-2 text-left text-[10px] font-medium tracking-widest text-white/40 uppercase">
								Origin
							</th>
							<th class="px-4 py-2 text-left text-[10px] font-medium tracking-widest text-white/40 uppercase">
								Destination
							</th>
							<th class="px-4 py-2 text-right text-[10px] font-medium tracking-widest text-white/40 uppercase">
								Value
							</th>
							<th class="px-4 py-2 text-left text-[10px] font-medium tracking-widest text-white/40 uppercase">
								Timestamp
							</th>
							<th class="px-4 py-2 text-right text-[10px] font-medium tracking-widest text-white/40 uppercase">
								Block#
							</th>
							<th class="px-4 py-2 text-right text-[10px] font-medium tracking-widest text-white/40 uppercase">
								Elapsed
							</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-white/5">
						{#if events.length === 0}
							<tr>
								<td colspan="7" class="px-4 py-8 text-center text-white/30">
									<div class="flex flex-col items-center gap-2">
										<div class="text-3xl animate-pulse text-orange-500/60">◉</div>
										<span class="text-[10px] uppercase tracking-widest">Monitoring transaction stream...</span>
									</div>
								</td>
							</tr>
						{:else}
							{#each events.slice(0, 20) as transfer}
								{@const stablecoin = stablecoinsMap.get(transfer.contract.toLowerCase())}
								{@const decimals = stablecoin && 'decimals' in stablecoin ? stablecoin.decimals : 18}
								{@const symbol = stablecoin && 'symbol' in stablecoin ? stablecoin.symbol : 'UNK'}
								{@const amount = Number(transfer.event.value) / 10 ** decimals}
								{@const formattedTimestamp = formatTimestamp(transfer.timestamp)}
								{@const timeAgo = getTimeAgo(transfer.timestamp)}
								<tr class="transition-all duration-200 hover:bg-white/[0.02]">
									<td class="px-4 py-2">
										<div class="flex items-center gap-2">
											<div class="flex h-5 w-5 items-center justify-center border border-white/10 text-[9px] font-bold text-white/50">
												{symbol[0]}
											</div>
											<span class="text-[10px] font-semibold text-white/70"
												>{symbol}</span
											>
										</div>
									</td>
									<td class="px-4 py-2">
										<code class="text-[10px] text-white/50">
											{transfer.event.from.slice(0, 6)}···{transfer.event.from.slice(-4)}
										</code>
									</td>
									<td class="px-4 py-2">
										<code class="text-[10px] text-white/50">
											{transfer.event.to.slice(0, 6)}···{transfer.event.to.slice(-4)}
										</code>
									</td>
									<td class="px-4 py-2 text-right">
										<div class="text-[11px] font-semibold tabular-nums text-white/70">
											{formatNumber(amount)}
										</div>
									</td>
									<td class="px-4 py-2">
										<div class="text-[10px] text-white/50">{formattedTimestamp}</div>
									</td>
									<td class="px-4 py-2 text-right">
										<div class="text-[10px] tabular-nums text-white/50">
											{transfer.blockNumber.toLocaleString()}
										</div>
									</td>
									<td class="px-4 py-2 text-right">
										<div class="text-[10px] text-white/50">{timeAgo}</div>
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
