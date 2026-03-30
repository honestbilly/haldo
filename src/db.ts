import pg from 'pg';

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
        template_type TEXT NOT NULL CHECK (template_type IN ('checklist', 'logbook')),
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

      -- Indexes for common queries
      CREATE INDEX IF NOT EXISTS idx_completions_vessel ON completions(vessel);
      CREATE INDEX IF NOT EXISTS idx_completions_crew_id ON completions(crew_id);
      CREATE INDEX IF NOT EXISTS idx_completions_trip_date ON completions(trip_date);
      CREATE INDEX IF NOT EXISTS idx_completions_template_id ON completions(template_id);
      CREATE INDEX IF NOT EXISTS idx_alerts_completion_id ON alerts(completion_id);
      CREATE INDEX IF NOT EXISTS idx_alerts_acknowledged ON alerts(acknowledged_at);
      CREATE INDEX IF NOT EXISTS idx_crew_active ON crew(active);
    `);
    console.log('[db] Database initialized');
  } finally {
    client.release();
  }
}
