"""One-command launcher: checks the broker, starts all modules, opens the UI."""
import socket
import subprocess
import sys
import time
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SERVICES = ["src.greenhouse", "src.hacker", "src.ws_bridge"]


def broker_available(host: str, port: int, timeout: float = 1.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def main() -> None:
    sys.path.insert(0, str(ROOT))
    from src.config import HTTP_PORT, MQTT_HOST, MQTT_PORT

    if not broker_available(MQTT_HOST, MQTT_PORT):
        print(f"MQTT broker is not reachable at {MQTT_HOST}:{MQTT_PORT}.")
        print("Start it first:  mosquitto -c mosquitto.conf")
        print("Install:  macOS: brew install mosquitto | Linux: sudo apt install mosquitto")
        sys.exit(1)

    import os
    env = {**os.environ, "PYTHONUNBUFFERED": "1"}
    procs = [subprocess.Popen([sys.executable, "-m", name], cwd=ROOT, env=env)
             for name in SERVICES]
    time.sleep(1.5)
    webbrowser.open(f"http://localhost:{HTTP_PORT}")
    print("All services running. Press Ctrl+C to stop.")
    try:
        for proc in procs:
            proc.wait()
    except KeyboardInterrupt:
        print("\nStopping services...")
        for proc in procs:
            proc.terminate()


if __name__ == "__main__":
    main()