import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { initDatabase } from './db.js';
import { loadTemplates } from './services/templates.js';
import sessionRoutes from './routes/session.js';
import logRoutes from './routes/log.js';
import todayRoutes from './routes/today.js';
import checklistRoutes from './routes/checklist.js';
import reportRoutes from './routes/reports.js';
import apiRoutes from './routes/api.js';
import handoffRoutes from './routes/handoff.js';
import submitRoutes from './routes/submit.js';
import moreRoutes from './routes/more.js';
import authRoutes from './routes/auth.js';
import taskCrewRoutes from './routes/tasks.js';
import weatherRoutes from './routes/weather.js';
import { refreshWeather } from './services/weather/weather-cache.js';

const app = new Hono();

// Static files
app.use('/public/*', serveStatic({ root: './' }));
app.use('/uploads/*', serveStatic({ root: './' }));

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', uptime: process.uptime() });
});

// Mount routes
app.route('/', sessionRoutes);
app.route('/', logRoutes);
app.route('/', todayRoutes);
app.route('/', checklistRoutes);
app.route('/', reportRoutes);
app.route('/api', apiRoutes);
app.route('/handoff', handoffRoutes);
app.route('/submit', submitRoutes);
app.route('/more', moreRoutes);
app.route('/login', authRoutes);
app.route('/', weatherRoutes);
app.route('/tasks', taskCrewRoutes);

// Startup
async function start() {
  console.log(`[haldo] Starting...`);

  // Initialize database
  await initDatabase();

  // Load templates
  await loadTemplates();

  // Pre-fetch weather data (fire-and-forget)
  refreshWeather().catch(err => console.error('[haldo] Weather pre-fetch failed:', err));

  // Start server
  const port = Number(process.env.PORT) || 3000;
  serve({ fetch: app.fetch, port });
  console.log(`[haldo] Running on http://localhost:${port}`);
}

start().catch(err => {
  console.error('[haldo] Failed to start:', err);
  process.exit(1);
});

export default app;
