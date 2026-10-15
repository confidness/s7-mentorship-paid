import { Palette, Settings, type LucideIcon } from 'lucide-react'

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
}

/** Studio is the whole product: brand kits, and the copy, images and websites made in them. */
export const NAV: NavItem[] = [
  { to: '/', label: 'nav_studio', icon: Palette, end: true, primary: true, covers: ['/studio'] },
  { to: '/settings', label: 'nav_settings', icon: Settings },
]

export const navFor = () => NAV

const under = (pathname: string, path: string) => pathname === path || pathname.startsWith(`${path}/`)

/** True when the reader is anywhere inside this entry's section, not only on its own page. */
export function isNavActive(item: NavItem, pathname: string) {
  const own = item.end ? pathname === item.to : under(pathname, item.to)
  return own || (item.covers ?? []).some((path) => under(pathname, path))
}

/**
 * Which section this page belongs to, or -1. The 3D scene moves its camera by this index.
 */
export const sectionIndex = (pathname: string) => NAV.findIndex((item) => isNavActive(item, pathname))
