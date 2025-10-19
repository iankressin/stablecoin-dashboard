import { stablesPipe } from '$lib/indexer/stables.indexer';

// serialize BigInt to string
(BigInt.prototype as any).toJSON = function () {
	return this.toString();
};

export async function GET() {
	const stream = new ReadableStream({
		async start(controller) {
			try {
				await stablesPipe(controller);
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
