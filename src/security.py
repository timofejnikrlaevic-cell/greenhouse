"""HMAC signing and verification of commands (anti-forgery + anti-replay)."""
import hashlib
import hmac
import json
import secrets
import time

from src.config import NONCE_CACHE_SIZE, REPLAY_WINDOW, SECRET

_seen_nonces: set[str] = set()


def sign_command(action: str, value) -> str:
    """Build a signed command payload as JSON string."""
    payload = {
        "action": action,
        "value": value,
        "ts": round(time.time(), 3),
        "nonce": secrets.token_hex(8),
    }
    payload["hmac"] = _hmac_hex(payload)
    return json.dumps(payload, ensure_ascii=False)


def verify_command(raw: str) -> tuple[bool, str]:
    """Return (ok, reason). Checks signature, freshness and nonce reuse."""
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return False, "malformed"
    if not isinstance(payload, dict) or not {"action", "value", "ts", "nonce", "hmac"} <= payload.keys():
        return False, "no signature"

    if not hmac.compare_digest(_hmac_hex(payload), str(payload["hmac"])):
        return False, "bad signature"

    if abs(time.time() - float(payload["ts"])) > REPLAY_WINDOW:
        return False, "stale timestamp"

    nonce = str(payload["nonce"])
    if nonce in _seen_nonces:
        return False, "replayed nonce"
    _seen_nonces.add(nonce)
    if len(_seen_nonces) > NONCE_CACHE_SIZE:
        _seen_nonces.pop()
    return True, "ok"


def _hmac_hex(payload: dict) -> str:
    message = f"{payload['action']}{payload['value']}{payload['ts']}{payload['nonce']}"
    return hmac.new(SECRET.encode(), message.encode(), hashlib.sha256).hexdigest()
