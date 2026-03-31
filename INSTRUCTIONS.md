# Haldo — Crew Checklist + Logbook App

## What This Is

Haldo delivers Honest Eco's operational checklists and trip logbooks to crew on their phones. Crew tap a link, pick their name, and complete their tasks. Billy sees everything on the report dashboard and through Claude Code.

## Quick Start (Local Development)

### Prerequisites
- Node.js 20+
- PostgreSQL running locally (or use Docker: `docker run -p 5432:5432 -e POSTGRES_DB=haldo -e POSTGRES_PASSWORD=postgres postgres:16`)

### Setup
```bash
# Clone and install
git clone https://github.com/honestbilly/haldo.git
cd haldo
npm install

# Configure environment
cp .env.example .env
# Edit .env with your values (see below)

# Create the database (if not using Docker)
createdb haldo

# Seed crew members and settings
npm run seed

# Start dev server
npm run dev
```

The app runs at http://localhost:3000

### Environment Variables

| Variable | What It Is | Example |
|----------|-----------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://localhost:5432/haldo` |
| `SESSION_SECRET` | Random string for cookie signing | Any 64+ character string |
| `SMTP_HOST` | Email server for alerts | `smtp.gmail.com` |
| `SMTP_PORT` | Email port | `587` |
| `SMTP_USER` | Email account | `billy@honesteco.com` |
| `SMTP_PASS` | Email password (Gmail: use App Password) | See Gmail setup below |
| `MANAGER_EMAIL` | Where alert emails go | `billy@honesteco.com` |
| `ALERT_EMAIL_FROM` | From address on alerts | `haldo@honesteco.com` |
| `REPORT_USER` | Dashboard login username | `billy` |
| `REPORT_PASS` | Dashboard login password | Choose something secure |
| `APP_URL` | Public URL of the app | `https://haldo.up.railway.app` |
| `PORT` | Server port | `3000` |

### Gmail App Password Setup

Gmail requires an "App Password" for SMTP:
1. Go to https://myaccount.google.com/security
2. Enable 2-Step Verification (required)
3. Under 2-Step Verification, click "App passwords"
4. Create a new app password for "Mail"
5. Copy the 16-character password into `SMTP_PASS` in your `.env`

## Deploy to Railway

1. Go to https://railway.app and create a new project
2. Add a **PostgreSQL** database (free tier, 500MB)
3. Add a **GitHub Repo** service — connect the `honestbilly/haldo` repo
4. Railway auto-detects Node.js and deploys
5. Copy the `DATABASE_URL` from the PostgreSQL service into the web service's environment variables (Railway may auto-link this)
6. Set all other environment variables in Railway's dashboard
7. After first deploy, open the Railway shell and run: `npx tsx scripts/seed.ts`

Railway auto-deploys when you push to `main`.

## Managing Crew

Crew roles: **Captain** and **Deckhand** (not "mate" — updated 2026-03-30).

**Via Manager Dashboard:**
- Go to `/report/crew` — see all crew, generate login links
- Login links: one-time tap, stays logged in 365 days. Send via WhatsApp.

**Via Claude Code (MCP):**
- "Add a new deckhand named Alex to SQUID" → `add_crew_member` tool
- "Deactivate Brady, he left" → `update_crew` with `active: false`
- Historical data preserved; they disappear from the name dropdown

## Managing Checklists

Checklists are JSON files in `/templates/`. Two ways to manage them:

**Via Manager Dashboard (recommended for non-technical users):**
- Go to `/report/templates` — see all checklists grouped by category
- Click to edit (JSON editor with validation)
- Clone button to duplicate for another vessel
- Save validates JSON and reloads immediately

**Via Claude Code (MCP):**
- "Add a monthly safety drill checklist for captains" → `create_template`
- "Change snorkel inventory minimum for adult masks to 16" → `update_template`
- "What checklists show for a deckhand on SQUID next week?" → `preview_schedule`

## Database Tables (as of 2026-03-30)

| Table | Purpose |
|-------|---------|
| `vessels` | 5 vessels with name, slug, COI flag |
| `crew` | Crew members with role (captain/deckhand) |
| `completions` | All checklist, logbook, and free-form log submissions |
| `alerts` | Threshold violations from checklist submissions |
| `handoff_notes` | Crew-to-crew notes, auto-expire 24hrs |
| `submissions` | Crew feedback (maintenance, safety, suggestions, kudos) |
| `assigned_tasks` | Manager-assigned tasks to vessel/crew |
| `auth_tokens` | Persistent login tokens |
| `settings` | App configuration |
| `trip_config` | Trip slots per vessel |

## Navigation (Crew Side)

- **Home** (`/today`) — Today's checklists, DMT pinned, assigned tasks
- **Submit** (`/submit`) — Handoff notes or feedback to management
- **More** (`/more`) — Profile, MGMT link, switch crew
- **Add Log Entry** (`/log`) — Free-form timestamped log (engine work, incidents, etc.)
- Bottom nav on all pages: Home | Submit | More

## Navigation (Manager Side)

- **Today** (`/report`) — Dashboard with vessel-grouped timeline, filters, search
- **History** (`/report/history`) — Historical view with date range, crew, type filters
- **Templates** (`/report/templates`) — Checklist editor
- **Crew** (`/report/crew`) — Crew management + login link generation

## MCP Server (Claude Code Integration)

The MCP server lets Claude Code query and manage Haldo directly.

### Setup in Claude Code

Add to your Claude Code MCP settings (`.claude/settings.json` or project settings):

```json
{
  "mcpServers": {
    "haldo": {
      "command": "npx",
      "args": ["tsx", "/path/to/haldo/src/mcp-server.ts"],
      "env": {
        "DATABASE_URL": "postgresql://localhost:5432/haldo"
      }
    }
  }
}
```

For production (Railway), use the Railway PostgreSQL connection string in `DATABASE_URL`.

### Available MCP Tools

| Tool | What It Does |
|------|-------------|
| `query_completions` | Search completions by vessel, crew, date, template |
| `query_alerts` | Search alerts, filter by acknowledged/unacknowledged |
| `query_crew` | List crew members, filter by role/vessel/active |
| `get_completion_detail` | Full details for one completion including all values |
| `get_stats` | Summary: completions today/week, pending alerts, crew count |
| `add_crew_member` | Add a new crew member |
| `update_crew` | Update name, role, vessel, or deactivate |
| `acknowledge_alerts` | Mark alerts as acknowledged |
| `list_templates` | List all templates with schedules |
| `create_template` | Create a new checklist/logbook template |
| `update_template` | Modify an existing template |
| `delete_template` | Remove a template |
| `preview_schedule` | Preview what shows for a vessel/role over N days |
| `run_sql` | Ad-hoc read-only SQL query |

## Adding a QR Code

1. Get your app URL (e.g., `https://haldo.up.railway.app`)
2. Generate a QR code at https://www.qr-code-generator.com/ (or any QR generator)
3. Print it and laminate it
4. Stick it on the helm of each vessel
5. Crew scan it → lands on the Haldo landing page

## File Structure

```
haldo/
├── src/
│   ├── index.ts          — Hono server entry point
│   ├── db.ts             — PostgreSQL schema + connection
│   ├── types.ts          — Template and database types
│   ├── mcp-server.ts     — MCP server for Claude Code
│   ├── routes/
│   │   ├── session.ts    — Landing page + session management
│   │   ├── forms.ts      — Checklist + logbook rendering + submission
│   │   ├── reports.ts    — Manager dashboard + history
│   │   └── api.ts        — JSON API endpoints
│   └── services/
│       ├── templates.ts  — Template loading, scheduling, overrides
│       ├── alerts.ts     — Threshold evaluation + alert creation
│       └── email.ts      — Alert email sending
├── templates/            — JSON checklist/logbook templates (Claude manages these)
├── public/               — CSS + frontend JavaScript
├── scripts/              — Seed script
└── INSTRUCTIONS.md       — This file
```
