import { describe, expect, it } from 'vitest';
import { createSSEParser, type SSEMessage } from './sse';

const collect = () => {
	const messages: SSEMessage[] = [];
	const parser = createSSEParser((message) => messages.push(message));
	return { messages, parser };
};

const STREAM =
	'event: widget_delta\ndata: {"messageId":"m7","type":"step","id":"retrieval","status":"running"}\n\n' +
	'event: widget_done\ndata: {"messageId":"m7"}\n\n';

const EXPECTED: SSEMessage[] = [
	{
		event: 'widget_delta',
		data: { messageId: 'm7', type: 'step', id: 'retrieval', status: 'running' }
	},
	{ event: 'widget_done', data: { messageId: 'm7' } }
];

describe('createSSEParser', () => {
	it('parses complete events from one chunk', () => {
		const { messages, parser } = collect();
		parser.push(STREAM);
		expect(messages).toEqual(EXPECTED);
	});

	it('gives the same result for every possible split into two chunks', () => {
		for (let at = 0; at <= STREAM.length; at++) {
			const { messages, parser } = collect();
			parser.push(STREAM.slice(0, at));
			parser.push(STREAM.slice(at));
			expect(messages, `split at ${at}`).toEqual(EXPECTED);
		}
	});

	it('handles one character per chunk', () => {
		const { messages, parser } = collect();
		STREAM.split('').forEach((char) => parser.push(char));
		expect(messages).toEqual(EXPECTED);
	});

	it('waits for the blank line before emitting an event', () => {
		const { messages, parser } = collect();
		parser.push('event: widget_done\ndata: {"messageId":"m7"}\n');
		expect(messages).toEqual([]);
		parser.push('\n');
		expect(messages).toHaveLength(1);
	});

	it('accepts \\r\\n and \\r line endings, even when \\r and \\n arrive separately', () => {
		const crlf = STREAM.replace(/\n/g, '\r\n');
		const { messages, parser } = collect();
		for (let i = 0; i < crlf.length; i += 1) parser.push(crlf[i]);
		expect(messages).toEqual(EXPECTED);

		const cr = collect();
		cr.parser.push(STREAM.replace(/\n/g, '\r'));
		cr.parser.push('\n');
		expect(cr.messages).toEqual(EXPECTED);
	});

	it('joins multiple data lines with a newline', () => {
		const { messages, parser } = collect();
		parser.push('event: x\ndata: {"a":\ndata: 1}\n\n');
		expect(messages).toEqual([{ event: 'x', data: { a: 1 } }]);
	});

	it('ignores comments, ids, retry and unknown fields, and accepts a missing space after the colon', () => {
		const { messages, parser } = collect();
		parser.push(': keep-alive\nid: 4\nretry: 100\nfoo: bar\nevent:widget_done\ndata:{"messageId":"m7"}\n\n');
		expect(messages).toEqual([{ event: 'widget_done', data: { messageId: 'm7' } }]);
	});

	it('uses "message" as the event name when none is given', () => {
		const { messages, parser } = collect();
		parser.push('data: 1\n\n');
		expect(messages).toEqual([{ event: 'message', data: 1 }]);
	});

	it('does not emit an event that has no data lines', () => {
		const { messages, parser } = collect();
		parser.push('event: widget_done\n\n: just a comment\n\n');
		expect(messages).toEqual([]);
	});

	it('reports malformed JSON without throwing and keeps parsing', () => {
		const { messages, parser } = collect();
		parser.push('event: widget_delta\ndata: {"messageId":"m7","key":"tok\n\n' + STREAM);
		expect(messages[0]).toEqual({
			event: 'widget_delta',
			raw: '{"messageId":"m7","key":"tok',
			malformed: true
		});
		expect(messages.slice(1)).toEqual(EXPECTED);
	});

	it('resets the event name after each event', () => {
		const { messages, parser } = collect();
		parser.push('event: widget_done\ndata: 1\n\ndata: 2\n\n');
		expect(messages.map((message) => message.event)).toEqual(['widget_done', 'message']);
	});

	it('end() discards and reports an unfinished event', () => {
		const { messages, parser } = collect();
		parser.push('event: widget_done\ndata: {"messageId":"m7"}');
		expect(parser.end()).toBe(true);
		parser.push('\n\n');
		expect(messages).toEqual([]);
	});

	it('end() reports nothing after a clean stream', () => {
		const { parser } = collect();
		parser.push(STREAM);
		expect(parser.end()).toBe(false);
	});
});
