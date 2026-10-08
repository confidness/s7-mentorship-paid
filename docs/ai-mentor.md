# The AI mentor

`askMentor(question, context)` in `src/lib/ai.ts` is the only thing the UI knows about, and it
has two brains behind it.

When a key is configured, `api/mentor.ts` answers — a serverless function calling OpenRouter or
Anthropic. **The key lives only in the server's environment.** There is deliberately no `VITE_`
prefix: anything carrying one is inlined into the client bundle and readable in devtools.

Without a key — or on a rate limit, a timeout, an outage, or a reply that will not parse — the
built-in knowledge base answers instead, with the same shape and the same teaching rule. Each
reply says which brain produced it.

## What it is for

It has two jobs, and they use the same box.

**Choosing a course.** The platform teaches nothing itself, so a student's first problem is
which of the published lessons to start with. The question comes in two parts and the first is
usually the real one: somebody who says they want to earn more has not chosen a field yet. The
catalogue is ranked in the browser first (`src/lib/discovery.ts` derives a direction, a length
and a format from each lesson's own words, because a mentor publishing in three minutes will
not fill in a taxonomy), and the model is handed that shortlist and told to choose among it. A
model asked to recommend a course with no catalogue in front of it produces a confident,
plausible, non-existent one. The ids it returns are checked against the real catalogue before
any card is rendered, so an invented id costs one suggestion instead of the student's trust in
the rest. When nothing in the catalogue is close, the reply offers the question back as a
request for the demand board.

**Getting unstuck.** Fifteen topics in three languages, and they are about learning rather than
about any subject: being stuck, a blank start, a review comment that did not land, work sent
back, asking a question that gets answered, a missed deadline, a broken streak, what belongs in
a submission, what a mentor is actually grading, using help honestly, choosing a mentor, access
after paying, and how to teach here. The local knowledge base answers these when it recognises
the question outright; anything else is treated as a request for a course.

## The teaching rule

The teaching rule is stated as a rule rather than a preference: hint, explain, ask back, and
refuse to hand over the finished work. Asked to do the assignment, the knowledge base says no
and offers to take the problem apart instead — there are only three ways to be stuck, and
naming which one is usually most of the answer. The server prompt was rewritten when the
assistant became a course advisor, and it now tells the model to recommend only what is in the
catalogue it is given and never to write code.

## Sign-in, keys and cost

`POST /api/mentor` requires a signed-in caller. The route spends an API key, and an endpoint
that spends a key for any caller on the internet is the same bill by a slower route. The
failure is the same 401 every other route gives, and the client treats any failure here as a
reason to fall back to the knowledge base.

`GET /api/mentor` is a health check. It says whether a key is configured, which provider,
which model (or `auto` for the built-in list), and the daily limit in force, and never a
secret. **Settings → Server features** reads it.

A single call is bounded too: the question is capped at 2000 characters, the catalogue at
twenty lines of 300 characters, and the reply at 700 tokens. The client waits 12 seconds for
the model before falling back, and after a 501 (no key configured) stops asking for a minute,
so an unconfigured deployment does not make every question wait on a request that cannot
succeed.

## A daily allowance

Signing in is not enough of a limit. Registration is open, so an account costs nothing, and a
signed-in loop can run the provider bill up as fast as the provider answers. The per-call caps
bound one request, not the total.

Every question about to reach a model spends one unit of the signed-in account's UTC-day
allowance. The count is kept in Postgres by `consume_ai_quota` (`0012_ai_usage.sql`), because a
serverless function keeps no memory between invocations and a counter held there would reset on
every cold start. The function is `security definer` and takes the account from `auth.uid()`,
so nobody can spend another account's allowance, and the route calls it through the caller's own
client, not the service role. The check and the increment are one statement, so two requests
arriving together cannot both pass on the last unit.

The unit is spent after every check that would have turned the request away for free (no key, a
malformed body, an oversized question), and before the provider is called, so a refusal never
costs the student part of their day.

- **The limit** is `AI_DAILY_LIMIT`, default 40. Blank, zero, negative or non-integer values fall
  back to 40, as does anything over 100000.
- **Over the limit** the route answers 429 with `limited` set and does not call the provider.
  The client answers from its built-in knowledge base and says the daily limit was reached and
  that it resets at 00:00 UTC, so the student has used up their allowance of the model and not
  their access to help.
- **If the migration is not applied** the route fails open, with one warning in the log per
  instance, so that deploying the code before the migration does not take the mentor down.
- **Any other database error** answers 503 and the client falls back to the knowledge base. A
  broken database does not lift the cap.

## Providers

OpenRouter wins when both keys are set. With `OPENROUTER_MODEL` blank, a list of free models is
tried in order, beginning with `openrouter/free`, a router that picks whatever is free at the
moment so the slug itself does not rot. A model that has gone paid or been retired is stepped
past; a bad key or an exhausted quota is not, because every remaining candidate would fail the
same way. Anthropic uses one fixed model and takes an optional `ANTHROPIC_WORKSPACE_ID`.

Both are asked for JSON. Anthropic's reply is started for it with an opening brace; OpenRouter's
is not, because it routes to whichever provider is cheapest today and not all of them honour a
partial turn. A small free model handed a strict JSON contract can explain JSON instead of
following it, which is how a working key once produced an answer nobody saw. So the parser
takes the object out from between the first and last brace, and a reply that is plain prose is
used as prose. A reply that is half-written JSON is refused, because it would read as gibberish.

## Languages

The answer is requested in the interface language. The local knowledge base is written in
English and `localizeAi` swaps in the Russian or Kazakh wording for the same entry id
(`src/i18n/ai.ru.ts`, `ai.kk.ts`); each entry's patterns also accept Russian and Kazakh
keywords, so a student gets the right answer whichever language they ask in.

## Testing it

`test/mentor.test.ts` runs the real handler against a stubbed provider and asserts what leaves
and what comes back, without needing a key. `test/discovery.test.ts` covers the offline ranking
the advisor stands on.
