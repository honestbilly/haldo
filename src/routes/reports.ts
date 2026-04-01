// Manager dashboard — thin aggregator mounting sub-routers
// Auth-gated: requires manager or admin role
import { Hono } from 'hono';
import { getAuth } from './auth.js';
import { getSession } from './session.js';
import dashboardRoutes from './report-dashboard.js';
import mgmtRoutes from './report-mgmt.js';
import taskRoutes from './report-tasks.js';
import libraryRoutes from './report-library.js';
import vesselRoutes from './report-vessels.js';
import scheduleRoutes from './report-schedule.js';
import logRoutes from './report-logs.js';

const app = new Hono();

// Auth gate: only manager and admin can access /report/*
app.use('/report/*', async (c, next) => {
  const auth = getAuth(c as any);
  const session = getSession(c as any);

  // Check auth cookie for manager/admin role
  const authRole = auth?.auth_role || session?.auth_role;

  if (authRole === 'manager' || authRole === 'admin') {
    await next();
    return;
  }

  // In dev mode (no REQUIRE_AUTH env), allow access
  if (!process.env.REQUIRE_AUTH) {
    await next();
    return;
  }

  // Unauthorized — show access denied
  return c.html(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Access Denied — Haldo</title>
    <link rel="stylesheet" href="/public/style.css">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap">
    </head><body style="background:#F2F2F7">
    <div style="max-width:480px;margin:0 auto;padding:80px 24px;text-align:center">
      <span class="material-symbols-outlined" style="font-size:48px;color:#FF3B30">lock</span>
      <h1 style="font-family:'Manrope',sans-serif;font-size:1.5rem;font-weight:800;color:#1a1c1e;margin-top:16px">Manager Access Required</h1>
      <p style="color:#8E8E93;margin-top:8px">This section is only available to managers and admins.</p>
      <a href="/today" style="display:inline-block;margin-top:24px;color:#1A6B8A;font-weight:600;text-decoration:none">← Back to Home</a>
    </div></body></html>`, 403);
});

// Also gate the bare /report route
app.use('/report', async (c, next) => {
  const auth = getAuth(c as any);
  const session = getSession(c as any);
  const authRole = auth?.auth_role || session?.auth_role;
  if (authRole === 'manager' || authRole === 'admin' || !process.env.REQUIRE_AUTH) {
    await next();
    return;
  }
  return c.redirect('/today');
});

// Mount dashboard (today view, history, alert acknowledge)
app.route('/', dashboardRoutes);

// Mount management (template editor, crew & tokens)
app.route('/', mgmtRoutes);

// Mount task management (task list, inbox, schedule)
app.route('/', taskRoutes);

// Mount repeated task library (view, build, edit)
app.route('/', libraryRoutes);

// Mount vessel management
app.route('/', vesselRoutes);

// Mount crew schedule
app.route('/', scheduleRoutes);

// Mount completed logs viewer
app.route('/', logRoutes);

export default app;
