# Dev-only fake OpenAI-compatible model, so the live session widget can be tried in a real chat
# without an API key. Standard library only.
#
#   python3 scripts/live-session/fake_openai_server.py [port]   (default port 8099)
#
# Then in Open WebUI: Admin Panel -> Settings -> Connections -> OpenAI API -> add
#   URL: http://localhost:8099/v1   Key: anything
from __future__ import annotations

import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL = 'fake-model'
ANSWER = (
    'This answer comes from a fake local model used for testing the live session widget. '
    'It streams a few words at a time, the same way a real model does, so you can try '
    'Stop, Regenerate and switching chats while it is still writing.'
)


def chunk(content: str | None, finish_reason: str | None = None) -> bytes:
    data = {
        'id': 'chatcmpl-fake',
        'object': 'chat.completion.chunk',
        'created': int(time.time()),
        'model': MODEL,
        'choices': [
            {'index': 0, 'delta': {'content': content} if content else {}, 'finish_reason': finish_reason}
        ],
    }
    return f'data: {json.dumps(data)}\n\n'.encode()


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def _json(self, body: dict):
        payload = json.dumps(body).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path.rstrip('/').endswith('/models'):
            self._json({'object': 'list', 'data': [{'id': MODEL, 'object': 'model', 'owned_by': 'dev'}]})
        else:
            self.send_error(404)

    def do_POST(self):
        if not self.path.rstrip('/').endswith('/chat/completions'):
            self.send_error(404)
            return
        body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')

        if not body.get('stream'):
            # Open WebUI also calls the model without streaming for titles, tags and follow-ups.
            self._json(
                {
                    'id': 'chatcmpl-fake',
                    'object': 'chat.completion',
                    'created': int(time.time()),
                    'model': MODEL,
                    'choices': [
                        {
                            'index': 0,
                            'message': {'role': 'assistant', 'content': '{"title": "Live session test"}'},
                            'finish_reason': 'stop',
                        }
                    ],
                    'usage': {'prompt_tokens': 10, 'completion_tokens': 5, 'total_tokens': 15},
                }
            )
            return

        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Transfer-Encoding', 'chunked')
        self.end_headers()

        def send(data: bytes):
            self.wfile.write(f'{len(data):x}\r\n'.encode() + data + b'\r\n')
            self.wfile.flush()

        try:
            words = ANSWER.split(' ')
            for start in range(0, len(words), 3):
                send(chunk(' '.join(words[start : start + 3]) + ' '))
                time.sleep(0.25)
            send(chunk(None, 'stop'))
            send(b'data: [DONE]\n\n')
            self.wfile.write(b'0\r\n\r\n')
        except (BrokenPipeError, ConnectionResetError):
            pass

    def log_message(self, format, *args):
        pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8099
    # Inside Docker the model must listen on all interfaces so the Open WebUI container can reach it.
    host = os.environ.get('FAKE_MODEL_HOST', '127.0.0.1')
    print(f'Fake OpenAI-compatible model "{MODEL}" on http://{host}:{port}/v1', flush=True)
    ThreadingHTTPServer((host, port), Handler).serve_forever()
