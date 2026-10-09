import { BriefcaseBusiness, Handshake, Palette, Settings, Store, type LucideIcon } from 'lucide-react'
import type { Role } from '../lib/bazaar'
import { sells } from '../lib/bazaar'

/**
 * The sections, shared by the menu bar and the 3D scene.
 *
 * Kept out of Layout.tsx because two very different things read it: the navigation, which
 * draws it, and the scene behind the page, which moves its camera to a different vantage for
 * each section. Neither should import the other to find out where the reader is.
 */
export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
  primary?: boolean
  /** Label for the mobile dock, where there is room for one short word. */
  short?: string
  /** The other paths this entry covers, so it stays lit on the pages under it. */
  covers?: string[]
  /** Only for someone who sells. A client has nothing to list and nothing to be paid for. */
  sellers?: boolean
}

/**
 * Studio is the front door: a business arrives to get its brand made, and the marketplace is
 * what they reach for once there is a brand to hand over.
 */
export const NAV: NavItem[] = [
  { to: '/', label: 'nav_studio', icon: Palette, end: true, primary: true, covers: ['/studio'] },
  { to: '/bazaar', label: 'nav_bazaar', icon: Store, primary: true },
  { to: '/contracts', label: 'nav_contracts', icon: Handshake, primary: true },
  { to: '/sell', label: 'nav_sell', icon: BriefcaseBusiness, primary: true, sellers: true },
  { to: '/settings', label: 'nav_settings', icon: Settings },
]

export const navFor = (role: Role | undefined) => NAV.filter((item) => !item.sellers || sells(role))

const under = (pathname: string, path: string) => pathname === path || pathname.startsWith(`${path}/`)

/** True when the reader is anywhere inside this entry's section, not only on its own page. */
export function isNavActive(item: NavItem, pathname: string) {
  const own = item.end ? pathname === item.to : under(pathname, item.to)
  return own || (item.covers ?? []).some((path) => under(pathname, path))
}

/**
 * Which section this page belongs to, or -1. Indexed against the full list rather than one
 * role's, so the 3D scene's camera stations do not shift when somebody starts selling.
 */
export const sectionIndex = (pathname: string) => NAV.findIndex((item) => isNavActive(item, pathname))
