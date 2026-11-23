import subprocess
import time
from kafka import KafkaProducer

SERVER_IP = "172.18.0.4"

producer = KafkaProducer(
    bootstrap_servers="172.18.0.5:29092"
)

server_down_sent = False


def check_server():
    global server_down_sent

    result = subprocess.run(
        ["ping", "-c", "1", SERVER_IP],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )

    if result.returncode == 0:
        print("SERVER HEALTHY ✅")
        server_down_sent = False

    else:
        print("SERVER DOWN ❌")

        if not server_down_sent:
            print("🚨 ALARM: SERVER FAILURE DETECTED 🚨")
            producer.send("network-events", b"SERVER_DOWN")
            producer.flush()
            server_down_sent = True


while True:
    check_server()
    time.sleep(5)