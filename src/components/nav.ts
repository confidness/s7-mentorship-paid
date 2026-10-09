import { BookOpen, ClipboardCheck, Compass, FilePlus2, FolderKanban, GraduationCap, LayoutDashboard, Settings, User as UserIcon, Users, type LucideIcon } from 'lucide-react'

/**
 * The five sections, shared by the menu bar and the 3D scene.
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
  /**
   * The other paths this entry covers.
   *
   * A section is one menu entry over several pages — "Work" is projects, the gallery and
   * competitions — so the entry has to stay lit while the reader moves between them with the
   * tabs. Without this the menu would go dark the moment they did, and look like they had
   * left the section they are plainly still in.
   */
  covers?: string[]
}

/**
 * Five entries, not eleven.
 *
 * The catalogue is the home page: what a person can learn here is the first thing the
 * platform has to show. Everything else is grouped by what someone is trying to do rather
 * than by which screen it happens to live on: Learning is the track, the assignments and the
 * badges; Work is projects, the gallery they end up in and the competitions they enter.
 */
export const STUDENT_NAV: NavItem[] = [
  { to: '/', label: 'courses', icon: BookOpen, end: true, primary: true, short: 'courses', covers: ['/requests'] },
  { to: '/learning', label: 'section_learning', icon: GraduationCap, primary: true, short: 'learning_short', covers: ['/assigned', '/achievements'] },
  { to: '/projects', label: 'section_work', icon: FolderKanban, primary: true, covers: ['/gallery', '/competition'] },
  { to: '/ai', label: 'ai_advisor', icon: Compass, primary: true, short: 'ai_mentor' },
  { to: '/profile', label: 'section_account', icon: UserIcon, covers: ['/settings'] },
]

export const MENTOR_NAV: NavItem[] = [
  { to: '/m', label: 'section_overview', icon: LayoutDashboard, end: true, primary: true, short: 'dashboard', covers: ['/m/analytics'] },
  { to: '/m/lessons', label: 'section_materials', icon: FilePlus2, primary: true, short: 'my_lessons', covers: ['/m/requests', '/m/courses', '/m/competition'] },
  { to: '/m/reviews', label: 'section_review', icon: ClipboardCheck, primary: true, short: 'reviews', covers: ['/m/projects'] },
  { to: '/m/students', label: 'section_people', icon: Users, primary: true, short: 'students', covers: ['/m/groups'] },
  { to: '/m/settings', label: 'section_account', icon: Settings, covers: ['/m/payouts'] },
]

const under = (pathname: string, path: string) => pathname === path || pathname.startsWith(`${path}/`)

/** The area decides the menu, not the role: a mentor browsing the catalogue is on the learner side. */
export const navFor = (pathname: string) => (under(pathname, '/m') ? MENTOR_NAV : STUDENT_NAV)

/** True when the reader is anywhere inside this entry's section, not only on its own page. */
export function isNavActive(item: NavItem, pathname: string) {
  const own = item.end ? pathname === item.to : under(pathname, item.to)
  return own || (item.covers ?? []).some((path) => under(pathname, path))
}

/** Which of the five sections this page belongs to, or -1 for a page that sits in none. */
export const sectionIndex = (pathname: string) => navFor(pathname).findIndex((item) => isNavActive(item, pathname))
