from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import Any


class CallEventHub:
    def __init__(self) -> None:
        self._listeners: dict[str, list[asyncio.Queue[dict[str, Any]]]] = defaultdict(list)

    def subscribe(self, call_id: str) -> asyncio.Queue[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._listeners[call_id].append(queue)
        return queue

    def unsubscribe(self, call_id: str, queue: asyncio.Queue[dict[str, Any]]) -> None:
        listeners = self._listeners.get(call_id, [])
        if queue in listeners:
            listeners.remove(queue)
        if not listeners and call_id in self._listeners:
            del self._listeners[call_id]

    async def publish(self, call_id: str, event: dict[str, Any]) -> None:
        for queue in self._listeners.get(call_id, []):
            await queue.put(event)


event_hub = CallEventHub()

