#!/usr/bin/env python3
"""
BLEnum BLE bridge (Python / bleak)
Scans BLE advertisements and pushes sightings over WebSocket.

  pip3 install -r requirements.txt
  python3 server.py

Default: ws://127.0.0.1:8787
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from typing import Any

try:
    from bleak import BleakScanner
except ImportError as e:
    raise SystemExit(
        "Missing bleak. Run: pip3 install -r requirements.txt\n" + str(e)
    ) from e

try:
    from websockets.asyncio.server import serve
    from websockets.server import ServerConnection
except ImportError:
    try:
        # Older websockets API
        from websockets import serve  # type: ignore
        from websockets.server import WebSocketServerProtocol as ServerConnection  # type: ignore
    except ImportError as e:
        raise SystemExit(
            "Missing websockets. Run: pip3 install -r requirements.txt\n" + str(e)
        ) from e

HOST = os.environ.get("BLENUM_BRIDGE_HOST", "127.0.0.1")
PORT = int(os.environ.get("BLENUM_BRIDGE_PORT", "8787"))
DEVICE_CAP = int(os.environ.get("BLENUM_DEVICE_CAP", "20"))
STALE_MS = int(os.environ.get("BLENUM_STALE_MS", "6000"))
BROADCAST_MS = float(os.environ.get("BLENUM_BROADCAST_MS", "200")) / 1000.0

devices: dict[str, dict[str, Any]] = {}
clients: set[Any] = set()
scanning = False
last_error = ""


def now_ms() -> int:
    return int(time.time() * 1000)


def prune() -> None:
    cutoff = now_ms() - STALE_MS
    dead = [k for k, v in devices.items() if v["seenAt"] < cutoff]
    for k in dead:
        del devices[k]


def sightings() -> list[dict[str, Any]]:
    prune()
    ranked = sorted(devices.values(), key=lambda d: d["rssi"], reverse=True)
    return ranked[:DEVICE_CAP]


def detection_callback(device: Any, advertisement_data: Any) -> None:
    global last_error
    address = getattr(device, "address", None) or str(device)
    name = getattr(device, "name", None) or getattr(advertisement_data, "local_name", None)
    rssi = getattr(advertisement_data, "rssi", None)
    if rssi is None:
        rssi = getattr(device, "rssi", -80)
    manufacturer_id = None
    md = getattr(advertisement_data, "manufacturer_data", None) or {}
    if md:
        manufacturer_id = next(iter(md.keys()))
    devices[address] = {
        "id": address,
        "name": name,
        "manufacturerId": manufacturer_id,
        "rssi": int(rssi) if rssi is not None else -80,
        "seenAt": now_ms(),
    }
    last_error = ""


async def broadcast(msg: dict[str, Any]) -> None:
    if not clients:
        return
    data = json.dumps(msg)
    dead: list[Any] = []
    for ws in list(clients):
        try:
            await ws.send(data)
        except Exception:
            dead.append(ws)
    for ws in dead:
        clients.discard(ws)


async def handler(ws: Any) -> None:
    clients.add(ws)
    print(f"[bridge] client connected ({len(clients)})")
    try:
        await ws.send(
            json.dumps(
                {
                    "type": "hello",
                    "scanning": scanning,
                    "error": last_error or None,
                    "port": PORT,
                }
            )
        )
        await ws.send(
            json.dumps(
                {
                    "type": "sightings",
                    "devices": sightings(),
                    "scanning": scanning,
                }
            )
        )
        async for _ in ws:
            pass
    finally:
        clients.discard(ws)
        print(f"[bridge] client disconnected ({len(clients)})")


async def broadcaster() -> None:
    while True:
        await broadcast(
            {
                "type": "sightings",
                "devices": sightings(),
                "scanning": scanning,
                "error": last_error or None,
            }
        )
        await asyncio.sleep(BROADCAST_MS)


async def run_scanner() -> None:
    global scanning, last_error
    while True:
        try:
            print("[bridge] starting BLE scanner…")
            async with BleakScanner(detection_callback=detection_callback):
                scanning = True
                last_error = ""
                print("[bridge] Scanning for BLE advertisements…")
                await broadcast({"type": "status", "scanning": True})
                await asyncio.Future()  # run forever until cancelled/error
        except asyncio.CancelledError:
            scanning = False
            raise
        except Exception as err:
            scanning = False
            last_error = str(err)
            print(f"[bridge] scanner error: {last_error}")
            await broadcast(
                {"type": "status", "scanning": False, "error": last_error}
            )
            await asyncio.sleep(2)


async def main() -> None:
    print(f"[bridge] listening on ws://{HOST}:{PORT}")
    print("[bridge] Keep this running, then choose Bridge → Connect in BLEnum.")
    print("[bridge] macOS: allow Bluetooth for Terminal if prompted.")

    async with serve(handler, HOST, PORT):
        await asyncio.gather(run_scanner(), broadcaster())


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[bridge] shutting down…")
