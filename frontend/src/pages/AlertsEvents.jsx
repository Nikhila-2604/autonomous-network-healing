import { useEffect, useMemo, useState } from "react";

const API_URL = "http://127.0.0.1:8000";

function formatTimestamp(timestamp) {
  if (!timestamp) return "Unknown time";
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString();
}

function severityStyle(severity) {
  switch ((severity || "info").toLowerCase()) {
    case "error":
      return "bg-red-100 text-red-700";
    case "warning":
      return "bg-amber-100 text-amber-700";
    case "success":
      return "bg-emerald-100 text-emerald-700";
    default:
      return "bg-sky-100 text-sky-700";
  }
}

function eventCategory(event) {
  if (event.type?.startsWith("NETCONF_") || event.source === "NETCONF/YANG") {
    return "netconf";
  }
  if (event.type?.startsWith("HEALING_") || event.type === "AUTO_HEAL_TRIGGERED") {
    return "healing";
  }
  if (event.type === "NETWORK_STATUS_CHANGED") return "docker";
  return "other";
}

function displayStatus(value) {
  if (!value) return "—";
  return String(value).toUpperCase();
}

export default function AlertsEvents() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [selectedEvent, setSelectedEvent] = useState(null);

  async function fetchEvents() {
    try {
      const response = await fetch(`${API_URL}/kafka/events`);
      if (!response.ok) throw new Error(`API returned HTTP ${response.status}`);
      const data = await response.json();
      setEvents(Array.isArray(data.events) ? data.events : []);
      setError("");
    } catch {
      setError("Unable to load Kafka events. Check whether FastAPI and Kafka are running.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const initialFetchId = window.setTimeout(fetchEvents, 0);
    const intervalId = window.setInterval(fetchEvents, 5000);
    return () => {
      window.clearTimeout(initialFetchId);
      window.clearInterval(intervalId);
    };
  }, []);

  const filteredEvents = useMemo(() => events.filter((event) => {
    const severity = (event.severity || "info").toLowerCase();
    const category = eventCategory(event);
    return (severityFilter === "all" || severity === severityFilter)
      && (categoryFilter === "all" || category === categoryFilter);
  }), [events, severityFilter, categoryFilter]);

  const netconfCount = events.filter((event) => eventCategory(event) === "netconf").length;
  const warningsCount = events.filter((event) => event.severity?.toLowerCase() === "warning").length;
  const errorsCount = events.filter((event) => event.severity?.toLowerCase() === "error").length;

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Alerts & Events</h1>
            <p className="mt-1 text-sm text-slate-500">
              Monitor Docker status, NETCONF interface changes, and healing activity in real time.
            </p>
          </div>
          <button
            onClick={fetchEvents}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700"
          >
            Refresh Events
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-sm text-slate-500">Total Events</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">{events.length}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-sm text-slate-500">NETCONF Events</p>
            <p className="mt-2 text-3xl font-bold text-sky-700">{netconfCount}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-sm text-slate-500">Warnings</p>
            <p className="mt-2 text-3xl font-bold text-amber-600">{warningsCount}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-sm text-slate-500">Errors</p>
            <p className="mt-2 text-3xl font-bold text-red-600">{errorsCount}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="category-filter" className="text-sm font-medium text-slate-700">
            Event source:
          </label>
          <select
            id="category-filter"
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="all">All sources</option>
            <option value="docker">Docker / Network</option>
            <option value="netconf">NETCONF / YANG</option>
            <option value="healing">Healing</option>
            <option value="other">Other</option>
          </select>

          <label htmlFor="severity-filter" className="text-sm font-medium text-slate-700">
            Severity:
          </label>
          <select
            id="severity-filter"
            value={severityFilter}
            onChange={(event) => setSeverityFilter(event.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="all">All severities</option>
            <option value="info">Info</option>
            <option value="success">Success</option>
            <option value="warning">Warning</option>
            <option value="error">Error</option>
          </select>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
        )}

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="font-semibold text-slate-900">Event History</h2>
            <p className="mt-1 text-xs text-slate-500">Showing {filteredEvents.length} of {events.length} Kafka events</p>
          </div>

          {loading ? (
            <p className="p-8 text-center text-slate-500">Loading events...</p>
          ) : filteredEvents.length === 0 ? (
            <div className="p-10 text-center">
              <p className="font-medium text-slate-700">No events found</p>
              <p className="mt-1 text-sm text-slate-500">Try changing the filters or generate a network event.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-100 text-slate-600">
                  <tr>
                    <th className="px-5 py-3">Time</th>
                    <th className="px-5 py-3">Event</th>
                    <th className="px-5 py-3">Source</th>
                    <th className="px-5 py-3">Device / Interface</th>
                    <th className="px-5 py-3">Severity</th>
                    <th className="px-5 py-3">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredEvents.map((event) => {
                    const category = eventCategory(event);
                    const isNetconf = category === "netconf";
                    return (
                      <tr key={event.id} className="hover:bg-slate-50">
                        <td className="whitespace-nowrap px-5 py-4 text-slate-500">{formatTimestamp(event.timestamp)}</td>
                        <td className="px-5 py-4 font-medium text-slate-800">
                          <div>{(event.type || "NETWORK_EVENT").replaceAll("_", " ")}</div>
                          {isNetconf && (
                            <div className="mt-1 text-xs font-semibold text-sky-700">
                              {displayStatus(event.previous_status)} → {displayStatus(event.operational_status)}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-4 text-slate-600">
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium">
                            {category === "netconf" ? "NETCONF / YANG" : category === "docker" ? "Docker" : category === "healing" ? "Auto-healing" : "System"}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-slate-600">
                          <div>{event.device || "network"}</div>
                          {event.interface && <div className="mt-1 text-xs text-slate-400">{event.interface}</div>}
                        </td>
                        <td className="px-5 py-4">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${severityStyle(event.severity)}`}>
                            {event.severity || "info"}
                          </span>
                        </td>
                        <td className="px-5 py-4">
                          <button onClick={() => setSelectedEvent(event)} className="font-medium text-sky-700 hover:underline">
                            View details
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {selectedEvent && (
          <div className="rounded-xl border border-sky-200 bg-white p-5">
            <div className="flex items-start justify-between gap-4">
              <h2 className="font-semibold text-slate-900">Event Details</h2>
              <button onClick={() => setSelectedEvent(null)} className="text-sm font-medium text-slate-500 hover:text-slate-900">
                Close
              </button>
            </div>
            <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
              <div><dt className="text-slate-500">Event type</dt><dd className="mt-1 font-medium text-slate-900">{selectedEvent.type || "—"}</dd></div>
              <div><dt className="text-slate-500">Timestamp</dt><dd className="mt-1 text-slate-800">{formatTimestamp(selectedEvent.timestamp)}</dd></div>
              <div><dt className="text-slate-500">Device</dt><dd className="mt-1 text-slate-800">{selectedEvent.device || "network"}</dd></div>
              <div><dt className="text-slate-500">Source</dt><dd className="mt-1 text-slate-800">{selectedEvent.source || (eventCategory(selectedEvent) === "netconf" ? "NETCONF/YANG" : eventCategory(selectedEvent))}</dd></div>
              <div className="sm:col-span-2"><dt className="text-slate-500">Message</dt><dd className="mt-1 text-slate-800">{selectedEvent.message || "—"}</dd></div>
              {selectedEvent.interface && <div><dt className="text-slate-500">Interface</dt><dd className="mt-1 font-medium text-slate-900">{selectedEvent.interface}</dd></div>}
              {selectedEvent.previous_status && <div><dt className="text-slate-500">Previous operational status</dt><dd className="mt-1 font-medium text-slate-900">{displayStatus(selectedEvent.previous_status)}</dd></div>}
              {selectedEvent.operational_status && <div><dt className="text-slate-500">Current operational status</dt><dd className="mt-1 font-medium text-slate-900">{displayStatus(selectedEvent.operational_status)}</dd></div>}
              {selectedEvent.id && <div className="sm:col-span-2"><dt className="text-slate-500">Event ID</dt><dd className="mt-1 break-all font-mono text-xs text-slate-600">{selectedEvent.id}</dd></div>}
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}
