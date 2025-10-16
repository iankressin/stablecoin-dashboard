import { stablesPipe } from '$lib/indexer/stables.indexer';

// serialize BigInt to string
(BigInt.prototype as any).toJSON = function () {
	return this.toString();
};

export async function GET() {
	const stream = new ReadableStream({
		async start(controller) {
			const encoder = new TextEncoder();

			try {
				const pipe = await stablesPipe();

				for await (const { data } of pipe) {
					const message = `data: ${JSON.stringify(data.transfers)}\n\n`;
					controller.enqueue(encoder.encode(message));
				}
			} catch (error) {
				console.error('Stream error:', error);
				controller.error(error);
			} finally {
				controller.close();
			}
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
}
