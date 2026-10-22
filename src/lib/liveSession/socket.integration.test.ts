import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { get, writable } from 'svelte/store';
import { followSocketStore } from './socket';
import { chatLive, socketState } from './store';

// Opt-in: LIVE_SESSION_INTEGRATION=1 npx vitest run src/lib/liveSession/socket.integration.test.ts
// Needs the backend virtualenv (or LIVE_SESSION_PYTHON pointing at a Python with python-socketio).
const python =
	process.env.LIVE_SESSION_PYTHON ??
	fileURLToPath(new URL('../../../backend/.venv/bin/python', import.meta.url));
const serverScript = fileURLToPath(new URL('./fixtures/socket_server.py', import.meta.url));
const enabled = process.env.LIVE_SESSION_INTEGRATION === '1' && existsSync(python);

const port = 20000 + Math.floor(Math.random() * 20000);
const options = { transports: ['websocket'], reconnectionDelay: 200, reconnectionDelayMax: 400 };

let server: ChildProcess | null = null;
const sockets: Socket[] = [];

const startServer = () => {
	server = spawn(python, [serverScript, String(port)], { stdio: 'ignore' });
};
const stopServer = () => {
	server?.kill('SIGKILL');
	server = null;
};

// Does what Chat.svelte does today: join the chat room on every (re)connect.
const openTab = (forceNew = false) => {
	const socket = io(`http://127.0.0.1:${port}`, { ...options, forceNew });
	socket.on('connect', () => socket.emit('events:chat', { chat_id: 'A', data: { type: 'join' } }, () => {}));
	sockets.push(socket);
	return socket;
};

const viewers = () => get(chatLive).A?.activeViewers ?? null;
const waitFor = (check: () => void) => vi.waitFor(check, { timeout: 8000, interval: 50 });

afterAll(() => {
	sockets.forEach((socket) => socket.close());
	stopServer();
});

describe.skipIf(!enabled)('live session socket against a real Socket.IO server', () => {
	it(
		'tracks connected → reconnecting → connected across a server restart and rejoins the chat room',
		async () => {
			startServer();
			const tab = openTab();
			const stop = followSocketStore(writable<Socket | null>(tab));

			await waitFor(() => expect(get(socketState)).toBe('connected'));
			await waitFor(() => expect(viewers()).toBe(1));

			openTab(true);
			await waitFor(() => expect(viewers()).toBe(2));

			stopServer();
			await waitFor(() => expect(get(socketState)).toBe('reconnecting'));
			expect(viewers()).toBeNull();

			startServer();
			await waitFor(() => expect(get(socketState)).toBe('connected'));
			await waitFor(() => expect(viewers()).toBe(2));

			tab.close();
			expect(get(socketState)).toBe('offline');
			stop();
		},
		30000
	);
});
