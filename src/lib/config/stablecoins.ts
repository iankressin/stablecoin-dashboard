export const stablecoins = {
	'ethereum-mainnet': [
		{
			address: '0xdc035d45d973e3ec169d2276ddab16f1e407384f',
			symbol: 'USDS',
			type: 'Crypto-backed',
			decimals: 18
		},
		{
			symbol: 'USDC',
			type: 'Fiat-backed',
			decimals: 6,
			address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
		},
		{
			address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
			symbol: 'USDT',
			type: 'Fiat-backed',
			decimals: 6
		},
		{
			address: '0x4c9edd5852cd905f086c759e8383e09bff1e68b3',
			symbol: 'USDe',
			type: 'Stable-backed',
			decimals: 18
		},
		{
			address: '0x6c3ea9036406852006290770bedfcaba0e23a0e8',
			symbol: 'PYUSD',
			type: 'Stable-backed',
			decimals: 6
		},
		{
			address: '0x40d16fc0246ad3160ccc09b8d0d3a2cd28ae6c2f',
			symbol: 'GHO',
			type: 'Stable-backed',
			decimals: 18
		}
	],
	'base-mainnet': [
		{
			address: '0x820c137fa70c8691f0e44dc420a5e53c168921dc',
			symbol: 'USDS',
			type: 'Crypto-backed',
			decimals: 18
		},
		{
			address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
			symbol: 'USDC',
			type: 'Fiat-backed',
			decimals: 6
		},
		{
			address: '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca',
			symbol: 'USDbC',
			type: 'Stable-backed',
			decimals: 6
		},
		{
			address: '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2',
			symbol: 'USDT',
			type: 'Fiat-backed',
			decimals: 6
		},
		{
			address: '0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34',
			symbol: 'USDe',
			type: 'Stable-backed',
			decimals: 18
		},
		{
			address: '0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42',
			symbol: 'EURC',
			type: 'Fiat-backed',
			decimals: 6
		},
		{
			address: '0xb79dd08ea68a908a97220c76d19a6aa9cbde4376',
			symbol: 'USD+',
			type: 'Crypto-backed',
			decimals: 6
		},
		{
			address: '0x4621b7a9c75199271f773ebd9a499dbd165c3191',
			symbol: 'DOLA',
			type: 'Crypto-backed',
			decimals: 18
		},
		{
			address: '0xcfa3ef56d303ae4faaba0592388f19d7c3399fb4',
			symbol: 'eUSD',
			type: 'Crypto-backed',
			decimals: 18
		},
		{
			address: '0x6bb7a212910682dcfdbd5bcbb3e28fb4e8da10ee',
			symbol: 'GHO',
			type: 'Stable-backed',
			decimals: 18
		}
	]
} as const;

export type Network = keyof typeof stablecoins;

const stableIds = Object.fromEntries(
	Object.entries(stablecoins).map(([network, coins]) => [
		network,
		Object.fromEntries(coins.map((coin) => [coin.address.toLowerCase(), coin.symbol]))
	])
) as Record<Network, Record<string, string>>;

export const stableId = (network: Network, address: string) =>
	stableIds[network]?.[address.toLowerCase()] || null;

export const stablecoinsMap = (network: Network) =>
	new Map(stablecoins[network].map((coin) => [coin.address.toLowerCase(), coin]));

export const stablecoinsSymbols = (network: Network) =>
	stablecoins[network].map((coin) => coin.symbol);
