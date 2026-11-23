import subprocess

print("🔧 Healing Controller Started")

result = subprocess.run(
    ["docker", "start", "server"],
    capture_output=True,
    text=True
)

if result.returncode == 0:
    print("✅ SERVER RESTARTED")
else:
    print("❌ HEALING FAILED")
    print(result.stderr)