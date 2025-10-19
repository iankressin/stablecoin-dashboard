import {
	commonAbis,
	createEvmDecoder,
	createEvmPortalSource,
	type DecodedEvent
} from '@sqd-pipes/pipes/evm';
import { stablecoins, type Network } from '$lib/config/stablecoins';
import pino from 'pino';
import pretty from 'pino-pretty';

const stream = pretty({
	colorize: true,
	translateTime: 'SYS:standard',
	ignore: 'pid,hostname'
});

const logger = pino(stream);

type TransferEventArgs = {
	readonly from: string;
	readonly to: string;
	readonly value: bigint;
	readonly network: Network;
};

export type TransferEvent = DecodedEvent<TransferEventArgs> & {
	network: Network;
};

let pipeInstance: any = null;
let isRunning = false;

const tokenDecoder = (contracts: string[]) =>
	createEvmDecoder({
		range: { from: 'latest' },
		contracts: contracts,
		events: {
			transfers: commonAbis.erc20.events.Transfer
		}
	});

export async function stablesPipe(controller: ReadableStreamDefaultController<any>) {
	if (isRunning && pipeInstance) {
		console.warn('Topology instance already running, returning existing instance');
		return pipeInstance;
	}

	isRunning = true;

	await Promise.all([
		networkPipe('base-mainnet', controller),
		networkPipe('ethereum-mainnet', controller)
	]);

	return pipeInstance;
}

const networkPipe = async (network: Network, controller: ReadableStreamDefaultController<any>) => {
	const pipe = createEvmPortalSource({
		portal: `https://portal.sqd.dev/datasets/${network}`,
		logger
	})
		.pipe(tokenDecoder(stablecoins[network].map((coin) => coin.address)))
		.pipe((data) =>
			data.transfers.map((transfer) => ({
				...transfer,
				network
			}))
		);

	const encoder = new TextEncoder();
	for await (const { data } of pipe) {
		const message = `data: ${JSON.stringify(data)}\n\n`;
		controller.enqueue(encoder.encode(message));
	}
};
