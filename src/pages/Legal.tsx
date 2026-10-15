import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { t } from '../i18n'

/**
 * Terms, Privacy and Refunds: public, so Lemon Squeezy's review and anybody deciding whether
 * to sign up can read them without an account.
 *
 * ponytail: English only and written into the page, not the dictionary. A translated legal
 * text is a second legal text to keep in step; translate when there are customers who need it.
 */

export type LegalDoc = 'terms' | 'privacy' | 'refunds'

const UPDATED = '11 October 2026'
const CONTACT = 'brandyzerapp@gmail.com'

const Mail = () => (
  <a href={`mailto:${CONTACT}`} className="font-semibold text-brand-600 hover:text-brand-700">
    {CONTACT}
  </a>
)

const To = ({ doc, children }: { doc: LegalDoc; children: ReactNode }) => (
  <Link to={`/${doc}`} className="font-semibold text-brand-600 hover:text-brand-700">
    {children}
  </Link>
)

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold tracking-[-0.02em] text-ink-900">{title}</h2>
      {children}
    </section>
  )
}

const List = ({ children }: { children: ReactNode }) => <ul className="list-disc space-y-1.5 pl-5">{children}</ul>

const DEMO = (
  <p className="border border-brand-200 bg-brand-100/60 px-3.5 py-2.5 font-medium text-brand-700">
    Brandyzer is a demo. Payments run in test mode, so no real money is charged. These documents already describe how the
    service will work once it opens.
  </p>
)

const TERMS = (
  <>
    {DEMO}
    <Section title="1. Who we are">
      <p>
        Brandyzer is an online service run by an individual based in the Republic of Kazakhstan ("we", "us"). You can reach
        us at <Mail />. By creating an account or using Brandyzer you agree to these Terms and to our{' '}
        <To doc="privacy">Privacy Policy</To>.
      </p>
    </Section>

    <Section title="2. Your account">
      <List>
        <li>You must be at least 18 and able to enter a contract.</li>
        <li>Give a real email address, keep your password to yourself, and tell us if someone else gets into your account.</li>
        <li>You are responsible for what happens under your account.</li>
      </List>
    </Section>

    <Section title="3. What Brandyzer does">
      <p>
        Brandyzer uses AI models to draft brand kits (names, colours, fonts, voice, logos), marketing copy and images from the
        details you give it, and builds websites from ready-made templates filled with your brand.
      </p>
    </Section>

    <Section title="4. AI output: check it before you use it">
      <List>
        <li>AI output can be wrong, generic, or similar to something that already exists. We do not promise that a name, logo or slogan is unique.</li>
        <li>
          We do not check whether a name or logo is free to use or can be registered as a trademark. Search the trademark
          register in every country you trade in before you put it on a sign, a package or a website.
        </li>
        <li>Read copy before publishing it. Prices, opening hours, claims about your product and anything regulated (food, health, finance) are yours to get right.</li>
      </List>
    </Section>

    <Section title="5. Who owns what">
      <p>
        You keep every right you have in what you enter. Whatever rights we have in the kits, copy and images made for you,
        we give to you. You let us store and process your content only as needed to run the service for you. The AI providers
        we use have their own terms, listed in the <To doc="privacy">Privacy Policy</To>.
      </p>
    </Section>

    <Section title="6. What you may not do">
      <List>
        <li>Use Brandyzer for anything illegal, or to make content that is hateful, sexual involving minors, or meant to harass someone.</li>
        <li>Copy another business's brand, pass yourself off as someone else, or make misleading advertising.</li>
        <li>Get around the plan limits, share an account to do so, or put automated load on the service.</li>
        <li>Try to break into the service, other people's accounts, or the systems it runs on.</li>
      </List>
      <p>We may remove content or suspend an account that breaks these rules.</p>
    </Section>

    <Section title="7. Plans and payment">
      <List>
        <li>The Free plan has monthly limits on brand kits, copy requests and images, shown in Settings.</li>
        <li>
          Pro costs $25 a month. Lemon Squeezy sells it to you as merchant of record: it takes the payment, charges any tax,
          and sends the receipt, and its buyer terms apply to the purchase.
        </li>
        <li>Pro renews every month until you cancel. Cancel any time from Settings → Manage subscription. Pro then lasts until the end of the month you paid for, and you are not charged again.</li>
        <li>Limits reset on the 1st of every month. Anything unused does not carry over.</li>
        <li>If the price changes, we tell you at least 30 days before your next renewal.</li>
        <li>
          Refunds are covered by our <To doc="refunds">Refund Policy</To>.
        </li>
      </List>
    </Section>


    <Section title="8. The service as it is">
      <p>
        We run Brandyzer with care, but we provide it "as is". Features can change, and the service or one of the AI
        providers behind it can be slow or unavailable. We may change or stop the service; if we stop it, we will tell you
        in advance where we can.
      </p>
    </Section>

    <Section title="9. Liability">
      <p>
        As far as the law allows, we are not liable for indirect losses such as lost profit, lost business or lost data, and
        our total liability to you is limited to what you paid us in the three months before the claim. Nothing here takes
        away rights you have as a consumer under the law of the country you live in.
      </p>
    </Section>

    <Section title="10. Ending your account">
      <p>
        You can stop using Brandyzer at any time and ask us to delete your account at <Mail />. We may suspend or close an
        account that breaks these Terms.
      </p>
    </Section>

    <Section title="11. Law and changes">
      <p>
        These Terms are governed by the law of the Republic of Kazakhstan, without taking away the protection the law of your
        own country gives you as a consumer. We may update these Terms; the date at the top changes, and for a significant
        change we email you before it takes effect.
      </p>
    </Section>
  </>
)

const PRIVACY = (
  <>
    {DEMO}
    <Section title="Who is responsible">
      <p>
        Brandyzer is run by an individual based in the Republic of Kazakhstan, who decides how your personal data is used.
        Questions and requests go to <Mail />. By creating an account you consent to the processing described here, including
        its transfer to the providers listed below.
      </p>
    </Section>

    <Section title="What we collect">
      <List>
        <li><strong>Account:</strong> your email address, a password (stored only as a hash by our sign-in provider; we never see it), your name, an optional bio, and whether you hire, freelance or both.</li>
        <li><strong>Your business:</strong> what you tell the Studio about your business (what you sell, to whom, where, how it should feel, your answers about the logo), and the brand kits, copy and images made from it.</li>
        <li><strong>Pro:</strong> your subscription's status and renewal date, sent to us by Lemon Squeezy. Lemon Squeezy holds your payment details; we never see them.</li>
        <li><strong>Usage:</strong> how many kits, copy requests and images you have used this month, to apply your plan's limits.</li>
        <li><strong>In your browser:</strong> your sign-in session, language, theme and look, kept in your browser's local storage. We use no advertising or analytics cookies and no trackers.</li>
        <li><strong>Server logs:</strong> our host keeps short-lived request logs, including IP address and browser type, to keep the service running and secure.</li>
      </List>
    </Section>

    <Section title="What we use it for">
      <p>
        To run Brandyzer for you: sign you in, draft your kits, copy and images, apply plan limits, run your Pro subscription,
        and send account emails (confirming your address, resetting your password). We do not sell your data,
        show ads, or send marketing email.
      </p>
    </Section>

    <Section title="Who else handles it">
      <p>To do this we rely on these providers, each under its own privacy terms:</p>
      <List>
        <li><strong>Supabase</strong>: database, sign-in and file storage.</li>
        <li><strong>Vercel</strong>: hosting and the server that talks to the providers below.</li>
        <li>
          <strong>OpenRouter</strong>: writes brand kits and copy from your business details, passing them to the free AI
          models it routes to. The companies running free models may keep what is sent and use it to improve their models,
          so do not put confidential information, or personal details about other people, into your business description.
        </li>
        <li>
          <strong>Pollinations</strong>: draws images from a written description of the picture, made from your brand kit.
        </li>
        <li><strong>Recraft and Hugging Face</strong>: may draw images instead of Pollinations, from the same description.</li>
        <li><strong>Lemon Squeezy</strong>: sells Pro as merchant of record and handles payment, tax and receipts.</li>
        <li><strong>Google (Gmail)</strong>: sends account emails.</li>
      </List>
      <p>
        These providers keep data on servers outside Kazakhstan, mainly in the United States and the European Union. We share
        data with authorities only when the law requires it.
      </p>
    </Section>

    <Section title="What other people can see">
      <List>
        <li>Images we make for you are stored at long, unguessable links. Anyone you give a link to can open the image.</li>
      </List>
    </Section>

    <Section title="How long we keep it">
      <p>
        As long as your account exists. When you ask us to delete your account, we delete your data within 30 days; copies in
        our providers' backups expire on their own schedule. Lemon Squeezy keeps payment records for as long as tax
        and financial law requires.
      </p>
    </Section>

    <Section title="Your rights">
      <p>
        You can see and correct most of your data in Settings. You can also ask us for a copy of your data, to correct or
        delete it, or withdraw your consent (which means closing your account) by writing to <Mail />. We answer promptly and
        within the time the law where you live requires. If you think we got something wrong, you can also complain to your
        data protection authority.
      </p>
    </Section>

    <Section title="Children">
      <p>Brandyzer is for businesses and is not meant for anyone under 18.</p>
    </Section>

    <Section title="Changes">
      <p>When this policy changes, the date at the top changes. For a significant change we email you first.</p>
    </Section>
  </>
)

const REFUNDS = (
  <>
    {DEMO}
    <Section title="Cancelling">
      <p>
        Pro is billed monthly by Lemon Squeezy. Cancel any time from Settings → Manage subscription. You are not charged
        again, and Pro lasts until the end of the month you already paid for.
      </p>
    </Section>

    <Section title="Refunds">
      <p>
        If Pro was not worth it, write to <Mail /> within 14 days of any payment, from the email address on the order, and we
        refund that payment in full. No reasons needed. The refund goes back to the card or account you paid with, usually
        within 5 to 10 business days, and Pro ends when it is issued.
      </p>
      <p>After 14 days a payment is not refunded, except where the law requires it.</p>
    </Section>

    <Section title="Your legal rights">
      <p>
        This policy adds to the rights you have as a consumer where you live; it does not replace them. See also our{' '}
        <To doc="terms">Terms</To>.
      </p>
    </Section>
  </>
)

const DOCS: Record<LegalDoc, { title: string; body: ReactNode }> = {
  terms: { title: 'Terms of Service', body: TERMS },
  privacy: { title: 'Privacy Policy', body: PRIVACY },
  refunds: { title: 'Refund Policy', body: REFUNDS },
}

/** "Terms · Privacy · Refunds", for the sign-in page and the foot of the app. */
export function LegalLinks() {
  return (
    <span className="inline-flex gap-2">
      {(['terms', 'privacy', 'refunds'] as const).map((doc, i) => (
        <span key={doc} className="inline-flex gap-2">
          {i > 0 && <span aria-hidden="true">·</span>}
          <Link to={`/${doc}`} className="underline-offset-2 hover:text-ink-700 hover:underline">
            {t(`legal_${doc}`)}
          </Link>
        </span>
      ))}
    </span>
  )
}

export default function Legal({ doc }: { doc: LegalDoc }) {
  const { title, body } = DOCS[doc]
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:py-16">
      <article className="card specular space-y-8 p-6 text-[15px] leading-relaxed text-ink-700 sm:p-10">
        <header className="space-y-2">
          <Link to="/" className="text-sm font-semibold text-brand-600 hover:text-brand-700">
            ← {t('brand')}
          </Link>
          <h1 className="text-[30px] font-bold tracking-[-0.03em] text-ink-900">{title}</h1>
          <p className="text-sm text-ink-500">Last updated {UPDATED}</p>
        </header>
        {body}
        <footer className="border-t edge pt-5 text-sm text-ink-500">
          <LegalLinks />
        </footer>
      </article>
    </div>
  )
}
