# Minimal Socket.IO server for socket.integration.test.ts. It mirrors the backend's contract for the
# live session widget (join a chat room, receive live:presence) without needing a login or a database.
import sys

import socketio
import uvicorn

sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')
app = socketio.ASGIApp(sio)


async def publish_presence(chat_id: str):
    viewers = len(list(sio.manager.get_participants('/', f'chat:{chat_id}')))
    await sio.emit(
        'events',
        {
            'chat_id': chat_id,
            'shared': True,
            'data': {'type': 'live:presence', 'data': {'chatId': chat_id, 'activeViewers': viewers}},
        },
        room=f'chat:{chat_id}',
    )


@sio.on('events:chat')
async def chat_events(sid, data):
    await sio.enter_room(sid, f'chat:{data["chat_id"]}')
    await publish_presence(data['chat_id'])
    return True


if __name__ == '__main__':
    uvicorn.run(app, host='127.0.0.1', port=int(sys.argv[1]), log_level='warning')
