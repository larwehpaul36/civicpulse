# CivicPulse

Civic accountability for local problems (waste, gutters, streetlights, potholes). Residents report with a photo and a pin, neighbors confirm, moderators escalate to whoever is responsible, and a public tracker shows who fixes things and how fast. Built in Ghana, designed to work anywhere.

**Stack:** Next.js 16 + React 19 (JavaScript, app router) · Supabase (Postgres + PostGIS, storage, anonymous auth, edge function) · Leaflet + OpenStreetMap · Vercel · Playwright.
Needs Node 20.9+ (Node 22 recommended).

---

## Continue in a new chat (read this first)

1. Open a new chat, attach **this README, `HANDOVER.md`, and the folder or zip of your project** (or at least the SQL files and anything that errors).
2. Paste the prompt at the bottom of this file and fill in the brackets.
3. Tick the checklist below as you go, so the next chat knows exactly where you are.

### Where the project stands
| Area | State |
|---|---|
| Features (reporting, offline queue, map, tracker, moderator desk, linking, notifications, directory) | Written. 46 unit checks pass. |
| Frontend v2 ("civic broadcast": live map and live numbers from `public_issues`, tricolor stripe, mobile tab bar with a center camera button, new palette on every page, dark mode, motion) | Done. Unit tests and `next build` pass. Not yet seen by real users. Design preview: Claude artifact canvas "CivicPulse: home concept". |
| Phase 0 tooling (this folder): `npm run check:live`, Playwright tests, CI, `supabase/setup_all.sql` | Written and syntax-checked. **Playwright and check:live have not been run against a browser or a live project yet.** |
| Live Supabase + Vercel deployment | **Not done. This is the next thing.** |
| Everything after Phase 0 | See the roadmap below. |

### Phase 0 checklist: make it real (tick these)
- [x] 1. Create a Supabase project. SQL editor: paste and run `supabase/setup_all.sql` (same as running 001 to 008 in order).
- [x] 2. Authentication > Providers: enable **Anonymous sign-ins**. Authentication > URL Configuration: set Site URL, add `http://localhost:3000/admin` and your Vercel URL to the redirect list.
- [x] 3. Copy `.env.local.example` to `.env.local`, fill in the project URL and anon key.
- [x] 4. `npm install`, then `npm run check:live`. Fix every FAIL it prints (each line says which migration or setting to fix). **Do not skip the two PRIVACY lines.**
- [x] 5. `npm run dev`, open **http://localhost:3000** (see the warning below about IP addresses), sign in at `/admin`, then run the `insert into moderators` line from the bottom of `005_moderators.sql` with your email.
- [x] 6. Add the first real responsible party and a `category_responsibilities` row (dev helpers at the bottom of `004_region_matching_and_public_view.sql`, or use /admin > add party).
- [x] 7. Run the full loop by hand: report, confirm (from a second browser profile), assign party in /admin, mark sent, add after photo, mark resolved, check /tracker.
- [x] 8. Push to GitHub. CI (`.github/workflows/ci.yml`) runs unit tests, build, `npm audit` and the smoke tests.
- [ ] 9. Deploy to Vercel (import the repo, add the same env vars, redeploy). Add the Vercel URL to Supabase's redirect list.
- [ ] 10. `npm run playwright:install` once, then `npm run test:e2e` (smoke, no backend needed) and `npm run test:e2e:live` (files a real report; use a TEST Supabase project).
- [ ] 11. On a real phone, over HTTPS: open the site online once, switch to airplane mode, make a report, switch signal back on, watch it send. Then test push notifications (add to Home Screen first on iPhone).
- [ ] 12. Test with 5 to 10 real residents. **Done when** 10+ real reports, 2+ categories, one case sent to a real responsible party.

> **Do not test at `http://192.168.x.x:3000`.** Browsers treat plain-HTTP LAN addresses as insecure, which disables "Use my location" and `crypto.randomUUID` (the report form needs both) and the service worker. Use `localhost` on your own computer, or the Vercel HTTPS URL on a phone. `npm run dev:https` is an option for LAN testing (self-signed certificate warning).

## Commands
| Command | What it does |
|---|---|
| `npm run dev` | Dev server (service worker is off in dev). |
| `npm run build && npm start` | Production build; the only mode where the service worker and push run. |
| `npm test` | 46 unit checks (offline queue, service worker rules, notifications, directory, related issues). |
| `npm run check:live` | Checks your live Supabase project with only the public key: sign-in, seed data, privacy, permissions, storage. |
| `npm run test:e2e` | Playwright smoke tests against a production build (no backend needed). |
| `npm run test:e2e:live` | Playwright test that files a real report. Uses your `.env.local`. |
| `tests/*_stub_test.sql` | SQL tests for the migrations; instructions in each file's first lines. |

## Project map
- `app/`: pages (`/` hero + report form, `/issues`, `/issues/[id]`, `/tracker`, `/directory`, `/my`, `/admin`, `/offline`, `/confirm-email`, `/unsubscribe`), `globals.css` (design system: tokens, dark mode, motion; reduced-motion respected).
- `components/`: `Nav` (top bar; floating bottom tabs on phones), `ReportForm`, `LocationPicker`, `IssuesMap`, `SyncBanner`, admin and directory components.
- `lib/`: `supabase.js`, offline queue (`offlineQueue`, `syncQueue`, `sync`, `useOutbox`), `strings.js` (all UI text), `homeStrings.js` (home page text; merge into strings.js when translating), `notifications`, `directory`, `relatedIssues`.
- `public/sw.js`: service worker. `supabase/functions/notify/`: push/email sender. `supabase/setup_all.sql`: all migrations in one paste.
- `001` to `008_*.sql` (project root): the migrations, edit these and regenerate `setup_all.sql`.
- `HANDOVER.md`: detailed decisions, per-phase notes and the long **Known issues** list. Read it.

## Rules the code follows (keep them)
- Categories, regions and "who is responsible where" are data, not code.
- Exact locations are private; the public sees rounded ones. Contact details of parties are never public.
- Reports are saved on the phone first, then sent. The client generates the report id, so retries are safe.
- Nobody edits the live directory directly: the community suggests, moderators approve.
- All UI text lives in `lib/strings.js`. System fonts and no heavy dependencies, on purpose (slow connections).
- Every change keeps `npm test` and `npm run build` green.

## Roadmap after Phase 0
- **Phase 1, attractive (weeks 2 to 4):** 3-step report flow (photo, spot, details) with progress and a success celebration; live stats strip on the home page; share card (OG image) for every report; tracker redesign with sparklines; one self-hosted font; accessibility audit.
- **Phase 2, trustworthy (weeks 4 to 6):** phone-number login + Cloudflare Turnstile; blur faces and strip EXIF from photos; tracker shows median days, backlog and resolution rate, and counts linked duplicates once; right of reply for responsible parties.
- **Phase 3, spread (months 2 to 3):** WhatsApp intake and updates; Twi, Ga, Ewe; automatic escalation after N days without response; public API and CSV/GeoJSON export; partner with one assembly, one radio station, one NGO.
- **Phase 4, scale (month 3 on):** TypeScript; server-rendered public pages; vector map tiles with clustering; Sentry and analytics; AI-assisted triage with a human in the loop; second city.
- **Metrics from day one:** reports per week; % confirmed by 3+ neighbors; % sent to a responsible party; median days to first response; % resolved; returning users.

## Prompt for the new chat
```
I'm an IT student in Ghana building CivicPulse, a civic accountability app (Next.js 16 + Supabase + Playwright). Act as my senior full-stack mentor and pair-programmer: practical, honest, push back if I'm overcomplicating things. Keep answers short and give me files I can drop into the project.

I've attached README.md and HANDOVER.md plus my project. Read README.md first (state, checklist, rules, roadmap), then HANDOVER.md (decisions and known issues).

My context:
- Launch area: [fill in]
- Who handles each problem type there: [fill in or "still finding out"]
- Time per week: [fill in]
- Phase 0 checklist items done so far: [e.g. "1 to 4"]
- Output of `npm run check:live`: [paste it, including any FAIL lines]

What I need now: [e.g. "Fix this error: ..." or "Start Phase 1: build the 3-step report flow"]

Before you start, tell me in 3 lines what you understood, and ask at most 2 questions.
```
