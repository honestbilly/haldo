import { nanoid } from 'nanoid';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/haldo',
});

async function seed() {
  console.log('Seeding Haldo database...');

  // Crew members
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
    const id = nanoid();
    await pool.query(
      `INSERT INTO crew (id, name, role, vessel)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [id, c.name, c.role, c.vessel]
    );
    console.log(`  + ${c.role}: ${c.name} (${c.vessel})`);
  }

  // Trip config
  await pool.query(
    `INSERT INTO trip_config (id, vessel, default_slots)
     VALUES ($1, $2, $3)
     ON CONFLICT (vessel) DO NOTHING`,
    [nanoid(), 'squid', JSON.stringify(['AM', 'PM'])]
  );
  console.log('  + Trip config: SQUID [AM, PM]');

  // Settings
  const settings = [
    ['manager_email', process.env.MANAGER_EMAIL || 'billy@honesteco.com'],
    ['alert_email_from', process.env.ALERT_EMAIL_FROM || 'haldo@honesteco.com'],
    ['app_name', 'Haldo'],
    ['app_url', process.env.APP_URL || 'http://localhost:3000'],
  ];

  for (const [key, value] of settings) {
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [key, value]
    );
    console.log(`  + Setting: ${key} = ${value}`);
  }

  console.log('Seed complete!');
  process.exit(0);
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
