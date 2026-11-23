from kafka import KafkaConsumer

consumer = KafkaConsumer(
    "network-events",
    bootstrap_servers="kafka:9092",
    auto_offset_reset="latest",
    group_id="rca-group"
)

print("RCA Engine Started...")

for message in consumer:
    event = message.value.decode()

    if event == "SERVER_DOWN":
        print("🚨 EVENT RECEIVED: SERVER_DOWN")
        print("ROOT CAUSE: Server is unreachable")