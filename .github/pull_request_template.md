## What and why

<!-- What changes for a student, a mentor or an admin, and why it is worth changing. Lead with the
     effect, not the file. -->

## How it was checked

- [ ] `npx tsc --noEmit`
- [ ] `npm run check`
- [ ] `npm run build`
- [ ] Clicked through the screens this touches, in more than one language if it has text

<!-- Say what you clicked and what you saw. If something could not be checked, say so. -->

## Checklist

- [ ] No secrets or service-role keys in the diff, and nothing new carries a `VITE_` prefix that should not be public
- [ ] Database changes are a new numbered migration in `supabase/migrations/`, and no applied migration was edited
- [ ] A change to payment or access has a test in `test/`
- [ ] New interface strings exist in English, Russian and Kazakh in `src/i18n/ui.ts`
