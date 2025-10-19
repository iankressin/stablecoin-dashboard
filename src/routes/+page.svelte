<script lang="ts">
	import { onMount } from 'svelte';
	import type { TransferEvent } from '$lib/indexer/stables.indexer';
	import { stablecoinsMap, stableId, stablecoins, type Network } from '$lib/config/stablecoins';
	import { Chart, registerables } from 'chart.js';
	import 'chartjs-adapter-date-fns';
	import { networks } from '$lib/config/network';

	Chart.register(...registerables);

	let events = $state<TransferEvent[]>([]);
	let aggregatedByContract = $state<Record<string, bigint>>({});
	let updatedContracts = $state<Set<string>>(new Set());
	let eventCount = $state(0);
	let isConnected = $state(false);
	let selectedNetwork = $state<Network | 'all'>('all');
	let previousSelectedNetwork = $state<Network | 'all'>('all');

	// Time-based tracking
	let volumeTimeline = $state<Array<{timestamp: number, volume: bigint, network: Network}>>([]);
	let minuteBuckets = $state<Record<string, bigint>>({}); // key: "YYYY-MM-DD HH:mm"

	// Network metrics
	let volumeByNetwork = $state<Record<Network, bigint>>({
		'ethereum-mainnet': 0n,
		'base-mainnet': 0n
	});
	let transactionsByNetwork = $state<Record<Network, number>>({
		'ethereum-mainnet': 0,
		'base-mainnet': 0
	});

	// Address tracking
	let uniqueAddresses = $state<Set<string>>(new Set());
	let addressVolumes = $state<Record<string, bigint>>({});

	// Reactive count for UI display
	let uniqueAddressCount = $derived(uniqueAddresses.size);

	// Velocity metrics
	let lastMinuteEvents = $state<TransferEvent[]>([]);
	let largestTransfer = $state<{value: bigint, symbol: string, timestamp: Date} | null>(null);

	// Total volume tracking (for accurate averages)
	let totalVolumeUSD = $state<number>(0);
	let totalTransactionsCount = $state<number>(0);

	// Per-network USD volume tracking (for consistent averages)
	let volumeByNetworkUSD = $state<Record<Network, number>>({
		'ethereum-mainnet': 0,
		'base-mainnet': 0
	});

	// Historical average transaction sizes for line charts
	let avgTransactionHistory = $state<Record<Network, Array<{timestamp: number, avgSize: number}>>>({
		'ethereum-mainnet': [],
		'base-mainnet': []
	});

	let chartCanvas: HTMLCanvasElement | undefined = $state();
	let chartInstance: Chart | null = null;
	const baseMainnet = stablecoinsMap('base-mainnet');
	const ethereumMainnet = stablecoinsMap('ethereum-mainnet');

	let chartData = $derived.by(() => {
		// Filter aggregated data based on selected network
		const filteredData = Object.entries(aggregatedByContract).filter(([key, _]) => {
			if (selectedNetwork === 'all') {
				// For 'all' mode, keys are in format "stableId:USDC" or "network:contract"
				return true;
			} else {
				// For specific network mode, keys are in format "network:contract"
				return key.startsWith(`${selectedNetwork}:`);
			}
		});

		const data = filteredData.map(([key, total]) => {
			let stablecoin;
			let contract;

			if (selectedNetwork === 'all') {
				if (key.startsWith('stableId:')) {
					// For 'all' mode with stableId, find any matching stablecoin
					const stableIdValue = key.split(':')[1];
					const allStablecoins = [...baseMainnet.values(), ...ethereumMainnet.values()];
					stablecoin = allStablecoins.find(coin => stableId('base-mainnet', coin.address) === stableIdValue || stableId('ethereum-mainnet', coin.address) === stableIdValue);
					contract = stablecoin?.address || key;
				} else {
					// For 'all' mode without stableId, key is "network:contract"
					contract = key.split(':')[1];
					const network = key.split(':')[0] as Network;
					const networkMap = network === 'base-mainnet' ? baseMainnet : ethereumMainnet;
					stablecoin = networkMap.get(contract);
				}
			} else {
				// For specific network mode, key is "network:contract"
				contract = key.split(':')[1];
				const networkMap = selectedNetwork === 'base-mainnet' ? baseMainnet : ethereumMainnet;
				stablecoin = networkMap.get(contract);
			}

			const decimals = stablecoin && 'decimals' in stablecoin ? stablecoin.decimals : 18;
			const symbol = stablecoin && 'symbol' in stablecoin ? stablecoin.symbol : 'Unknown';
			const value = Number(total) / 10 ** decimals;
			return {
				name: symbol,
				value: Math.max(value, 0.01), // Ensure minimum value for log scale
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

	// Cross-chain comparisons
	let networkDistribution = $derived.by(() => {
		const total = Object.values(volumeByNetworkUSD).reduce((sum, v) => sum + v, 0);
		return Object.entries(volumeByNetworkUSD).map(([network, volume]) => ({
			network,
			percentage: total > 0 ? (volume / total) * 100 : 0
		}));
	});

	let networkActivityDistribution = $derived.by(() => {
		const total = Object.values(transactionsByNetwork).reduce((sum, v) => sum + v, 0);
		return Object.entries(transactionsByNetwork).map(([network, count]) => ({
			network,
			percentage: total > 0 ? (count / total) * 100 : 0,
			count
		}));
	});

	let averageVolumePerTransaction = $derived.by(() => {
		const totalTransactions = Object.values(transactionsByNetwork).reduce((sum, v) => sum + v, 0);
		if (totalTransactions === 0) return 0;

		// Use the tracked total volume and transaction count
		return totalVolumeUSD / totalTransactions;
	});

	// Velocity metrics
	let transactionsPerMinute = $derived.by(() => {
		const now = Date.now();
		const oneMinuteAgo = now - 60000;
		return lastMinuteEvents.filter(e => new Date(e.timestamp).getTime() > oneMinuteAgo).length;
	});

	let averageTransactionSize = $derived.by(() => {
		if (lastMinuteEvents.length === 0) return 0;
		const totalVolume = lastMinuteEvents.reduce((sum, event) => {
			const decimals = getDecimals(event.network, event.contract);
			return sum + Number(event.event.value) / (10 ** decimals);
		}, 0);
		return totalVolume / lastMinuteEvents.length;
	});

	let volumeRate = $derived.by(() => {
		const now = Date.now();
		const oneMinuteAgo = now - 60000;
		const recentEvents = lastMinuteEvents.filter(e => new Date(e.timestamp).getTime() > oneMinuteAgo);
		return recentEvents.reduce((sum, event) => {
			const decimals = getDecimals(event.network, event.contract);
			return sum + Number(event.event.value) / (10 ** decimals);
		}, 0);
	});

	// Reset stats when network selection changes
	$effect(() => {
		if (selectedNetwork !== previousSelectedNetwork) {
			// Clear aggregated data
			aggregatedByContract = {};
			updatedContracts = new Set();
			eventCount = 0;
			events = [];

			// Clear new metrics
			volumeTimeline = [];
			minuteBuckets = {};
			volumeByNetwork = {
				'ethereum-mainnet': 0n,
				'base-mainnet': 0n
			};
			transactionsByNetwork = {
				'ethereum-mainnet': 0,
				'base-mainnet': 0
			};
			volumeByNetworkUSD = {
				'ethereum-mainnet': 0,
				'base-mainnet': 0
			};
			avgTransactionHistory = {
				'ethereum-mainnet': [],
				'base-mainnet': []
			};
			// Clear chart instances
			Object.values(chartInstances).forEach(chart => {
				if (chart) chart.destroy();
			});
			chartInstances = {
				'ethereum-mainnet': null,
				'base-mainnet': null
			};
			// Don't reset unique addresses - they should be global across all networks
			// uniqueAddresses = new Set();
			// addressVolumes = {};
			lastMinuteEvents = [];
			largestTransfer = null;
			totalVolumeUSD = 0;
			totalTransactionsCount = 0;

			// Destroy and recreate chart for network switch
			if (chartInstance) {
				chartInstance.destroy();
				chartInstance = null;
			}

			// Update previous selection
			previousSelectedNetwork = selectedNetwork;
		}
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
									const actualValue = context.parsed.y;
									return 'VOL: ' + formatNumber(actualValue);
								}
							}
						}
						},
						scales: {
							y: {
								type: 'logarithmic',
								min: 1,
								grid: {
									color: 'rgba(255, 255, 255, 0.05)',
									lineWidth: 1
								},
								ticks: {
									color: 'rgba(255, 255, 255, 0.4)',
									font: {
										family: 'monospace',
										size: 9
									},
									callback: function(value: any) {
										if (value >= 1000000) {
											return (value / 1000000).toFixed(1) + 'M';
										} else if (value >= 1000) {
											return (value / 1000).toFixed(1) + 'K';
										}
										return value;
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

	// Helper functions
	function formatMinuteBucket(timestamp: Date): string {
		const d = new Date(timestamp);
		return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()} ${d.getHours()}:${d.getMinutes()}`;
	}

	function getTransactionSizeCategory(value: bigint, decimals: number): 'small' | 'medium' | 'large' {
		const amount = Number(value) / 10 ** decimals;
		if (amount < 1000) return 'small';
		if (amount < 100000) return 'medium';
		return 'large';
	}

	function getSymbol(transfer: TransferEvent): string {
		const stablecoin = baseMainnet.get(transfer.contract.toLowerCase()) || ethereumMainnet.get(transfer.contract.toLowerCase());
		return stablecoin && 'symbol' in stablecoin ? stablecoin.symbol : 'UNK';
	}

	function getDecimals(network: Network, contractAddress: string): number {
		const coin = stablecoins[network]?.find(c => c.address.toLowerCase() === contractAddress.toLowerCase());
		return coin?.decimals || 18; // Default to 18 if not found
	}

	function calculateMovingAverage(window: number): number {
		const now = Date.now();
		const windowMs = window * 60 * 1000; // Convert minutes to milliseconds
		const windowStart = now - windowMs;

		const windowEvents = volumeTimeline.filter(e => e.timestamp > windowStart);
		if (windowEvents.length === 0) return 0;

		const totalVolume = windowEvents.reduce((sum, e) => sum + Number(e.volume), 0);
		return totalVolume / windowEvents.length;
	}

	function createSmallLineChart(canvas: HTMLCanvasElement, network: Network): Chart | null {
		const history = avgTransactionHistory[network] || [];
		if (history.length === 0) return null;

		// Create sliding time window - show last 30 minutes of data
		const now = Date.now();
		const windowMinutes = 30; // Always show 30 minutes
		const windowStart = now - (windowMinutes * 60 * 1000);

		let data = history
			.filter(point => point.timestamp >= windowStart)
			.map((point) => ({
				x: point.timestamp,
				y: point.avgSize
			}));


		// If we only have one data point, duplicate it with a small time offset to show a proper line
		if (data.length === 1) {
			const timestamp = data[0].x;
			data = [
				{ x: timestamp, y: data[0].y },
				{ x: timestamp + 30000, y: data[0].y } // 30 seconds later
			];
		}


		return new Chart(canvas, {
			type: 'line',
			data: {
				datasets: [{
					label: 'Avg Size',
					data: data,
					borderColor: network === 'ethereum-mainnet' ? 'rgb(59, 130, 246)' : 'rgb(251, 146, 60)',
					backgroundColor: network === 'ethereum-mainnet' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(251, 146, 60, 0.1)',
					borderWidth: 3,
					fill: true,
					tension: 0.4,
					pointRadius: 0,
					pointHoverRadius: 0,
					pointBackgroundColor: 'transparent',
					pointBorderColor: 'transparent',
					pointBorderWidth: 0
				}]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				layout: {
					padding: {
						bottom: 20,
						left: 10,
						right: 10,
						top: 10
					}
				},
				interaction: {
					intersect: false,
					mode: 'index'
				},
				plugins: {
					legend: {
						display: false
					},
					tooltip: {
						enabled: true,
						callbacks: {
							label: (context) => `Avg: ${formatNumber(context.parsed.y || 0)} USD/tx`
						}
					}
				},
				scales: {
					x: {
						type: 'time',
						display: true,
						position: 'bottom',
						time: {
							unit: 'second',
							displayFormats: {
								second: 'HH:mm:ss',
								minute: 'HH:mm'
							}
						},
						ticks: {
							color: 'rgba(255, 255, 255, 0.8)',
							font: {
								size: 7,
								family: 'monospace'
							},
							maxRotation: 90,
							minRotation: 0,
							callback: function(value: any) {
								return new Date(value).toLocaleTimeString();
							}
						},
						grid: {
							color: 'rgba(255, 255, 255, 0.1)',
							lineWidth: 1
						},
						title: {
							display: true,
							text: 'Time',
							color: 'rgba(255, 255, 255, 0.6)',
							font: {
								size: 8
							}
						}
					},
					y: {
						display: true,
						position: 'left',
						ticks: {
							color: 'rgba(255, 255, 255, 0.8)',
							font: {
								size: 7,
								family: 'monospace'
							}
						},
						grid: {
							color: 'rgba(255, 255, 255, 0.1)',
							lineWidth: 1
						},
						title: {
							display: true,
							text: 'USD/tx',
							color: 'rgba(255, 255, 255, 0.6)',
							font: {
								size: 8
							}
						}
					}
				},
				animation: {
					duration: 300
				}
			}
		});
	}

	// Chart instances for each network
	let chartInstances = $state<Record<Network, Chart | null>>({
		'ethereum-mainnet': null,
		'base-mainnet': null
	});

	// Reactive chart updates when data changes
	$effect(() => {
		// This effect will run whenever avgTransactionHistory changes
		Object.entries(avgTransactionHistory).forEach(([network, history]) => {
			const chart = chartInstances[network as Network];
			if (history.length > 0) {
				if (chart) {
					// Update existing chart data with 30-minute sliding time window
					const now = Date.now();
					const windowMinutes = 30; // Always show 30 minutes
					const windowStart = now - (windowMinutes * 60 * 1000);

					let data = history
						.filter(point => point.timestamp >= windowStart)
						.map((point) => ({
							x: point.timestamp,
							y: point.avgSize
						}));

					// If we only have one data point, duplicate it with a small time offset to show a proper line
					if (data.length === 1) {
						const timestamp = data[0].x;
						data = [
							{ x: timestamp, y: data[0].y },
							{ x: timestamp + 30000, y: data[0].y } // 30 seconds later
						];
					}

					chart.data.datasets[0].data = data;
					chart.update('none'); // Update without animation for better performance
				} else {
					// Chart doesn't exist yet, but we have data - we need to wait for the canvas to be available
					// The chart will be created when the canvas mounts with the Svelte action
				}
			}
		});
	});

	// Svelte action for creating small line charts
	function createChartAction(canvas: HTMLCanvasElement, network: Network) {
		let chart: Chart | null = null;

		const updateChart = () => {
			// Destroy existing chart if it exists
			if (chart) {
				chart.destroy();
				chart = null;
			}

			// Check if canvas is already in use by another chart
			const existingChart = Chart.getChart(canvas);
			if (existingChart) {
				existingChart.destroy();
			}

			// Create new chart
			chart = createSmallLineChart(canvas, network);
			chartInstances[network] = chart;

			// If chart creation failed, we'll try again when data becomes available
			if (!chart) {
				chartInstances[network] = null;
			}
		};

		updateChart();

		return {
			update(newNetwork: Network) {
				if (newNetwork !== network) {
					network = newNetwork;
					updateChart();
				}
			},
			destroy() {
				if (chart) {
					chart.destroy();
					chart = null;
					chartInstances[network] = null;
				}
			}
		};
	}

	// Process incoming transfers based on current network selection
	function processTransfers(transfers: TransferEvent[]) {
		// Filter transfers based on selected network first
		const filteredTransfers = transfers.filter(transfer =>
			selectedNetwork === 'all' || transfer.network === selectedNetwork
		);

		// Only count filtered transfers
		eventCount += filteredTransfers.length;

		transfers.forEach((transfer, index) => {
			// Try every possible way to get the addresses
			let fromAddr = null;
			let toAddr = null;
			let value = null;

			// Method 1: transfer.event.from
			if (transfer.event?.from) {
				fromAddr = transfer.event.from.toLowerCase();
				toAddr = transfer.event.to?.toLowerCase();
				value = transfer.event.value;
			}
			// Method 2: transfer.from (direct)
			else if ((transfer as any).from) {
				fromAddr = (transfer as any).from.toLowerCase();
				toAddr = (transfer as any).to?.toLowerCase();
				value = (transfer as any).value;
			}
			// Method 3: Check if it's nested differently
			else {
			}
			if (fromAddr && toAddr) {
				// Force reactivity by creating a new Set
				const newSet = new Set(uniqueAddresses);
				newSet.add(fromAddr);
				newSet.add(toAddr);
				uniqueAddresses = newSet;

				// Track address volumes
				if (value) {
					const bigValue = BigInt(value);
					addressVolumes[fromAddr] = (addressVolumes[fromAddr] || 0n) + bigValue;
					addressVolumes[toAddr] = (addressVolumes[toAddr] || 0n) + bigValue;
				}
			} else {
			}
		});

		const updated = { ...aggregatedByContract };
		filteredTransfers.forEach((transfer) => {
			const contract = transfer.contract.toLowerCase();
			const value = BigInt(transfer.event.value);
			const network = transfer.network;

			// Create aggregation key based on mode
			let aggregationKey;
			if (selectedNetwork === 'all') {
				// For 'all' mode, group by stableId to combine same stablecoin across networks
				const stableIdValue = stableId(network, contract);
				if (stableIdValue) {
					aggregationKey = `stableId:${stableIdValue}`;
				} else {
					aggregationKey = `${network}:${contract}`;
				}
			} else {
				// For specific network mode, use network:contract format
				aggregationKey = `${network}:${contract}`;
			}

			if (!updated[aggregationKey]) {
				updated[aggregationKey] = 0n;
			}
			updated[aggregationKey] += value;
			highlightUpdate(contract);
		});
		aggregatedByContract = updated;

		// Track timeline and new metrics
		filteredTransfers.forEach(transfer => {
			volumeTimeline.push({
				timestamp: new Date(transfer.timestamp).getTime(),
				volume: BigInt(transfer.event.value),
				network: transfer.network
			});

			// Track by minute bucket
			const minuteKey = formatMinuteBucket(transfer.timestamp);
			minuteBuckets[minuteKey] = (minuteBuckets[minuteKey] || 0n) + BigInt(transfer.event.value);

			// Network aggregation
			volumeByNetwork[transfer.network] = (volumeByNetwork[transfer.network] || 0n) + BigInt(transfer.event.value);
			transactionsByNetwork[transfer.network] = (transactionsByNetwork[transfer.network] || 0) + 1;

			// Track total volume and transaction count for accurate averages
			const decimals = getDecimals(transfer.network, transfer.contract);
			const volumeUSD = Number(transfer.event.value) / (10 ** decimals);
			totalVolumeUSD += volumeUSD;
			totalTransactionsCount += 1;

			// Track per-network USD volume for consistent averages
			volumeByNetworkUSD[transfer.network] = (volumeByNetworkUSD[transfer.network] || 0) + volumeUSD;

			// Update historical average transaction sizes (every 2 transactions or every 15 seconds)
			const txCount = transactionsByNetwork[transfer.network] || 0;
			const now = Date.now();
			const lastUpdate = avgTransactionHistory[transfer.network].length > 0
				? avgTransactionHistory[transfer.network][avgTransactionHistory[transfer.network].length - 1].timestamp
				: 0;

			// Update more frequently: every 2 transactions, every 15 seconds, or first transaction
			// Also ensure minimum 5 second gap between updates for better time distribution
			if ((txCount % 2 === 0 && txCount > 0) || (now - lastUpdate > 15000) || (txCount === 1) || (now - lastUpdate > 5000)) {
				const currentAvg = volumeByNetworkUSD[transfer.network] / txCount;
				avgTransactionHistory[transfer.network].push({
					timestamp: now,
					avgSize: currentAvg
				});

				// Keep more data points for 30-minute window (up to 360 points for 30min at 5sec intervals)
				if (avgTransactionHistory[transfer.network].length > 360) {
					avgTransactionHistory[transfer.network] = avgTransactionHistory[transfer.network].slice(-360);
				}
			}

			// Largest transfer tracking
			const value = BigInt(transfer.event.value);
			if (!largestTransfer || value > largestTransfer.value) {
				largestTransfer = { value, symbol: getSymbol(transfer), timestamp: transfer.timestamp };
			}
		});

		// Maintain rolling window for TPM (keep last 5 minutes)
		lastMinuteEvents = [...filteredTransfers, ...lastMinuteEvents].filter(e =>
			new Date(e.timestamp).getTime() > Date.now() - 300000
		);

		// Add filtered transfers to events
		events = [...filteredTransfers, ...events].slice(0, 100);
	}

	onMount(() => {
		// Unique addresses are already initialized as $state variables

		const eventSource = new EventSource('/api/stables');

		eventSource.onopen = () => {
			isConnected = true;
		};

		eventSource.onmessage = (event) => {
			const transfers = JSON.parse(event.data) as TransferEvent[];
			processTransfers(transfers);
		};

		eventSource.onerror = (error) => {
			console.error('EventSource error:', error);
			isConnected = false;
			eventSource.close();
		};

		// Periodic update for chart data to ensure regular data points
		// This runs every 10 seconds to add data points even during low activity
		const periodicUpdateInterval = setInterval(() => {
			Object.entries(transactionsByNetwork).forEach(([network, txCount]) => {
				if (txCount > 0) {
					const now = Date.now();
					const lastUpdate = avgTransactionHistory[network as Network].length > 0
						? avgTransactionHistory[network as Network][avgTransactionHistory[network as Network].length - 1].timestamp
						: 0;

					// Only add if at least 10 seconds have passed since last update
					if (now - lastUpdate > 10000) {
						const currentAvg = volumeByNetworkUSD[network as Network] / txCount;
						avgTransactionHistory[network as Network].push({
							timestamp: now,
							avgSize: currentAvg
						});

						// Keep more data points for 30-minute window (up to 360 points for 30min at 5sec intervals)
						if (avgTransactionHistory[network as Network].length > 360) {
							avgTransactionHistory[network as Network] = avgTransactionHistory[network as Network].slice(-360);
						}
					}
				}
			});
		}, 10000); // Run every 10 seconds

		return () => {
			if (chartInstance) {
				chartInstance.destroy();
			}
			if (periodicUpdateInterval) {
				clearInterval(periodicUpdateInterval);
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
				<div class="flex items-center gap-3">
					<select
						bind:value={selectedNetwork}
						class="bg-black border border-white/20 text-white/80 text-[10px] uppercase tracking-widest px-2 py-1 hover:border-white/40 focus:border-orange-500 focus:outline-none transition-colors"
					>
						<option value="all">All Networks</option>
						{#each Object.entries(networks) as [id, network]}
							<option value={id}>{network.label}</option>
						{/each}
					</select>
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
		<div class="mb-4 flex flex-wrap gap-2">
			<div class="border border-white/5 bg-white/[0.02] p-2 flex-1 min-w-0">
				<div class="mb-1 flex items-center justify-between">
					<div class="text-[9px] tracking-widest text-white/40 uppercase">Tokens Tracked</div>
					<div class="h-px flex-1 bg-white/5 mx-2"></div>
				</div>
				<div class="text-xl font-bold tabular-nums text-white/90">
					{Object.entries(aggregatedByContract).filter(([key, _]) => {
						if (selectedNetwork === 'all') return true;
						return key.startsWith(`${selectedNetwork}:`);
					}).length}
				</div>
			</div>
			<div class="border border-white/5 bg-white/[0.02] p-2 flex-1 min-w-0">
				<div class="mb-1 flex items-center justify-between">
					<div class="text-[9px] tracking-widest text-white/40 uppercase">Total Intercepts</div>
					<div class="h-px flex-1 bg-white/5 mx-2"></div>
				</div>
				<div class="text-xl font-bold tabular-nums text-white/90">
					{eventCount.toLocaleString()}
				</div>
			</div>
			<div class="border border-white/5 bg-white/[0.02] p-2 flex-1 min-w-0">
				<div class="mb-1 flex items-center justify-between">
					<div class="text-[9px] tracking-widest text-white/40 uppercase">TPM</div>
					<div class="h-px flex-1 bg-white/5 mx-2"></div>
				</div>
				<div class="text-xl font-bold tabular-nums text-orange-500">
					{transactionsPerMinute}
				</div>
				<div class="text-[8px] text-white/30">tx/min</div>
			</div>
			<div class="border border-white/5 bg-white/[0.02] p-2 flex-1 min-w-0">
				<div class="mb-1 flex items-center justify-between">
					<div class="text-[9px] tracking-widest text-white/40 uppercase">Unique Addresses</div>
					<div class="h-px flex-1 bg-white/5 mx-2"></div>
				</div>
				<div class="text-xl font-bold tabular-nums text-white/90">
					{uniqueAddressCount.toLocaleString()}
				</div>
			</div>
			<div class="border border-white/5 bg-white/[0.02] p-2 flex-1 min-w-0">
				<div class="mb-1 flex items-center justify-between">
					<div class="text-[9px] tracking-widest text-white/40 uppercase">Volume Rate</div>
					<div class="h-px flex-1 bg-white/5 mx-2"></div>
				</div>
				<div class="text-xl font-bold tabular-nums text-white/90">
					{formatNumber(volumeRate)}
				</div>
				<div class="text-[8px] text-white/30">USD/min</div>
			</div>
		</div>

		<!-- Network Distribution -->
		{#if networkDistribution.length > 0 || networkActivityDistribution.length > 0}
			<div class="mb-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
				<!-- Volume Distribution -->
				{#if networkDistribution.length > 0}
					<div class="border border-white/5 bg-white/[0.01] p-3">
						<div class="mb-2 flex items-center justify-between">
							<div class="text-[10px] tracking-widest text-white/40 uppercase">Volume Distribution</div>
							<div class="text-[9px] text-white/30">
								{Object.values(volumeByNetworkUSD).reduce((sum, v) => sum + v, 0).toFixed(2)} USD total
							</div>
						</div>
						<div class="space-y-3">
							{#each networkDistribution as {network, percentage}}
								{@const isDominant = percentage > 90}
								{@const txCount = transactionsByNetwork[network as Network] || 0}
								{@const networkVolume = volumeByNetwork[network as Network] || 0n}
								<div class="space-y-2">
									<!-- Network header -->
									<div class="flex items-center justify-between">
										<div class="flex items-center gap-2">
											<div class="w-2 h-2 rounded-full {isDominant ? 'bg-orange-500' : 'bg-orange-500/60'}"></div>
											<div class="text-[10px] font-semibold text-white/80 uppercase">{networks[network as Network]?.label || network}</div>
											{#if isDominant && percentage > 95}
												<div class="text-[8px] text-orange-400">⚠</div>
											{/if}
										</div>
										<div class="text-[9px] text-white/60">
											{formatNumber(volumeByNetworkUSD[network as Network] || 0)} USD
										</div>
									</div>

									<!-- Volume bar with gradient -->
									<div class="w-full bg-white/5 rounded-full h-2 relative">
										<div
											class="h-2 rounded-full transition-all duration-500 bg-gradient-to-r from-orange-500/80 to-orange-400/60"
											style="width: {Math.max(percentage, 1)}%"
										></div>
									</div>

									<!-- Stats row -->
									<div class="flex justify-between text-[8px] text-white/50">
										<span>{percentage.toFixed(1)}% of total volume</span>
										<span>{txCount} transactions</span>
									</div>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Activity Distribution -->
				{#if networkActivityDistribution.length > 0}
					<div class="border border-white/5 bg-white/[0.01] p-3">
						<div class="mb-2 flex items-center justify-between">
							<div class="text-[10px] tracking-widest text-white/40 uppercase">Activity Distribution</div>
							<div class="text-[9px] text-white/30">
								{Object.values(transactionsByNetwork).reduce((sum, v) => sum + v, 0)} tx
							</div>
						</div>
						<div class="space-y-3">
							{#each networkActivityDistribution as {network, percentage, count}}
								<div class="space-y-2">
									<!-- Network header -->
									<div class="flex items-center justify-between">
										<div class="flex items-center gap-2">
											<div class="w-2 h-2 rounded-full bg-orange-500/60"></div>
											<div class="text-[10px] font-semibold text-white/80 uppercase">{networks[network as Network]?.label || network}</div>
										</div>
										<div class="text-[9px] text-white/60">
											{count} transactions
										</div>
									</div>

									<!-- Activity bar with gradient -->
									<div class="w-full bg-white/5 rounded-full h-2">
										<div
											class="bg-gradient-to-r from-orange-500/80 to-orange-400/60 h-2 rounded-full transition-all duration-500"
											style="width: {Math.max(percentage, 1)}%"
										></div>
									</div>

									<!-- Stats row -->
									<div class="flex justify-between text-[8px] text-white/50">
										<span>{percentage.toFixed(1)}% of total activity</span>
										<span>{((percentage / 100) * Object.values(transactionsByNetwork).reduce((sum, v) => sum + v, 0)).toFixed(0)} tx</span>
									</div>
								</div>
							{/each}
						</div>
					</div>
				{/if}

			</div>

			{#if networkDistribution.some(d => d.percentage > 95)}
				<div class="mb-4 text-[9px] text-orange-400/60 flex items-center justify-center gap-1">
					<span>⚠</span>
					<span>Heavy network dominance detected - consider filtering by specific network</span>
				</div>
			{/if}

		<!-- Average Volume Per Transaction -->
		{#if Object.entries(transactionsByNetwork).some(([_, count]) => count > 0)}
			<div class="mb-4">
				<div class="border border-white/5 bg-white/[0.01] p-4">
					<div class="mb-3 flex items-center justify-between">
						<div class="text-[10px] tracking-widest text-white/40 uppercase">Avg Volume/Tx</div>
						<div class="text-[9px] text-white/30">
							{formatNumber(averageVolumePerTransaction)} USD/tx
						</div>
					</div>
					<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
						{#each Object.entries(transactionsByNetwork) as [network, count]}
							{@const networkVolumeUSD = volumeByNetworkUSD[network as Network] || 0}
							{@const avgForNetwork = count > 0 ? networkVolumeUSD / count : 0}

							<div class="space-y-3">
								<!-- Network header with stats -->
								<div class="flex items-center justify-between">
									<div class="flex items-center gap-2">
										<div class="w-2 h-2 rounded-full bg-orange-500/60"></div>
										<div class="text-[10px] font-semibold text-white/80 uppercase">{networks[network as Network]?.label || network}</div>
									</div>
									<div class="text-[9px] text-white/60">
										{count} transactions
									</div>
								</div>

								<!-- Average transaction size trend chart -->
								<div class="space-y-2">
									<div class="flex justify-between text-[8px] text-white/50">
										<span>Avg Size Trend</span>
										<span>{formatNumber(avgForNetwork)} USD/tx</span>
									</div>
									<div class="w-full h-40 bg-white/5 rounded p-2">
										{#if avgTransactionHistory[network as Network]?.length > 0}
											<canvas
												class="w-full h-full"
												data-network={network}
												use:createChartAction={network as Network}
											></canvas>
										{:else}
											<div class="flex items-center justify-center h-full">
												<div class="text-[9px] text-white/30">No data yet</div>
											</div>
										{/if}
									</div>
								</div>

								<!-- Activity indicator -->
								<div class="space-y-1">
									<div class="text-[8px] text-white/50">Recent Activity</div>
									<div class="flex items-center gap-1">
										<div class="w-2 h-2 rounded-full bg-orange-500/60 animate-pulse"></div>
										<div class="text-[8px] text-white/60">
											{lastMinuteEvents.filter(e => e.network === network).length} tx in last min
										</div>
									</div>
								</div>

							</div>
						{/each}
					</div>
				</div>
			</div>
		{/if}
		{/if}

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
							<th class="w-20 px-4 py-2 text-left text-[10px] font-medium tracking-widest text-white/40 uppercase">
								Asset
							</th>
							<th class="w-24 px-4 py-2 text-left text-[10px] font-medium tracking-widest text-white/40 uppercase">
								Network
							</th>
							<th class="w-32 px-4 py-2 text-right text-[10px] font-medium tracking-widest text-white/40 uppercase">
								Value
							</th>
							<th class="w-48 px-4 py-2 text-left text-[10px] font-medium tracking-widest text-white/40 uppercase">
								Timestamp
							</th>
							<th class="w-24 px-4 py-2 text-right text-[10px] font-medium tracking-widest text-white/40 uppercase">
								Block#
							</th>
							<th class="w-20 px-4 py-2 text-right text-[10px] font-medium tracking-widest text-white/40 uppercase">
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
								{@const stablecoin = baseMainnet.get(transfer.contract.toLowerCase()) || ethereumMainnet.get(transfer.contract.toLowerCase())}
								{@const network = networks[transfer.network as Network] || { label: transfer.network, id: transfer.network }}
								{@const decimals = stablecoin && 'decimals' in stablecoin ? stablecoin.decimals : 18}
								{@const symbol = stablecoin && 'symbol' in stablecoin ? stablecoin.symbol : 'UNK'}
								{@const amount = Number(transfer.event.value) / 10 ** decimals}
								{@const formattedTimestamp = formatTimestamp(transfer.timestamp)}
								{@const timeAgo = getTimeAgo(transfer.timestamp)}
								{@const sizeCategory = getTransactionSizeCategory(transfer.event.value, decimals)}
								{@const isLargest = largestTransfer && largestTransfer.value === transfer.event.value && largestTransfer.symbol === symbol}
								{@const networkTpm = transactionsByNetwork[transfer.network] || 0}
								<tr class="transition-all duration-200 hover:bg-white/[0.02] {isLargest ? 'bg-orange-500/10 border-l-2 border-orange-500' : ''}">
									<td class="w-20 px-4 py-2">
										<div class="flex items-center gap-2">
											<div class="flex h-5 w-5 items-center justify-center border border-white/10 text-[9px] font-bold text-white/50">
												{symbol[0]}
											</div>
											<span class="text-[10px] font-semibold text-white/70">
												{symbol}
											</span>
										</div>
									</td>
									<td class="w-24 px-4 py-2">
										<div class="text-[10px] text-white/50">{network.label}</div>
										<div class="text-[8px] text-orange-500/60">
											{networkTpm} tx/min
										</div>
									</td>
									<td class="w-32 px-4 py-2 text-right">
										<div class="text-[11px] font-semibold tabular-nums {
											sizeCategory === 'small' ? 'text-white/50' :
											sizeCategory === 'medium' ? 'text-white/70' :
											'text-orange-500'
										}">
											{formatNumber(amount)}
											{#if isLargest}
												<span class="ml-1 text-orange-400">★</span>
											{/if}
										</div>
									</td>
									<td class="w-48 px-4 py-2">
										<div class="text-[10px] text-white/50">{formattedTimestamp}</div>
									</td>
									<td class="w-24 px-4 py-2 text-right">
										<div class="text-[10px] tabular-nums text-white/50">
											{transfer.blockNumber.toLocaleString()}
										</div>
									</td>
									<td class="w-20 px-4 py-2 text-right">
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
