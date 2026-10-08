# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and the project aims to follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Nothing was tagged before 1.0.0. The 0.x entries below are the history grouped after the fact, by
the day it happened, so that it reads as milestones; they are not releases anyone installed.
`package.json` says 1.0.0, and that is the state of `main` at the last dated entry.

## [Unreleased]

### Added

- Continuous integration: `npm ci`, `tsc --noEmit`, `npm run check` and `npm run build` on every
  push to `main` and every pull request.
- CodeQL analysis of the JavaScript and TypeScript, on push, on pull request and weekly.
- Dependabot for npm and GitHub Actions, weekly, with minor and patch updates grouped.
- Issue forms for bug reports and feature requests, a pull request template, and `CODEOWNERS`.
  Blank issues are off, and the issue chooser points vulnerabilities at a private advisory.
- `SECURITY.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant 3.0), `CONTRIBUTING.md` and
  `ROADMAP.md`.
- A `docs/` folder: architecture, deployment, payments, the AI mentor, languages and design;
  decision records for the mentor PIN, the retired curriculum and open teaching; and runbooks
  for Stripe webhooks and Supabase migrations.
- `.editorconfig` and `.nvmrc` (Node 22, the version the project is verified on).
- Chargeback handling in the Stripe webhook. A dispute withdraws access while the bank decides,
  a won dispute (or an inquiry closed with a warning) gives it back, and a lost one leaves the
  order `charged_back` and the lesson shut. Orders gain the statuses `disputed` and
  `charged_back` (`0011`), and the webhook subscribes to `charge.dispute.created` and
  `charge.dispute.closed`.
- A per-account daily limit on AI mentor questions, 40 a UTC day unless `AI_DAILY_LIMIT` says
  otherwise, counted in Postgres (`0012`). Over the limit the model is not called and the
  built-in knowledge base answers, saying so.

### Changed

- `README.md` is now a front door: a short pitch, a quickstart, the product's argument, and a
  map of the documentation. The long how-to content moved into `docs/`.
- Facts in the README that had drifted from the code were corrected: the number of test files,
  the number of interface strings, the bundle size claim, the `admin` pages directory that does
  not exist, the migrations that a deployment needs, and the description of how mentors start
  teaching. The pitch no longer calls every mentor verified: anyone may teach, and only an
  account Stripe has verified may sell.
- `.env.example` leaves the Supabase variables empty, with example values in the comments, so
  that `cp .env.example .env.local` keeps the app fully local. A placeholder URL counted as a
  configured backend and sent every sign-in to a project that does not exist.

### Fixed

- A late payment notice could re-grant a lesson that had been refunded.
- A refund that arrived before its payment notice was acknowledged and silently lost. It is now
  sent back to Stripe to be retried, until the event is three days old.
- A partial refund revoked access. Only a full refund does.

### Security

- Any signed-in account could loop the AI mentor to run up the provider bill. Each account now
  has a daily allowance, spent in the database by a function that takes the account from the
  session and not from the request.

## [1.0.0] - 2026-09-27

### Added

- The demand board: a student publishes what they want taught, others vote, and a mentor can
  answer a request with a course they wrote. Answering notifies the people who voted, once
  (`0008`).
- Public numbers about a lesson and a mentor that their author cannot write: how many people
  bought it, how many started it, and how long the mentor takes to review work (`0009`).
- A server-side inbox for notifications that cross from one account to another, with the
  columns a person may change narrowed to whether they have read it (`0004`, `0005`, `0007`).
- A skin picker with ten skins, an atelier skin with a Three.js scene, a crash screen, and a
  requests page. `three`, `@react-three/fiber` and `drei` were added as dependencies.

### Changed

- Anyone signed in may teach. The mentor application desk is dropped, and Stripe still gates
  money (`0006`). See [decision 0003](docs/decisions/0003-open-teaching.md).
- The AI mentor becomes a course advisor over the ranked catalogue, and requires sign-in.

### Fixed

- Every Node function answered 500 on Vercel, because `package.json` is `"type": "module"` and
  imports without a `.js` extension do not load when each function is compiled on its own.
- Every Node route then crashed on `req.headers.get` and hung until timeout, because Vercel's
  Node runtime calls a default export as `(req, res)` and ignores what it returns. Handlers now
  export named `GET`, `POST`, `PATCH` and `DELETE`, and receive the Web `Request` they were
  written for. `scripts/check-api-imports.mjs` is part of `npm run check` and fails on both.
- Two answers to one request in the same second no longer both stay silent.
- Non-string fields sent to `/api/mentor` no longer crash the handler.

### Security

- An author can no longer claim or decide their own project, and a claimed project stays with
  the mentor who claimed it.
- The browser insert policy on `project_feedback` is dropped; the API writes feedback with the
  service role (`0010`).
- Mentors no longer read other people's drafts (`0010`).
- Repricing a published lesson goes through the same Stripe check as publishing it, and
  `price_cents` and `currency` are no longer writable from the browser (`0010`).

## [0.2.0] - 2026-09-20

### Added

- Progress on the server: three tables (`0002`), an endpoint that applies operations and
  expresses no rules of its own, and a client outbox with a single commit point. Operations are
  idempotent and commutative, so a replay pays nothing twice and two devices converge.
- Projects and reviews on the server (`0003`), so a mentor can see work submitted from a
  student's browser. Claiming a review can lose a race and answers 409 rather than letting two
  people write contradicting reviews of the same work.
- Mentor lessons written to the server first and the browser second, with material in a private
  bucket under the mentor's own user id instead of a data URL in `localStorage`.
- `scripts/check-env.mjs`, which says whether the Supabase keys are in the right slots without
  printing a value, and shouts if the service-role key is anywhere the browser would be given it.

### Changed

- The platform no longer teaches. See [decision 0002](docs/decisions/0002-curriculum-retired.md).
- The AI mentor's knowledge base is fifteen topics about learning, in three languages, in place
  of twenty-one about wiring. The server prompt describes the platform it is actually in.
- Levels are named for how far along someone is (Apprentice, Practitioner, Specialist, Master)
  rather than for a robotics career. The review rubric is three axes any subject can be scored on.
- The sign-in page counts mentors, their published lessons and their students, and on an empty
  platform says how the thing works instead of printing three zeroes.
- The README was rewritten for the product this became.

### Removed

- The five built-in courses, twelve modules, eighteen lessons and the hardware registry.
- The wiring diagram, the component cards, the ultrasonic simulator and the Web Serial terminal,
  and the Russian and Kazakh translations of the retired lessons.
- Forty-nine interface strings that belonged to those, worked out from git rather than guessed.

### Fixed

- The dashboard white-screened on first paint after registration when there was no course.
- `registerUser` signed every new account up to a course that no longer existed.
- The ordering selectors read the curriculum constants instead of the state they were given,
  which made every lesson look locked once content came from a mentor.
- A welcome notification pointed at a lesson that did not exist, and a student summary fell back
  to a course that did not exist.

## [0.1.0] - 2026-09-19

### Added

- A marketplace built on the S7 Robotics Platform's curriculum and interface
  (github.com/confidness/s7-robotics-platform). Mentors were verified by an application with
  documents, approved or rejected by a named admin, rather than admitted by a shared PIN.
  Identity documents lived in a private bucket reachable only through signed links that expire
  in five minutes.
- Paid lessons. Mentors set a price in integer minor units, Stripe Checkout takes the payment,
  Connect Express pays them out, and the platform keeps `PLATFORM_FEE_BPS` (default 20%). The
  price is read from the database, never the request, and `/api/lesson-content` is the paywall.
- Entitlements written only by the Stripe webhook, keyed on the Checkout Session id so a
  redelivery grants nothing twice. A refund revokes access.
- Supabase Auth in place of a password kept in `localStorage` in cleartext. State left by that
  build is cleared on load.
- All new interface text ships in Kazakh, Russian and English.
- `test/monetization.test.ts`, covering fee rounding and the entitlement and answer-key rules.
- A liquid-metal shader background, Motion primitives in place of a page-entrance class, and a
  brutalist look read off the shader's own colours.

### Changed

- The copy stopped describing a robotics academy: the hero, the brand line, the AI mentor's
  description, the search placeholder and the page title. Achievement ids were left alone,
  because they are written into saved progress.
- Squared the 98 corners the first radius pass missed.
- A contrast audit over the new background found and fixed fills, dimmed labels and a token that
  could not clear AA in the dark theme.

### Fixed

- A free assignment could not be handed in, because submitting required an entitlement and free
  lessons never get one. Published at zero now means open to anyone who can see it.
- Both payouts for a mentor-written lesson recorded the kind `lesson`, sharing a namespace with
  the curriculum. Assignments have their own kind, and saved history is retagged on load so
  nothing is paid a second time.

[Unreleased]: https://github.com/confidness/s7-mentorship-paid/compare/15ff792...main
[1.0.0]: https://github.com/confidness/s7-mentorship-paid/compare/4c23b34...15ff792
[0.2.0]: https://github.com/confidness/s7-mentorship-paid/compare/157b0d1...4c23b34
[0.1.0]: https://github.com/confidness/s7-mentorship-paid/commits/157b0d1
