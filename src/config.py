"""Central configuration: topics, ports, constants. Reads .env if present."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _load_env(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())


_load_env(ROOT / ".env")

MQTT_HOST = os.getenv("MQTT_HOST", "localhost")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
SECRET = os.getenv("SECRET", "dev-secret-change-me")

HTTP_PORT = 8000
WEB_DIR = ROOT / "web"

TOPIC_TELEMETRY = "greenhouse/telemetry"
TOPIC_COMMANDS = "greenhouse/commands"
TOPIC_SECURITY = "greenhouse/security"
TOPIC_ATTACK = "system/attack_control"
TOPIC_MODE = "system/mode"

TELEMETRY_INTERVAL = 2.0        # seconds between telemetry updates
REPLAY_WINDOW = 5.0             # max command age, seconds
NONCE_CACHE_SIZE = 1000         # anti-replay memory size
TEMP_ALARM = 40.0               # critical temperature, Celsius
TEMP_BASELINE = 24.0            # comfortable temperature, Celsius
HUM_BASELINE = 45.0             # comfortable soil humidity, %
