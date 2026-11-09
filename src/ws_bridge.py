"""MQTT <-> WebSocket bridge and static file server for the web UI (single port)."""
import asyncio
import json
import os

from aiohttp import WSMsgType, web
import paho.mqtt.client as mqtt

from src import security
from src.config import (HTTP_PORT, MQTT_HOST, MQTT_PORT, TOPIC_ATTACK,
                        TOPIC_COMMANDS, TOPIC_MODE, TOPIC_SECURITY,
                        TOPIC_TELEMETRY, WEB_DIR)

clients: set = set()
loop: asyncio.AbstractEventLoop | None = None
mqtt_client: mqtt.Client | None = None

TOPIC_TYPES = {
    TOPIC_TELEMETRY: "telemetry",
    TOPIC_SECURITY: "security",
    TOPIC_ATTACK: "attack",
    TOPIC_MODE: "mode",
}


def on_connect(client, *_):
    for topic in TOPIC_TYPES:
        client.subscribe(topic)
    print("[bridge] connected to broker")


def on_message(_client, _userdata, msg) -> None:
    kind = TOPIC_TYPES.get(msg.topic)
    if kind:
        broadcast(json.dumps({"type": kind, "data": json.loads(msg.payload)},
                             ensure_ascii=False))


def broadcast(text: str) -> None:
    if clients and loop is not None:
        asyncio.run_coroutine_threadsafe(_broadcast(text), loop)


async def _broadcast(text: str) -> None:
    for ws in list(clients):
        try:
            await ws.send_str(text)
        except ConnectionResetError:
            clients.discard(ws)


async def ws_handler(request: web.Request) -> web.WebSocketResponse:
    ws = web.WebSocketResponse(heartbeat=30)
    await ws.prepare(request)
    clients.add(ws)
    try:
        async for msg in ws:
            if msg.type == WSMsgType.TEXT:
                handle_ui_message(msg.data)
    finally:
        clients.discard(ws)
    return ws


def handle_ui_message(raw: str) -> None:
    try:
        msg = json.loads(raw)
        mtype = msg["type"]
    except (json.JSONDecodeError, KeyError, TypeError):
        return
    if mtype == "command":  # legit admin command -> always signed
        mqtt_client.publish(TOPIC_COMMANDS,
                            security.sign_command(str(msg["action"]), msg["value"]))
    elif mtype == "attack":
        mqtt_client.publish(TOPIC_ATTACK, json.dumps({"on": bool(msg["on"])}))
    elif mtype == "mode":
        mqtt_client.publish(TOPIC_MODE, json.dumps({"mode": str(msg["mode"])}))


async def index(_request: web.Request) -> web.FileResponse:
    return web.FileResponse(WEB_DIR / "index.html")


async def on_startup(_app: web.Application) -> None:
    global loop
    loop = asyncio.get_running_loop()


def main() -> None:
    global mqtt_client
    mqtt_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="ws-bridge")
    mqtt_client.on_connect = on_connect
    mqtt_client.on_message = on_message
    mqtt_client.connect(MQTT_HOST, MQTT_PORT)
    mqtt_client.loop_start()

    app = web.Application()
    app.on_startup.append(on_startup)
    app.router.add_get("/", index)
    app.router.add_get("/ws", ws_handler)
    app.router.add_static("/", WEB_DIR)

    # cloud hosts (HF Spaces, Render) set PORT and require 0.0.0.0 binding
    port = int(os.getenv("PORT", str(HTTP_PORT)))
    host = "0.0.0.0" if os.getenv("PORT") else "127.0.0.1"
    print(f"[bridge] UI: http://localhost:{port} | ws: /ws on the same port")
    try:
        web.run_app(app, host=host, port=port)
    except KeyboardInterrupt:
        pass
    finally:
        mqtt_client.loop_stop()
        mqtt_client.disconnect()


if __name__ == "__main__":
    main()
