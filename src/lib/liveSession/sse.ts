export type SSEMessage =
	| { event: string; data: unknown; malformed?: false }
	| { event: string; raw: string; malformed: true };

export type SSEParser = {
	push: (chunk: string) => void;
	end: () => boolean;
};

export const createSSEParser = (onMessage: (message: SSEMessage) => void): SSEParser => {
	let buffer = '';
	let event = '';
	let data: string[] = [];

	const dispatch = () => {
		if (data.length > 0) {
			const name = event || 'message';
			const raw = data.join('\n');
			let parsed: unknown;
			let malformed = false;
			try {
				parsed = JSON.parse(raw);
			} catch {
				malformed = true;
			}
			onMessage(malformed ? { event: name, raw, malformed: true } : { event: name, data: parsed });
		}
		event = '';
		data = [];
	};

	const processLine = (line: string) => {
		if (line === '') {
			dispatch();
			return;
		}
		if (line.startsWith(':')) return;

		const colon = line.indexOf(':');
		const field = colon === -1 ? line : line.slice(0, colon);
		let value = colon === -1 ? '' : line.slice(colon + 1);
		if (value.startsWith(' ')) value = value.slice(1);

		if (field === 'event') event = value;
		else if (field === 'data') data.push(value);
	};

	return {
		push(chunk) {
			buffer += chunk;
			// A trailing \r may be the first half of a \r\n split across two chunks.
			const held = buffer.endsWith('\r') ? '\r' : '';
			const lines = (held ? buffer.slice(0, -1) : buffer).replace(/\r\n?/g, '\n').split('\n');
			buffer = lines.pop() + held;
			lines.forEach(processLine);
		},
		end() {
			const incomplete = buffer !== '' || data.length > 0;
			buffer = '';
			event = '';
			data = [];
			return incomplete;
		}
	};
};
