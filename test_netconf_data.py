
from ncclient import manager

try:
    with manager.connect(
        host="127.0.0.1",
        port=830,
        username="netconf",
        password="netconf",
        hostkey_verify=False,
        device_params={"name": "default"},
        allow_agent=False,
        look_for_keys=False,
        timeout=15
    ) as connection:

        print("NETCONF connection successful!")

        response = connection.get_config(
            source="running",
            filter=(
                "subtree",
                '<autonomous-network xmlns="urn:autonomous-network"/>'
            )
        )

        print("\nRetrieved Network Device Configuration:")
        print(response.data_xml)

except Exception as error:
    print("Error:", error)
