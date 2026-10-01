# Varied Scenery and Stable Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Synchronize varied destination themes across arrival speech and imagery, and keep the airplane window geometry stable across viewport sizes.

**Architecture:** Add one weighted scene-theme selector at the morning-content boundary so speech and image prompts share a single choice. Separately, diagnose the existing window layout at representative viewport sizes and constrain the frame with a fixed aspect ratio plus a responsive inner safe area.

**Tech Stack:** TypeScript, OpenAI chat/image prompts, vanilla HTML/CSS/JavaScript, Node regression scripts, browser viewport testing.

---

### Task 1: Weighted arrival scene themes

**Files:**
- Modify: `src/lib/ai/morning-content.ts`
- Modify if required: `server.ts`
- Create: `scripts/check-morning-scene-variety.mjs`

- [ ] **Step 1: Write a failing regression script**

Load the morning-content module and assert that it exposes five weighted theme families whose weights total 100, that a supplied theme is included in both fallback speech and `imagePrompt`, and that landmark examples remain location-specific.

- [ ] **Step 2: Verify the regression script fails**

Run: `npx tsx scripts/check-morning-scene-variety.mjs`

Expected: FAIL because no shared weighted scene-theme selector exists.

- [ ] **Step 3: Implement one shared theme selection**

Define landmark, nature, food, street/market, and culture/transport/life themes with weights `30/25/20/15/10`. Select once per arrival request, pass the selected instruction to the OpenAI request, and use it in fallback generation. Require `voiceText`, `localFeature`, and `imagePrompt` to describe the same authentic destination subject while retaining weather and time constraints.

- [ ] **Step 4: Verify theme behavior**

Run: `npx tsx scripts/check-morning-scene-variety.mjs`

Expected: PASS for total weights, shared subject, fallback, and location-safety assertions.

### Task 2: Stable responsive airplane window

**Files:**
- Modify: `public/style.css`
- Modify only if geometry requires it: `public/index.html`
- Create or update: `scripts/check-window-responsive.mjs`

- [ ] **Step 1: Reproduce the clipping**

Open the app at narrow phone, standard phone, tablet, and desktop viewports. Record the frame rectangle, inner text rectangle, shade rectangle, computed aspect ratio, and any overflow. Identify the exact CSS rule that lets content or viewport height change the frame geometry.

- [ ] **Step 2: Write a failing layout regression**

Add assertions for a stable frame aspect ratio, text staying inside the inner safe area, and shade edges matching the frame at all representative viewports.

- [ ] **Step 3: Verify the layout regression fails**

Run the responsive check or browser assertions against the current CSS.

Expected: FAIL at the viewport that reproduces clipping or frame drift.

- [ ] **Step 4: Apply the smallest geometry fix**

Give the frame one aspect ratio and bounded responsive width/height. Keep text in an absolutely bounded safe area with `clamp()` typography and spacing. Anchor the shade to the frame rather than content flow. Preserve the current visual design and motion.

- [ ] **Step 5: Verify representative viewports**

Re-run the layout assertions and capture the corrected phone and desktop states.

Expected: PASS with no clipped text and no frame ratio drift.

### Task 3: Integration verification

**Files:**
- Verify all files changed by Tasks 1–2.

- [ ] **Step 1: Run syntax and type checks**

Run: `npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 2: Run project checks**

Run: `node --check public/app.js && node --check public/broadcast-audio.js && npm run check:contract`

Expected: all commands PASS.

- [ ] **Step 3: Check formatting and lints**

Run: `git diff --check`, then inspect IDE lints for edited files.

Expected: no new errors.
