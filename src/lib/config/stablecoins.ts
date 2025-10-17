export const stablecoins = [
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
		type: 'Stable-backed',
		decimals: 6
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
		address: '0xeb466342c4d449bc9f53a865d5cb90586f405215',
		symbol: 'axlUSDC',
		type: 'Crypto-backed',
		decimals: 6
	}
] as const;

export const stablecoinsMap = new Map(
	stablecoins.map((coin) => [coin.address.toLowerCase(), coin])
);

export const stablecoinsSymbols = stablecoins.map((coin) => coin.symbol);
