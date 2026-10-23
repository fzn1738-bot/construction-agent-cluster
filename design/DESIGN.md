# Design — Construction Agent Dashboard

## Audience and job
Developers and system administrators who run the construction agent runtime (loop, folder polling, FTP sync, IMAP polling, SQLite state). They glance at it on a desktop monitor or a Mac mini console, often on a second screen, sometimes on a phone to check after hours. The dashboard's one job: answer "is the agent alive and keeping up?" in a second, then show which monitor (folders, FTP, email) needs attention. The orb carries that answer; everything else is supporting detail.

## Mood and references
Calm, sober, site-office: warm concrete neutrals, one survey-teal accent, and signal colours that behave like safety signage (green go, amber caution, red stop). Dense but quiet, built for long unattended watching, not marketing.
- Sync/status tooling conventions: [Ventoy](https://github.com/ventoy/Ventoy) (utilitarian, status-first) and [aedes-persistence](https://www.npmjs.com/package/aedes-persistence) (infrastructure library; plain, technical). Borrowed: restraint, monospace for technical values. Avoided: their brand colours and any hi-vis yellow/black hazard-tape cliché.

## Palette — light
| Role | Hex | Contrast |
|---|---|---|
| page (`--paper`) | #ebe8e1 | — |
| surface | #fbfaf7 | — |
| surface-2 | #f3f1ec | — |
| ink | #1d2226 | 15.4 on surface |
| muted ink (`--ink-2`) | #4a5258 | 7.6 |
| faint ink (`--ink-3`) | #5b646b | 5.8 (4.9 on page, 5.4 on surface-2) |
| rule | #d6d2c8 | decorative |
| accent | #0a6b78 | 5.9; white on accent 6.2 |
| success | #17703a | 5.0 on page; 5.1 on ok-soft |
| warning | #8a5200 | 6.1; 5.4 on warn-soft |
| danger | #b32a2a | 6.1; 5.1 on bad-soft |
| series 1–4 | #0072b2, #c24e00, #7a5a00, #7b4fa8 | ≥4.6 on surface |

## Palette — dark
| Role | Hex | Contrast |
|---|---|---|
| page | #12161a | — |
| surface | #1a2025 | — |
| surface-2 | #222a30 | — |
| ink | #eef1f3 | 14.5 |
| muted ink | #b4bdc4 | 8.6 |
| faint ink | #8d98a1 | 5.6 (5.0 on surface-2) |
| rule | #2d363d | decorative |
| accent | #4cc2d1 | 7.8; dark ink on accent 8.6 |
| success | #5fd48a | 8.8 |
| warning | #f2b84b | 9.2 |
| danger | #ff8a80 | 7.2 |
| series 1–4 | #56b4e9, #ff9a52, #e6c84a, #b79af0 | ≥6.9 |

Chart series follow the Okabe–Ito colour-blind-safe family (blue / vermillion / olive-gold / violet), differing in hue and lightness; pair with direct labels or markers, never colour alone. Status is always colour plus text/icon.

## Typography
System stacks only (strict CSP, nothing to download): `ui-sans-serif / SF Pro / Segoe UI` for UI, `ui-monospace / SF Mono / Menlo` for paths, hostnames, counts, timestamps and IDs. Scale: 12 / 14 / 16 / 20 / 28 / orb headline 40+. Body 14–16px, labels 12px uppercase-free with tabular numerals for counts.

## Layout and components
- Spacing on a 4px base (4, 8, 12, 16, 24, 32). Radius 8px cards, 6px controls, full pill for status chips. Shadow: soft 1px+14px in light, none in dark (rules separate instead).
- Orb centred at the top, three ring captions (Polling Folders, FTP Transfers, Emails Processed) around it, then a monitors list/table with one row per source: name, state chip, last run, queue depth.
- Rows are compact; paths and error text in mono, truncated with a title tooltip.
- Responsive: single column on phones, orb first.

## Do / Don't
- Do reserve green/amber/red for state; use the teal accent for interaction and selection.
- Do show "last synced" times prominently; staleness is the real failure mode.
- Don't use hazard stripes, hard hats or stock construction imagery.
- Don't rely on colour alone, and don't put ink-3 text below 12px.

## The orb
The centrepiece, ~breathing slowly (7s) when healthy so a frozen orb reads as a stalled agent. Colour by mood, taken from the accent: ok teal (light 10 125 140 / dark 76 194 209), running deeper blue (20 100 170 / pale 150 225 240), waiting amber (214 140 10 / 242 184 75), failing red (200 55 50 / 255 138 128). Ring captions use success green, accent teal and violet (`--ring-1..3`), each ≥4.4:1 on the page.
