# Cold email infrastructure setup

Outreach to engineering firms (ITE Georgia membership, GDOT pre-qualified
consultants, named decision-makers at the top 20 metro Atlanta firms) is
expected to be the primary GTM channel until inbound SEO catches up.
Doing it badly will torch your sender reputation forever — sending from
`gkogon6@gmail.com` at any volume gets the address flagged across Gmail,
Outlook, and corporate spam filters within ~50 messages.

This doc captures the one-time setup. Most of it is DNS + signup steps
the user owns; the unsubscribe endpoint + page are already in the
codebase.

## 1. Domain email (1 hour, $6/mo)

Don't send cold email from a personal Gmail. Get a domain mailbox:

| Provider | Cost | Notes |
|---|---|---|
| **Google Workspace** | $6/user/mo | Best deliverability, familiar UI, easy DNS. **Recommended.** |
| Zoho Mail | $1/user/mo | Cheaper, weaker deliverability reputation. OK if Workspace is too pricey. |
| Fastmail | $5/user/mo | Excellent privacy + deliverability. Less common in B2B context. |

Recommended addresses to create:
- `gerald@simpleimpactstudies.com` — for personal sales outreach
- `sales@simpleimpactstudies.com` — already referenced in the Enterprise CTA mailto
- `noreply@simpleimpactstudies.com` — for transactional emails when Resend gets wired

## 2. SPF / DKIM / DMARC DNS records (30 min, free)

Without these, your messages land in spam folders. Add to Cloudflare
(which manages your DNS for `simpleimpactstudies.com`):

### SPF (TXT record on `@`)
```
v=spf1 include:_spf.google.com include:amazonses.com ~all
```
Replace `_spf.google.com` with your provider's include host. Add the
Resend / Amazon SES include too if/when you wire transactional email.

### DKIM (TXT record, key from your email provider)
Google Workspace generates a long key value during setup — copy it
verbatim into a TXT record on the `google._domainkey` subdomain.

### DMARC (TXT record on `_dmarc.simpleimpactstudies.com`)
Start permissive while you tune:
```
v=DMARC1; p=none; rua=mailto:dmarc-reports@simpleimpactstudies.com; pct=100
```
After 2 weeks of clean reports, tighten to `p=quarantine`. After another
month, `p=reject`.

### Verify
```
dig +short txt simpleimpactstudies.com
dig +short txt _dmarc.simpleimpactstudies.com
dig +short txt google._domainkey.simpleimpactstudies.com
```

Test deliverability before the first real send:
- Send to https://www.mail-tester.com — they grade your message 0–10.
  Aim for 9+ before sending to a real prospect.

## 3. CAN-SPAM-compliant email footer

Every outbound marketing email (cold outreach included) must include:
- A physical postal address
- A clear unsubscribe mechanism

The unsubscribe endpoint is already live at
`https://simpleimpactstudies.com/unsubscribe?email=…` and registered as
both `GET /api/unsubscribe` and `POST /api/unsubscribe`. The page is
public, prefills the email from the query param, and writes to
`email_optouts` in the DB.

### Footer template (plain text)
```
—
Gerald Kogon
Simple Impact Studies | https://simpleimpactstudies.com
{YOUR_PHYSICAL_ADDRESS_HERE — street, city, state, ZIP}

You're receiving this because we identified you as a contact at a firm
that may benefit from screening-level Traffic Impact Studies. If this
isn't your interest, unsubscribe in one click:
https://simpleimpactstudies.com/unsubscribe?email={RECIPIENT_EMAIL}
```

### Footer template (HTML)
```html
<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
<p style="color:#6b7280;font-size:12px;line-height:1.5;font-family:system-ui,sans-serif;">
  Gerald Kogon · Simple Impact Studies
  · <a href="https://simpleimpactstudies.com" style="color:#2563eb;">simpleimpactstudies.com</a>
  <br>
  {YOUR_PHYSICAL_ADDRESS_HERE}
  <br><br>
  You're receiving this because we identified you as a contact at a
  firm that may benefit from screening-level Traffic Impact Studies.
  <a href="https://simpleimpactstudies.com/unsubscribe?email={RECIPIENT_EMAIL}&source=outbound_2026" style="color:#2563eb;">Unsubscribe</a>.
</p>
```

**You must fill in `{YOUR_PHYSICAL_ADDRESS_HERE}` for the footer to be
CAN-SPAM compliant.** A PO box works. Your home address works if you're
willing to put it on the internet (most people aren't). Office-share
addresses (WeWork, Industrious) work and are common for sole proprietors.

The `&source=outbound_2026` param on the unsubscribe link tags the
opt-out with a campaign source — useful for analytics later.

## 4. Sending volume + cadence

| Phase | Volume | Why |
|---|---|---|
| Week 1 (warmup) | 5–10 emails/day from new mailbox | Builds sender reputation gradually. Sending 100/day from a new mailbox triggers spam filters. |
| Week 2–4 | 20–30 emails/day | Still personal; still researched. |
| Steady state | 50–100/day per mailbox | Higher with multiple mailboxes (rotate `gerald@`, `sales@`, etc.) |

Always personalize the first line of the email per recipient — generic
"Hi {first_name}" mass blasts are flagged by every modern spam filter.

## 5. Tracking

A bare-bones tracker is enough until you've sent 200+ emails:

| Field | Why |
|---|---|
| Firm name | Filter by who's been touched |
| Contact name + role | "Director of Traffic" vs. "Senior PE" requires different pitches |
| Email | Match replies and opt-outs |
| Sent date | 2-week follow-up cadence |
| Last touched | Don't double-tap within 30 days |
| Reply state | Replied / Bounced / Opt-out / Silent |
| Notes | Personal context for the next touch |

Tools that work for this volume (free or near-free):
- **Airtable** — flexible, free under 1000 records
- **Notion** — fine for the first 100 prospects
- **Google Sheets** — works, but harder to maintain at 50+ entries

When you cross ~500 prospects, look at **Hubspot Starter ($20/mo)** or
**Pipedrive ($15/mo)** for a real CRM.

## 6. Email content principles for traffic engineers

What works:
- Subject lines with a specific project they're working on
- One concrete data point ("we ran 49 Atlanta signals against your X")
- A short Loom video demo (2 min, screen share)
- A request for 15 min, not 60
- Reference to a peer firm if you have one as a customer

What kills the reply rate:
- "Hope this finds you well"
- "I wanted to reach out because..."
- "Let me know if you'd like to learn more"
- Industry-buzzword pitch ("AI-powered traffic platform")
- 5-paragraph emails

The first email is 4–6 short sentences. Maximum. Save the depth for the
reply.

## 7. Code-level integration (already done)

| Item | Status |
|---|---|
| `email_optouts` table + `isOptedOut(email)` helper | ✅ Live |
| `GET /api/unsubscribe?email=…` (lookup) | ✅ Live |
| `POST /api/unsubscribe` (opt-out) | ✅ Live |
| `/unsubscribe` public page | ✅ Live |
| Future marketing-email sender must call `isOptedOut(email)` before sending | ⚠️ Pattern documented; no automated sender exists yet — when one is added (Resend campaign, Customer.io, etc.) wire this check at the dispatch boundary. |

## 8. Open follow-ups for the user

- [ ] Sign up for Google Workspace at `simpleimpactstudies.com`
- [ ] Add SPF, DKIM, DMARC records in Cloudflare DNS
- [ ] Pick a physical address for the email footer (PO box / coworking space / home)
- [ ] Test outbound deliverability via mail-tester.com (target score 9+)
- [ ] Build the prospect list — top 20 metro Atlanta traffic firms with
      named contacts (use GDOT pre-qualified consultants, ITE Georgia
      membership, LinkedIn Sales Navigator)
- [ ] Don't start mass sending until the funnel is tight (Stripe products
      created, www subdomain added, PDF visual verified)
