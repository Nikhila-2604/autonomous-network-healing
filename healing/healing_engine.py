def decide_action(root_cause):
    if root_cause == "Server is unreachable":
        return "RESTART_SERVER"

    return "NO_ACTION"


action = decide_action("Server is unreachable")

print("HEALING DECISION:", action)