# 0002. The built-in curriculum is retired

## Status

Accepted on 2026-09-20.

## Context

The codebase began as a robotics school with five courses and eighteen lessons written in code.
A marketplace that arrives already teaching something has picked a side — every mentor after
the first competes with the platform's own content, on the platform's own shelf.

The content was also welded into the code. The interface assumed a subject: a hardware platform
registry, a bill of materials, a wiring diagram, a Web Serial terminal that spoke to a board
over USB, achievements and levels named after a robotics career, and an assistant that knew
about ultrasonic sensors and H-bridges. A lesson on this platform can be about anything, so it
has a bill of materials for nothing.

## Decision

Remove the five courses, twelve modules, eighteen lessons and the hardware registry.

Keep `src/lib/curriculum.ts`, empty and typed. The helpers and the unlock order are the
contract the rest of the app is written against, so nothing downstream had to learn the
curriculum went away, and reviving a built-in track is a data change rather than a code change.

A lesson from a built-in track, if anyone adds one back, runs through four sections — theory,
code, task, challenge. There used to be two more, components and wiring, which assumed the
subject was electronics, and they were deleted with the hardware.

## Consequences

Three real defects surfaced the moment the content did not backfill them, and each is the
reason a rule now exists.

- **Nothing is assumed about a new account.** `registerUser` signed every new account up to a
  course that no longer exists. Nobody is enrolled in anything on day one.
- **Ordering comes from state.** The ordering selectors took a state and then ignored it,
  reading the curriculum constants instead. That was indistinguishable from reading state while
  the two were the same object; with content coming from a mentor it fails silently, with the
  order empty and every lesson looking locked. Order now comes from `state.lessons`.
- **Tests build their own fixtures.** The flow test asserted that five courses ship. A check
  that depends on product content breaks every time the content changes, so it now builds a
  three-lesson fixture of its own and asserts the opposite: a fresh deployment brings no
  subject.

Also: a `!` in this codebase is a claim about data, and every one of them was written when the
platform shipped its own content. The dashboard dereferenced the current course with one and
white-screened on first paint after registration. When something is retired, load the app
signed in before reporting it done.

The sign-in page counts mentors, their published lessons and their students, and on an empty
platform says how the thing works instead of printing three zeroes. The AI mentor's knowledge
base was rewritten from twenty-one topics about wiring to fifteen about learning, and its
purpose has since widened to choosing a course; see [the AI mentor](../ai-mentor.md).
