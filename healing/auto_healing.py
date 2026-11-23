import subprocess
from kafka import KafkaConsumer

consumer = KafkaConsumer(
    "network-events",
    bootstrap_servers="localhost:9092",
    auto_offset_reset="latest",
    group_id="healing-group"
)

print("🔧 Auto Healing Engine Started...")

for message in consumer:
    event = message.value.decode()

    if event == "SERVER_DOWN":
        print("🚨 SERVER FAILURE DETECTED")
        print("🔧 ACTION: Restarting server...")

        subprocess.run(["docker", "start", "server"])

        print("✅ SERVER RESTARTED")
