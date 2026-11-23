import asyncio
import json
import logging
import subprocess
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from threading import Event, Lock, Thread

from confluent_kafka import Consumer, Producer
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# --------------------------------------------------
# CONFIGURATION
# --------------------------------------------------

MONITOR_INTERVAL_SECONDS = 10
AUTO_HEAL_COOLDOWN_SECONDS = 60
MAX_EVENTS = 200
COMMAND_TIMEOUT_SECONDS = 6
HEALING_RETRY_ATTEMPTS = 5
HEALING_RETRY_DELAY_SECONDS = 2

KAFKA_BOOTSTRAP_SERVERS = "localhost:9092"
KAFKA_TOPIC = "network-events"
KAFKA_CONSUMER_GROUP = "network-healing-dashboard"


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("network-healing")

# --------------------------------------------------
# SHARED STATE
# --------------------------------------------------

events = []
events_lock = Lock()
status_lock = Lock()
healing_lock = Lock()

kafka_events = []
kafka_events_lock = Lock()

previous_network_status = None
last_auto_heal_time = 0.0

kafka_producer = None
kafka_consumer_thread = None
kafka_consumer_stop = Event()
kafka_producer_available = False
kafka_consumer_available = False


# --------------------------------------------------
# KAFKA PRODUCER
# --------------------------------------------------

def kafka_delivery_report(error, message):
    if error is not None:
        logger.error("Kafka delivery failed: %s", error)
    else:
        logger.info(
            "Kafka event delivered: topic=%s partition=%s offset=%s",
            message.topic(),
            message.partition(),
            message.offset(),
        )


def publish_to_kafka(event):
    global kafka_producer_available

    if kafka_producer is None:
        return

    try:
        kafka_producer.produce(
            topic=KAFKA_TOPIC,
            key=event["id"],
            value=json.dumps(event),
            callback=kafka_delivery_report,
        )
        kafka_producer.poll(0)
        kafka_producer_available = True
    except BufferError:
        try:
            kafka_producer.poll(1)
            kafka_producer.produce(
                topic=KAFKA_TOPIC,
                key=event["id"],
                value=json.dumps(event),
                callback=kafka_delivery_report,
            )
            kafka_producer.poll(0)
            kafka_producer_available = True
        except Exception:
            kafka_producer_available = False
            logger.exception("Could not queue event in Kafka.")
    except Exception:
        kafka_producer_available = False
        logger.exception("Kafka publish failed; local event history is retained.")


def initialize_kafka_producer():
    global kafka_producer, kafka_producer_available

    try:
        kafka_producer = Producer({
            "bootstrap.servers": KAFKA_BOOTSTRAP_SERVERS,
            "client.id": "autonomous-network-healing-api",
            "enable.idempotence": True,
            "acks": "all",
        })
        kafka_producer.list_topics(timeout=5)
        kafka_producer_available = True
        logger.info(
            "Kafka Producer connected: %s; topic=%s",
            KAFKA_BOOTSTRAP_SERVERS,
            KAFKA_TOPIC,
        )
    except Exception:
        kafka_producer = None
        kafka_producer_available = False
        logger.exception("Kafka Producer unavailable; API will continue.")


def shutdown_kafka_producer():
    global kafka_producer, kafka_producer_available

    if kafka_producer is not None:
        try:
            remaining = kafka_producer.flush(10)
            if remaining:
                logger.warning("%s Kafka message(s) were not delivered.", remaining)
        except Exception:
            logger.exception("Error flushing Kafka Producer.")

    kafka_producer = None
    kafka_producer_available = False


# --------------------------------------------------
# KAFKA CONSUMER
# --------------------------------------------------

def kafka_consumer_worker():
    """
    Run the Kafka Consumer in its own thread.
    Consumed messages are cached for the /kafka/events endpoint.
    """
    global kafka_consumer_available

    consumer = None
    try:
        consumer = Consumer({
            "bootstrap.servers": KAFKA_BOOTSTRAP_SERVERS,
            "group.id": KAFKA_CONSUMER_GROUP,
            "auto.offset.reset": "earliest",
            "enable.auto.commit": True,
        })
        consumer.subscribe([KAFKA_TOPIC])
        kafka_consumer_available = True
        logger.info(
            "Kafka Consumer subscribed to '%s' (group=%s).",
            KAFKA_TOPIC,
            KAFKA_CONSUMER_GROUP,
        )

        while not kafka_consumer_stop.is_set():
            message = consumer.poll(1.0)

            if message is None:
                continue

            if message.error():
                logger.error("Kafka Consumer error: %s", message.error())
                continue

            try:
                event = json.loads(message.value().decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                logger.exception("Received a Kafka message that is not valid JSON.")
                continue

            # Keep newest consumed messages first for the dashboard.
            with kafka_events_lock:
                kafka_events.insert(0, event)
                del kafka_events[MAX_EVENTS:]

            logger.info(
                "Kafka event consumed: type=%s partition=%s offset=%s",
                event.get("type", "UNKNOWN"),
                message.partition(),
                message.offset(),
            )

    except Exception:
        kafka_consumer_available = False
        logger.exception("Kafka Consumer stopped because of an error.")
    finally:
        kafka_consumer_available = False
        if consumer is not None:
            consumer.close()
        logger.info("Kafka Consumer closed.")


def start_kafka_consumer():
    global kafka_consumer_thread

    kafka_consumer_stop.clear()
    kafka_consumer_thread = Thread(
        target=kafka_consumer_worker,
        name="kafka-event-consumer",
        daemon=True,
    )
    kafka_consumer_thread.start()


def stop_kafka_consumer():
    kafka_consumer_stop.set()

    if kafka_consumer_thread is not None:
        kafka_consumer_thread.join(timeout=5)


# --------------------------------------------------
# EVENT STORAGE
# --------------------------------------------------

def record_event(event_type, message, severity="info", device="network"):
    timestamp = datetime.now(timezone.utc).isoformat()
    event = {
        "id": str(uuid.uuid4()),
        "timestamp": timestamp,
        "type": event_type,
        "message": message,
        "severity": severity,
        "device": device,
    }

    with events_lock:
        events.insert(0, event)
        del events[MAX_EVENTS:]

    publish_to_kafka(event)
    return event


def record_status_change(current_status):
    global previous_network_status

    with status_lock:
        changed = current_status != previous_network_status
        if changed:
            previous_network_status = current_status.copy()

    if not changed:
        return False

    severity = "warning" if "down" in current_status.values() else "info"
    record_event(
        "NETWORK_STATUS_CHANGED",
        (
            f"Router 1: {current_status['router1']}, "
            f"Router 2: {current_status['router2']}, "
            f"Server: {current_status['server']}"
        ),
        severity,
        "network",
    )
    return True


# --------------------------------------------------
# DOCKER HELPERS
# --------------------------------------------------

def run_command(command, timeout=COMMAND_TIMEOUT_SECONDS):
    try:
        return subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return None


def get_container_status(container_name):
    result = run_command([
        "docker", "inspect", "-f", "{{.State.Running}}", container_name
    ])

    if result and result.returncode == 0:
        return "running" if result.stdout.strip().lower() == "true" else "down"
    return "down"


def check_server_connectivity():
    if get_container_status("router1") != "running":
        return False

    result = run_command([
        "docker", "exec", "router1", "ping",
        "-c", "1", "-W", "2", "server"
    ])
    return result is not None and result.returncode == 0


def get_network_snapshot():
    router1 = get_container_status("router1")
    router2 = get_container_status("router2")
    server_container = get_container_status("server")

    if router1 != "running" or server_container != "running":
        server = "down"
    else:
        server = "healthy" if check_server_connectivity() else "down"

    return {"router1": router1, "router2": router2, "server": server}


# --------------------------------------------------
# SERVER HEALING
# --------------------------------------------------

def perform_server_healing():
    with healing_lock:
        if get_container_status("router1") != "running":
            record_event(
                "HEALING_FAILED",
                "Cannot recover server because router1 is down.",
                "error",
                "router1",
            )
            return {
                "message": "Router1 is down. Start router1 first.",
                "action": "HEALING_FAILED",
                "recovery": "FAILED",
            }

        if check_server_connectivity():
            record_event(
                "HEALING_CHECK",
                "Server is already reachable. No recovery needed.",
                "info",
                "server",
            )
            return {
                "message": "Server is already healthy",
                "action": "NO_ACTION",
                "recovery": "VERIFIED",
            }

        record_event(
            "HEALING_STARTED",
            "Server connectivity failed. Attempting server recovery.",
            "warning",
            "server",
        )

        restart = run_command(["docker", "start", "server"], timeout=15)
        if restart is None or restart.returncode != 0:
            details = (
                restart.stderr.strip()
                if restart is not None
                else "Docker command timed out or Docker CLI was unavailable."
            )
            if not details and restart is not None:
                details = restart.stdout.strip() or "Docker could not start the server."

            record_event(
                "HEALING_FAILED",
                f"Unable to restart server: {details}",
                "error",
                "server",
            )
            return {
                "message": "Unable to restart server",
                "details": details,
                "action": "HEALING_FAILED",
                "recovery": "FAILED",
            }

        for attempt in range(1, HEALING_RETRY_ATTEMPTS + 1):
            time.sleep(HEALING_RETRY_DELAY_SECONDS)
            if (
                get_container_status("server") == "running"
                and check_server_connectivity()
            ):
                record_event(
                    "HEALING_SUCCESS",
                    "Server recovered and connectivity verified.",
                    "success",
                    "server",
                )
                record_status_change(get_network_snapshot())
                return {
                    "message": "Server recovered successfully",
                    "action": "RESTART_SERVER",
                    "recovery": "VERIFIED",
                    "attempts": attempt,
                }

        record_event(
            "HEALING_UNVERIFIED",
            "Server was started, but connectivity could not be verified.",
            "error",
            "server",
        )
        return {
            "message": "Server restarted but recovery could not be verified",
            "action": "RESTART_SERVER",
            "recovery": "FAILED",
        }


# --------------------------------------------------
# BACKGROUND NETWORK MONITOR
# --------------------------------------------------

async def monitor_network():
    global last_auto_heal_time
    await asyncio.sleep(3)

    while True:
        try:
            current_status = await asyncio.to_thread(get_network_snapshot)
            record_status_change(current_status)

            # Automatic recovery currently covers the server only.
            if (
                current_status["router1"] == "running"
                and current_status["server"] == "down"
            ):
                now = time.monotonic()
                if now - last_auto_heal_time >= AUTO_HEAL_COOLDOWN_SECONDS:
                    last_auto_heal_time = now
                    record_event(
                        "AUTO_HEAL_TRIGGERED",
                        "Monitor detected a server failure and triggered recovery.",
                        "warning",
                        "server",
                    )
                    await asyncio.to_thread(perform_server_healing)

        except asyncio.CancelledError:
            raise
        except Exception as exc:
            record_event(
                "MONITOR_ERROR",
                f"Background monitor error: {exc}",
                "error",
                "network",
            )

        await asyncio.sleep(MONITOR_INTERVAL_SECONDS)


# --------------------------------------------------
# FASTAPI LIFECYCLE
# --------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    initialize_kafka_producer()

    record_event(
        "MONITOR_STARTED",
        "Automatic network monitoring started.",
        "success",
        "network",
    )

    start_kafka_consumer()
    monitor_task = asyncio.create_task(monitor_network())

    try:
        yield
    finally:
        monitor_task.cancel()
        try:
            await monitor_task
        except asyncio.CancelledError:
            pass

        stop_kafka_consumer()
        shutdown_kafka_producer()


app = FastAPI(title="Autonomous Network Healing API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------
# API ENDPOINTS
# --------------------------------------------------

@app.get("/")
def home():
    return {
        "message": "Network Healing API is running",
        "automatic_monitoring": True,
        "kafka_producer_connected": kafka_producer_available,
        "kafka_consumer_connected": kafka_consumer_available,
        "kafka_topic": KAFKA_TOPIC,
    }


@app.get("/health")
def health():
    return {
        "status": "healthy",
        "kafka_producer_connected": kafka_producer_available,
        "kafka_consumer_connected": kafka_consumer_available,
    }


@app.get("/network/status")
def network_status():
    current_status = get_network_snapshot()
    record_status_change(current_status)
    return current_status


@app.get("/events")
def get_events():
    with events_lock:
        snapshot = list(events)
    return {"total": len(snapshot), "events": snapshot}


@app.get("/kafka/status")
def kafka_status():
    return {
        "producer_connected": kafka_producer_available,
        "consumer_connected": kafka_consumer_available,
        "bootstrap_servers": KAFKA_BOOTSTRAP_SERVERS,
        "topic": KAFKA_TOPIC,
        "consumer_group": KAFKA_CONSUMER_GROUP,
    }


@app.get("/kafka/events")
def get_kafka_events():
    with kafka_events_lock:
        snapshot = list(kafka_events)
    return {
        "total": len(snapshot),
        "events": snapshot,
        "source": "Kafka consumer cache",
    }


@app.post("/network/heal")
def heal_network():
    return perform_server_healing()