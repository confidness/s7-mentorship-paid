import { useLocation, useNavigate } from 'react-router-dom'
import { Tabs } from './ui'
import { t } from '../i18n'

/**
 * The second level of navigation: one section, several pages.
 *
 * The sidebar had eleven entries for a student and ten for a mentor, which is a list rather
 * than a structure — "projects", "gallery" and "competition" are three names for the same
 * activity, and nothing said so. Grouping them cuts the sidebar to five and puts the
 * relationship on screen, where it does some work.
 *
 * The labels are dictionary keys, resolved here — the groups below are data, and a finished
 * sentence in them would be one the reader's language never reaches.
 *
 * These are links, not panels. Every page keeps the URL it already had, so bookmarks, the
 * back button and every `<Link>` in the app keep pointing at the same place — the grouping
 * is a change to how the app is presented, not to what anything is called.
 */
export interface SectionTab {
  to: string
  label: string
}

export function SectionTabs({ tabs }: { tabs: SectionTab[] }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()

  // Longest match wins, so `/m/lessons/new` selects the lessons tab rather than whichever
  // shorter path happens to be a prefix of it.
  const active =
    [...tabs]
      .sort((a, b) => b.to.length - a.to.length)
      .find((tab) => pathname === tab.to || pathname.startsWith(`${tab.to}/`))?.to ?? tabs[0].to

  return <Tabs className="mb-6" value={active} onChange={(to) => navigate(to)} tabs={tabs.map((tab) => ({ id: tab.to, label: t(tab.label) }))} />
}

/* ------------------------------------------------------------------ the sections */

export const CATALOGUE_TABS: SectionTab[] = [
  { to: '/', label: 'course_catalog' },
  { to: '/requests', label: 'section_demand' },
]

export const LEARNING_TABS: SectionTab[] = [
  { to: '/learning', label: 'tab_progress' },
  { to: '/learning/courses', label: 'my_learning' },
  { to: '/assigned', label: 'mentor_assignments' },
  { to: '/achievements', label: 'achievements' },
]

export const WORK_TABS: SectionTab[] = [
  { to: '/projects', label: 'projects' },
  { to: '/gallery', label: 'gallery' },
  { to: '/competition', label: 'competition' },
]

export const ACCOUNT_TABS: SectionTab[] = [
  { to: '/profile', label: 'profile' },
  { to: '/settings', label: 'settings' },
]

export const MENTOR_OVERVIEW_TABS: SectionTab[] = [
  { to: '/m', label: 'dashboard' },
  { to: '/m/analytics', label: 'analytics' },
]

export const MENTOR_MATERIAL_TABS: SectionTab[] = [
  { to: '/m/lessons', label: 'my_lessons' },
  { to: '/m/requests', label: 'section_demand' },
  { to: '/m/courses', label: 'courses' },
  { to: '/m/competition', label: 'competition' },
]

export const MENTOR_REVIEW_TABS: SectionTab[] = [
  { to: '/m/reviews', label: 'tab_queue' },
  { to: '/m/projects', label: 'tab_all_work' },
]

export const MENTOR_PEOPLE_TABS: SectionTab[] = [
  { to: '/m/students', label: 'students' },
  { to: '/m/groups', label: 'groups' },
]

export const MENTOR_ACCOUNT_TABS: SectionTab[] = [
  { to: '/m/settings', label: 'settings' },
  { to: '/m/payouts', label: 'payouts' },
]

/**
 * Which strip belongs above this page, if any.
 *
 * Rendered once in the layout rather than added to twenty page components. The pages know
 * nothing about the sections they now sit in, which is the point: the grouping is a property
 * of the navigation and can be changed here without touching a single screen.
 *
 * A page that is not in a section — a lesson, one project, the builder — returns nothing and
 * gets the full width it had before.
 */
export function tabsForPath(pathname: string): SectionTab[] | null {
  const groups = [CATALOGUE_TABS, LEARNING_TABS, WORK_TABS, ACCOUNT_TABS, MENTOR_OVERVIEW_TABS, MENTOR_MATERIAL_TABS, MENTOR_REVIEW_TABS, MENTOR_PEOPLE_TABS, MENTOR_ACCOUNT_TABS]
  // An exact match only. `/projects/abc` is one project, not the Work section — a strip of
  // siblings above a detail page is noise, and its own back link says more.
  return groups.find((group) => group.some((tab) => tab.to === pathname)) ?? null
}
