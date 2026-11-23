import { useCallback, useEffect, useMemo, useState } from 'react'

const API_BASE = 'http://127.0.0.1:8000'

const initialDevices = [
  {
    name: 'Router 1',
    model: 'Docker Ubuntu Container',
    role: 'Gateway Primary',
    address: 'Docker network',
    mac: 'Not available',
    uptime: 'Container runtime',
    latency: 'Not measured',
    status: 'Unknown',
    icon: 'router',
  },
  {
    name: 'Router 2',
    model: 'Docker Ubuntu Container',
    role: 'Gateway Standby',
    address: 'Docker network',
    mac: 'Not available',
    uptime: 'Container runtime',
    latency: 'Not measured',
    status: 'Unknown',
    icon: 'router',
  },
  {
    name: 'Server',
    model: 'Docker Ubuntu Container',
    role: 'Application Server',
    address: 'Docker network',
    mac: 'Not available',
    uptime: 'Container runtime',
    latency: 'Not measured',
    status: 'Unknown',
    icon: 'dns',
  },
]

function Icon({ children, className = '' }) {
  return (
    <span className={`material-symbols-outlined ${className}`}>
      {children}
    </span>
  )
}

function normalizeStatus(value) {
  const status = String(value ?? '').toLowerCase()
  if (status === 'running' || status === 'healthy') return 'Healthy'
  if (status === 'down' || status === 'stopped' || status === 'unhealthy') return 'Down'
  return 'Unknown'
}

function normalizeOperationalStatus(value) {
  const status = String(value ?? '').toLowerCase()
  if (status === 'up') return 'UP'
  if (status === 'down') return 'DOWN'
  return 'UNKNOWN'
}

function NetworkDevices() {
  const [devices, setDevices] = useState(initialDevices)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedDevice, setSelectedDevice] = useState('Router 1')
  const [message, setMessage] = useState('Loading live device status...')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [netconfConnected, setNetconfConnected] = useState(false)

  const refreshDevices = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setMessage('Checking Docker container status...')
    setIsRefreshing(true)

    try {
      const [networkResponse, netconfStatusResponse, netconfDevicesResponse] =
        await Promise.all([
          fetch(`${API_BASE}/network/status`),
          fetch(`${API_BASE}/netconf/status`),
          fetch(`${API_BASE}/netconf/devices`),
        ])

      if (!networkResponse.ok) {
        throw new Error(`Network status API returned HTTP ${networkResponse.status}`)
      }

      const result = await networkResponse.json()

      let netconfStatus = null
      let netconfResult = null

      if (netconfStatusResponse.ok) {
        netconfStatus = await netconfStatusResponse.json()
      }

      if (netconfDevicesResponse.ok) {
        netconfResult = await netconfDevicesResponse.json()
      }

      const receivedDevices =
        netconfResult?.success && Array.isArray(netconfResult.devices)
          ? netconfResult.devices
          : []

      const allDevicesConnected =
        receivedDevices.length === 3 &&
        receivedDevices.every((item) => item.success && item.connected)

      setNetconfConnected(Boolean(netconfStatus?.all_connected && allDevicesConnected))

      setDevices((current) =>
        current.map((device) => {
          const key = device.name.toLowerCase().replaceAll(' ', '')
          const netconfEntry = receivedDevices.find((item) => item.device === key)
          const configuration = netconfEntry?.configuration
          const updated = { ...device, status: normalizeStatus(result[key]) }

          if (configuration) {
            updated.address = configuration.management_ip || device.address
            updated.netconfDeviceName = configuration.device_name
            updated.interfaces = configuration.interfaces || []
            updated.netconfConnected = Boolean(netconfEntry.success && netconfEntry.connected)
            updated.netconfPort = netconfEntry.port
            updated.netconfOperationalStatus = normalizeOperationalStatus(
              configuration.interfaces?.[0]?.operational_status,
            )
            updated.model = 'Docker Ubuntu · NETCONF'
          } else {
            updated.netconfConnected = false
            updated.netconfOperationalStatus = 'UNKNOWN'
          }

          return updated
        }),
      )

      const connectedCount = receivedDevices.filter(
        (item) => item.success && item.connected,
      ).length
      setMessage(
        allDevicesConnected
          ? `Docker status and all three NETCONF configurations updated (${connectedCount}/3 connected).`
          : `Docker statuses updated. NETCONF agents connected: ${connectedCount}/3.`,
      )
    } catch (error) {
      setMessage(`Cannot load live status: ${error.message}. Check FastAPI and Docker.`)
      setDevices((current) => current.map((device) => ({ ...device, status: 'Unknown' })))
    } finally {
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    // Defer the initial fetch so state updates do not run synchronously
    // inside the effect body.
    const initialRefreshId = window.setTimeout(() => {
      refreshDevices()
    }, 0)

    const intervalId = window.setInterval(
      () => refreshDevices({ quiet: true }),
      5000,
    )

    return () => {
      window.clearTimeout(initialRefreshId)
      window.clearInterval(intervalId)
    }
  }, [refreshDevices])

  const filteredDevices = useMemo(() => {
    const query = search.trim().toLowerCase()
    return devices.filter((device) => {
      const matchesSearch = `${device.name} ${device.address} ${device.role} ${device.model}`
        .toLowerCase()
        .includes(query)
      const matchesStatus = statusFilter === 'all' || device.status.toLowerCase() === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [devices, search, statusFilter])

  const selected = devices.find((device) => device.name === selectedDevice)
  const healthyCount = devices.filter((device) => device.status === 'Healthy').length
  const downCount = devices.filter((device) => device.status === 'Down').length

  async function runDiagnostics(device) {
    setSelectedDevice(device.name)
    await refreshDevices()
    setMessage(`${device.name} diagnostics completed using the live backend status.`)
  }

  async function restartDevice(device) {
    if (device.name !== 'Server') {
      setMessage(`Restart for ${device.name} is not exposed by the current backend API. No restart was attempted.`)
      return
    }

    setMessage('Requesting server recovery...')
    try {
      const response = await fetch(`${API_BASE}/network/heal`, { method: 'POST' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || `Backend returned HTTP ${response.status}`)
      setMessage(result.message || 'Recovery request completed.')
      await refreshDevices({ quiet: true })
    } catch (error) {
      setMessage(`Recovery failed: ${error.message}`)
    }
  }

  return (
    <section className="space-y-6 p-5 md:p-8">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-center">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-blue-600">
              <Icon>device_hub</Icon>
              Infrastructure Telemetry Inventory
            </div>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">Network Devices</h2>
            <p className="mt-2 text-sm text-slate-500">View and monitor Docker devices alongside their live NETCONF/YANG interface configurations.</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold ${
                netconfConnected
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-amber-200 bg-amber-50 text-amber-700'
              }`}
              title="Connections to the three Netopeer2 NETCONF lab agents"
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  netconfConnected ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
              />
              NETCONF {netconfConnected ? '3/3 Connected' : 'Partially connected / Unavailable'}
            </span>
            <div className="relative min-w-52 flex-1">
              <Icon className="absolute left-3 top-2.5 text-lg text-slate-400">search</Icon>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Filter devices..."
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-3 text-sm outline-none transition focus:border-blue-400 focus:bg-white"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-blue-400"
            >
              <option value="all">All statuses</option>
              <option value="healthy">Healthy</option>
              <option value="down">Down</option>
              <option value="unknown">Unknown</option>
            </select>
            <button
              onClick={() => refreshDevices()}
              disabled={isRefreshing}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60"
            >
              <Icon>{isRefreshing ? 'progress_activity' : 'refresh'}</Icon>
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { title: 'Total Connected', value: devices.filter((device) => device.status === 'Healthy').length, icon: 'developer_board', color: 'text-blue-600' },
          { title: 'Operating Normally', value: healthyCount, icon: 'verified', color: 'text-emerald-600' },
          { title: 'High Latency', value: '—', icon: 'speed', color: 'text-slate-500' },
          { title: 'Offline / Down', value: downCount, icon: 'portable_wifi_off', color: 'text-red-600' },
        ].map((metric) => (
          <div key={metric.title} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{metric.title}</p>
              <h3 className="mt-2 text-3xl font-bold text-slate-900">{metric.value}</h3>
            </div>
            <div className={`rounded-xl bg-slate-50 p-3 ${metric.color}`}><Icon className="text-2xl">{metric.icon}</Icon></div>
          </div>
        ))}
      </div>

      {message && <div role="status" className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">{message}</div>}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <h3 className="font-bold text-slate-900">Active Hardware Nodes</h3>
            <p className="mt-1 text-sm text-slate-500">Select a device to inspect its details.</p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600">{filteredDevices.length} displayed</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[850px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-4">Device name</th>
                <th className="px-5 py-4">Device role</th>
                <th className="px-5 py-4">Address</th>
                <th className="px-5 py-4">Latency</th>
                <th className="px-5 py-4">Status</th>
                <th className="px-5 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredDevices.map((device) => (
                <tr
                  key={device.name}
                  onClick={() => setSelectedDevice(device.name)}
                  className={`cursor-pointer border-t border-slate-100 transition hover:bg-blue-50/40 ${selectedDevice === device.name ? 'bg-blue-50/50' : ''}`}
                >
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><Icon className="text-xl">{device.icon}</Icon></div>
                      <div>
                        <p className="font-semibold text-slate-900">{device.name}</p>
                        <p className="mt-1 text-xs text-slate-500">{device.model}</p>
                        <p className={`mt-1 text-xs font-semibold ${
                          device.netconfConnected ? 'text-emerald-700' : 'text-amber-700'
                        }`}>
                          NETCONF {device.netconfConnected ? `· Port ${device.netconfPort}` : '· Unavailable'}
                          {device.netconfOperationalStatus
                            ? ` · eth0 ${device.netconfOperationalStatus}`
                            : ''}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-slate-600">{device.role}</td>
                  <td className="px-5 py-4 font-mono text-xs text-slate-600">{device.address}</td>
                  <td className="px-5 py-4 text-slate-500">{device.latency}</td>
                  <td className="px-5 py-4">
                    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${device.status === 'Healthy' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : device.status === 'Down' ? 'border-red-200 bg-red-50 text-red-700' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${device.status === 'Healthy' ? 'bg-emerald-500' : device.status === 'Down' ? 'bg-red-500' : 'bg-slate-400'}`} />
                      {device.status}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex justify-end gap-2">
                      <button onClick={(event) => { event.stopPropagation(); runDiagnostics(device) }} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100">Diagnose</button>
                      <button onClick={(event) => { event.stopPropagation(); restartDevice(device) }} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:border-red-200 hover:bg-red-50 hover:text-red-700">Restart</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredDevices.length === 0 && <tr><td colSpan="6" className="px-5 py-12 text-center text-sm text-slate-500">No devices match your search or status filter.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {selected && (
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><Icon className="text-2xl">{selected.icon}</Icon></div>
              <div><h3 className="text-lg font-bold text-slate-900">{selected.name}</h3><p className="mt-1 text-sm text-slate-500">{selected.model} · {selected.role}</p></div>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600">Selected device</span>
          </div>
          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ['Current status', selected.status],
              ['Network address', selected.address],
              ['Ping latency', selected.latency],
              ['Runtime', selected.uptime],
              ['NETCONF connection', selected.netconfConnected ? 'Connected' : 'Unavailable'],
              ['NETCONF port', selected.netconfPort ?? '—'],
              ['NETCONF device name', selected.netconfDeviceName || '—'],
              [
                'Interface',
                selected.interfaces?.map((item) => item.name).join(', ') || '—',
              ],
              [
                'Admin status',
                selected.interfaces?.map((item) => item.admin_status).join(', ') || '—',
              ],
              [
                'Operational status',
                selected.interfaces?.map((item) => item.operational_status).join(', ') || '—',
              ],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
                <p className="mt-2 break-words text-sm font-semibold text-slate-900">{value}</p>
              </div>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Live NETCONF interface state</p>
              <p className="mt-1 text-sm text-slate-600">
                {selected.interfaces?.[0]?.name || 'Interface'} · YANG operational-status · Port {selected.netconfPort ?? '—'}
              </p>
            </div>
            {(() => {
              const operational = selected.netconfOperationalStatus || 'UNKNOWN'
              return (
                <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold ${
                  operational === 'UP'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : operational === 'DOWN'
                      ? 'border-red-200 bg-red-50 text-red-700'
                      : 'border-slate-200 bg-white text-slate-600'
                }`}>
                  <span className={`h-2 w-2 rounded-full ${
                    operational === 'UP' ? 'bg-emerald-500' : operational === 'DOWN' ? 'bg-red-500' : 'bg-slate-400'
                  }`} />
                  {operational}
                </span>
              )
            })()}
          </div>
          <p className="mt-4 text-xs leading-5 text-slate-400">NETCONF configuration is retrieved from three separate Netopeer2/Sysrepo lab agents representing Router 1, Router 2, and Server. Device interface state refreshes automatically every 5 seconds. Latency, MAC address, CPU, and memory are not returned by the current backend endpoints, so they are not fabricated.</p>
        </section>
      )}
    </section>
  )
}

export default NetworkDevices