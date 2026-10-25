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

1. **Site documents** (split): arrivals file list and folder rail, with filter, scan button and admin folder form. Empty: “Nothing has arrived yet.”
2. **Contractor file transfers** (focus): throughput and transfer timeline, failure detail, sync button and admin direction control. Empty: “No transfers yet.”
3. **Project inbox** (split): message queue and triage rules, with rule filter, check button and admin rule editor. Empty: “No messages triaged yet.”
4. **Activity record** (grid): filterable event ledger with record integrity, check button and CSV export. Empty: “No events yet.”

Each screen uses its own records from the solution's SQLite log, local folder, FTP or IMAP agent. Its 1–2 metrics and 2 panels are tagged with that pane. Overview owns aggregate runs, success and errors.

## Centrepiece (Overview) — "Site plan orb"
Built as `dashboard/public/hero.js` on a canvas/SVG, keeping the orb as the heart.
- **Core:** a central orb (radius ≈ 22% of the shorter side) in the mood colour (`--orb-ok` healthy, `--orb-run` running, `--orb-wait` caution, `--orb-bad` failing), radial-gradient glow, breathing scale 1→1.04 over `--breath` (7s). Inside: primary number (Success rate, 44px) and headline word ("Healthy").
- **Site-plan grid:** faint blueprint grid (`--rule`, 1px, 24px cells) with slow parallax; two concentric thin survey rings at 1.4× and 1.9× radius, dashed, rotating 120s and 180s.
- **Pane nodes:** four small rounded-square nodes (one per client outcome) on the outer ring, labelled in 12px ink-2; node fill = state colour (`--ok`, `--warn`, `--bad`; demo nodes accent-soft with dashed outline), plus a glyph character (✓ ! ✕ D) so colour is never alone. Each node's line to the core is a thin path carrying moving dots (speed ∝ recent activity); a stalled path is static, so freezing reads as trouble.
- **Ring captions:** Runs today, Success, Last run placed at 10, 2 and 6 o'clock using `--ring-1..3`, value 20px + label 12px.
- **Mobile:** nodes flow onto a single ring at 90% width; labels abbreviate; motion respects `prefers-reduced-motion` (static, no rotation).
- **Dark mode:** glow stronger, grid at 40% opacity.

## The orb
Colours derive from the accent blue: ok #1b5fc1 (dark #6aa8ff), running teal-cyan (0 130 170 / 140 220 245), waiting amber (214 140 10 / 242 184 75), failing red (200 55 50 / 255 138 128). Ring captions: success green, accent blue, violet (≥4.4:1 on the page).
