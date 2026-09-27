import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock, MessageSquareReply, Search, Sparkles, Users } from 'lucide-react'
import { useApp } from '../../lib/store'
import { assignedLessons } from '../../lib/selectors'
import { DIRECTION_IDS, searchLessons, type DirectionId, type FormatId, type LengthId } from '../../lib/discovery'
import { formatMoney } from '../../lib/money'
import { Badge, Card, EmptyState, SkeletonCard, btn, controlClass, inputClass } from '../../components/ui'
import { useLoaded } from '../../lib/hooks'
import { t, getLocale } from '../../i18n'

const FORMATS: FormatId[] = ['quiz', 'practice', 'coding', 'reading']
const LENGTHS: LengthId[] = ['short', 'medium', 'long']

/**
 * The catalogue, and the front door.
 *
 * This page used to list `state.courses` — the built-in curriculum, which the pivot emptied.
 * It has rendered nothing to anybody since, which for a home page is the whole shop front.
 * What there actually is to learn here is what mentors have published, so that is what it
 * lists now.
 *
 * The filtering is `lib/discovery.ts` and runs entirely in the browser: no query to the
 * server, no model, nothing to be down. The advisor sits on top of the same ranking, which
 * is why the two never disagree about what exists.
 */
export default function Courses() {
  const { state } = useApp()
  const ready = useLoaded()
  const locale = getLocale()

  const [query, setQuery] = useState('')
  const [direction, setDirection] = useState<DirectionId | 'all'>('all')
  const [format, setFormat] = useState<FormatId | 'all'>('all')
  const [length, setLength] = useState<LengthId | 'all'>('all')
  const [freeOnly, setFreeOnly] = useState(false)

  const published = useMemo(() => assignedLessons(state), [state])
  const results = useMemo(() => searchLessons(published, { query, direction, format, length, freeOnly }), [published, query, direction, format, length, freeOnly])

  // Only directions with something in them. A dropdown full of empty shelves reads as a
  // broken catalogue rather than a small one.
  const stocked = useMemo(() => {
    const present = new Set(searchLessons(published).map((m) => m.direction))
    return DIRECTION_IDS.filter((id) => present.has(id))
  }, [published])

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-0.03em] text-ink-900">{t('course_catalog')}</h1>
          <p className="mt-1 text-sm text-ink-500">{t('courses_published_by_mentors')}</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge tone="brand">{t('n_courses_found', { n: results.length })}</Badge>
          <Link to="/ai" className={btn('secondary', 'sm')}>
            <Sparkles size={15} aria-hidden="true" />
            {t('ai_advisor')}
          </Link>
        </div>
      </header>

      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search size={16} className="absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-400" aria-hidden="true" />
            <input
              className={`${inputClass} pl-10`}
              placeholder={t('what_do_you_want_to_learn')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={t('search_courses')}
              type="search"
            />
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-1 lg:pb-0">
            <select className={`${controlClass} min-w-36`} value={direction} onChange={(e) => setDirection(e.target.value as DirectionId | 'all')} aria-label={t('any_direction')}>
              <option value="all">{t('any_direction')}</option>
              {stocked.map((id) => (
                <option key={id} value={id}>
                  {t(`dir_${id}`)}
                </option>
              ))}
            </select>
            <select className={`${controlClass} min-w-32`} value={format} onChange={(e) => setFormat(e.target.value as FormatId | 'all')} aria-label={t('any_format')}>
              <option value="all">{t('any_format')}</option>
              {FORMATS.map((id) => (
                <option key={id} value={id}>
                  {t(`fmt_${id}`)}
                </option>
              ))}
            </select>
            <select className={`${controlClass} min-w-32`} value={length} onChange={(e) => setLength(e.target.value as LengthId | 'all')} aria-label={t('any_length')}>
              <option value="all">{t('any_length')}</option>
              {LENGTHS.map((id) => (
                <option key={id} value={id}>
                  {t(`len_${id}`)}
                </option>
              ))}
            </select>
            <label className="flex shrink-0 items-center gap-2 px-1 text-sm font-semibold text-ink-700">
              <input type="checkbox" className="size-4 accent-[var(--color-ink-900)]" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} />
              {t('free_only')}
            </label>
          </div>
        </div>
      </Card>

      {!ready ? (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : !published.length ? (
        <EmptyState icon={Search} title={t('catalogue_is_empty')} body={t('catalogue_is_empty_body')} />
      ) : !results.length ? (
        <EmptyState icon={Search} title={t('nothing_matches_those_filters')} body={t('widen_the_filters_or_clear_the_search')} />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {results.map(({ lesson, direction: dir, format: fmt, minutes }) => (
            <Link key={lesson.id} to={`/assigned/${lesson.id}`} className="group block">
              <Card className="flex h-full flex-col gap-3 p-5 transition group-hover:-translate-y-0.5 group-hover:shadow-[6px_6px_0_0_var(--color-ink-900)]">
                <div className="flex items-start justify-between gap-3">
                  <Badge tone="brand">{t(`dir_${dir}`)}</Badge>
                  <span className="text-sm font-bold whitespace-nowrap text-ink-900">
                    {lesson.priceCents > 0 ? formatMoney(lesson.priceCents, lesson.currency, locale) : t('free')}
                  </span>
                </div>

                <div className="flex-1">
                  <h2 className="text-base font-bold tracking-[-0.02em] text-ink-900">{lesson.title}</h2>
                  <p className="mt-1.5 line-clamp-3 text-sm text-ink-600">{lesson.summary}</p>
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
                  <span className="inline-flex items-center gap-1">
                    <Clock size={13} aria-hidden="true" />
                    {t('about_n_minutes', { n: minutes })}
                  </span>
                  <span>{t(`fmt_${fmt}`)}</span>
                  {lesson.authorName && <span className="truncate">{lesson.authorName}</span>}
                </div>

                {/* The line the author did not write. `buyers` is the one nobody can forge —
                    only the Stripe webhook writes an entitlement — so it leads when there is
                    one, and `starters` is labelled as starting rather than finishing because
                    that is all it can honestly claim. No numbers at all reads as new, not as
                    bad: a blank where other cards have figures is a penalty on the newest
                    mentors, which is the last group to discourage. */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t-2 border-ink-900 pt-2 text-xs font-semibold text-ink-700">
                  {lesson.stats?.buyers ? (
                    <span className="inline-flex items-center gap-1">
                      <Users size={13} aria-hidden="true" />
                      {t('n_people_took_this', { n: lesson.stats.buyers })}
                    </span>
                  ) : lesson.stats?.starters ? (
                    <span className="inline-flex items-center gap-1">
                      <Users size={13} aria-hidden="true" />
                      {t('n_people_started_this', { n: lesson.stats.starters })}
                    </span>
                  ) : (
                    <span className="text-ink-500">{t('no_record_yet')}</span>
                  )}
                  {lesson.stats?.medianReviewHours !== undefined && (
                    <span className="inline-flex items-center gap-1 text-ink-600">
                      <MessageSquareReply size={13} aria-hidden="true" />
                      {t('replies_in_about_n_hours', { n: Math.max(1, Math.round(lesson.stats.medianReviewHours)) })}
                    </span>
                  )}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
