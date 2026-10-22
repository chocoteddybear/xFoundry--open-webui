import asyncio
import json
import logging

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from open_webui.utils.auth import get_verified_user

log = logging.getLogger(__name__)

router = APIRouter()

FAULTS = {'malformed', 'duplicate', 'split'}


def sse(event: str, data: dict) -> str:
    return f'event: {event}\ndata: {json.dumps(data)}\n\n'


def build_script(message_id: str, faults: set[str], fail: bool) -> list[str]:
    def step(id: str, status: str, label: str | None = None) -> str:
        data = {'messageId': message_id, 'type': 'step', 'id': id, 'status': status}
        if label:
            data['label'] = label
        return sse('widget_delta', data)

    def metric(key: str, label: str, value) -> str:
        return sse('widget_delta', {'messageId': message_id, 'type': 'metric', 'key': key, 'label': label, 'value': value})

    events = [
        step('understand', 'running', 'Understanding the question'),
        metric('tokens', 'Tokens', 0),
        step('understand', 'complete'),
        step('retrieval', 'running', 'Searching docs'),
        metric('sources', 'Sources', 3),
    ]
    if 'malformed' in faults:
        events.append('event: widget_delta\ndata: {"messageId": "' + message_id + '", "type": "metric", "key": "tok\n\n')
    events.append(step('retrieval', 'complete'))
    if 'duplicate' in faults:
        events.append(step('retrieval', 'complete'))
    events.append(step('draft', 'running', 'Drafting the answer'))

    if fail:
        events.append(metric('tokens', 'Tokens', 38))
        events.append(sse('widget_error', {'messageId': message_id, 'message': 'Upstream timed out'}))
        return events

    for value in (38, 74, 121, 168, 212):
        events.append(metric('tokens', 'Tokens', value))
    events.append(metric('confidence', 'Confidence', 0.82))
    events.append(step('draft', 'complete'))
    events.append(sse('widget_done', {'messageId': message_id}))
    if 'duplicate' in faults:
        events.append(sse('widget_done', {'messageId': message_id}))
    return events


@router.get('/stream')
async def stream_live_session(
    request: Request,
    chat_id: str,
    message_id: str,
    faults: str = '',
    fail: bool = False,
    delay_ms: int = Query(400, ge=0, le=5000),
    user=Depends(get_verified_user),
):
    requested_faults = {fault for fault in faults.split(',') if fault in FAULTS}
    events = build_script(message_id, requested_faults, fail)

    async def generate():
        try:
            for event in events:
                if await request.is_disconnected():
                    log.debug('live session stream for %s:%s closed by client', chat_id, message_id)
                    return
                await asyncio.sleep(delay_ms / 1000)
                if 'split' in requested_faults:
                    # Uneven pieces make the browser receive events cut mid-line, which the parser must reassemble.
                    for start in range(0, len(event), 7):
                        yield event[start : start + 7]
                        await asyncio.sleep(0.01)
                else:
                    yield event
        except asyncio.CancelledError:
            log.debug('live session stream for %s:%s cancelled', chat_id, message_id)
            raise

    return StreamingResponse(
        generate(),
        media_type='text/event-stream',
        # X-Accel-Buffering stops nginx-style proxies from holding the stream until it ends.
        headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'},
    )
