import pg from 'pg';
import { nanoid } from 'nanoid';

const { Pool } = pg;

// Railway provides DATABASE_URL automatically
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

export default pool;

// Run migrations on startup
export async function initDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS crew (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('captain', 'mate')),
        vessel TEXT,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS completions (
        id TEXT PRIMARY KEY,
        template_id TEXT NOT NULL,
        template_type TEXT NOT NULL CHECK (template_type IN ('checklist', 'logbook', 'log')),
        vessel TEXT NOT NULL,
        crew_id TEXT NOT NULL REFERENCES crew(id),
        trip_date TEXT,
        trip_slot TEXT,
        started_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ,
        values_json JSONB NOT NULL,
        alerts_json JSONB,
        notes TEXT,
        signed_off BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS alerts (
        id TEXT PRIMARY KEY,
        completion_id TEXT NOT NULL REFERENCES completions(id),
        template_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        item_label TEXT NOT NULL,
        current_value TEXT NOT NULL,
        threshold_value TEXT NOT NULL,
        severity TEXT NOT NULL CHECK (severity IN ('warning', 'critical')),
        message TEXT NOT NULL,
        notified_at TIMESTAMPTZ,
        acknowledged_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS trip_config (
        id TEXT PRIMARY KEY,
        vessel TEXT NOT NULL UNIQUE,
        default_slots JSONB NOT NULL DEFAULT '["AM", "PM"]',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS handoff_notes (
        id TEXT PRIMARY KEY,
        vessel TEXT NOT NULL,
        crew_id TEXT NOT NULL REFERENCES crew(id),
        crew_name TEXT NOT NULL,
        role TEXT NOT NULL,
        note TEXT NOT NULL,
        resolved BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Auth tokens for persistent login
      CREATE TABLE IF NOT EXISTS auth_tokens (
        token TEXT PRIMARY KEY,
        crew_id TEXT NOT NULL REFERENCES crew(id),
        role TEXT NOT NULL DEFAULT 'crew',  -- 'crew' | 'manager' | 'admin'
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_used_at TIMESTAMPTZ,
        revoked BOOLEAN NOT NULL DEFAULT FALSE
      );

      -- Add login_token to crew if not exists
      DO $$ BEGIN
        ALTER TABLE crew ADD COLUMN login_token TEXT;
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$;

      -- Migration: add 'log' to template_type check constraint
      DO $$ BEGIN
        ALTER TABLE completions DROP CONSTRAINT IF EXISTS completions_template_type_check;
        ALTER TABLE completions ADD CONSTRAINT completions_template_type_check
          CHECK (template_type IN ('checklist', 'logbook', 'log'));
      EXCEPTION WHEN OTHERS THEN NULL;
      END $$;

      -- Indexes for common queries
      CREATE INDEX IF NOT EXISTS idx_handoff_notes_vessel ON handoff_notes(vessel, resolved);
      CREATE INDEX IF NOT EXISTS idx_completions_vessel ON completions(vessel);
      CREATE INDEX IF NOT EXISTS idx_completions_crew_id ON completions(crew_id);
      CREATE INDEX IF NOT EXISTS idx_completions_trip_date ON completions(trip_date);
      CREATE INDEX IF NOT EXISTS idx_completions_template_id ON completions(template_id);
      CREATE INDEX IF NOT EXISTS idx_alerts_completion_id ON alerts(completion_id);
      CREATE INDEX IF NOT EXISTS idx_alerts_acknowledged ON alerts(acknowledged_at);
      CREATE INDEX IF NOT EXISTS idx_crew_active ON crew(active);
    `);
    console.log('[db] Database initialized');

    // Auto-seed if crew table is empty
    const crewCount = await client.query('SELECT COUNT(*) FROM crew');
    if (parseInt(crewCount.rows[0].count) === 0) {
      console.log('[db] Empty database detected — seeding crew and settings...');
      const crew = [
        { name: 'Jess', role: 'captain', vessel: 'squid' },
        { name: 'Chase', role: 'captain', vessel: 'squid' },
        { name: 'Kristen', role: 'captain', vessel: 'squid' },
        { name: 'Alexa', role: 'captain', vessel: 'squid' },
        { name: 'Libbie', role: 'captain', vessel: 'squid' },
        { name: 'Dan', role: 'captain', vessel: 'squid' },
        { name: 'Andrew', role: 'captain', vessel: 'squid' },
        { name: 'Hadden', role: 'mate', vessel: 'squid' },
        { name: 'Bryan', role: 'mate', vessel: 'squid' },
        { name: 'Jackie', role: 'mate', vessel: 'squid' },
        { name: 'Charlie', role: 'mate', vessel: 'squid' },
      ];
      for (const c of crew) {
        await client.query(
          'INSERT INTO crew (id, name, role, vessel) VALUES ($1, $2, $3, $4)',
          [nanoid(), c.name, c.role, c.vessel]
        );
      }
      // Trip config for all vessels
      for (const vessel of ['squid', 'blu-q', 'cowfish', 'scout', 'java-cat']) {
        await client.query(
          `INSERT INTO trip_config (id, vessel, default_slots) VALUES ($1, $2, $3)
           ON CONFLICT (vessel) DO NOTHING`,
          [nanoid(), vessel, JSON.stringify(['AM', 'PM'])]
        );
      }
      // Default settings
      const settings = [
        ['manager_email', process.env.MANAGER_EMAIL || 'billy@honesteco.com'],
        ['alert_email_from', process.env.ALERT_EMAIL_FROM || 'haldo@honesteco.com'],
        ['app_name', process.env.APP_NAME || 'Haldo'],
        ['app_url', process.env.APP_URL || 'http://localhost:3000'],
      ];
      for (const [key, value] of settings) {
        await client.query(
          `INSERT INTO settings (key, value) VALUES ($1, $2)
           ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
          [key, value]
        );
      }
      console.log('[db] Seed complete — 11 crew, 5 vessels, settings');
    }
  } finally {
    client.release();
  }
}
