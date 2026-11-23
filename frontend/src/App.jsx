

import { useEffect, useState } from 'react'

import './App.css'

import NetworkDevices from './pages/NetworkDevices'
import AlertsEvents from './pages/AlertsEvents'
import HealingHistory from './pages/HealingHistory'

const navigation = [

  { name: 'Dashboard', icon: 'grid_view' },

  { name: 'Network Devices', icon: 'hub' },

  { name: 'Alerts & Events', icon: 'notifications_active' },

  { name: 'Healing History', icon: 'history_edu' },

  { name: 'Settings', icon: 'settings' },

]

const devices = [

  { name: 'Router 1', role: 'Gateway Primary', type: 'Main Router', ip: 'Docker network', icon: 'router' },

  { name: 'Router 2', role: 'Gateway Standby', type: 'Backup Router', ip: 'Docker network', icon: 'hub' },

  { name: 'Server', role: 'Application Server', type: 'Application Server', ip: 'Docker network', icon: 'dns' },

]

function Icon({ children, className = '' }) {

  return (

    <span className={`material-symbols-outlined ${className}`}>

      {children}

    </span>

  )

}

function SummaryCard({ title, value, subtitle, icon, color }) {

  const colors = {

    blue: 'bg-sky-50 border-sky-100 text-sky-600',

    green: 'bg-emerald-50 border-emerald-100 text-emerald-600',

    gray: 'bg-slate-100 border-slate-200 text-slate-500',

  }

  return (

    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition hover:shadow-md">

      <div className="flex items-start justify-between gap-3">

        <div>

          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">

            {title}

          </p>

          <h2 className="mt-3 text-4xl font-bold tracking-tight text-slate-900">

            {value}

          </h2>

          <p className="mt-2 flex items-center gap-2 text-xs text-slate-500">

            <span className={`h-2 w-2 rounded-full ${color === 'green' ? 'bg-emerald-500' : color === 'blue' ? 'bg-sky-500' : 'bg-slate-300'}`} />

            {subtitle}

          </p>

        </div>

        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border ${colors[color]}`}>

          <Icon className="text-2xl">{icon}</Icon>

        </div>

      </div>

    </div>

  )

}

function Dashboard({ onNavigate, networkStatus, networkError, refreshNetwork, checkingNetwork, networkEvents, eventsError }) {

  const [healingMessage, setHealingMessage] = useState('Monitoring for interruptions')

  async function runHealingCheck() {

    setHealingMessage('Checking live Docker container status...')

    const data = await refreshNetwork()

    if (!data) {

      setHealingMessage('Backend connection failed. Check FastAPI.')

      return

    }

    setHealingMessage(`Router 1: ${data.router1} · Router 2: ${data.router2} · Server: ${data.server}`)

  }

  return (

    <div className="space-y-6 p-5 md:p-8">

      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">

        <div>

          <p className="text-xs font-bold uppercase tracking-widest text-sky-600">

            Infrastructure overview

          </p>

          <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">

            Network Overview

          </h2>

          <p className="mt-1 text-sm text-slate-500">

            Monitor your network and recover from failures automatically.

          </p>

        </div>

        <span className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">

          <span className="h-2 w-2 rounded-full bg-emerald-500" />

          API-connected checks

        </span>

      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">

        <SummaryCard title="Total Devices" value="3" subtitle="Configured devices" icon="dns" color="blue" />

        <SummaryCard title="Devices Healthy" value={networkStatus ? [networkStatus.router1, networkStatus.router2, networkStatus.server].filter((status) => status === 'running' || status === 'healthy').length : '—'} subtitle={networkStatus ? 'Live backend status' : 'Waiting for backend'} icon="verified" color="green" />

        <SummaryCard
          title="Active Alerts"
          value={networkStatus
            ? Object.values(networkStatus).filter((status) => status === 'down').length
            : '—'}
          subtitle="Devices currently down"
          icon="notifications_active"
          color="gray"
        />
        <SummaryCard
          title="Healing Actions"
          value={networkEvents.filter((event) => event.type === 'HEALING_STARTED').length}
          subtitle="Recorded recovery attempts"
          icon="auto_fix_high"
          color="blue"
        />

      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-7">

          <div className="flex flex-wrap items-center justify-between gap-3">

            <div>

              <div className="flex items-center gap-2">

                <Icon className="text-xl text-sky-600">router</Icon>

                <h3 className="text-lg font-bold text-slate-900">Network Devices</h3>

              </div>

              <p className="mt-1 text-sm text-slate-500">

                Current status of your connected equipment

              </p>

            </div>

            <button

              onClick={() => onNavigate('Network Devices')}

              className="rounded-lg px-3 py-2 text-sm font-semibold text-sky-700 transition hover:bg-sky-50"

            >

              View all →

            </button>

          </div>

          <div className="mt-5 overflow-x-auto">

            <table className="w-full min-w-[570px] text-left">

              <thead>

                <tr className="border-y border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500">

                  <th className="px-3 py-3">DEVICE</th>

                  <th className="px-3 py-3">TYPE</th>

                  <th className="px-3 py-3">STATUS</th>

                  <th className="px-3 py-3">ADDRESS</th>

                </tr>

              </thead>

              <tbody>

                {devices.map((device) => (

                  <tr key={device.name} className="border-b border-slate-100 transition hover:bg-slate-50">

                    <td className="px-3 py-4">

                      <div className="flex items-center gap-3">

                        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-sky-100 bg-sky-50 text-sky-600">

                          <Icon>{device.icon}</Icon>

                        </div>

                        <div>

                          <p className="text-sm font-semibold text-slate-900">{device.name}</p>

                          <p className="text-xs text-slate-500">{device.role}</p>

                        </div>

                      </div>

                    </td>

                    <td className="px-3 py-4 text-sm text-slate-600">{device.type}</td>

                    <td className="px-3 py-4">

                      {(() => {

                        const statusKey = device.name === 'Router 1' ? 'router1' : device.name === 'Router 2' ? 'router2' : 'server'

                        const status = networkStatus?.[statusKey]

                        const healthy = status === 'running' || status === 'healthy'

                        return (

                          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${healthy ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : status ? 'border-red-200 bg-red-50 text-red-700' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>

                            <span className={`h-1.5 w-1.5 rounded-full ${healthy ? 'bg-emerald-500' : status ? 'bg-red-500' : 'bg-slate-400'}`} />

                            {status ?? (networkError ? 'Unavailable' : 'Checking...')}

                          </span>

                        )

                      })()}

                    </td>

                    <td className="px-3 py-4 font-mono text-xs text-slate-500">{device.ip}</td>

                  </tr>

                ))}

              </tbody>

            </table>

          </div>

          <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">

            {networkError ? `Backend error: ${networkError}` : `Live status refreshes automatically every 5 seconds${networkStatus?.checked_at ? ` · Last checked ${networkStatus.checked_at}` : ''}.`}

          </p>

        </section>

        <section className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-5">

          <div className="flex items-center justify-between gap-3">

            <div className="flex items-center gap-3">

              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-sky-100 bg-sky-50 text-sky-600">

                <Icon className="text-2xl">shield_with_heart</Icon>

              </div>

              <div>

                <h3 className="font-bold text-slate-900">Automatic Healing</h3>

                <p className="mt-1 text-xs text-slate-500">Self-healing controller</p>

              </div>

            </div>

            <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">

              API check

            </span>

          </div>

          <div className="mt-5 space-y-3">

            <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">

              <div>

                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Current check</p>

                <p className="mt-1 text-sm text-slate-700">{healingMessage}</p>

              </div>

              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-sky-500" />

            </div>

            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-4">

              <div>

                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Recovery action</p>

                <p className="mt-1 text-sm text-slate-600">Not triggered by this check</p>

              </div>

              <Icon className="text-slate-400">history</Icon>

            </div>

            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-4">

              <div>

                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Recovery verification</p>

                <p className="mt-1 text-sm text-slate-600">Available through the healing API</p>

              </div>

              <Icon className="text-emerald-600">task_alt</Icon>

            </div>

          </div>

          <button

            onClick={runHealingCheck}

            disabled={checkingNetwork}

            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-700 disabled:cursor-wait disabled:opacity-60"

          >

            <Icon>{checkingNetwork ? 'progress_activity' : 'autorenew'}</Icon>

            {checkingNetwork ? 'Checking...' : 'Run Network Check'}

          </button>

          <p className="mt-2 text-center text-xs text-slate-400">

            Checks network status; it does not restart the server.

          </p>

        </section>

      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">

          <div className="flex items-center justify-between">

            <div>

              <div className="flex items-center gap-2">

                <Icon className="text-xl text-sky-600">account_tree</Icon>

                <h3 className="text-lg font-bold text-slate-900">Network Health Visualization</h3>

              </div>

              <p className="mt-1 text-sm text-slate-500">Live Docker container status</p>

            </div>

            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">Topology</span>

          </div>

          <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">

            <svg viewBox="0 0 520 230" role="img" aria-label="Router 1 connects to Router 2 and Server" className="h-auto w-full">

              <path d="M260 67 V100 H130 V130 M260 100 H390 V130" fill="none" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" />

              <circle cx="260" cy="100" r="5" fill="#0284c7" />

              <rect x="175" y="15" width="170" height="55" rx="12" fill="#e0f2fe" stroke="#bae6fd" />

              <text x="260" y="38" fontSize="12" fill="#0369a1" textAnchor="middle">GATEWAY</text>

              <text x="260" y="55" fontSize="15" fontWeight="600" fill="#0f172a" textAnchor="middle">Router 1</text>

              <text x="260" y="82" fontSize="10" fill={networkStatus?.router1 === 'running' ? '#047857' : '#b91c1c'} textAnchor="middle">{networkStatus?.router1 ?? 'Checking...'}</text>

              <rect x="45" y="130" width="170" height="60" rx="12" fill="#ffffff" stroke="#cbd5e1" />

              <text x="130" y="153" fontSize="11" fill="#64748b" textAnchor="middle">NETWORK ROUTER</text>

              <text x="130" y="173" fontSize="15" fontWeight="600" fill="#0f172a" textAnchor="middle">Router 2</text>

              <text x="130" y="184" fontSize="10" fill={networkStatus?.router2 === 'running' ? '#047857' : '#b91c1c'} textAnchor="middle">{networkStatus?.router2 ?? 'Checking...'}</text>

              <rect x="305" y="130" width="170" height="60" rx="12" fill="#ffffff" stroke="#cbd5e1" />

              <text x="390" y="153" fontSize="11" fill="#64748b" textAnchor="middle">APPLICATION NODE</text>

              <text x="390" y="173" fontSize="15" fontWeight="600" fill="#0f172a" textAnchor="middle">Server</text>

              <text x="390" y="184" fontSize="10" fill={networkStatus?.server === 'healthy' ? '#047857' : '#b91c1c'} textAnchor="middle">{networkStatus?.server ?? 'Checking...'}</text>

              <text x="260" y="218" fontSize="11" fill="#64748b" textAnchor="middle">{networkError ? 'Backend unavailable' : 'Live status from FastAPI'}</text>

            </svg>

          </div>

        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">

          <div className="flex items-center justify-between gap-3">

            <div>

              <div className="flex items-center gap-2">

                <Icon className="text-xl text-sky-600">notifications_active</Icon>

                <h3 className="text-lg font-bold text-slate-900">Recent Alerts & Events</h3>

              </div>

              <p className="mt-1 text-sm text-slate-500">Network events and healing audit feed</p>

            </div>

            <button

              onClick={() => onNavigate('Alerts & Events')}

              className="text-sm font-semibold text-sky-700 hover:text-sky-900"

            >

              View all →

            </button>

          </div>

          <div className="mt-5 space-y-3">
            {eventsError && (
              <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                Unable to load recent events: {eventsError}
              </p>
            )}

            {!eventsError && networkEvents.length === 0 && (
              <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                No network events recorded yet.
              </p>
            )}

            {networkEvents.slice(0, 5).map((event) => (
              <div
                key={event.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">
                    {(event.type || 'NETWORK_EVENT').replaceAll('_', ' ')}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{event.message}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {event.timestamp ? new Date(event.timestamp).toLocaleString() : 'Unknown time'}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
                  {event.severity || 'info'}
                </span>
              </div>
            ))}

            <button
              onClick={() => onNavigate('Alerts & Events')}
              className="text-sm font-semibold text-sky-700 hover:text-sky-900"
            >
              View all events →
            </button>
          </div>

        </section>

      </div>

    </div>

  )

}

function PlaceholderPage({ title }) {

  return (

    <div className="p-8">

      <section className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">

        <p className="text-xs font-bold uppercase tracking-widest text-sky-600">AutoNet Heal</p>

        <h2 className="mt-2 text-2xl font-bold text-slate-900">{title}</h2>

        <p className="mt-2 text-sm text-slate-500">

          This page will be implemented from its original Stitch template next.

        </p>

      </section>

    </div>

  )

}

function App() {

  const [activePage, setActivePage] = useState('Dashboard')

  const [networkStatus, setNetworkStatus] = useState(null)

  const [networkError, setNetworkError] = useState('')

  const [checkingNetwork, setCheckingNetwork] = useState(false)
  const [networkEvents, setNetworkEvents] = useState([])
  const [eventsError, setEventsError] = useState('')
  const [kafkaStatus, setKafkaStatus] = useState(null)
async function refreshNetwork() {

    setCheckingNetwork(true)

    try {

      const response = await fetch('http://127.0.0.1:8000/network/status')

      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const data = await response.json()

      setNetworkStatus(data)

      setNetworkError('')

      return data

    } catch (error) {

      setNetworkError(error.message || 'Unable to reach FastAPI')

      return null

    } finally {

      setCheckingNetwork(false)

    }

  }

  async function refreshEvents() {
    try {
      // Read events consumed from Kafka, rather than only FastAPI's local event list.
      const response = await fetch('http://127.0.0.1:8000/kafka/events')
      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const data = await response.json()
      setNetworkEvents(Array.isArray(data.events) ? data.events : [])
      setEventsError('')
    } catch (error) {
      setEventsError(error.message || 'Unable to load Kafka events')
    }
  }

  async function refreshKafkaStatus() {
    try {
      const response = await fetch('http://127.0.0.1:8000/kafka/status')
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setKafkaStatus(await response.json())
    } catch {
      setKafkaStatus(null)
    }
  }

  useEffect(() => {
    // Start the first refresh asynchronously so state updates do not run
    // synchronously inside the effect body.
    const initialRefreshId = window.setTimeout(() => {
      refreshNetwork()
      refreshEvents()
      refreshKafkaStatus()
    }, 0)

    const intervalId = window.setInterval(() => {
      refreshNetwork()
      refreshEvents()
      refreshKafkaStatus()
    }, 5000)

    return () => {
      window.clearTimeout(initialRefreshId)
      window.clearInterval(intervalId)
    }
  }, [])
return (

    <div className="min-h-screen bg-slate-50 text-slate-900">

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col justify-between border-r border-slate-200 bg-white px-5 py-7 md:flex">

        <div>

          <div className="mb-10 flex items-center gap-3">

            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-600 text-white shadow-sm">

              <Icon className="text-2xl">hub</Icon>

            </div>

            <div>

              <h1 className="text-lg font-bold tracking-tight">AutoNet Heal</h1>

              <p className="text-xs text-slate-500">Autonomous Ops Core</p>

            </div>

          </div>

          <nav className="space-y-1">

            {navigation.map((item) => (

              <button

                key={item.name}

                onClick={() => setActivePage(item.name)}

                className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm transition ${

                  activePage === item.name

                    ? 'bg-sky-50 font-semibold text-sky-700'

                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'

                }`}

              >

                <Icon className="text-xl">{item.icon}</Icon>

                {item.name}

              </button>

            ))}

          </nav>

        </div>

        <div className="border-t border-slate-200 pt-5">

          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700">

            <span className="h-2 w-2 rounded-full bg-emerald-500" />

            Backend integration

          </div>

          <p className="mt-2 text-xs leading-5 text-slate-400">

            Autonomous Network Healing Platform

          </p>

        </div>

      </aside>

      <div className="min-h-screen md:pl-64">

        <header className="sticky top-0 z-20 flex min-h-20 flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur md:px-8">

          <div>

            <h1 className="text-xl font-bold tracking-tight text-slate-900">

              {activePage === 'Dashboard' ? 'Autonomous Network Controller' : activePage}

            </h1>

            <p className="mt-1 text-xs text-slate-500">

              Continuous telemetry monitoring and self-healing platform

            </p>

          </div>

          <div className="flex items-center gap-3">

            <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold ${
              kafkaStatus?.producer_connected && kafkaStatus?.consumer_connected
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-amber-200 bg-amber-50 text-amber-700'
            }`}>
              <span className={`h-2 w-2 rounded-full ${
                kafkaStatus?.producer_connected && kafkaStatus?.consumer_connected
                  ? 'bg-emerald-500'
                  : 'bg-amber-500'
              }`} />
              {kafkaStatus?.producer_connected && kafkaStatus?.consumer_connected
                ? 'Kafka connected'
                : 'Kafka connecting'}
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
              <span className="h-2 w-2 rounded-full bg-sky-500" />
              Dashboard online
            </span>

            <button

              onClick={() => window.location.reload()}

              title="Refresh page"

              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"

            >

              <Icon>refresh</Icon>

            </button>

          </div>

        </header>

        <main>

{activePage === 'Dashboard' ? (
  <Dashboard
    onNavigate={setActivePage}
    networkStatus={networkStatus}
    networkError={networkError}
    refreshNetwork={refreshNetwork}
    checkingNetwork={checkingNetwork}
    networkEvents={networkEvents}
    eventsError={eventsError}
  />
) : activePage === 'Network Devices' ? (
  <NetworkDevices />
) : activePage === 'Alerts & Events' ? (
  <AlertsEvents />
) : activePage === 'Healing History' ? (
  <HealingHistory />
) : (
  <PlaceholderPage title={activePage} />
)}

        </main>

      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-slate-200 bg-white p-1 md:hidden">

        {navigation.map((item) => (

          <button

            key={item.name}

            onClick={() => setActivePage(item.name)}

            className={`flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-[10px] ${

              activePage === item.name ? 'bg-sky-50 font-semibold text-sky-700' : 'text-slate-500'

            }`}

          >

            <Icon className="text-xl">{item.icon}</Icon>

            <span>{item.name}</span>

          </button>

        ))}

      </nav>

    </div>

  )

}

export default App
