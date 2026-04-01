// One-time script to import tasks and schedule to production DB
// Run: railway run node scripts/import-production.js

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function importTasks() {
  const csvPath = path.join(__dirname, '..', 'Downloads', 'Operations Work Tracker and Log - March 2026.csv');

  // Try multiple paths
  let csv;
  const paths = [
    '/Users/billylitmer/Downloads/Operations Work Tracker and Log - March 2026.csv',
    path.join(__dirname, '..', 'tasks-import.csv'),
  ];

  for (const p of paths) {
    try { csv = fs.readFileSync(p, 'utf8'); break; } catch(e) {}
  }

  if (!csv) {
    // Hardcode the data since file paths don't work in railway run
    const tasks = [
      { vessel: 'blu-q', title: 'Main Topping lift needs replacement', notes: 'lift has split from wear and flag halyard wrap' },
      { vessel: 'blu-q', title: 'Main Sail track lower piece', notes: null },
      { vessel: 'blu-q', title: 'Bench Seating cracks', notes: 'Needs renforcing with boards under hatches' },
      { vessel: 'blu-q', title: 'Paint under walkway Port Hull', notes: 'Will use matching paint to cover glassed areas' },
      { vessel: 'blu-q', title: 'Lower Unit rebuild on Starbard Engine', notes: 'Will rebuild lower unit off spare motor to swap, New impeller, gaskets, Thermostat, Filters and Oil' },
      { vessel: 'cowfish', title: 'Fill small holes along railing', notes: 'Holes made from hardware removed in yard' },
      { vessel: 'cowfish', title: 'Remove the PA from the hydraulic loop', notes: 'Needs Steering check and system updated' },
      { vessel: 'java-cat', title: 'Rerig lazy jacks and sail cover', notes: null },
      { vessel: 'java-cat', title: 'Bimini Needs installed', notes: 'Get Java Cat bimini back on' },
      { vessel: 'blu-q', title: 'Replace Port Fuel lines with USCG approved lines', notes: 'The fuel hoses were replaced with what doesn\'t look to be USCG approved.', status: 'completed' },
      { vessel: 'java-cat', title: 'Install Brochure Display', notes: 'It\'s at office', status: 'completed' },
      { vessel: 'squid', title: 'Starboard hull cleaned', notes: 'make sure all bits and pieces are out of hull that could break the bilge pump. Degrease with dawn or equiv under battery box compartment.', status: 'completed' },
      { vessel: 'shore', title: 'Captain Search', notes: 'Ask crew for recommendations, call personal contact list.' },
      { vessel: 'shore', title: 'Ride Along with Crew', notes: 'Use the ride along evaluation template' },
      { vessel: 'squid', title: 'Magnets', notes: 'Foredeck hatches- Need magnets on both sides (hatch and lip) corrosion protected.' },
      { vessel: 'blu-q', title: 'Shore Power', notes: 'shore power cable tested and good', status: 'completed' },
      { vessel: 'cowfish', title: 'Checklist', notes: 'Copy and paste the SQUID waking up and put boat to bed checklist. Adapt it for cowfish.' },
    ];

    let count = 0;
    for (const t of tasks) {
      const id = crypto.randomBytes(10).toString('hex');
      try {
        await pool.query(
          'INSERT INTO assigned_tasks (id, title, vessel, status, notes, source_type, category) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [id, t.title, t.vessel, t.status || 'pending', t.notes, 'manual', 'maintenance']
        );
        count++;
      } catch(e) {
        console.error('Skip:', t.title, e.message.substring(0, 50));
      }
    }
    console.log('Imported', count, 'tasks to production');
  }
}

async function importSchedule() {
  // Schedule data from ICS parse
  const entries = [
    // March 2026
    ['Dan', '2026-03-01'], ['Kristen', '2026-03-01'], ['Jackie', '2026-03-01'], ['Bryan', '2026-03-01'],
    ['Dan', '2026-03-02'], ['Alexa', '2026-03-02'], ['Bryan', '2026-03-02'],
    ['Libbie', '2026-03-03'], ['Hadden', '2026-03-03'], ['Bryan', '2026-03-03'],
    ['Libbie', '2026-03-05'], ['Charlie', '2026-03-05'],
    ['Dan', '2026-03-06'], ['Chase', '2026-03-06'], ['Charlie', '2026-03-06'],
    ['Kristen', '2026-03-09'], ['Alexa', '2026-03-09'], ['Bryan', '2026-03-09'],
    ['Libbie', '2026-03-10'], ['Hadden', '2026-03-10'], ['Bryan', '2026-03-10'],
    ['Dan', '2026-03-13'], ['Chase', '2026-03-13'], ['Jackie', '2026-03-13'], ['Charlie', '2026-03-13'],
    ['Dan', '2026-03-16'], ['Alexa', '2026-03-16'], ['Bryan', '2026-03-16'],
    ['Dan', '2026-03-22'], ['Kristen', '2026-03-22'], ['Jackie', '2026-03-22'], ['Bryan', '2026-03-22'],
    ['Kristen', '2026-03-23'], ['Alexa', '2026-03-23'], ['Bryan', '2026-03-23'],
    // April 2026
    ['Libbie', '2026-04-01'], ['Alexa', '2026-04-01'], ['Charlie', '2026-04-01'], ['Jackie', '2026-04-01'],
    ['Jess', '2026-04-02'], ['Libbie', '2026-04-02'], ['Hadden', '2026-04-02'], ['Charlie', '2026-04-02'],
    ['Chase', '2026-04-04'], ['Libbie', '2026-04-04'], ['Hadden', '2026-04-04'], ['Jackie', '2026-04-04'],
    ['Dan', '2026-04-05'], ['Kristen', '2026-04-05'], ['Jackie', '2026-04-05'], ['Charlie', '2026-04-05'],
  ];

  // Get crew name → id map
  const crewResult = await pool.query('SELECT id, name FROM crew WHERE active = TRUE');
  const crewMap = {};
  for (const cr of crewResult.rows) {
    crewMap[cr.name.toLowerCase()] = cr.id;
  }

  let count = 0;
  for (const [name, date] of entries) {
    const crewId = crewMap[name.toLowerCase()];
    if (!crewId) { console.log('Skip (no crew):', name); continue; }
    const id = crypto.randomBytes(10).toString('hex');
    try {
      await pool.query(
        'INSERT INTO crew_schedule (id, crew_id, schedule_date, shift) VALUES ($1, $2, $3, $4) ON CONFLICT (crew_id, schedule_date) DO UPDATE SET shift = $4',
        [id, crewId, date, 'full']
      );
      count++;
    } catch(e) {
      console.error('Skip:', name, date, e.message.substring(0, 50));
    }
  }
  console.log('Imported', count, 'schedule entries to production');
}

async function main() {
  await importTasks();
  await importSchedule();
  pool.end();
}

main().catch(e => { console.error(e); pool.end(); });
