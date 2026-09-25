# i18n + Onboarding Implementation Plan

> **For agentic workers:** Execute inline in this session (user requested one-shot). Checkbox tracking optional.

**Goal:** Add zh/en UI + speech + share localization, and first-login airline-narrative onboarding (story + spotlight), per `docs/superpowers/specs/2026-08-03-i18n-onboarding-design.md`.

**Architecture:** Lightweight `public/i18n.js` + `public/onboarding.js`; optional `locale` on takeoff/land for AI only (not Notion); TTS fallback follows locale.

**Tech Stack:** Vanilla JS front-end, existing Express/`tsx` server, OpenAI broadcast prompts.

---

### File map

| File | Role |
|------|------|
| `public/i18n.js` | Dictionaries, `t`, `setLocale`, DOM apply |
| `public/onboarding.js` | Story overlay + spotlight tour |
| `public/index.html` | `data-i18n`, lang toggles, onboarding roots, scripts |
| `public/style.css` | Lang switch + onboarding styles |
| `public/app.js` | Wire locale, share, login→onboarding, API locale |
| `public/broadcast-audio.js` | `en-US` / `zh-TW` voices |
| `src/lib/ai/broadcast.ts` | EN prompts + fallbacks |
| `server.ts` | Pass `locale` into broadcast helpers |

### Tasks

1. Add `i18n.js` + wire HTML/CSS lang toggles  
2. Add `onboarding.js` + trigger after login  
3. Patch `app.js` (direction labels, share, API locale, messages)  
4. Patch `broadcast.ts` + `server.ts` + `broadcast-audio.js`  
5. `npm run check:contract` + browser smoke  

Commits: only if user asks (per user rule).
