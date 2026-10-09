import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import Layout from './components/Layout'
import OrbitSceneGate from './components/OrbitSceneGate'
import { Spinner } from './components/ui'
import { useApp } from './lib/store'
import { backendConfigured } from './lib/supabase'

import Login from './pages/Login'
import NotFound from './pages/NotFound'
import Settings from './pages/Settings'
import StudioHome from './pages/studio/Home'
import NewKit from './pages/studio/NewKit'
import KitPage from './pages/studio/Kit'
import Directory from './pages/bazaar/Directory'
import ServicePage from './pages/bazaar/Service'
import ContractList from './pages/contracts/List'
import ContractDetail from './pages/contracts/Detail'
import MyServices from './pages/sell/Services'
import ServiceEditor from './pages/sell/ServiceEditor'
import Payouts from './pages/sell/Payouts'

function Protected({ children }: { children: ReactNode }) {
  const { user } = useApp()
  const location = useLocation()
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  return <>{children}</>
}

/**
 * Shown instead of the app when the browser bundle has no Supabase project.
 *
 * Brandyzer has no local mode: every kit, service and contract is a row other people read.
 * Deliberately not translated, for the same reason as the crash screen — it is about the
 * deployment, and the person reading it is whoever is setting it up.
 */
function NotConfigured() {
  return (
    <div className="grid min-h-screen place-items-center p-6">
      <div className="card w-full max-w-lg space-y-3 p-6">
        <h1 className="text-2xl font-bold tracking-[-0.03em] text-ink-900">Brandyzer needs a Supabase project</h1>
        <p className="text-sm leading-relaxed text-ink-600">
          Set <code className="font-mono">VITE_SUPABASE_URL</code> and <code className="font-mono">VITE_SUPABASE_ANON_KEY</code>, run{' '}
          <code className="font-mono">supabase/migrations/0001_brandyzer.sql</code> against the project, and rebuild. The README lists the server keys.
        </p>
      </div>
    </div>
  )
}

export default function App() {
  const { ready, user } = useApp()
  if (!backendConfigured) return <NotConfigured />
  // Until the stored session is checked, nobody is signed in or out — showing the sign-in
  // page for half a second to somebody who is signed in reads as being logged out.
  if (!ready) {
    return (
      <div className="grid min-h-screen place-items-center text-ink-500">
        <Spinner />
      </div>
    )
  }

  return (
    <>
      {/* Behind every route, and outside them, so the world survives navigation. */}
      <OrbitSceneGate />
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
        <Route path="/register" element={user ? <Navigate to="/" replace /> : <Login register />} />

        <Route
          element={
            <Protected>
              <Layout />
            </Protected>
          }
        >
          <Route path="/" element={<StudioHome />} />
          <Route path="/studio/new" element={<NewKit />} />
          <Route path="/studio/:kitId" element={<KitPage />} />

          <Route path="/bazaar" element={<Directory />} />
          <Route path="/bazaar/:serviceId" element={<ServicePage />} />

          <Route path="/contracts" element={<ContractList />} />
          <Route path="/contracts/:contractId" element={<ContractDetail />} />

          <Route path="/sell" element={<MyServices />} />
          <Route path="/sell/new" element={<ServiceEditor />} />
          <Route path="/sell/:serviceId/edit" element={<ServiceEditor />} />
          <Route path="/sell/payouts" element={<Payouts />} />

          <Route path="/settings" element={<Settings />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  )
}
