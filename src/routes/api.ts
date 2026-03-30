import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import pool from '../db.js';

const app = new Hono();

// List completions (JSON API)
app.get('/completions', async (c) => {
  const vessel = c.req.query('vessel');
  const crewId = c.req.query('crew_id');
  const templateId = c.req.query('template_id');
  const type = c.req.query('type');
  const from = c.req.query('from');
  const to = c.req.query('to');
  const limit = Math.min(Number(c.req.query('limit')) || 50, 500);

  let query = `
    SELECT co.*, cr.name as crew_name
    FROM completions co
    JOIN crew cr ON co.crew_id = cr.id
    WHERE 1=1`;
  const params: any[] = [];
  let idx = 1;

  if (vessel) { query += ` AND co.vessel = $${idx++}`; params.push(vessel); }
  if (crewId) { query += ` AND co.crew_id = $${idx++}`; params.push(crewId); }
  if (templateId) { query += ` AND co.template_id = $${idx++}`; params.push(templateId); }
  if (type) { query += ` AND co.template_type = $${idx++}`; params.push(type); }
  if (from) { query += ` AND co.trip_date >= $${idx++}`; params.push(from); }
  if (to) { query += ` AND co.trip_date <= $${idx++}`; params.push(to); }

  query += ` ORDER BY co.completed_at DESC LIMIT $${idx++}`;
  params.push(limit);

  const result = await pool.query(query, params);
  return c.json(result.rows);
});

// List alerts (JSON API)
app.get('/alerts', async (c) => {
  const acknowledged = c.req.query('acknowledged');
  const vessel = c.req.query('vessel');
  const from = c.req.query('from');
  const to = c.req.query('to');
  const limit = Math.min(Number(c.req.query('limit')) || 50, 500);

  let query = `
    SELECT a.*, c.vessel, cr.name as crew_name
    FROM alerts a
    JOIN completions c ON a.completion_id = c.id
    JOIN crew cr ON c.crew_id = cr.id
    WHERE 1=1`;
  const params: any[] = [];
  let idx = 1;

  if (acknowledged === 'true') { query += ` AND a.acknowledged_at IS NOT NULL`; }
  if (acknowledged === 'false') { query += ` AND a.acknowledged_at IS NULL`; }
  if (vessel) { query += ` AND c.vessel = $${idx++}`; params.push(vessel); }
  if (from) { query += ` AND a.created_at >= $${idx++}`; params.push(from); }
  if (to) { query += ` AND a.created_at <= $${idx++}`; params.push(to); }

  query += ` ORDER BY a.created_at DESC LIMIT $${idx++}`;
  params.push(limit);

  const result = await pool.query(query, params);
  return c.json(result.rows);
});

// Crew management
app.get('/crew', async (c) => {
  const active = c.req.query('active');
  const role = c.req.query('role');
  const vessel = c.req.query('vessel');

  let query = 'SELECT * FROM crew WHERE 1=1';
  const params: any[] = [];
  let idx = 1;

  if (active === 'true') { query += ' AND active = TRUE'; }
  if (active === 'false') { query += ' AND active = FALSE'; }
  if (role) { query += ` AND role = $${idx++}`; params.push(role); }
  if (vessel) { query += ` AND vessel = $${idx++}`; params.push(vessel); }

  query += ' ORDER BY role, name';
  const result = await pool.query(query, params);
  return c.json(result.rows);
});

app.post('/crew', async (c) => {
  const body = await c.req.json();
  const id = nanoid();
  const { name, role, vessel } = body;

  if (!name || !role) {
    return c.json({ error: 'name and role are required' }, 400);
  }

  await pool.query(
    'INSERT INTO crew (id, name, role, vessel) VALUES ($1, $2, $3, $4)',
    [id, name, role, vessel || null]
  );

  const result = await pool.query('SELECT * FROM crew WHERE id = $1', [id]);
  return c.json(result.rows[0], 201);
});

export default app;
