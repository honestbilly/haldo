import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { initDatabase } from './db.js';
import { loadTemplates } from './services/templates.js';
import sessionRoutes from './routes/session.js';
import formRoutes from './routes/forms.js';
import reportRoutes from './routes/reports.js';
import apiRoutes from './routes/api.js';

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
app.route('/', formRoutes);
app.route('/', reportRoutes);
app.route('/api', apiRoutes);

// Startup
async function start() {
  console.log(`[haldo] Starting...`);

  // Initialize database
  await initDatabase();

  // Load templates
  await loadTemplates();

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
