import { useLocation, useNavigate } from 'react-router-dom'
import { Tabs } from './ui'
import { t } from '../i18n'

/**
 * The second level of navigation: one section, several pages.
 *
 * These are links, not panels. Every page keeps its own URL, so bookmarks and the back
 * button keep working — the grouping is a change to how the app is presented, not to what
 * anything is called. The labels are dictionary keys, resolved here.
 */
export interface SectionTab {
  to: string
  label: string
}

export function SectionTabs({ tabs }: { tabs: SectionTab[] }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()

  // Longest match wins, so a deeper path selects its own tab rather than a shorter prefix.
  const active =
    [...tabs]
      .sort((a, b) => b.to.length - a.to.length)
      .find((tab) => pathname === tab.to || pathname.startsWith(`${tab.to}/`))?.to ?? tabs[0].to

  return <Tabs className="mb-6" value={active} onChange={(to) => navigate(to)} tabs={tabs.map((tab) => ({ id: tab.to, label: t(tab.label) }))} />
}

export const SELL_TABS: SectionTab[] = [
  { to: '/sell', label: 'my_services' },
  { to: '/sell/payouts', label: 'payouts' },
]

/**
 * Which strip belongs above this page, if any. An exact match only: a detail page or an
 * editor gets the full width, and its own back link says more than a row of siblings.
 */
export function tabsForPath(pathname: string): SectionTab[] | null {
  return [SELL_TABS].find((group) => group.some((tab) => tab.to === pathname)) ?? null
}
