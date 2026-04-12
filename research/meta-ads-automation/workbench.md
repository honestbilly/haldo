# Meta Ads Automation — Workbench

**Owner:** Billy (Honest Eco)
**Started:** 2026-04-11
**Status:** 🟡 Research complete — awaiting Phase 0 verification (rez-software Pixel + CAPI)

---

## Goal

Use Claude Code Desktop on macOS to manage Meta (FB + IG) ad campaigns for Honest Eco near-fully automated, with periodic human review. Billy does not visit Meta Ads Manager after initial setup. Work runs on Billy's Mac.

---

## Requirements

- Connect to Meta programmatically (FB + IG ads)
- ~100% automated with periodic Billy review
- Evaluation + iteration loop
- Budget control (hard caps, no runaway spend)
- Ad creation — copy + propose creatives; if Billy provides photos/videos, Claude handles upload + campaign build
- Analyze historical ad performance, form opinions on what works
- Billy does not go into Meta Ads Manager after initial setup
- Work runs on Billy's computer (not a cloud service)

---

## Feasibility verdict

**YES — feasible and achievable with existing tools. One blocker to verify.**

- Every technical piece exists in 2026
- "Near-full automation" is correctly interpreted as **daily 5-min review ritual**, not unattended autonomy
- The real-money risk is manageable with layered safety (Meta account cap + permission modes + PreToolUse hooks)
- Use **Claude Code Desktop**, not Cowork (Cowork is the wrong execution environment — sandboxed cloud VM)
- **Blocker:** rez-software must have Meta Pixel + Conversions API installed, or the whole attribution chain is broken and Meta optimizes on incomplete data

---

## Architecture

**Components:**
- **Runtime:** Claude Code Desktop app for macOS
- **Connector:** `pipeboard-co/meta-ads-mcp` (most mature community MCP, ~763★, active April 2026, Python, full CRUD + insights + creative upload)
- **Auth:** Meta Business Manager System User → non-expiring token → stored in macOS Keychain
- **Scheduling:** Claude Code Desktop → Schedule → local tasks (NOT `/loop`, NOT cloud tasks)
- **Notifications:** Gmail MCP (draft reports) + macOS desktop notification + Notion MCP (audit log)
- **Safety:** Meta account spend limit (hard ceiling) + campaign spend_cap + PreToolUse hooks + Plan/Ask permission modes + allowlisted MCP tools

**Two scheduled tasks, not one:**

| Task | Schedule | Permission mode | Allowed tools | Output |
|---|---|---|---|---|
| `meta-ads-morning-pull` | Daily 8:03am | **Plan** | Read-only Meta MCP tools + Write (local files) + Gmail draft | Daily report + proposed changes as Gmail draft |
| `meta-ads-apply-changes` | **Manual only** | **Ask** | Write Meta MCP tools + read + notification | Executes approved changes, one prompt per action |

**Why two:** The read-only task physically cannot mutate anything in Plan mode. The apply task only runs when Billy triggers it after reviewing the draft. Single-task write access = eventual expensive accident.

---

## Hard rules enforced by the system (not the prompt)

| Rule | Enforcement layer |
|---|---|
| Account daily spend ceiling | Meta Ads Manager — outside Claude entirely, survives any Claude-side failure |
| Per-campaign `spend_cap` on every campaign | Meta API (set at creation) |
| No writes in morning-pull task | Plan mode + allowlist + PreToolUse hook denies on task-name mismatch |
| Budget changes > 25% require Billy | PreToolUse hook intercepts and denies |
| Never touch customer DMs/comments/reviews | Not on allowlist, ever |
| Never make unsubstantiated claims in copy | Prompt rules + weekly review |
| Never upload customer lists without explicit opt-in | Manual step always |
| Year-over-year comparisons only | Prompt rule — Sept-2026 vs Sept-2025, never vs March |
| Monthly API spend cap | Anthropic Console ($20/mo safety net) |

---

## Phased plan

### Phase 0 — Pre-flight (BLOCKING)
**Duration:** Verification, then potentially a boldSQUID sub-workstream
- [ ] Confirm with Oskar: is Meta Pixel installed on rez-software across all pages (incl. booking confirmation)?
- [ ] Confirm with Oskar: is Conversions API wired up server-side, deduped with Pixel by `event_id`?
- [ ] If either = no → this becomes a boldSQUID setup workstream before any agent work. See `Dropbox/Santa Claude/projects/boldsquid/setup-workbench.md`
- [ ] Verify Event Match Quality (EMQ) score ≥ 6 in Meta Events Manager

### Phase 1 — Setup (~1 sitting + verification wait)
- [ ] Create Meta Developer App (developers.facebook.com → My Apps → Business type)
- [ ] Complete Meta Business Verification (takes a few business days)
- [ ] Create System User in Business Manager → assign Admin on Honest Eco ad account + Page
- [ ] Generate System User access token with scopes: `ads_management`, `ads_read`, `business_management`
- [ ] Store token in macOS Keychain: `security add-generic-password -s meta-ads -a billy -w <token>`
- [ ] Set account-level daily spend limit in Meta Ads Manager (conservative — this is the final backstop)
- [ ] Install pipeboard-co/meta-ads-mcp into Claude Code Desktop (edit `~/Library/Application Support/Claude/claude_desktop_config.json`)
- [ ] Verify: `list_campaigns` from Claude session returns real Honest Eco data
- [ ] Enable "Keep computer awake" in Claude Code Desktop → General settings
- [ ] Write brand-voice doc for Honest Eco (45-min interview + site/review scraping)
- [ ] Install `~/.claude/settings.json` hooks (PreToolUse audit + deny on writes when task name mismatches + StopFailure Gmail on errors)

### Phase 2 — Read-only observation (2–3 weeks)
- [ ] Create `meta-ads-morning-pull` scheduled task in Plan mode
- [ ] Run daily, review draft email every morning, compare to actual Ads Manager reality
- [ ] **Week 1 protocol:** also manually "Run now" each day to verify schedule bugs (#44128, #23092) aren't live on current build
- [ ] Log surprises, drift, wrong opinions in this workbench
- [ ] **Gate to advance:** 2+ consecutive weeks of clean, trustable daily reports

### Phase 3 — Proposal mode
- [ ] Create `meta-ads-apply-changes` task (Manual trigger, Ask mode)
- [ ] Billy triggers after reading morning draft
- [ ] Each mutation requires Ask-mode approval click
- [ ] **Gate to advance:** 4+ weeks of clean proposals, zero surprises

### Phase 4 — Graduated autonomy
- [ ] One safe action at a time moves to auto-execute, via narrowly-scoped allowlist:
  - [ ] Pause fatigued ad (freq > 3.5 AND CTR decay ≥ 20%)
  - [ ] Scale winner by ≤20%/day
  - [ ] Refresh primary text variants within an existing ad
- [ ] Everything else still proposes
- [ ] Each individual action earns trust before the next graduates

### Phase 5 — Creative velocity (optional)
- [ ] Only if creative refresh cadence becomes the bottleneck
- [ ] Remotion-based video assembly from raw clips (there's a `remotion-best-practices` skill available)
- [ ] Monthly phone-dump ritual for raw material

---

## Research findings — full detail

### Meta Marketing API (axis 1)

**Self-service auth path:** Standard access to `ads_read` and `ads_management` is sufficient for managing your own ad account. **No App Review needed.** System User tokens do not expire (key for automation).

**Setup hurdle:** 1–3 hours if smooth, 1–2 weeks if Business Verification hits doc issues. Verification is tightening — plan to complete it.

**Writable via API:** Campaigns, Ad Sets, Ads, Ad Creatives (build new, don't update), Custom Audiences (customer list + website), Lookalikes.

**Requires manual Meta setup first:** Pixel install, payment method, IG-to-Page link, domain verification.

**Creative upload:** All formats API-uploadable (image, video, carousel, collection, Reels, stories). Two-step flow: POST media → get hash → reference in creative. Reels video upload uses a different host (`rupload.facebook.com`). Instagram actor ID is **required per ad** for IG placements — Meta does not auto-link from the Page.

**Budget levers (layered):**
- `daily_budget` — soft, ±25% daily pacing
- `lifetime_budget` — hard over schedule window
- `spend_cap` (campaign-level) — hard, minimum $100
- **Account-level spending limit** — the hardest ceiling. Set manually in Ads Manager. API can read but not raise above current value. **Use as kill switch.**

**Pause latency:** 5–15 min to actually stop delivery. Not suitable as emergency brake against runaway spend — the account spend limit is.

**API throttles:** Max 4 ad-set budget changes/hour, max 10 ad-spend-change calls/day. Auto-optimizers that thrash will hit these.

**Insights API:** Refreshes every ~15 min, stabilizes over 24–72h as late conversions arrive, **locked at 28 days**. Full breakdown support (age/gender/placement/region/device/hour). June 10, 2025 attribution change: `action_report_time=mixed` now default, windows pulled from ad set settings.

**Rate limits:** Dev tier is painful (60-pt bucket). Standard tier (~9000 pts) is fine for single ad account. Base quota + 40/active-ad for `ads_management`, + 400/active-ad for `ads_insights`. Honest Eco single-account won't hit limits after first 2 weeks.

**Conversions API + Pixel — MANDATORY:** Use both. Pixel alone loses 30–60% of conversions in 2026. CAPI fills iOS/ITP/adblock gaps and is the only way to count offline bookings. Deduplicate by `event_id`. Standard events needed: `ViewContent`, `InitiateCheckout`, `Purchase` (with value + currency). EMQ score ≥ 6.

**Sandbox:** Marketing API Sandbox Ad Accounts exist (synthetic data, no real money). Also: real account with campaigns created in `PAUSED` = dry run — Meta doesn't charge until `ACTIVE`.

**Top gotchas:**
1. Don't use User Tokens for automation (they expire in 1–2 hrs); use System User tokens
2. Pixel doesn't always carry over on API-duplicated ad sets — always set `promoted_object.pixel_id` explicitly
3. Instagram actor ID missing on IG ads → ads post from wrong account
4. Policy rejection language: second-person attribute phrasing ("Are you a tired parent?") is the #1 auto-rejection
5. API versions deprecate quarterly; pin version in URL, plan bi-annual version bumps

---

### Claude ↔ Meta integration paths (axis 2)

**No official Meta MCP from Anthropic or Meta.** Community ecosystem is mature with multiple real options.

**Ranked MCP options:**
1. **pipeboard-co/meta-ads-mcp** — ~763★, Python, active April 2026, full coverage, OAuth + token auth, Docker, also offers remote-hosted endpoint. **This is the recommended starting point.**
2. **brijr/meta-mcp** — ~147★, TypeScript, 25 tools, production-ready, npm installable. Good alternative if you prefer Node.
3. **gomarble-ai/facebook-ads-mcp-server** — ~266★, Python, read-heavy (25+ tools), one-click installer.
4. **attainmentlabs/meta-ads-mcp** — newer, thoughtful safety: always creates campaigns PAUSED by default.
5. Others: hashcott, amekala/ads-mcp (multi-platform), promobase (thin SDK wrapper reference).

**Maturity caveat:** All community, Meta blesses none, API version drift is a constant tax. Write ops are where bugs live; read ops more reliable. Budget for periodic version-bump maintenance.

**Build-your-own path:** Weekend project for one developer. ~300–500 lines of Python using FastMCP + facebook-python-business-sdk. Worth doing only if pipeboard doesn't fit a specific need.

**Alternative: CLI tool + Claude Code shell-out.** Works fine. Pros: easier to debug in Terminal, runs outside Claude too (cron, launchd). Cons: weaker typing, Claude doesn't auto-discover tools. The [nocodesaas.io case study](https://www.nocodesaas.io/p/how-i-built-an-automated-ad-machine) used this approach with plain Node + Graph API, no MCP.

**Cowork vs. Code verdict — use Code.** Cowork runs in a sandboxed cloud VM, can't directly own local MCP stdio servers, can't keep secrets locally, uses remote MCP connectors over HTTPS from Anthropic's IPs. Claude Code Desktop runs local stdio MCP servers natively, shell commands, local files, hooks, scheduled tasks. Code is the correct tool for unattended ad management on your own machine.

**OAuth on desktop:** Don't do user-token OAuth. Use System User tokens — no browser dance, no redirect URIs, no refresh cycle.

**Token storage:** macOS Keychain. `security add-generic-password -s meta-ads -a billy -w <token>`. Python `keyring`, Node `keytar`. Plaintext .env is acceptable-but-worse.

**Meta Advantage+ vs. Claude automation:** Not redundant — stack them. Advantage+ optimizes delivery inside Meta's graph. Claude handles cross-session strategy, brand voice, creative briefing, analysis grounded in Honest Eco specifics. The 2026 model is: Claude sets up the campaign + feeds good inputs, Advantage+ optimizes delivery.

---

### Unattended scheduling on Claude Code Desktop (axis 3)

**Three scheduling mechanisms — only one is right for this job:**

| Mechanism | Runs on | Needs Mac awake | Needs session open | File access | Right for this? |
|---|---|---|---|---|---|
| **Desktop local scheduled task** | Your Mac | Yes | No | Yes (local) | ✅ YES |
| **Cloud/remote scheduled task** | Anthropic cloud | No | No | No (fresh git clone only) | ❌ No — can't use local MCPs or secrets |
| **`/loop` skill** | Your Mac | Yes | **Yes** (dies with session) | Yes | ❌ No — not unattended |

**How to create:** Claude Code Desktop sidebar → Schedule → New task → New local task. Set name, prompt, frequency, and **permission mode per task**. Stored on disk as `~/.claude/scheduled-tasks/<task-name>/SKILL.md`. Can also be created via natural language in any Claude session.

**Each run is a fresh session.** No multi-day context overflow. Design pattern: "new agent wakes up, reads yesterday's notes from disk, does work, writes today's notes, exits." Write a daily decisions log (`~/meta-ads-decisions/YYYY-MM-DD.md`) and have tomorrow's run read the last 7 days.

**Permission modes:**
- `plan` — reads only, no writes, no commands. **This is the morning-pull mode.**
- `default` (Ask) — stalls run, waits for human click per tool. **This is the apply-changes mode.**
- `acceptEdits` — too permissive for real money
- `dontAsk` — allowlist-only, auto-deny outside it. Also valid for apply-changes with tighter allowlist.
- `bypassPermissions` — **NEVER use this for Meta ads.**

**PreToolUse hooks can return `permissionDecision: "deny"` and block tool calls even under bypassPermissions.** This is where hard dollar caps and "never touch X" rules live — at the harness layer, not model layer, so the prompt can't talk its way past them.

**Notification paths, ranked:**
1. **Gmail MCP draft** (already connected). Draft, not send — can't accidentally email customers. Title: `[Meta Ads] YYYY-MM-DD — N proposed changes`.
2. **macOS desktop notification** — built-in on every scheduled run.
3. **Notion MCP** — audit log / running dashboard.
4. Slack — overkill for a one-person shop.

**Kill switch — layered, do all of them:**
1. Revoke Meta System User token (nuclear, Meta-side, survives any Claude failure)
2. Pause scheduled task (toggle Repeats off)
3. Delete task
4. Quit Claude Code Desktop (Cmd+Q)
5. Force-kill Claude process (Activity Monitor)
6. Remove MCP from settings.json
7. **Meta account-level daily spend cap** — the most important one, outside Claude entirely

**Cost:** On Claude Max 5x, a daily Meta ads run (~50k input + 5k output tokens, Sonnet) is comfortably inside the 5-hour token window and cost ~$0/day (subscription). Pro's 44k per 5hr window is tight if also coding. Recommendation: Max 5x + $20/mo API safety net in Anthropic Console.

**Gotchas (design against):**
1. **Idle sleep kills runs silently.** Enable "Keep computer awake." Closing the lid still sleeps regardless. Consider a dedicated Mac mini if laptop moves around.
2. **Catch-up runs fire exactly one missed run on wake**, not the whole queue. Add prompt guardrail: "if more than 4 hours late, generate missed-run report instead of acting."
3. **Bug cluster #44128, #23092, #36131, #42662** — scheduled tasks may not fire unless app is open/focused; ~5 min idle auto-quit. **Week 1 protocol:** manual Run now + compare against scheduled fires.
4. **MCP token silent death** (Gmail, Notion, Meta all expire eventually). Agent runs, 401s, writes "no data available," nobody notices for a week. Mitigation: SessionStart health check hook + StopFailure Gmail draft on any error.
5. **Rate limits shared** across interactive + scheduled. Schedule morning runs before Billy's workday.
6. **Permission stalls** — Ask-mode tasks sit in sidebar waiting for clicks. Good for safety, bad if ignored.
7. **Context drift across runs** — persist decisions to disk, read recent days next run.
8. **The prompt is the spec** — scheduled tasks don't re-ask clarifications. Write the task prompt like an SFR.

---

### Creative + analytics for tour ads (axis 4)

**Ad copy — fully automated.** Claude produces usable, brand-voiced copy once given a proper brand doc. Best practices:
- Primary text: 1–3 lines, hook in first 1.7 seconds, lead with concrete promise not brand fluff
- 5 primary text options per ad, Meta tests per-person — this is where variant generation pays
- Headline ~27 chars Feed, ~40 max. Reels overlay 10 chars.
- Each field must stand alone — Meta may swap text between fields
- Variant testing: one hypothesis per ad (urgency vs. value vs. social proof vs. specificity), not random wordsmithing
- Emoji: measured, not overloaded; not allowed in CTA button
- CTA: "Book Now" for conversion, "Learn More" for cold

**Images — real photos only. Do not use AI-generated.** Three converging reasons:
1. **Meta policy (2024–2026):** C2PA metadata detection → automatic "AI info" label on your ads
2. **Traveler research (CrowdRiff):** 68% of travelers demand authentic visuals; peer-reviewed hospitality research shows AI images *impede* ability to envision the actual experience; real photos lift conversion ~35%
3. **Brand:** Honest Eco's value prop is authenticity — real biologists, wild dolphins, Key West waters. AI images contradict the brand promise on contact.

Claude's role with real photo library: rank for feed-stopping potential, recommend crops per placement (1:1, 4:5, 9:16), suggest text overlay zones, pair photos to copy variants, pick thumbnails. Exception: purely graphic promo cards ("Book before May 1") where no experience is depicted.

**Video — phased:**
- **Phase 1 (start here):** Billy provides finished 15–30s clips, Claude writes captions/overlays/copy, picks thumbnail, uploads. Trivially viable.
- **Phase 2 (only if raw material is the bottleneck):** Remotion-assembled from raw clips. There's a `remotion-best-practices` skill available. Don't build speculatively.
- **Phase 3 / skip:** Don't skip video entirely — data is unambiguous that video outperforms static on CTR/engagement. But static still drives 60–70% of conversions via retargeting/lower-funnel. Run mixed.
- **Always:** burned-in captions (85% of FB video watched muted), 9:16 Reels version + 1:1 Feed version from same master.

**Historical analysis — the hard truth:** Small-business data is under-powered. Meta's learning phase wants ~50 conversions/ad set/week; statistical tests want ~100 per variation. Honest Eco probably produces 10–40 bookings/ad set/week at $500–$3k/month. Most "winners" are noise.

**Metrics to prioritize (in order):**
1. Cost per booking (offline-matched) — the only number that truly matters at this scale
2. ROAS (realistic: 3–6x cold, 6–12x retargeting — not the 12.9x aggregate that includes OTAs)
3. CTR (leading indicator, noisy, fast)
4. Frequency (fatigue — reliable at any sample size)
5. Thumbstop rate (3-sec views / impressions) — best early creative-quality signal

**Deprioritize:** audience overlap, granular A/B winner-picking (samples too small).

**Claude's opinion format — be specific, not hedged, but state confidence:**
- GOOD: "Sunset sail creative is fatigued (freq 4.2, CTR -31% over 14d). Kill Monday. Replace with reef-snorkel clip."
- BAD: "There may be some indication of potential fatigue in some creatives, worth considering reviewing."
- FLAG SAMPLE SIZE: "Only 14 bookings across 3 ad sets this week — I can't distinguish winners statistically. This is directional. Agree?"

**Campaign structure for $500–$3k/month:**

```
Campaign 1 — Awareness/Traffic (10–20% budget)
  • Objective: Traffic or ThruPlay
  • Audience: Broad US, 28–65, optional travel interest
  • Creative: Brand story video (real biologists, conservation)
  • Purpose: Upper funnel, feed retargeting pools

Campaign 2 — Conversions (70–80% budget)
  • Objective: Sales (Purchase)
  • Audience: Broad + 1% Lookalike of past customers
  • Creative: 3–5 ads mixing video + tour photos
  • Purpose: The money-maker. Where ASC eventually lives.

Campaign 3 — Retargeting (10–15% budget)
  • Objective: Sales (Purchase)
  • Audience: Site visitors 30d, 75% video viewers, IG engagers
  • Creative: Specific offer + social proof (reviews, UGC)
  • Purpose: Close warm traffic.
```

**Advantage+ Shopping (ASC) vs. manual:** ASC lowers CPA 10–20% but needs 50+ weekly purchases to run well. Honest Eco at $500/mo probably doesn't. **Start manual for 60 days to build conversion history, migrate Campaign 2 to ASC only when weekly purchases stabilize above ~25.** Use CBO (Campaign Budget Optimization) so Meta distributes across ad sets.

**Audiences — ranked:** Broad (1st) → 1% LAL of past customers (2nd) → retargeting pools (3rd) → interest-based (last resort, rarely beats broad + LAL at scale).

**Benchmarks (2025, travel services / recreation US):**
- CTR median ~1.07%, >1.5% healthy, >2% great
- CPC $0.57–$1.88 range (wide — don't anchor)
- CPM ~$6.83 median travel services
- ROAS realistic 3–6x cold, 6–12x retargeting
- Click→booking 2–5%

**FLAG:** no public benchmarks exist for "Key West small eco-tour operators" specifically. Everything is aggregated across the full travel industry. Directional only.

**Better health signals than benchmarks:** cost per booking trending down WoW, frequency < 3, thumbstop > 25% on video, retargeting ROAS > 5x, **actual booking calendar pace vs. same period last year.** The booking calendar is the real scoreboard — Meta's reported conversions are noisy.

**Creative refresh cadence:**
- Frequency > 2.5 — early warning
- Frequency > 3.5 + CTR decay ≥ 20% — replace now
- Retargeting > 3.0 — act immediately
- At $500–$3k/mo, creative stays fresh ~3–6 weeks (vs. 1 week at $100k/mo)
- Target: 1 fresh creative every 10–14 days

**Without a raw-material pipeline, refresh cadence fails no matter how good the automation.** Build a monthly phone-dump ritual.

**Key West seasonality — critical:**

| Season | Period | Budget | Targeting | Creative angle |
|---|---|---|---|---|
| Peak | Dec–Apr (Mar–Apr peak) | Max | Broad, ride the demand | "Don't miss your spot," scarcity, date-specific |
| Shoulder | May, Nov | 70% of peak | Broad + LAL + retargeting | "Before crowds return / after crowds leave" |
| Low | Jun–Oct (lowest Sep–Oct) | 40–50% of peak, **never zero** | Drive-market states (GA, AL, TN) + local FL | Value, locals' pick, event-specific (Fantasy Fest, Hemingway Days, Pride) |

**Critical rule:** Never compare Sept CPA to March CPA. **Year-over-year same-month only.** Otherwise the agent kills good ads every summer.

**Never zero budget in low season** — breaks pixel signal continuity, resets learning phase, makes November ramp start from scratch. Maintain a presence floor.

**What Claude owns vs. what Billy owns:**

| Always Billy | Propose + approve | Auto-execute |
|---|---|---|
| Budget changes > 25% | New creative launches (copy + assets) | Pause fatigued ad (freq + CTR rule) |
| New campaign types (first ASC, first retargeting, first Lead Gen) | Weekly campaign review + recommendations | Scale winners ≤ 20%/day |
| Spending over monthly cap | Creative kill recommendations | Primary text variant swaps within an existing ad |
| Brand voice shifts | Audience changes (new LAL, new exclusions) | Daily performance reports |
| Customer communication (DMs, comments, reviews) | Offline conversion uploads | UTM hygiene, link checks |
| Claims/guarantees in copy | Seasonal budget plan | Frequency monitoring |
| Responding to bad reviews | | |

**Hard "never automate" list:** customer comms, claim-making copy, budget escalation beyond cap, launching new campaign *types* first time, uploading customer lists, responding to Meta policy flags, deciding what the tours are.

---

## Open questions for Billy

1. **🚨 Does rez-software have Meta Pixel + CAPI live today?** (Check with Oskar. Blocker.)
2. **Current monthly Meta spend and booking volume from Meta?** (Determines ASC readiness + statistical weight.)
3. **Claude subscription tier — Max 5x or Pro?** (Pro's 5-hour token window is tight when also coding.)
4. **Build a Honest Eco brand-voice doc first?** (~45-min interview + site/review scraping. Copy quality depends on this more than any technical piece.)
5. **Kill-switch runbook — where does it live?** (Suggestion: pinned top of this workbench, printed, browser bookmarked.)

## Decisions (pending Billy review)

- [ ] Use Claude Code Desktop, not Cowork — **pending Billy confirmation**
- [ ] Use pipeboard-co/meta-ads-mcp as starting connector — **pending**
- [ ] Two-task architecture (read-only Plan + manual Ask apply) — **pending**
- [ ] Phase 0 gate: don't start Phase 1 until Pixel + CAPI verified — **pending**
- [ ] No AI-generated images, real photos only — **pending (opinionated; based on policy + research + brand)**
- [ ] Start manual campaigns, migrate to ASC only after ~25 weekly purchases — **pending**

## To-do

- [ ] Billy reviews this workbench
- [ ] Answer the 5 open questions
- [ ] Confirm/adjust phased plan
- [ ] Check rez-software Pixel + CAPI status with Oskar (Phase 0 gate)
- [ ] Decide Claude subscription tier if not already on Max 5x
- [ ] Schedule brand-voice interview session

## Change log

- **2026-04-11** — Workbench created. Four-axis research complete (Meta API, Claude integration paths, unattended scheduling, creative+analytics). Feasibility verdict: YES conditional on Pixel/CAPI blocker. Recommended Claude Code Desktop + pipeboard MCP + two-task Plan/Ask architecture. Full research findings captured above.
