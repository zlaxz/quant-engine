#!/usr/bin/env python3
"""
Massive Socket - WebSocket streaming for real-time market data
"""

import asyncio
import json
import logging
import os
import websockets
from dataclasses import dataclass
from datetime import datetime
from typing import Optional, List, Callable, Dict

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@dataclass
class Tick:
    symbol: str
    price: float
    timestamp: datetime
    type: str

class MassiveSocket:
    def __init__(self, api_key=None, symbols=None, feed_type="stocks"):
        self.api_key = api_key or os.getenv("MASSIVE_KEY")
        self.symbols = symbols or []
        self.url = "wss://socket.polygon.io/stocks"
        self._ws = None
        self._running = False
        self._queue = asyncio.Queue()

    async def connect(self):
        logger.info(f"Connecting to {self.url}...")
        self._ws = await websockets.connect(self.url)

        # Auth
        await self._ws.send(json.dumps({"action": "auth", "params": self.api_key}))
        resp = await self._ws.recv()
        logger.info(f"Auth response: {resp}")

        # Subscribe
        if self.symbols:
            params = ",".join([f"T.{s}" for s in self.symbols])
            await self._ws.send(json.dumps({"action": "subscribe", "params": params}))
            logger.info(f"Subscribed to {self.symbols}")

        self._running = True

    async def stream(self):
        while self._running:
            try:
                msg = await self._ws.recv()
                data = json.loads(msg)
                for item in data:
                    if item.get('ev') == 'T':
                        yield Tick(
                            symbol=item['sym'],
                            price=item['p'],
                            timestamp=datetime.fromtimestamp(item['t']/1000),
                            type='trade'
                        )
            except Exception as e:
                logger.error(f"Stream error: {e}")
                await asyncio.sleep(1)

    async def close(self):
        self._running = False
        if self._ws:
            await self._ws.close()
