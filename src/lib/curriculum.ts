import type { Course, Lesson, Module, Platform, PlatformId } from './types'

/**
 * The platform ships with no subject of its own.
 *
 * It used to carry a robotics school: five courses, twelve modules, eighteen lessons and a
 * hardware registry, all written in code. That was the product when the product was a school.
 * It is now a marketplace of mentors, and a marketplace that arrives already teaching
 * something has picked a side — every mentor after the first would be competing with the
 * platform's own content, on the platform's own shelf.
 *
 * So these are empty, and deliberately still here. The types, the helpers and the unlock
 * order are the contract the rest of the app is written against; keeping them means a mentor's
 * own material can fill the same shapes, and means anyone reviving a built-in track only has
 * to supply data. Nothing downstream had to learn that the curriculum went away.
 *
 * What a learner actually works through now lives in `customLessons` — written by a mentor,
 * priced by them, reviewed by them. See the marketplace half of the README.
 */

/** Hardware belonged to robotics. A mentor teaching anything else has no use for a board. */
export const PLATFORMS: Platform[] = []

export const platformById = (id: PlatformId) => PLATFORMS.find((p) => p.id === id)

export const COURSES: Course[] = []

export const MODULES: Module[] = []

export const LESSONS: Lesson[] = []

export const modulesForCourse = (courseId: string): Module[] => MODULES.filter((m) => m.courseId === courseId).sort((a, b) => a.order - b.order)

const orderedLessons = (courseId: string): Lesson[] => {
  const rank = (moduleId: string) => MODULES.find((m) => m.id === moduleId)?.order ?? 0
  return LESSONS.filter((l) => l.courseId === courseId).sort((a, b) => rank(a.moduleId) - rank(b.moduleId) || a.order - b.order)
}

export const lessonsForCourse = (courseId: string): Lesson[] => orderedLessons(courseId)

/** Flat ordered lesson ids — the unlock chain follows this order. */
export const courseLessonOrder = (courseId: string): string[] => orderedLessons(courseId).map((l) => l.id)
