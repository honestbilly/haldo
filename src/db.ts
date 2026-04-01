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
      CREATE TABLE IF NOT EXISTS vessels (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        coi BOOLEAN NOT NULL DEFAULT FALSE,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS crew (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('captain', 'deckhand')),
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

      CREATE TABLE IF NOT EXISTS submissions (
        id TEXT PRIMARY KEY,
        crew_id TEXT NOT NULL REFERENCES crew(id),
        vessel TEXT NOT NULL,
        category TEXT NOT NULL CHECK (category IN (
          'maintenance', 'suggestion', 'meeting-topic',
          'safety', 'sop-feedback', 'kudos', 'general'
        )),
        title TEXT NOT NULL,
        details TEXT,
        photo_url TEXT,
        status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'in-progress', 'resolved')),
        priority TEXT CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
        resolution_note TEXT,
        reviewed_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS assigned_tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        vessel TEXT,
        assigned_to TEXT REFERENCES crew(id),
        assigned_by TEXT,
        template_id TEXT,
        source_submission_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in-progress', 'completed', 'cancelled')),
        priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
        due_date DATE,
        completed_at TIMESTAMPTZ,
        completed_by TEXT,
        notes TEXT,
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

      -- Migration: rename 'mate' → 'deckhand' in crew table
      DO $$ BEGIN
        ALTER TABLE crew DROP CONSTRAINT IF EXISTS crew_role_check;
        UPDATE crew SET role = 'deckhand' WHERE role = 'mate';
        ALTER TABLE crew ADD CONSTRAINT crew_role_check CHECK (role IN ('captain', 'deckhand'));
      EXCEPTION WHEN OTHERS THEN NULL;
      END $$;

      -- Migration: expand assigned_tasks status to include blocked/snoozed + add snoozed_until
      DO $$ BEGIN
        ALTER TABLE assigned_tasks DROP CONSTRAINT IF EXISTS assigned_tasks_status_check;
        ALTER TABLE assigned_tasks ADD CONSTRAINT assigned_tasks_status_check
          CHECK (status IN ('pending', 'in-progress', 'completed', 'cancelled', 'blocked', 'snoozed'));
      EXCEPTION WHEN OTHERS THEN NULL;
      END $$;
      DO $$ BEGIN
        ALTER TABLE assigned_tasks ADD COLUMN snoozed_until DATE;
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$;
      DO $$ BEGIN
        ALTER TABLE assigned_tasks ADD COLUMN estimated_minutes INTEGER;
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$;

      -- Migration: Maintenance tracker schema upgrades
      DO $$ BEGIN ALTER TABLE assigned_tasks ADD COLUMN tags TEXT[] DEFAULT '{}'; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
      DO $$ BEGIN ALTER TABLE assigned_tasks ADD COLUMN parent_task_id TEXT REFERENCES assigned_tasks(id); EXCEPTION WHEN duplicate_column THEN NULL; END $$;
      DO $$ BEGIN ALTER TABLE assigned_tasks ADD COLUMN category TEXT DEFAULT 'general'; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
      DO $$ BEGIN ALTER TABLE assigned_tasks ADD COLUMN location TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
      DO $$ BEGIN ALTER TABLE assigned_tasks ADD COLUMN skill_level TEXT DEFAULT 'any'; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
      DO $$ BEGIN ALTER TABLE assigned_tasks ADD COLUMN actual_minutes INTEGER; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
      DO $$ BEGIN ALTER TABLE assigned_tasks ADD COLUMN started_at TIMESTAMPTZ; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
      DO $$ BEGIN ALTER TABLE assigned_tasks ADD COLUMN source_type TEXT DEFAULT 'manual'; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
      DO $$ BEGIN ALTER TABLE assigned_tasks ADD COLUMN source_id TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
      DO $$ BEGIN ALTER TABLE assigned_tasks ADD COLUMN merged_into_id TEXT REFERENCES assigned_tasks(id); EXCEPTION WHEN duplicate_column THEN NULL; END $$;

      -- Task comments table
      CREATE TABLE IF NOT EXISTS task_comments (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES assigned_tasks(id),
        crew_id TEXT REFERENCES crew(id),
        author_name TEXT NOT NULL,
        comment TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Crew profile additions
      DO $$ BEGIN ALTER TABLE crew ADD COLUMN email TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
      DO $$ BEGIN ALTER TABLE crew ADD COLUMN phone TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
      DO $$ BEGIN ALTER TABLE crew ADD COLUMN skills TEXT[] DEFAULT '{}'; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
      DO $$ BEGIN ALTER TABLE crew ADD COLUMN notes TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;

      -- Vessels table (replaces hardcoded VESSELS constant)
      CREATE TABLE IF NOT EXISTS vessels (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        color TEXT DEFAULT '#1A6B8A',
        vessel_type TEXT DEFAULT 'boat' CHECK (vessel_type IN ('boat', 'shore', 'yard', 'office')),
        active BOOLEAN DEFAULT TRUE,
        display_order INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Crew schedule table (monthly CSV upload)
      CREATE TABLE IF NOT EXISTS crew_schedule (
        id TEXT PRIMARY KEY,
        crew_id TEXT NOT NULL REFERENCES crew(id),
        schedule_date DATE NOT NULL,
        vessel_slug TEXT,
        shift TEXT DEFAULT 'full' CHECK (shift IN ('am', 'pm', 'full', 'off')),
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(crew_id, schedule_date)
      );
      CREATE INDEX IF NOT EXISTS idx_crew_schedule_date ON crew_schedule(schedule_date);
      CREATE INDEX IF NOT EXISTS idx_crew_schedule_crew ON crew_schedule(crew_id);

      -- Ensure vessels table has all columns (migration for partial creates)
      DO $$ BEGIN ALTER TABLE vessels ADD COLUMN color TEXT DEFAULT '#1A6B8A'; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
      DO $$ BEGIN ALTER TABLE vessels ADD COLUMN vessel_type TEXT DEFAULT 'boat'; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
      DO $$ BEGIN ALTER TABLE vessels ADD COLUMN active BOOLEAN DEFAULT TRUE; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
      DO $$ BEGIN ALTER TABLE vessels ADD COLUMN display_order INTEGER DEFAULT 0; EXCEPTION WHEN duplicate_column THEN NULL; END $$;

      -- Seed default vessels (idempotent)
      INSERT INTO vessels (id, name, slug, color, vessel_type, display_order) VALUES
        ('v-squid', 'SQUID', 'squid', '#1A6B8A', 'boat', 10),
        ('v-bluq', 'Blu Q', 'blu-q', '#0D5470', 'boat', 20),
        ('v-cowfish', 'Cowfish', 'cowfish', '#2E86AB', 'boat', 30),
        ('v-scout', 'Scout', 'scout', '#3A7CA5', 'boat', 40),
        ('v-javacat', 'Java Cat', 'java-cat', '#4A90A4', 'boat', 50),
        ('v-shore', 'Shore / Office', 'shore', '#8E8E93', 'shore', 100),
        ('v-yard', 'Yard', 'yard', '#8E8E93', 'yard', 110)
      ON CONFLICT (slug) DO NOTHING;

      -- Indexes for maintenance tracker
      CREATE INDEX IF NOT EXISTS idx_tasks_parent ON assigned_tasks(parent_task_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_category ON assigned_tasks(category);
      CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id);

      -- Indexes for new tables
      CREATE INDEX IF NOT EXISTS idx_submissions_vessel ON submissions(vessel);
      CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);
      CREATE INDEX IF NOT EXISTS idx_submissions_category ON submissions(category);
      CREATE INDEX IF NOT EXISTS idx_assigned_tasks_vessel ON assigned_tasks(vessel);
      CREATE INDEX IF NOT EXISTS idx_assigned_tasks_status ON assigned_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_assigned_tasks_assigned_to ON assigned_tasks(assigned_to);

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
      // Seed vessels
      const vessels = [
        { name: 'SQUID', slug: 'squid', coi: true },
        { name: 'Blu Q', slug: 'blu-q', coi: true },
        { name: 'Cowfish', slug: 'cowfish', coi: true },
        { name: 'Scout', slug: 'scout', coi: false },
        { name: 'Java Cat', slug: 'java-cat', coi: false },
      ];
      for (const v of vessels) {
        await client.query(
          `INSERT INTO vessels (id, name, slug, coi) VALUES ($1, $2, $3, $4)
           ON CONFLICT (slug) DO NOTHING`,
          [nanoid(), v.name, v.slug, v.coi]
        );
      }

      const crew = [
        { name: 'Jess', role: 'captain', vessel: 'squid' },
        { name: 'Chase', role: 'captain', vessel: 'squid' },
        { name: 'Kristen', role: 'captain', vessel: 'squid' },
        { name: 'Alexa', role: 'captain', vessel: 'squid' },
        { name: 'Libbie', role: 'captain', vessel: 'squid' },
        { name: 'Dan', role: 'captain', vessel: 'squid' },
        { name: 'Andrew', role: 'captain', vessel: 'squid' },
        { name: 'Hadden', role: 'deckhand', vessel: 'squid' },
        { name: 'Bryan', role: 'deckhand', vessel: 'squid' },
        { name: 'Jackie', role: 'deckhand', vessel: 'squid' },
        { name: 'Charlie', role: 'deckhand', vessel: 'squid' },
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
      console.log('[db] Seed complete — 5 vessels, 11 crew, settings');
    }
  } finally {
    client.release();
  }
}
