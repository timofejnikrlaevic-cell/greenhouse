"""Greenhouse device: telemetry publisher, actuator, HMAC verifier in defended mode."""
import json
import random
import time

import paho.mqtt.client as mqtt

from src import security
from src.config import (HUM_BASELINE, MQTT_HOST, MQTT_PORT, TEMP_ALARM,
                        TEMP_BASELINE, TELEMETRY_INTERVAL, TOPIC_COMMANDS,
                        TOPIC_MODE, TOPIC_SECURITY, TOPIC_TELEMETRY)

state = {
    "temp": 24.0,
    "humidity": 45.0,
    "pump": False,
    "heater": 0,
    "mode": "normal",
    "alarm": False,
}


def on_connect(client, *_):
    client.subscribe(TOPIC_COMMANDS)
    client.subscribe(TOPIC_MODE)
    print("[greenhouse] connected to broker")


def apply_action(action: str, value) -> None:
    if action == "pump":
        state["pump"] = bool(value)
    elif action == "heater":
        state["heater"] = max(0, min(100, int(value)))


def on_message(client, _userdata, msg) -> None:
    text = msg.payload.decode("utf-8", "replace")

    if msg.topic == TOPIC_MODE:
        try:
            state["mode"] = json.loads(text).get("mode", "normal")
        except json.JSONDecodeError:
            return
        print(f"[greenhouse] mode -> {state['mode']}")
        return

    if state["mode"] == "defended":
        ok, reason = security.verify_command(text)
        if not ok:
            print(f"[greenhouse] REJECTED ({reason}): {text}")
            _publish_event(client, "rejected", reason, text)
            return

    try:
        cmd = json.loads(text)
        apply_action(str(cmd["action"]), cmd["value"])
    except (json.JSONDecodeError, KeyError, TypeError, ValueError):
        print(f"[greenhouse] malformed command ignored: {text}")
        return

    print(f"[greenhouse] applied: {cmd['action']}={cmd['value']}")
    _publish_event(client, "accepted", "ok", text)


def _publish_event(client, event: str, reason: str, payload: str) -> None:
    client.publish(TOPIC_SECURITY, json.dumps(
        {"event": event, "reason": reason, "payload": payload}, ensure_ascii=False))


def physics_step() -> None:
    """Heater warms the air, pump moistens the soil; values relax to comfortable baseline."""
    state["temp"] += (state["heater"] / 100 * 0.9
                      - (state["temp"] - TEMP_BASELINE) * 0.02
                      + random.uniform(-0.1, 0.1))
    state["humidity"] += ((10 if state["pump"] else 0)
                          - (state["humidity"] - HUM_BASELINE) * 0.05
                          + random.uniform(-0.2, 0.2))
    state["temp"] = max(5.0, min(80.0, state["temp"]))
    state["humidity"] = max(5.0, min(95.0, state["humidity"]))
    state["alarm"] = state["temp"] >= TEMP_ALARM


def main() -> None:
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="greenhouse")
    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(MQTT_HOST, MQTT_PORT)
    client.loop_start()
    print("[greenhouse] started")
    try:
        while True:
            physics_step()
            client.publish(TOPIC_TELEMETRY,
                           json.dumps(state | {"ts": time.time()}, ensure_ascii=False))
            time.sleep(TELEMETRY_INTERVAL)
    except KeyboardInterrupt:
        pass
    finally:
        client.loop_stop()
        client.disconnect()


if __name__ == "__main__":
    main()