import type { Network } from './stablecoins';

export const networks: Record<Network, { label: string; id: string }> = {
	'base-mainnet': {
		label: 'Base',
		id: 'base-mainnet'
	},
	'ethereum-mainnet': {
		label: 'Eth ',
		id: 'ethereum-mainnet'
	}
} as const;
