import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Bot, Clock, HelpCircle, Megaphone, Route, Send, Sparkles, User as UserIcon } from 'lucide-react'
import { useApp, useToast } from '../lib/store'
import { askMentor, STARTER_PROMPTS, type AiReply, type AskContext } from '../lib/ai'
import { directionOf, minutesOf } from '../lib/discovery'
import { formatMoney } from '../lib/money'
import type { CustomLesson } from '../lib/types'
import { CodeBlock } from './code'
import { Button, inputClass } from './ui'
import { t, getLocale } from '../i18n'

/**
 * A recommendation, as something you can open.
 *
 * Advice that names a course and leaves you to find it is half an answer. The ids come back
 * with the reply; the course itself is looked up in the catalogue that was sent, so nothing
 * renders here that the platform does not actually hold.
 */
function Recommendation({ lesson }: { lesson: CustomLesson }) {
  return (
    <Link to={`/assigned/${lesson.id}`} className="group flex items-center gap-3 border-2 border-ink-900 fill-strong px-3.5 py-2.5 transition hover:shadow-[4px_4px_0_0_var(--color-ink-900)]">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold text-ink-900">{lesson.title}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-ink-500">
          <span>{t(`dir_${directionOf(lesson)}`)}</span>
          <span className="inline-flex items-center gap-1">
            <Clock size={11} aria-hidden="true" />
            {t('about_n_minutes', { n: minutesOf(lesson) })}
          </span>
          <span className="font-semibold text-ink-700">{lesson.priceCents > 0 ? formatMoney(lesson.priceCents, lesson.currency, getLocale()) : t('free')}</span>
        </span>
      </span>
      <ArrowRight size={15} className="shrink-0 text-ink-400 transition group-hover:text-ink-900" aria-hidden="true" />
    </Link>
  )
}

interface Message {
  id: string
  role: 'user' | 'ai'
  text: string
  reply?: AiReply
}

/** Renders **bold** and paragraph breaks — the only formatting the mentor replies use. */
function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, i) =>
        line.trim() === '' ? (
          <span key={i} className="block h-2" />
        ) : (
          <p key={i} className="text-sm leading-relaxed text-ink-700">
            {line.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
              part.startsWith('**') ? (
                <strong key={j} className="font-bold text-ink-900">
                  {part.slice(2, -2)}
                </strong>
              ) : (
                <span key={j}>{part}</span>
              ),
            )}
          </p>
        ),
      )}
    </>
  )
}

export default function AiMentorPanel({ context, height = 'h-[32rem]' }: { context: AskContext; height?: string }) {
  const { setLearningPath } = useApp()
  const toast = useToast()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [messages, pending])

  async function ask(question: string) {
    const q = question.trim()
    if (!q || pending) return
    setInput('')
    setMessages((m) => [...m, { id: `u-${Date.now()}`, role: 'user', text: q }])
    setPending(true)
    const reply = await askMentor(q, context)
    setPending(false)
    setMessages((m) => [...m, { id: reply.id, role: 'ai', text: reply.text, reply }])
  }

  return (
    <div className="flex flex-col overflow-hidden border edge fill-strong">
      <div className="flex items-center gap-3 border-b edge fill-soft px-4 py-3">
        <span className="grid h-9 w-9 place-items-center bg-gradient-to-br from-accent-500 to-brand-600 text-white">
          <Bot size={18} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-ink-900">{t('ai_mentor_title')}</p>
          <p className="truncate text-xs text-ink-500">{context.lessonTitle ? t('context_lesson', { title: context.lessonTitle }) : t('hints_explanations_and_debugging_never_the_finis')}</p>
        </div>
      </div>

      <div ref={scroller} className={`flex-1 space-y-4 overflow-y-auto p-4 ${height}`}>
        {messages.length === 0 && (
          <div className="py-6 text-center">
            <span className="mx-auto mb-3 grid h-12 w-12 place-items-center fill text-ink-400">
              <Sparkles size={22} aria-hidden="true" />
            </span>
            <p className="text-sm font-semibold text-ink-900">{t('ask_anything_about_your_build')}</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-ink-500">{t('hints_and_questions_never_the_answer')}</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {STARTER_PROMPTS.map((p) => (
                <button key={p} onClick={() => ask(t(p))} className="border edge fill-strong px-3 py-1.5 text-xs font-medium text-ink-700 transition hover:border-brand-300 hover:bg-brand-50">
                  {t(p)}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="flex justify-end gap-2.5">
              <p className="max-w-[80%] bg-brand-600 px-3.5 py-2.5 text-sm leading-relaxed text-white">{m.text}</p>
              <span className="grid h-8 w-8 shrink-0 place-items-center bg-ink-200 text-ink-600">
                <UserIcon size={15} aria-hidden="true" />
              </span>
            </div>
          ) : (
            <div key={m.id} className="flex gap-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center bg-gradient-to-br from-accent-500 to-brand-600 text-white">
                <Bot size={15} aria-hidden="true" />
              </span>
              <div className="min-w-0 max-w-[85%] space-y-3">
                <div className="fill px-3.5 py-3">
                  <RichText text={m.text} />
                  {/* Which brain answered. Useful when the key is missing and the offline base steps in. */}
                  <p className="mt-2 flex items-center gap-1 text-[11px] font-medium text-ink-500">
                    <Sparkles size={10} aria-hidden="true" />
                    {m.reply?.fromModel ? t('answered_by_the_model') : t('answered_offline')}
                  </p>
                </div>
                {m.reply?.askFor && (
                  <Link
                    to={`/requests?ask=${encodeURIComponent(m.reply.askFor)}`}
                    className="inline-flex items-center gap-2 border-2 border-ink-900 bg-accent-400 px-4 py-2 text-sm font-semibold text-on-accent shadow-[3px_3px_0_0_var(--color-ink-900)]"
                  >
                    <Megaphone size={15} aria-hidden="true" />
                    {t('ask_for_it_instead')}
                  </Link>
                )}
                {m.reply?.recommendations && m.reply.recommendations.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-bold tracking-wide text-ink-500">{t('recommended_for_you')}</p>
                    {m.reply.recommendations
                      .map((id) => (context.catalogue ?? []).find((l) => l.id === id))
                      .filter((lesson): lesson is CustomLesson => Boolean(lesson))
                      .map((lesson) => (
                        <Recommendation key={lesson.id} lesson={lesson} />
                      ))}
                    {/* Advice you have to remember is advice you lose. Keeping it turns three
                        suggestions into something with a position and a next step. */}
                    {m.reply.recommendations.length > 1 && (
                      <button
                        onClick={() => {
                          setLearningPath(m.reply!.recommendations!)
                          toast({ title: t('my_learning_path'), body: t('path_kept'), tone: 'success' })
                        }}
                        className="mt-1 inline-flex items-center gap-2 border-2 border-ink-900 fill-strong px-3.5 py-2 text-xs font-bold text-ink-900 transition hover:shadow-[3px_3px_0_0_var(--color-ink-900)]"
                      >
                        <Route size={14} aria-hidden="true" />
                        {t('save_as_my_path')}
                      </button>
                    )}
                  </div>
                )}
                {m.reply?.code && (
                  <div>
                    <p className="mb-1.5 text-xs font-semibold text-ink-500">{m.reply.code.caption}</p>
                    <CodeBlock source={m.reply.code.source} filename="hint.ino" />
                  </div>
                )}
                {m.reply?.question && (
                  <p className="flex items-start gap-2 border border-brand-200/70 bg-brand-100/50 px-3.5 py-2.5 text-sm font-medium text-brand-800">
                    <HelpCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                    {m.reply.question}
                  </p>
                )}
                {m.reply?.followUps && m.reply.followUps.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {m.reply.followUps.map((f) => (
                      <button key={f} onClick={() => ask(f)} className="border edge fill-strong px-3 py-1.5 text-xs font-medium text-ink-700 transition hover:border-brand-300 hover:bg-brand-50">
                        {f}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ),
        )}

        {pending && (
          <div className="flex gap-2.5" aria-live="polite">
            <span className="grid h-8 w-8 shrink-0 place-items-center bg-gradient-to-br from-accent-500 to-brand-600 text-white">
              <Bot size={15} aria-hidden="true" />
            </span>
            <span className="flex items-center gap-1.5 fill px-4 py-3.5">
              <span className="sr-only">{t('mentor_is_typing')}</span>
              {[0, 1, 2].map((i) => (
                <span key={i} className="h-2 w-2 animate-bounce bg-ink-400" style={{ animationDelay: `${i * 120}ms` }} />
              ))}
            </span>
          </div>
        )}
      </div>

      <form
        className="flex items-end gap-2 border-t edge p-3"
        onSubmit={(e) => {
          e.preventDefault()
          ask(input)
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              ask(input)
            }
          }}
          rows={1}
          placeholder={t('ask_about_anything_stuck')}
          aria-label={t('message_the_ai_mentor')}
          className={`${inputClass} max-h-32 min-h-11 flex-1 resize-none py-3`}
        />
        <Button type="submit" icon={Send} disabled={!input.trim() || pending} aria-label={t('send_message')}>
          <span className="hidden sm:inline">{t('ask')}</span>
        </Button>
      </form>
    </div>
  )
}
