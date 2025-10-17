import {
	commonAbis,
	createEvmDecoder,
	createEvmPortalSource,
	type DecodedEvent
} from '@sqd-pipes/pipes/evm';
import { stablecoins } from '$lib/config/stablecoins';
import pino from 'pino';
import pretty from 'pino-pretty';

const stream = pretty({
  colorize: true,
  translateTime: 'SYS:standard',
  ignore: 'pid,hostname',
});

const logger = pino(stream);

type TransferEventArgs = {
	readonly from: string;
	readonly to: string;
	readonly value: bigint;
};

export type TransferEvent = DecodedEvent<TransferEventArgs>;

let pipeInstance: any = null;
let isRunning = false;

export async function stablesPipe() {
	if (isRunning && pipeInstance) {
		console.warn('Topology instance already running, returning existing instance');
		return pipeInstance;
	}

	isRunning = true;
	pipeInstance = createEvmPortalSource({
		portal: 'https://portal.sqd.dev/datasets/base-mainnet',
		logger
	}).pipe(
		createEvmDecoder({
			range: { from: 'latest' },
			contracts: stablecoins.map((coin) => coin.address),
			events: {
				transfers: commonAbis.erc20.events.Transfer
			}
		})
	);

	return pipeInstance;
}
