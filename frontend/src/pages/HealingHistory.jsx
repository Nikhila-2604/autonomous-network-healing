import { useEffect, useMemo, useState } from "react";

const API_URL = "http://127.0.0.1:8000";

const HISTORY_TYPES = [
  "AUTO_HEAL_TRIGGERED",
  "HEALING_STARTED",
  "HEALING_SUCCESS",
  "HEALING_FAILED",
  "HEALING_UNVERIFIED",
  "HEALING_CHECK",
  "NETCONF_OPERATIONAL_STATUS_CHANGED",
];

function formatTimestamp(timestamp) {
  if (!timestamp) return "Unknown time";
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString();
}

function isNetconfEvent(event) {
  return event.type === "NETCONF_OPERATIONAL_STATUS_CHANGED"
    || event.source === "NETCONF/YANG";
}

function eventOutcome(event) {
  if (event.type === "HEALING_SUCCESS") return "Verified recovery";
  if (event.type === "HEALING_FAILED" || event.type === "HEALING_UNVERIFIED") return "Failed";
  if (event.type === "NETCONF_OPERATIONAL_STATUS_CHANGED") {
    return event.operational_status === "down" ? "Interface down" : "Interface recovered";
  }
  if (event.type === "AUTO_HEAL_TRIGGERED") return "Recovery triggered";
  if (event.type === "HEALING_STARTED") return "In progress";
  if (event.type === "HEALING_CHECK") return "Health check";
  return "Recorded";
}

function outcomeStyle(event) {
  if (event.type === "HEALING_SUCCESS"
    || (isNetconfEvent(event) && event.operational_status === "up")) {
    return "bg-emerald-100 text-emerald-700";
  }
  if (event.type === "HEALING_FAILED" || event.type === "HEALING_UNVERIFIED"
    || (isNetconfEvent(event) && event.operational_status === "down")) {
    return "bg-red-100 text-red-700";
  }
  if (event.type === "AUTO_HEAL_TRIGGERED" || event.type === "HEALING_STARTED") {
    return "bg-amber-100 text-amber-700";
  }
  return "bg-sky-100 text-sky-700";
}

export default function HealingHistory() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");

  async function loadHistory() {
    try {
      const response = await fetch(`${API_URL}/kafka/events`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const history = (Array.isArray(data.events) ? data.events : [])
        .filter((event) => HISTORY_TYPES.includes(event.type));
      setEvents(history);
      setError("");
    } catch {
      setError("Unable to load Kafka healing history. Check FastAPI and Kafka.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const initialFetchId = window.setTimeout(loadHistory, 0);
    const intervalId = window.setInterval(loadHistory, 5000);
    return () => {
      window.clearTimeout(initialFetchId);
      window.clearInterval(intervalId);
    };
  }, []);

  const filteredEvents = useMemo(() => events.filter((event) => {
    if (filter === "all") return true;
    if (filter === "success") {
      return event.type === "HEALING_SUCCESS"
        || (isNetconfEvent(event) && event.operational_status === "up");
    }
    if (filter === "failed") {
      return event.type === "HEALING_FAILED" || event.type === "HEALING_UNVERIFIED"
        || (isNetconfEvent(event) && event.operational_status === "down");
    }
    if (filter === "netconf") return isNetconfEvent(event);
    return !isNetconfEvent(event);
  }), [events, filter]);

  const successes = events.filter((event) => event.type === "HEALING_SUCCESS").length;
  const failures = events.filter((event) =>
    event.type === "HEALING_FAILED" || event.type === "HEALING_UNVERIFIED"
  ).length;
  const netconfTransitions = events.filter(isNetconfEvent).length;

  // The API returns newest-first; reverse a copy to render the timeline chronologically.
  // Display the newest events first.
const timelineEvents = [...filteredEvents].sort(
  (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
);

  return (
    <div className="space-y-6 p-5 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Healing History</h2>
          <p className="mt-1 text-sm text-slate-500">
            Review automatic recovery attempts, verified outcomes, and NETCONF interface transitions.
          </p>
        </div>
        <button onClick={loadHistory} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700">
          Refresh History
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-500">Recorded Events</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{events.length}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-white p-5">
          <p className="text-sm text-slate-500">Verified Recoveries</p>
          <p className="mt-2 text-3xl font-bold text-emerald-600">{successes}</p>
        </div>
        <div className="rounded-xl border border-red-200 bg-white p-5">
          <p className="text-sm text-slate-500">Failed / Unverified</p>
          <p className="mt-2 text-3xl font-bold text-red-600">{failures}</p>
        </div>
        <div className="rounded-xl border border-sky-200 bg-white p-5">
          <p className="text-sm text-slate-500">NETCONF Transitions</p>
          <p className="mt-2 text-3xl font-bold text-sky-700">{netconfTransitions}</p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-slate-900">Recovery Audit Timeline</h3>
            <p className="mt-1 text-xs text-slate-500">Events are displayed from newest to oldest.</p>
          </div>
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="all">All recovery events</option>
            <option value="success">Successful / recovered</option>
            <option value="failed">Failed / interface down</option>
            <option value="netconf">NETCONF transitions</option>
            <option value="healing">Healing operations</option>
          </select>
        </div>

        {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        {loading ? (
          <p className="py-8 text-center text-slate-500">Loading healing history...</p>
        ) : timelineEvents.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">
            No matching recovery events yet. Stop the test server or run a healing operation to generate history.
          </p>
        ) : (
          <div className="space-y-3">
            {timelineEvents.map((event) => {
              const netconf = isNetconfEvent(event);
              return (
                <div key={event.id} className="relative rounded-lg border border-slate-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-slate-900">
                          {(event.type || "EVENT").replaceAll("_", " ")}
                        </p>
                        {netconf && (
                          <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-700">
                            NETCONF / YANG
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-slate-600">{event.message || "No event description available."}</p>
                      {netconf && (
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                          <span className="rounded-md bg-slate-100 px-2 py-1 font-medium text-slate-700">
                            {event.device || "router1"} · {event.interface || "interface"}
                          </span>
                          <span className="text-slate-500">
                            {String(event.previous_status || "unknown").toUpperCase()}
                            {" → "}
                            {String(event.operational_status || "unknown").toUpperCase()}
                          </span>
                        </div>
                      )}
                      <p className="mt-2 text-xs text-slate-400">{formatTimestamp(event.timestamp)}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${outcomeStyle(event)}`}>
                      {eventOutcome(event)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
