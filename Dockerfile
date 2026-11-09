FROM python:3.12-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends mosquitto \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

ENV MQTT_HOST=127.0.0.1 \
    MQTT_PORT=1883 \
    PORT=7860

EXPOSE 7860
CMD ["sh", "-c", "mosquitto -c mosquitto.conf -d && sleep 1 && ([ -f .env ] || python generate_secret.py) && exec python run_all.py"]
