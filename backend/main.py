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
from ncclient import manager
import xml.etree.ElementTree as ET

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

# NETCONF lab devices (independent Netopeer2 Docker containers)
NETCONF_USERNAME = "netconf"
NETCONF_PASSWORD = "netconf"
NETCONF_TIMEOUT_SECONDS = 15
NETCONF_MODULE_NAMESPACE = "urn:autonomous-network"

NETCONF_DEVICES = {
    "router1": {"host": "127.0.0.1", "port": 830, "container": "netconf-device"},
    "router2": {"host": "127.0.0.1", "port": 831, "container": "netconf-router2"},
    "server": {"host": "127.0.0.1", "port": 832, "container": "netconf-server"},
}

last_netconf_operational_status = {
    device_name: None for device_name in NETCONF_DEVICES
}
netconf_sync_lock = Lock()


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
last_auto_heal_time = {"router1": 0.0, "router2": 0.0, "server": 0.0}

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

def record_event(event_type, message, severity="info", device="network", metadata=None):
    timestamp = datetime.now(timezone.utc).isoformat()
    event = {
        "id": str(uuid.uuid4()),
        "timestamp": timestamp,
        "type": event_type,
        "message": message,
        "severity": severity,
        "device": device,
    }

    if metadata:
        event.update(metadata)

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
# MULTI-DEVICE HEALING
# --------------------------------------------------

HEALABLE_DEVICES = {
    "router1": "router1",
    "router2": "router2",
    "server": "server",
}


def verify_device_recovery(device_name):
    """Verify the simulated container is running; verify server reachability too."""
    if get_container_status(device_name) != "running":
        return False

    if device_name == "server":
        return check_server_connectivity()

    return True


def perform_device_healing(device_name):
    """Start a stopped simulated device and verify its recovery."""
    if device_name not in HEALABLE_DEVICES:
        return {
            "message": f"Unknown device: {device_name}",
            "action": "HEALING_FAILED",
            "recovery": "FAILED",
        }

    with healing_lock:
        # Router 1 provides the path used to verify server connectivity.
        if device_name == "server" and get_container_status("router1") != "running":
            record_event(
                "HEALING_FAILED",
                "Cannot recover server because router1 is down.",
                "error",
                "server",
            )
            return {
                "message": "Router1 is down. Recover router1 first.",
                "action": "HEALING_FAILED",
                "recovery": "FAILED",
            }

        if verify_device_recovery(device_name):
            record_event(
                "HEALING_CHECK",
                f"{device_name} is already healthy. No recovery needed.",
                "info",
                device_name,
            )
            return {
                "message": f"{device_name} is already healthy",
                "action": "NO_ACTION",
                "recovery": "VERIFIED",
            }

        record_event(
            "HEALING_STARTED",
            f"{device_name} is unavailable. Attempting container recovery.",
            "warning",
            device_name,
        )

        restart = run_command(["docker", "start", HEALABLE_DEVICES[device_name]], timeout=15)
        if restart is None or restart.returncode != 0:
            details = (
                restart.stderr.strip()
                if restart is not None
                else "Docker command timed out or Docker CLI was unavailable."
            )
            if not details and restart is not None:
                details = restart.stdout.strip() or f"Docker could not start {device_name}."

            record_event(
                "HEALING_FAILED",
                f"Unable to start {device_name}: {details}",
                "error",
                device_name,
            )
            return {
                "message": f"Unable to recover {device_name}",
                "details": details,
                "action": "HEALING_FAILED",
                "recovery": "FAILED",
            }

        for attempt in range(1, HEALING_RETRY_ATTEMPTS + 1):
            time.sleep(HEALING_RETRY_DELAY_SECONDS)
            if verify_device_recovery(device_name):
                record_event(
                    "HEALING_SUCCESS",
                    f"{device_name} recovered and verification succeeded.",
                    "success",
                    device_name,
                )
                record_status_change(get_network_snapshot())
                return {
                    "message": f"{device_name} recovered successfully",
                    "action": "START_CONTAINER",
                    "recovery": "VERIFIED",
                    "attempts": attempt,
                    "device": device_name,
                }

        record_event(
            "HEALING_UNVERIFIED",
            f"{device_name} was started, but recovery could not be verified.",
            "error",
            device_name,
        )
        return {
            "message": f"{device_name} started but recovery could not be verified",
            "action": "START_CONTAINER",
            "recovery": "FAILED",
            "device": device_name,
        }


def perform_server_healing():
    """Backward-compatible wrapper for the existing server recovery endpoint."""
    return perform_device_healing("server")


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
            await synchronize_netconf_status(current_status)

            # Recover stopped routers first. Server recovery depends on router1.
            failed_devices = []
            if current_status["router1"] != "running":
                failed_devices.append("router1")
            if current_status["router2"] != "running":
                failed_devices.append("router2")
            if current_status["server"] == "down" and current_status["router1"] == "running":
                failed_devices.append("server")

            now = time.monotonic()
            for device_name in failed_devices:
                if now - last_auto_heal_time[device_name] < AUTO_HEAL_COOLDOWN_SECONDS:
                    continue

                last_auto_heal_time[device_name] = now
                record_event(
                    "AUTO_HEAL_TRIGGERED",
                    f"Monitor detected a {device_name} failure and triggered recovery.",
                    "warning",
                    device_name,
                )
                await asyncio.to_thread(perform_device_healing, device_name)

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
    # Preserve the original endpoint: it continues to recover the server.
    return perform_server_healing()


@app.post("/network/heal/{device_name}")
def heal_device(device_name: str):
    return perform_device_healing(device_name.lower())


# --------------------------------------------------
# NETCONF HELPERS AND API ENDPOINTS
# --------------------------------------------------

def get_netconf_device_configuration(device_name="router1"):
    """
    Retrieve one device's custom autonomous-network configuration via NETCONF.
    Each simulated device has an independent Netopeer2/Sysrepo datastore.
    """
    if device_name not in NETCONF_DEVICES:
        raise ValueError(f"Unknown NETCONF device: {device_name}")

    endpoint = NETCONF_DEVICES[device_name]
    with manager.connect(
        host=endpoint["host"],
        port=endpoint["port"],
        username=NETCONF_USERNAME,
        password=NETCONF_PASSWORD,
        hostkey_verify=False,  # Local development lab only.
        device_params={"name": "default"},
        allow_agent=False,
        look_for_keys=False,
        timeout=NETCONF_TIMEOUT_SECONDS,
    ) as connection:
        response = connection.get_config(
            source="running",
            filter=(
                "subtree",
                '<autonomous-network xmlns="urn:autonomous-network"/>',
            ),
        )
        return response.data_xml


def parse_netconf_device_configuration(xml_data):
    """Convert the returned YANG XML into dashboard-friendly JSON."""
    root = ET.fromstring(xml_data)
    namespace = {"an": NETCONF_MODULE_NAMESPACE}

    network = root.find(".//an:autonomous-network", namespace)
    if network is None:
        raise ValueError(
            "The autonomous-network configuration was not found in NETCONF data."
        )

    device_name = network.findtext("an:device-name", default="", namespaces=namespace)
    management_ip = network.findtext(
        "an:management-ip", default="", namespaces=namespace
    )

    interfaces = []
    for interface in network.findall("an:interfaces", namespace):
        interfaces.append({
            "name": interface.findtext(
                "an:name", default="", namespaces=namespace
            ),
            "admin_status": interface.findtext(
                "an:admin-status", default="unknown", namespaces=namespace
            ),
            "operational_status": interface.findtext(
                "an:operational-status", default="unknown", namespaces=namespace
            ),
        })

    return {
        "device_name": device_name,
        "management_ip": management_ip,
        "interfaces": interfaces,
    }


def update_netconf_operational_status(device_name, status):
    """
    Synchronize the observed Docker state into the selected device's YANG data.
    The lab model stores operational-status in the running datastore.
    """
    if device_name not in NETCONF_DEVICES:
        raise ValueError(f"Unknown NETCONF device: {device_name}")
    if status not in {"up", "down"}:
        raise ValueError("NETCONF operational status must be 'up' or 'down'.")

    endpoint = NETCONF_DEVICES[device_name]

    with netconf_sync_lock:
        previous_status = last_netconf_operational_status[device_name]
        if status == previous_status:
            return False

        # On the first successful synchronization, compare against the value
        # already present in the device datastore so we do not emit a false
        # UNKNOWN transition when the configured value is already correct.
        if previous_status is None:
            try:
                current_xml = get_netconf_device_configuration(device_name)
                current_data = parse_netconf_device_configuration(current_xml)
                interfaces = current_data.get("interfaces", [])
                current_status = next(
                    (
                        item.get("operational_status")
                        for item in interfaces
                        if item.get("name") == "eth0"
                    ),
                    None,
                )
                previous_status = current_status or "unknown"
            except Exception:
                previous_status = "unknown"

            if previous_status == status:
                last_netconf_operational_status[device_name] = status
                return False

        config_xml = f"""
        <config xmlns="urn:ietf:params:xml:ns:netconf:base:1.0">
          <autonomous-network xmlns="{NETCONF_MODULE_NAMESPACE}">
            <interfaces>
              <name>eth0</name>
              <operational-status>{status}</operational-status>
            </interfaces>
          </autonomous-network>
        </config>
        """

        with manager.connect(
            host=endpoint["host"],
            port=endpoint["port"],
            username=NETCONF_USERNAME,
            password=NETCONF_PASSWORD,
            hostkey_verify=False,  # Local development lab only.
            device_params={"name": "default"},
            allow_agent=False,
            look_for_keys=False,
            timeout=NETCONF_TIMEOUT_SECONDS,
        ) as connection:
            connection.edit_config(target="running", config=config_xml)

        last_netconf_operational_status[device_name] = status
        logger.info(
            "NETCONF operational-status synchronized: device=%s eth0=%s",
            device_name,
            status,
        )

        record_event(
            "NETCONF_OPERATIONAL_STATUS_CHANGED",
            (
                f"{device_name} interface eth0 operational status changed "
                f"from {previous_status.upper()} to {status.upper()}."
            ),
            "warning" if status == "down" else "success",
            device_name,
            metadata={
                "interface": "eth0",
                "previous_status": previous_status,
                "operational_status": status,
                "source": "NETCONF/YANG",
                "netconf_host": endpoint["host"],
                "netconf_port": endpoint["port"],
            },
        )
        return True


async def synchronize_netconf_status(network_status):
    """Synchronize each device's observed Docker state to its own NETCONF agent."""
    device_statuses = {
        "router1": "up" if network_status.get("router1") == "running" else "down",
        "router2": "up" if network_status.get("router2") == "running" else "down",
        "server": "up" if network_status.get("server") == "healthy" else "down",
    }

    for device_name, operational_status in device_statuses.items():
        try:
            await asyncio.to_thread(
                update_netconf_operational_status,
                device_name,
                operational_status,
            )
        except Exception:
            # A NETCONF failure for one device must not stop monitoring,
            # Kafka events, healing, or synchronization of the other devices.
            logger.exception(
                "Could not synchronize NETCONF status for %s to '%s'.",
                device_name,
                operational_status,
            )


@app.get("/netconf/status")
def netconf_status():
    """Check NETCONF connectivity for all configured lab devices."""
    device_results = []
    for device_name, endpoint in NETCONF_DEVICES.items():
        try:
            with manager.connect(
                host=endpoint["host"],
                port=endpoint["port"],
                username=NETCONF_USERNAME,
                password=NETCONF_PASSWORD,
                hostkey_verify=False,  # Local development lab only.
                device_params={"name": "default"},
                allow_agent=False,
                look_for_keys=False,
                timeout=NETCONF_TIMEOUT_SECONDS,
            ):
                device_results.append({
                    "device": device_name,
                    "connected": True,
                    "host": endpoint["host"],
                    "port": endpoint["port"],
                    "server": "Netopeer2",
                    "protocol": "NETCONF over SSH",
                })
        except Exception as exc:
            logger.exception("NETCONF connection check failed for %s.", device_name)
            device_results.append({
                "device": device_name,
                "connected": False,
                "host": endpoint["host"],
                "port": endpoint["port"],
                "server": "Netopeer2",
                "error": str(exc),
            })

    # Keep the original top-level fields for compatibility with the existing
    # Network Devices frontend, while exposing the complete device list.
    router1_result = next(
        item for item in device_results if item["device"] == "router1"
    )
    return {
        "connected": router1_result["connected"],
        "host": router1_result["host"],
        "port": router1_result["port"],
        "server": "Netopeer2",
        "protocol": "NETCONF over SSH",
        "devices": device_results,
        "all_connected": all(item["connected"] for item in device_results),
    }


@app.get("/netconf/devices")
def netconf_devices():
    """Read the YANG configuration from all three independent NETCONF agents."""
    results = []
    for device_name, endpoint in NETCONF_DEVICES.items():
        try:
            xml_data = get_netconf_device_configuration(device_name)
            device_data = parse_netconf_device_configuration(xml_data)
            results.append({
                "device": device_name,
                "success": True,
                "connected": True,
                "host": endpoint["host"],
                "port": endpoint["port"],
                "configuration": device_data,
                "raw_xml": xml_data,
            })
        except Exception as exc:
            logger.exception(
                "Could not retrieve NETCONF configuration for %s.", device_name
            )
            results.append({
                "device": device_name,
                "success": False,
                "connected": False,
                "host": endpoint["host"],
                "port": endpoint["port"],
                "error": str(exc),
            })

    return {
        "success": all(item["success"] for item in results),
        "total": len(results),
        "devices": results,
        "source": "Netopeer2 / Sysrepo via NETCONF",
    }


@app.get("/netconf/device/{device_name}")
def netconf_device_by_name(device_name: str):
    """Read one named device's configuration through its NETCONF agent."""
    if device_name not in NETCONF_DEVICES:
        return {
            "success": False,
            "message": f"Unknown NETCONF device: {device_name}",
            "available_devices": list(NETCONF_DEVICES),
        }

    try:
        xml_data = get_netconf_device_configuration(device_name)
        device_data = parse_netconf_device_configuration(xml_data)
        endpoint = NETCONF_DEVICES[device_name]
        return {
            "success": True,
            "device_name": device_name,
            "host": endpoint["host"],
            "port": endpoint["port"],
            "source": "Netopeer2 / Sysrepo via NETCONF",
            "device": device_data,
            "raw_xml": xml_data,
        }
    except Exception as exc:
        logger.exception(
            "Could not retrieve %s configuration over NETCONF.", device_name
        )
        return {
            "success": False,
            "message": f"Could not retrieve {device_name} NETCONF configuration.",
            "error": str(exc),
        }


@app.get("/netconf/device")
def netconf_device():
    """Backward-compatible endpoint: read Router 1 configuration."""
    try:
        xml_data = get_netconf_device_configuration("router1")
        device_data = parse_netconf_device_configuration(xml_data)
        return {
            "success": True,
            "source": "Netopeer2 / Sysrepo via NETCONF",
            "device": device_data,
            "raw_xml": xml_data,
        }
    except Exception as exc:
        logger.exception("Could not retrieve Router 1 configuration over NETCONF.")
        return {
            "success": False,
            "message": "Could not retrieve NETCONF device configuration.",
            "error": str(exc),
        }


@app.post("/netconf/sync")
async def sync_netconf_now():
    """Synchronize all NETCONF agents from the current Docker snapshot."""
    current_status = await asyncio.to_thread(get_network_snapshot)
    device_statuses = {
        "router1": "up" if current_status.get("router1") == "running" else "down",
        "router2": "up" if current_status.get("router2") == "running" else "down",
        "server": "up" if current_status.get("server") == "healthy" else "down",
    }

    results = []
    for device_name, operational_status in device_statuses.items():
        try:
            changed = await asyncio.to_thread(
                update_netconf_operational_status,
                device_name,
                operational_status,
            )
            results.append({
                "device": device_name,
                "success": True,
                "operational_status": operational_status,
                "updated": changed,
                "port": NETCONF_DEVICES[device_name]["port"],
            })
        except Exception as exc:
            logger.exception(
                "Manual NETCONF synchronization failed for %s.", device_name
            )
            results.append({
                "device": device_name,
                "success": False,
                "operational_status": operational_status,
                "updated": False,
                "port": NETCONF_DEVICES[device_name]["port"],
                "error": str(exc),
            })

    return {
        "success": all(item["success"] for item in results),
        "network_status": current_status,
        "devices": results,
        # Retain the old response field for existing frontend consumers.
        "netconf_operational_status": device_statuses["router1"],
        "updated": any(item["updated"] for item in results),
    }
