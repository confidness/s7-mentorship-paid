import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Compass, Sparkles, Wallet } from 'lucide-react'
import { useApp } from '../../lib/store'
import { assignedLessons, currentLesson, profileOf } from '../../lib/selectors'
import { searchLessons } from '../../lib/discovery'
import AiMentorPanel from '../../components/AiMentorPanel'
import { Badge, Card, SectionHeading } from '../../components/ui'
import { t } from '../../i18n'

/**
 * The advisor.
 *
 * It answers one question — what should I learn here, and which course do I start with —
 * and it answers it out of the catalogue rather than out of the model's imagination. The
 * shortlist is ranked in the browser before the question is ever sent, so the same advice
 * comes back with no key configured, no credit, and no network on the way to the model.
 */
export default function AIMentor() {
  const { state, user } = useApp()
  const profile = user ? profileOf(state, user.id) : undefined
  const lesson = user && profile ? currentLesson(state, user.id, profile.currentCourseId) : undefined
  const course = state.courses.find((c) => c.id === profile?.currentCourseId)

  const catalogue = useMemo(() => assignedLessons(state), [state])

  /** What the catalogue actually holds, so the page says something before anyone types. */
  const shelves = useMemo(() => {
    const counts = new Map<string, number>()
    for (const match of searchLessons(catalogue)) counts.set(match.direction, (counts.get(match.direction) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [catalogue])

  const free = useMemo(() => catalogue.filter((l) => l.priceCents <= 0).length, [catalogue])

  if (!user) return null

  return (
    <div className="space-y-6">
      <header>
        <h1 className="flex items-center gap-2.5 text-[28px] font-bold tracking-[-0.03em] text-ink-900">
          <span className="grid h-10 w-10 place-items-center border-2 border-ink-900 bg-accent-400 text-on-accent">
            <Compass size={20} aria-hidden="true" />
          </span>
          {t('ai_advisor')}
        </h1>
        <p className="mt-1.5 text-sm text-ink-500">{t('ai_advisor_subtitle')}</p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1.7fr_1fr]">
        <AiMentorPanel
          context={{ lessonTitle: lesson?.title, courseTitle: course?.title, studentName: user.name, catalogue }}
          height="h-[30rem]"
        />

        <div className="space-y-5">
          <Card className="p-5">
            <SectionHeading title={t('course_catalog')} icon={Sparkles} />
            {shelves.length ? (
              <ul className="space-y-2">
                {shelves.map(([direction, count]) => (
                  <li key={direction}>
                    <Link to="/" className="flex items-center justify-between gap-3 py-1 text-sm font-semibold text-ink-700 transition hover:text-ink-900">
                      {t(`dir_${direction}`)}
                      <Badge tone="neutral">{count}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-600">{t('catalogue_is_empty_body')}</p>
            )}
          </Card>

          {free > 0 && (
            <Card className="p-5">
              <SectionHeading title={t('free_only')} icon={Wallet} />
              <p className="text-sm leading-relaxed text-ink-600">{t('n_courses_found', { n: free })}</p>
              <p className="mt-2 text-xs text-ink-500">{t('offline_search_used')}</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
