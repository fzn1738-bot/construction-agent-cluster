# Design — Construction Agent Dashboard ("site sky")

## Owner direction
- Follow the owner's two reference screenshots (`.ai-design-refs/REF-cda12f6f01a0.png`, `REF-143f1afe8b7b.png`): a tall, phone-width (780px) screen, pale sky-blue page (#d0e0eb to #e5f3fc), white rounded cards, soft shadows, airy spacing. I could not view the images; the palette and layout were taken from sampled pixel colours and proportions, so the match is by colour and composition rather than by inspecting details. Match their overall aesthetic, layout and component style.
- Owner's notes, followed exactly: "Act as a world-class UI designer. Every tab gets its own layout, not shared tiles. Full width, mobile friendly."
- Consequences: the old warm-concrete/teal look is replaced by cool blue-white with a blue accent; each pane has its own composition (see Panes); content runs full width of the viewport (no fixed max-width container), cards stack on phones and expand to multi-column from 720px.

## Audience and job
Site managers, project coordinators and the client's operations lead who rely on the construction agent to file site documents (watched folders), mirror files over FTP, triage the project inbox (IMAP) and keep a SQLite record of every action. They check on a phone in the site cabin or a desktop in the office. Job: answer "is the agent delivering what we pay for, and is anything waiting on me?" in a second, then let them run an action or add a missing key. Each tab is a client outcome, never an internal component.

## Mood and references
Bright, calm, trustworthy: daylight over a site, white sheets on a pale blue drawing table. Confident type, one blue accent, signal colours only for state.
- Owner's references (above).
- [Linear](https://linear.app) for restraint and dense lists; [Stripe Dashboard](https://dashboard.stripe.com) for numeric hierarchy; [Vercel](https://vercel.com/dashboard) for status chips. Borrow: whitespace, tabular numerals, one accent. Avoid: gradient hero banners, hazard-stripe/hard-hat construction clichés, identical KPI tile rows on every tab.

## Palette — light
| Role | Hex | Contrast |
|---|---|---|
| page `--paper` | #e4edf4 | — |
| surface | #ffffff | — |
| surface-2 | #f1f6fa | — |
| ink | #14212e | 16.3 on surface, 13.8 on page |
| strong | #0b1620 | headings |
| muted ink `--ink-2` | #44566a | 7.5 |
| faint ink `--ink-3` | #566879 | 5.8 (4.9 on page) |
| rule | #cfdce7 | decorative |
| accent | #1b5fc1 | 6.1 on surface; white on accent 6.1 |
| accent-soft | #dbe8f8 | accent on it 4.9 |
| success | #12703d | 6.2; 5.2 on ok-soft #dcf1e4 |
| warning | #8a5200 | 6.4; 5.5 on warn-soft #fbeccd |
| danger | #b32a2a | 6.4; 5.2 on bad-soft #fbe1de |
| series 1–4 | #0072b2, #b84800, #7a5a00, #7b4fa8 | marks ≥3:1 on surface, labelled directly |

## Palette — dark
| Role | Hex | Contrast |
|---|---|---|
| page | #0d1620 | — |
| surface | #142130 | — |
| surface-2 | #1b2b3d | — |
| ink | #eaf1f8 | 14.3 on surface |
| muted ink | #b3c2d1 | 9.0 |
| faint ink | #8fa2b5 | 6.2 (5.5 on surface-2) |
| rule | #263a50 | decorative |
| accent | #6aa8ff | 6.7; dark ink on accent 7.9 |
| success | #5fd48a | 8.7 |
| warning | #f2b84b | 9.1 |
| danger | #ff8a80 | 7.1 |
| series 1–4 | #56b4e9, #ff9a52, #e6c84a, #b79af0 | ≥6.1 |

Series follow the Okabe–Ito colour-blind-safe family (blue / vermillion / olive-gold / violet); always add direct labels, markers or dash patterns. State is colour plus word or icon.

## Typography
System stacks only (strict CSP): `ui-sans-serif, SF Pro Text, Segoe UI` for UI; `ui-monospace, SF Mono, Menlo` for paths, hosts, IDs, timestamps. Scale 12 / 14 / 16 / 20 / 28 / 44 (the one primary number per screen). Headings weight 650, tight tracking (-0.01em); numerals tabular. Minimum 12px; no faint ink under 12px.

## Layout and components
- 4px base spacing (4, 8, 12, 16, 24, 32, 48). Radius 16px cards (as in the references), 10px controls, pill chips. Shadow `0 8px 24px` blue-tinted in light, none in dark (rules separate).
- Full width: page padding 16px on phones, 32px desktop; cards fill the width and form a 12-column grid from 720px.
- Cards are white on the pale page; header row = title (16/650) + chip; no card-in-card.
- Tables become stacked label/value cards under 640px. Tap targets ≥44px. Primary run button: solid accent, one per screen.
- Status chips: ok / warn / bad / demo (accent-soft with "Demo data" text).

## Do / Don't
- Do give each tab its own composition; do mark demo data with a visible "Demo data" chip until a key is saved.
- Do show "last updated" next to every number.
- Don't use identical tile rows on different tabs; don't use green/amber/red decoratively; don't use placeholder text.

## Panes
Each sidebar pane is a client outcome. Overview shows their combined state; setup, connection checks, users, control and reports live in the existing HQ shell. A client sees only the outcome panes granted to their access code. A missing connection shows visibly marked demo records on that outcome until Settings has its required fields.

1. **Site documents** (split): arrivals grouped into Last hour / Earlier today / Before today, with filter chips; rail with the headline number, waiting/failed chips and the Scan button, the watched folder (path, monitor state, admin editor folded into “Change the watched folder”), a file-type mix and the 24-hour arrivals trend. On phones the headline card and Scan come before the list. Empty: “Nothing has arrived yet.”
2. **Contractor file transfers** (focus): a full-width sync band (number, chips, Sync button, direction control) with a Site ⇄ Contractor FTP flow diagram showing count and volume each way (on phones the Sync button and direction come before the diagram, and Site and Contractor sit side by side above the two lanes); the failure card (white with a red edge) beside the 24-hour trend from 900px; then the full-width paged transfer timeline. The direction control is labelled. Empty: “No transfers yet.”
3. **Project inbox** (split): a full-width triage band with one proportional bar of where mail went (series colours plus a labelled legend) and the Check button; below, the paged message queue (filters: each rule, No rule, Unreadable) beside a rail: rules with colour swatches keyed to the bar, match counts and a folded rule editor; the mailbox; who writes most. Empty: “No messages triaged yet.”
4. **Activity record** (grid): three tiles (record size and integrity with Check and Export CSV; events by source; what is stored, named in plain words) over a full-width ledger with counted source and result filters, sources in plain words (Site folder, FTP, Inbox, Schedule), each event as a muted source prefix plus readable text (two lines on phones), 15 rows at a time with “Show more”. Empty: “No events yet.”

### Workflow Automation (RPA) tabs
Ten tabs read as one pipeline, **Record → Build → Run**, and Overview groups them that way. All of them share the workflow picker, so moving between them keeps one workflow open, and every table on them becomes a compact card on phones: the name spans the row and the other cells sit up to three across, each with its label above.
- Record: **Record a workflow** (split: recorder, what the recorder sees, captured steps; rail: what is kept, recent recordings), **Typed inputs** (grid), **Apps & pages** (focus: route band, screen changes, stop cards; long addresses wrap), **Step screenshots** (grid: contact sheet).
- Build: **Workflows** (split: library + chosen workflow; rail: Schedule and Trigger, each a plain sentence first, its form folded once set), **Step editor** (split, sticky focused-step rail), **Order & checkpoints** (focus: vertical flow with approval gates), **Variables** (split: variable cards 2 across + binding table; rail: Add a variable, Logins from Connections).
- Run: **Run a workflow** (focus: start band, live run with Stop, approval box, steps beside the current screen, log), **Run history** (split: summary, charts, run list 8/12 per page; sticky details rail that lists "Runs that need a look" until a run is chosen, and comes first on phones).
- An enlarged screenshot opens at the top of the screen with an accent edge and scrolls itself into view once (instantly under reduced motion).

Every 24-hour trend is the shared `trend()` helper: total and peak as text, a plot that stretches to its card (2px line, soft area), axis words in HTML at 12px so they never shrink in a rail.

Long lists page (12–15 rows, then “Show N more”) so no screen runs to thousands of pixels on a phone. Admin-only editors sit in a collapsed `<details>` so the client view and the admin view share one calm layout. The demo banner is a single compact row: Demo data chip, title, what it means, Open Settings (one grid row on wide screens, ~60px). On phones the chip, title and Open Settings share the first line and the explanation sits underneath (~110px, never a stacked column of three blocks). Under 380px the title drops and the chip carries it.

Each screen uses its own records from the solution's SQLite log, local folder, FTP or IMAP agent. Its 1–2 metrics and 2 panels are tagged with that pane. Overview owns aggregate runs, success and errors.

## Centrepiece (Overview) — "Site plan orb"
Built as `dashboard/public/hero.js` on a canvas, keeping the orb as the heart.
- **Core:** a central orb (radius ≈ 17% of the shorter side) in the mood colour (`--orb-ok` healthy, `--orb-run` running, `--orb-wait` caution, `--orb-bad` failing), radial glow, breathing 1→1.04 over `--breath` (7s). Inside: Success rate (up to 44px), the headline word and its label (leading words drop, e.g. "Workflow success rate" → "Success rate", until the label fits inside the orb).
- **Success gauge:** a ring just outside the orb filled to the success rate, with ticks every 10%, so the number has a shape.
- **Site-plan grid:** blueprint grid (`--rule`, 24px cells, a stronger line every 4 cells) drifting slowly; two dashed survey rings turning in opposite directions (120s, 180s); a soft radar sweep from the core turning once a minute.
- **Outcome nodes:** one rounded-square node per client outcome on the diagonals, label = tab name plus its state line (desktop) or short name (phone: Documents, Transfers, Inbox, Activity), measured so labels never leave the stage. Fill = state colour with a glyph (✓ ! ✕ –); demo nodes keep the same state glyph on a white fill with a dashed outline (no letter codes). A faint halo marks warn/bad nodes. Each node's link to the core carries moving dots (fast when healthy, slow when it needs a look, none when failing or waiting), so a frozen link reads as trouble.
- **Automation pipeline:** the ten Workflow Automation tabs sit as beads on the inner survey ring in three labelled phases between the outcome links: RECORD at 9 o'clock, BUILD at 12, RUN at 3, read clockwise. Each phase has a soft track (tinted amber/red when a tab in it needs a look or is failing) and a label with the phase's worst state glyph. Small accent arrowheads and a faint dotted guide join the phases, and a glowing packet travels Record → Run every 9 s (still when a phase is failing, and under reduced motion). Each phase spreads its beads only as far as the nearest outcome link allows, so beads never sit on a link. Beads use the same demo treatment as nodes (white fill, dashed outline in the state colour, same glyph). Any other cross-outcome tab would sit at 6 o'clock under "More".
- **Ring captions:** only the ring numbers the orb doesn't already show (Runs today, Last run), at 9 and 3 o'clock; Success lives only in the orb; 28px mono values in `--ring-1..3` with 12px uppercase labels. On phones (stage < 560px) they move to a readout under the stage.
- **Outcome buttons:** under the stage, one keyboard button per tab (state glyph, title, state line, its headline number); 4 across from 1180px, 2 across from 560px, stacked on phones. Where four share a row the number sits under the name at 28px. Under them a **Workflow automation** card shows the same pipeline as three numbered columns (1 Record, 2 Build, 3 Run, with the phase's state chip and a one-line hint), each holding its tabs as compact buttons with their headline number; the columns sit side by side from 1100px with → between them, and stack on smaller screens (2 buttons across from 560px). They replace the kit's service cards on Overview; below them the kit's number tiles fill their row. From 1100px the Activity chart sits on the left with Reports under it, and Recent runs fills the right-hand column (7/5 of 12 columns, 6/6 below 1280px) so both columns end together. The kit chart's axis words grow in narrow cards (container queries) so they never render under 12px.
- **Sizing:** the stage's size comes from CSS (`aspect-ratio` 20/19 on phones, 12/5 from 640px, height 380–460px) and the canvas is absolutely positioned inside it, so the canvas never widens the page.
- **Motion:** `prefers-reduced-motion` gives a static frame (no drift, rotation, sweep, breathing or moving dots); the animation also pauses off-screen and in hidden tabs.
- **Dark mode:** glow stronger, grid fainter.
- **Text equivalent:** a live-region sentence names the headline, success rate, ring numbers and every tab's state.

## The orb
Colours derive from the accent blue: ok #1b5fc1 (dark #6aa8ff), running teal-cyan (0 130 170 / 140 220 245), waiting amber (214 140 10 / 242 184 75), failing red (200 55 50 / 255 138 128). Ring captions: success green, accent blue, violet (≥4.4:1 on the page).
