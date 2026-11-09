"""Write a fresh random SECRET into .env (run once before first start)."""
import secrets
from pathlib import Path

ENV_PATH = Path(__file__).resolve().parent / ".env"


def main() -> None:
    lines = []
    if ENV_PATH.exists():
        lines = [line for line in ENV_PATH.read_text(encoding="utf-8").splitlines()
                 if not line.startswith("SECRET=")]
    lines.append(f"SECRET={secrets.token_hex(32)}")
    ENV_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("New SECRET written to .env")


if __name__ == "__main__":
    main()
