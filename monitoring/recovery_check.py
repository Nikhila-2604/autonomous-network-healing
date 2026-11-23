import subprocess
import time

SERVER_IP = "172.18.0.2"


def verify_recovery():
    print("🔍 Checking server recovery...")

    for attempt in range(1, 6):
        result = subprocess.run(
            ["ping", "-c", "1", SERVER_IP],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )

        if result.returncode == 0:
            print("✅ RECOVERY VERIFIED: Server is healthy")
            return True

        print(f"⏳ Attempt {attempt}/5: Server not ready")
        time.sleep(2)

    print("❌ RECOVERY FAILED: Server is unreachable")
    return False


verify_recovery()