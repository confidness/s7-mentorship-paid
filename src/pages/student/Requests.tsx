import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CalendarClock, Check, Megaphone, Plus, Wallet } from 'lucide-react'
import { useApp, useToast } from '../../lib/store'
import { answerRequest, askForCourse, listRequests, voteForRequest, withdrawRequest, type CourseRequest } from '../../lib/api'
import { backendConfigured } from '../../lib/supabase'
import { directionOf } from '../../lib/discovery'
import { lessonsByAuthor } from '../../lib/selectors'
import { formatMoney, parsePrice } from '../../lib/money'
import { Badge, Button, Card, EmptyState, Field, Modal, SkeletonCard, btn, controlClass, inputClass } from '../../components/ui'
import { t, getLocale } from '../../i18n'

/**
 * The demand board.
 *
 * A marketplace with an empty catalogue cannot attract students, and without students it
 * cannot attract mentors. Every large platform buys its way out of that; this one publishes
 * the demand instead, so the first thing a mentor sees is not a blank page but a ranked list
 * of briefs with an audience already attached to each.
 *
 * The same page serves both sides. A student asks and backs; a mentor answers with a course
 * they wrote. Splitting it in two would mean a mentor could not see what they, as a learner,
 * had asked for — and since teaching here is a switch rather than a status, most people are
 * both.
 */
export default function Requests() {
  const { state, user, standing } = useApp()
  const locale = getLocale()
  const [params] = useSearchParams()

  const [requests, setRequests] = useState<CourseRequest[] | null>(null)
  const [voted, setVoted] = useState<string[]>([])
  const [asking, setAsking] = useState(Boolean(params.get('ask')))
  const [answering, setAnswering] = useState<CourseRequest | null>(null)

  const load = useCallback(async () => {
    if (!backendConfigured) return setRequests([])
    try {
      const data = await listRequests()
      setRequests(data.requests)
      setVoted(data.voted)
    } catch {
      // The board is not worth an error screen: an empty one reads the same as a quiet one.
      setRequests([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /** Optimistic, because a vote that waits for a round trip feels broken. */
  async function toggleVote(request: CourseRequest) {
    const wanted = !voted.includes(request.id)
    setVoted((all) => (wanted ? [...all, request.id] : all.filter((id) => id !== request.id)))
    setRequests((all) => all?.map((r) => (r.id === request.id ? { ...r, votes: Math.max(0, r.votes + (wanted ? 1 : -1)) } : r)) ?? all)
    try {
      await voteForRequest(request.id, wanted)
    } catch {
      void load()
    }
  }

  if (!user) return null

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-0.03em] text-ink-900">{t('demand_board')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-500">{standing.isMentor ? t('demand_board_mentor_subtitle') : t('demand_board_subtitle')}</p>
        </div>
        <button className={btn('primary')} onClick={() => setAsking(true)}>
          <Plus size={17} aria-hidden="true" />
          {t('ask_for_a_course')}
        </button>
      </header>

      {requests === null ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : !requests.length ? (
        <EmptyState icon={Megaphone} title={t('nothing_requested_yet')} body={t('nothing_requested_yet_body')} action={<button className={btn('primary')} onClick={() => setAsking(true)}>{t('ask_for_a_course')}</button>} />
      ) : (
        <ul className="space-y-4">
          {requests.map((request) => {
            const backed = voted.includes(request.id)
            return (
              <li key={request.id}>
                <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:gap-5">
                  {/* The count is the point of the row, so it leads. */}
                  <button
                    onClick={() => void toggleVote(request)}
                    aria-pressed={backed}
                    aria-label={backed ? t('backed') : t('back_this')}
                    className={`flex h-16 w-16 shrink-0 flex-col items-center justify-center border-2 border-ink-900 text-center transition ${
                      backed ? 'bg-accent-400 text-on-accent shadow-[3px_3px_0_0_var(--color-ink-900)]' : 'fill-strong text-ink-900 hover:shadow-[3px_3px_0_0_var(--color-ink-900)]'
                    }`}
                  >
                    <span className="text-lg leading-none font-bold tabular-nums">{request.votes}</span>
                    <span className="mt-0.5 text-[10px] leading-tight font-semibold">{backed ? <Check size={12} className="mx-auto" aria-hidden="true" /> : t('back_this').split(' ')[0]}</span>
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="brand">{t(`dir_${directionOf({ title: request.title, summary: request.body })}`)}</Badge>
                      {request.answers.length > 0 && <Badge tone="success">{t('answered_by_n_courses', { n: request.answers.length })}</Badge>}
                    </div>
                    <h2 className="mt-2 text-base font-bold tracking-[-0.02em] text-ink-900">{request.title}</h2>
                    {request.body && <p className="mt-1 text-sm leading-relaxed text-ink-600">{request.body}</p>}

                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-500">
                      <span className="inline-flex items-center gap-1">
                        <Wallet size={13} aria-hidden="true" />
                        {request.budgetCents > 0 ? formatMoney(request.budgetCents, request.currency, locale) : t('no_budget_stated')}
                      </span>
                      {request.deadline && (
                        <span className="inline-flex items-center gap-1">
                          <CalendarClock size={13} aria-hidden="true" />
                          {request.deadline}
                        </span>
                      )}
                      <span>{t('n_people_want_this', { n: request.votes })}</span>
                    </div>

                    {request.answers.length > 0 && (
                      <ul className="mt-3 flex flex-wrap gap-2">
                        {request.answers.map((answer) => (
                          <li key={answer.lessonId}>
                            <Link to={`/assigned/${answer.lessonId}`} className="border edge fill-strong px-3 py-1.5 text-xs font-semibold text-ink-700 transition hover:border-brand-300">
                              {state.customLessons.find((l) => l.id === answer.lessonId)?.title ?? t('course')}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-col gap-2">
                    {standing.isMentor && (
                      <Button variant="secondary" size="sm" onClick={() => setAnswering(request)}>
                        {t('answer_with_a_course')}
                      </Button>
                    )}
                    {request.authorId === user.id && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          await withdrawRequest(request.id).catch(() => {})
                          void load()
                        }}
                      >
                        {t('withdraw_request')}
                      </Button>
                    )}
                  </div>
                </Card>
              </li>
            )
          })}
        </ul>
      )}

      {/* Accounts are free and self-serve, so a vote count is a number of accounts. Saying so
          under the board is cheaper than pretending the number is more precise than it is. */}
      {requests !== null && requests.length > 0 && <p className="text-xs text-ink-500">{t('votes_are_accounts_not_people')}</p>}

      {asking && <AskModal onClose={() => setAsking(false)} onDone={load} initialTitle={params.get('ask') ?? ''} />}
      {answering && <AnswerModal request={answering} onClose={() => setAnswering(null)} onDone={load} />}
    </div>
  )
}

function AskModal({ onClose, onDone, initialTitle }: { onClose: () => void; onDone: () => void; initialTitle: string }) {
  const toast = useToast()
  const [title, setTitle] = useState(initialTitle)
  const [body, setBody] = useState('')
  const [budget, setBudget] = useState('')
  const [deadline, setDeadline] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    if (title.trim().length < 4) return setError(t('request_title_hint'))
    setBusy(true)
    try {
      await askForCourse({
        title: title.trim(),
        body: body.trim(),
        budgetCents: parsePrice(budget, 'usd') ?? 0,
        currency: 'usd',
        deadline: deadline || null,
      })
      onDone()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('something_went_wrong_try_again'))
      toast({ title: t('something_went_wrong_try_again'), tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('ask_for_a_course')}
      subtitle={t('what_should_someone_teach')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            {t('ask_for_a_course')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('what_should_someone_teach')} required hint={t('request_title_hint')} error={error}>
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label={t('request_body_label')} hint={t('request_body_hint')}>
          <textarea className={`${inputClass} min-h-28 resize-y`} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('budget_label')} hint={t('budget_hint')}>
            <input className={inputClass} value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="decimal" placeholder="0" />
          </Field>
          <Field label={t('deadline_label')}>
            <input className={inputClass} type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  )
}

/** A mentor answers with something they already wrote — the server refuses anything else. */
function AnswerModal({ request, onClose, onDone }: { request: CourseRequest; onClose: () => void; onDone: () => void }) {
  const { state, user } = useApp()
  const toast = useToast()
  const mine = useMemo(() => (user ? lessonsByAuthor(state, user.id).filter((l) => l.published) : []), [state, user])
  const [lessonId, setLessonId] = useState(mine[0]?.id ?? '')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    try {
      const { announced } = await answerRequest(request.id, lessonId)
      toast({ title: t('answered_by_n_courses', { n: 1 }), body: t('n_people_want_this', { n: announced }), tone: 'success' })
      onDone()
      onClose()
    } catch (err) {
      toast({ title: t('something_went_wrong_try_again'), body: err instanceof Error ? err.message : '', tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('answer_with_a_course')}
      subtitle={request.title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={!lessonId}>
            {t('answer_with_a_course')}
          </Button>
        </>
      }
    >
      {mine.length ? (
        <Field label={t('my_lessons')}>
          <select className={`${controlClass} w-full`} value={lessonId} onChange={(e) => setLessonId(e.target.value)}>
            {mine.map((lesson) => (
              <option key={lesson.id} value={lesson.id}>
                {lesson.title}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <p className="text-sm text-ink-600">{t('catalogue_is_empty_body')}</p>
      )}
    </Modal>
  )
}
