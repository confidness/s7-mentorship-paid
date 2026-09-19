import { localizeAi, type AiEntryText } from '../i18n/ai'
import { getLocale } from '../i18n'

/**
 * AI Robotics Mentor — reply layer.
 *
 * `askMentor` is the only thing the UI knows about. Today it is answered by the local
 * knowledge base below; pointing it at a real model means replacing the body of this one
 * function with a fetch and keeping the same signature.
 *
 * Teaching rule baked into every answer: hint, explain, ask back. Never hand over the
 * finished project — the student has to build it.
 *
 * Every entry carries an id. The English text below is canonical; `localizeAi` swaps in the
 * Russian or Kazakh wording for the same id. Each `match` also accepts Russian and Kazakh
 * keywords, so a student gets the right answer whichever language they ask in.
 */

export interface AskContext {
  lessonTitle?: string
  courseTitle?: string
  studentName?: string
  code?: string
}

export interface AiReply {
  id: string
  text: string
  code?: { language: string; source: string; caption: string }
  question?: string
  followUps: string[]
  /** Whether a model answered, or the offline knowledge base did. Shown next to the reply. */
  fromModel?: boolean
}

interface Entry {
  id: string
  match: RegExp
  en: AiEntryText
  code?: { language: string; source: string }
}

export const KB: Entry[] = [
  {
    id: 'stuck',
    match: /\b(stuck|no idea|don'?t know what to do|i am lost|feeling lost|confused)\b|застрял|не знаю, ?что делать|непонятно|потерялся|тұрып қалдым|не істеу керегін білмеймін/i,
    en: {
      text: 'Being stuck is information, and which kind of stuck you are tells you what to do next.\n\nThere are only three. **You do not understand the task** — then reread it and write, in your own words, what a finished version would look like. **You understand it but cannot start** — then the task is too big, and the next move is to find the smallest piece you could finish in ten minutes. **You started and it is wrong** — then you have something concrete, which is the easiest of the three.\n\nName which one it is before you do anything else. Most of the time naming it is the whole answer.',
      question: 'Which of the three is it right now — not understood, too big, or started and wrong?',
      followUps: ['I cannot start at all', 'I do not understand the task', 'How do I ask my mentor?'],
    },
  },
  {
    id: 'where-to-start',
    match: /\b(where (do i|to) start|how (do i|to) begin|first step|blank)\b|с чего (начать|мне начать)|как начать|первый шаг|неден бастау|қалай бастаймын/i,
    en: {
      text: 'Do not start at the beginning. Start at the part you already understand, wherever it sits.\n\nA task you cannot begin is almost always several tasks wearing one label. Read it again and mark every separate thing it actually asks for — usually there are three or four. One of them you already know how to do. Do that one, and the page stops being blank, which is most of the problem.\n\nThe order you hand it in matters. The order you build it does not.',
      question: 'Read the task once more: how many separate things is it actually asking for?',
      followUps: ['I still cannot split it up', 'What is my mentor looking for?', 'How much time should this take?'],
    },
  },
  {
    id: 'feedback',
    match: /\b(feedback|comment|review said|what does .* mean|unclear)\b|замечани|комментарий|не понял.*(наставник|проверк)|что имел в виду|пікір|түсінбедім/i,
    en: {
      text: 'A review comment is usually shorter than the thought behind it. The useful move is to turn it into a question you can answer yes or no to.\n\n"This is unclear" becomes "would it be clear if I explained why I chose this?" — and now you can check. "Wrong approach" becomes "which step was the wrong one, the first or the last?" A comment you cannot convert into a yes-or-no question is one you should ask about directly.\n\nAsking a mentor to expand is not admitting anything. It is the cheapest thing in the whole loop.',
      question: 'Take the comment that puzzled you: what yes-or-no question would settle it?',
      followUps: ['How do I ask without sounding rude?', 'My work came back with changes', 'What are they grading?'],
    },
  },
  {
    id: 'changes',
    match: /\b(changes requested|sent back|rejected|returned|redo|failed review)\b|вернул|на доработку|отклонил|переделать|қайтарды|түзетуге/i,
    en: {
      text: 'Work coming back is the system doing its job, not a verdict on you. A mentor who returns something has read it — that is more attention than an approval sometimes gets.\n\nBefore you change anything, separate the comments into two piles: **this is wrong** and **this could be better**. Fix the first pile completely. Touch the second pile only if you have time, and say in your note which of those you chose not to do and why. A mentor reading a second submission wants to know you understood, not that you obeyed.\n\nResubmitting does not cost you the XP you already earned.',
      question: 'Of the comments you got, which are actually wrong-versus-better?',
      followUps: ['I disagree with one of the comments', 'How do I write the resubmission note?', 'Do I lose progress?'],
    },
  },
  {
    id: 'ask-well',
    match: /\b(how (do i|to) ask|good question|what should i ask|ask my mentor)\b|как [^.?!]{0,20}(спросить|задать вопрос)|задать вопрос|что спросить|сұрақ қою|қалай сұраймын/i,
    en: {
      text: 'A question that gets a fast answer has three parts, and most questions are missing the middle one.\n\n**What you were trying to do.** **What you tried.** **What happened instead.** The middle part is what turns "it does not work" into something answerable — it tells the mentor which wrong idea to correct, and without it they have to guess.\n\nIf writing the middle part solves it before you send, that is not wasted time. That is the most common outcome, and it is why the habit is worth having.',
      question: 'Try it on your current problem: what did you try, and what happened instead?',
      followUps: ['I do not know what I tried', 'My mentor has not replied', 'I do not understand their comment'],
    },
  },
  {
    id: 'deadline',
    match: /\b(deadline|late|behind|out of time|no time|running out)\b|дедлайн|не успева|опазда|мало времени|отстал|үлгермей|уақыт жоқ/i,
    en: {
      text: 'Hand in what you have, on time, with a note saying what is missing. That is almost always better than handing in nothing, later.\n\nA mentor can review partial work. They cannot review work that has not arrived, and a submission that says "the first two parts are done, the third is not started and here is why" gives them something to respond to. You get feedback on the two parts instead of on nothing.\n\nWhat you should not do is disappear. Being behind is ordinary; going quiet is what makes it a problem.',
      question: 'What is actually finished right now, even partly?',
      followUps: ['Can I ask for more time?', 'What do I write in the note?', 'I have not started at all'],
    },
  },
  {
    id: 'motivation',
    match: /\b(motivat\w*|lazy|gave up|procrastinat\w*|streak|burn(t|ed) out|cannot focus)\b|мотивац|лень|забросил|прокрастин|серия дней|выгорел|не могу сосредоточ|жалқау|тастап кеттім/i,
    en: {
      text: 'A broken streak is not a reason to stop; it is just a number that went back to one. The number was never the point.\n\nWhat actually works is making the next session smaller than your resistance to it. Not "finish the lesson" — open the task and read it. That is a real session. The reason it works is that starting is the expensive part, and a small start spends it cheaply.\n\nIf you have been away a while, do not try to catch up. Start from wherever you are, today.',
      question: 'What is the smallest piece of this you could finish in ten minutes?',
      followUps: ['I have been away for weeks', 'I cannot start at all', 'How long should a lesson take?'],
    },
  },
  {
    id: 'submit',
    match: /\b(submit|hand in|upload my work|send my work|attach)\b|сдать|отправить работу|прикрепить|загрузить работу|тапсыру|жіберу/i,
    en: {
      text: 'Hand in the work and the thinking. The work alone makes the mentor reconstruct what you were doing, and they will reconstruct it wrong.\n\nWith the submission, write three lines: what you were going for, what you are unsure about, and anything you deliberately left out. The middle line is the one that earns you the best feedback, because it tells the mentor where to look.\n\nIf the task asked for a file, attach it before you write the note — people forget in that order, not the other one.',
      question: 'What is the one thing in your work you are least sure about?',
      followUps: ['What are they grading?', 'Can I resubmit later?', 'How long does review take?'],
    },
  },
  {
    id: 'rubric',
    match: /\b(grade|grading|marked|rubric|criteria|what.*look(ing)? for|score)\b|оценива|критери|за что ставят|что смотрят|баға|нені қарайды/i,
    en: {
      text: 'Most mentors are reading for three things, in this order: does it do what was asked, can they follow your reasoning, and did you notice the parts that do not work.\n\nThe third one surprises people. Saying "this part is fragile and here is why" scores better than hoping nobody looks, because it shows you can see your own work clearly — which is the thing that actually transfers to the next task.\n\nPolish comes last, and it is the cheapest to fix. Do not spend your remaining hour there.',
      question: 'Looking at your work now: which part would you flag as the weakest?',
      followUps: ['How do I write the submission note?', 'My work came back with changes', 'How is XP calculated?'],
    },
  },
  {
    id: 'do-my-homework',
    match: /\b(write (the|my) (whole|entire|full)|do (my|the) (project|homework|task|assignment)|give me the (full|complete) (code|answer|solution)|solve it for me|just tell me the answer)\b|напиши (весь|целиком|полностью)|сделай (за меня|проект|задание)|реши за меня|дай (весь код|готовый ответ)|просто скажи ответ|толық жаз|бәрін жаз|орныма жаса/i,
    en: {
      text: 'No. Not because of a rule, but because it would waste the thing you are paying a mentor for.\n\nThe work is the only part that changes what you can do next time. Handing you a finished answer produces a submission with your name on it and nothing behind it, and your mentor will see that in about ten seconds — they read your earlier work.\n\nWhat I will do is take it apart with you. Which piece is actually blocking you: understanding what is being asked, knowing where to start, or getting something you started to work?',
      question: 'Which of those three is the real blocker?',
      followUps: ['I do not understand the task', 'I cannot start at all', 'I started and it is wrong'],
    },
  },
  {
    id: 'honesty',
    match: /\b(cheat|copy|plagiar|use ai|chatgpt|is it allowed|someone else.s work)\b|списать|скопировать|плагиат|можно ли исполь|чужую работу|көшіру|бөтен жұмыс/i,
    en: {
      text: 'The line is not about tools, it is about whether you could rebuild it. Using help to understand something is learning. Submitting something you could not explain is not, whoever or whatever produced it.\n\nA practical test before you hand in: cover the work and explain to yourself what each part does and why it is there. Anything you cannot explain, either understand it or take it out.\n\nIf you did use help substantially, say so in the note. Mentors respond to that far better than to being surprised by it later.',
      question: 'Could you explain every part of your current work without looking at it?',
      followUps: ['What should go in the note?', 'What are they grading?', 'I do not understand part of my own work'],
    },
  },
  {
    id: 'choose-mentor',
    match: /\b(which mentor|choose a mentor|worth (it|paying)|is it worth|pick a (lesson|mentor)|price)\b|какого наставника|выбрать наставника|стоит ли (платить|брать)|цена урока|қай тәлімгер|тұра ма/i,
    en: {
      text: 'Read what the lesson actually asks you to hand in, not what it promises to teach. The tasks tell you the level far more honestly than the summary does.\n\nA lesson worth paying for has work in it that a person will read. If the whole thing marks itself, you are buying material, which is fine — just know that is what it is. If it asks for something written or built, you are buying somebody’s attention, and that is the part that is hard to get anywhere else.\n\nEvery mentor here was checked by a named reviewer before they could publish. That is a floor, not a recommendation.',
      question: 'Look at the tasks in the lesson you are considering: how many need a human to read them?',
      followUps: ['How does paying work?', 'Can I see a lesson before buying?', 'How do I become a mentor?'],
    },
  },
  {
    id: 'access',
    match: /\b(paid|bought|purchase|cannot open|locked|access|refund)\b|оплатил|купил|не открывается|нет доступа|заблокирован|возврат|төледім|ашылмайды/i,
    en: {
      text: 'Access is decided on the server, not in your browser, and it is granted when the payment actually confirms rather than when you return from the checkout page. With most cards that is immediate; with a few methods it takes a minute.\n\nIf a lesson you paid for is still shut after that, reload once — the page asks again on load. If it is still shut, that is a real fault and worth reporting rather than retrying the payment, because a second payment would be a second order.\n\nA refund withdraws access again, which is the same mechanism running backwards.',
      question: 'Did the payment confirm, or did you come back from the checkout page before it finished?',
      followUps: ['I was charged twice', 'How do refunds work?', 'Is this lesson worth it?'],
    },
  },
  {
    id: 'become-mentor',
    match: /\b(become a mentor|teach here|sell (a|my) lesson|apply to teach|how do i teach)\b|стать наставником|преподавать|продавать урок|подать заявку|тәлімгер болу|сабақ сату/i,
    en: {
      text: 'Register as a student first, then apply from **Teach on S7**. The application asks for your legal name, what you have taught, and at least one document, and a named reviewer approves or rejects it on the record.\n\nApproval lets you write and publish. Selling needs one more thing: a connected payout account, checked both when you publish a priced lesson and again when somebody tries to buy it — an account that gets restricted later stops sales rather than taking money it cannot forward.\n\nYour first lesson does not have to be long. It has to have something in it worth reading.',
      question: 'What is the one thing you know well enough to review somebody else doing?',
      followUps: ['What documents do I need?', 'How does the payout split work?', 'How long does approval take?'],
    },
  },
  {
    id: 'hello',
    match: /\b(hi|hello|hey|salam|good (morning|evening))\b|привет|здравствуй|добрый (день|вечер)|сәлем|салам/i,
    en: {
      text: 'Hello, {name}. You are on **{lesson}** — tell me where it is going wrong and we will take it apart.\n\nI give hints, explanations and questions back. I will not write the thing for you, because your mentor is going to read it and so should you.',
      question: 'What are you working on at this moment?',
      followUps: ['I am stuck', 'I do not understand the feedback', 'Where do I start?'],
    },
  },
]

/** Greeting and fallback each have a second wording for when we do not know the lesson. */
const NO_LESSON: Record<string, AiEntryText> = {
  hello: {
    text: 'Hello, {name}. Ask me about a task you are stuck on, a review comment you did not follow, or simply where to begin.\n\nI give hints, explanations and questions back — never the finished answer.',
    question: 'What are you working on at this moment?',
    followUps: ['I am stuck', 'I do not understand the feedback', 'Where do I start?'],
  },
  fallback: {
    text: 'I can help best if we narrow it down.\n\nMost problems here are one of four:\n\n• **The task** — you are not sure what is being asked\n• **The start** — you know, but cannot get going\n• **The work** — you started and something is wrong\n• **The review** — a mentor said something you did not follow\n\nTell me which, and paste the exact wording if there is any.',
    question: 'Which of those four is it?',
    followUps: ['I am stuck', 'Where do I start?', 'I do not understand the feedback'],
  },
}

const FALLBACK: AiEntryText = {
  text: 'I can help best if we narrow it down. You are on **{lesson}**, so I will assume that is the context.\n\nMost problems here are one of four:\n\n• **The task** — you are not sure what is being asked\n• **The start** — you know, but cannot get going\n• **The work** — you started and something is wrong\n• **The review** — a mentor said something you did not follow\n\nTell me which, and paste the exact wording if there is any.',
  question: 'Which of those four is it?',
  followUps: ['I am stuck', 'Where do I start?', 'I do not understand the feedback'],
}
let counter = 0

/** How long to wait for the model before falling back — a stuck student will not sit through more. */
const MODEL_TIMEOUT_MS = 12_000

/**
 * When a 501 said no key was configured, so an unconfigured deployment stops asking every time.
 *
 * It expires rather than latching for good: a key added in the dashboard would otherwise leave
 * every tab opened beforehand permanently offline, with nothing on screen to explain why.
 */
let offlineUntil = 0
const OFFLINE_RETRY_MS = 60_000

/**
 * Asks the server-side model. Returns null on anything at all — no key configured, rate limit,
 * offline, slow — and the caller falls back to the local knowledge base. The student should never
 * see an error where a hint belongs.
 */
async function askModel(question: string, ctx: AskContext): Promise<Omit<AiReply, 'id'> | null> {
  if (Date.now() < offlineUntil) return null
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), MODEL_TIMEOUT_MS)
  try {
    const res = await fetch('/api/mentor', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: abort.signal,
      body: JSON.stringify({
        question,
        locale: getLocale(),
        lessonTitle: ctx.lessonTitle,
        courseTitle: ctx.courseTitle,
        code: ctx.code,
      }),
    })
    if (res.status === 501) {
      offlineUntil = Date.now() + OFFLINE_RETRY_MS
      return null
    }
    if (!res.ok) return null
    const data = (await res.json()) as Omit<AiReply, 'id'>
    return data?.text ? data : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export function askMentorLocal(question: string, ctx: AskContext = {}): Promise<AiReply> {
  const entry = KB.find((e) => e.match.test(question))
  const lesson = ctx.lessonTitle ?? ''
  const vars = { name: ctx.studentName?.split(' ')[0] ?? '', lesson }

  // The greeting and the fallback read differently when there is no lesson to refer to.
  let id = entry?.id ?? 'fallback'
  let en = entry?.en ?? FALLBACK
  if (!lesson && NO_LESSON[id]) {
    id = `${id}_plain`
    en = NO_LESSON[entry?.id ?? 'fallback']
  }

  const body = localizeAi(id, en, vars)
  const reply: AiReply = {
    id: `ai-${++counter}-${Date.now()}`,
    text: body.text,
    question: body.question,
    followUps: body.followUps,
    code: entry?.code && body.caption ? { ...entry.code, caption: body.caption } : undefined,
  }
  // Latency is deliberate: the UI has to handle a pending state, exactly as it would with a real model.
  return new Promise((resolve) => setTimeout(() => resolve(reply), 620 + Math.random() * 520))
}

/**
 * What the UI calls. The model answers when one is configured and reachable; otherwise the local
 * base does, with the same shape and the same teaching rule. Neither path can fail visibly.
 */
export async function askMentor(question: string, ctx: AskContext = {}): Promise<AiReply> {
  const fromModel = await askModel(question, ctx)
  if (fromModel) return { ...fromModel, id: `ai-${++counter}-${Date.now()}`, fromModel: true }
  return askMentorLocal(question, ctx)
}

/** Keys into the UI dictionary — the prompts are translated at render time, like every other label. */
export const STARTER_PROMPTS = ['ai_starter_stuck', 'ai_starter_begin', 'ai_starter_feedback', 'ai_starter_ask', 'ai_starter_grading']
