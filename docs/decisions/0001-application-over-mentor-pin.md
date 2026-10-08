# 0001. An application, not a mentor PIN

## Status

Accepted on 2026-09-19, in the first commit. **Superseded in part** by
[0003](0003-open-teaching.md): the PIN stayed gone, but the reviewed application that replaced
it was itself retired on 2026-09-27. Read this record for why a shared secret was the wrong
answer, which is still true; read 0003 for what the platform does now.

## Context

The platform this was built from gated mentor accounts behind a PIN: an eight-digit code,
checked server-side, that turned a registration into a mentor account.

A shared secret answers the wrong question. It tells you someone knows a number that has been
passed around a staff room for a year — not who they are, and not whether they should be
handling children's work or taking their families' money. It also cannot be revoked for one
person without changing it for everyone.

## Decision

Replace the PIN with an application: legal name, a description of what you have taught, and at
least one document. A named admin approves or rejects it, and the decision records who made it
and when.

| Stage | What it meant |
| --- | --- |
| `none` | never applied — the authoring tools are not shown |
| `pending` | waiting for a reviewer; still a student in every respect |
| `approved` | may write and publish lessons |
| `rejected` | told why, and may apply again with it corrected |

Everyone registered as a student. Becoming a mentor happened through an approved application,
and nothing a person typed at signup could shortcut that: the profile trigger hard-coded the
role to `student`, and the policy on `profiles` pinned `role` and `is_admin` to their current
values.

Approval alone did not allow selling. A paid lesson also needed a connected Stripe account with
charges enabled, checked at publish time and again at purchase time.

Identity documents lived in a private Supabase Storage bucket (`mentor-docs`). They were never
public, never listed, and shown to a reviewer only through signed links that expire in five
minutes. The application itself was `mentor_applications`, with one live application per person
enforced by a partial unique index.

## Consequences

- A mentor can be removed without disturbing any other mentor, which a shared PIN cannot do.
- Someone has to read the applications. That is a real cost, and it is the cost 0003 later
  judged too high for an open marketplace.
- Identity documents are the most sensitive data the platform holds, so the bucket, its policies
  and the signed-link lifetime were designed first and are still the reason `mentor-docs` stays
  private.
- The tables and the bucket remain in the schema after the desk was retired. `0006` kept
  `mentor_applications` on purpose, because dropping a table to tidy up an interface is how
  history gets lost.
