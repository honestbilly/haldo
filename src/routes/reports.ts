// Manager dashboard — thin aggregator mounting sub-routers
import { Hono } from 'hono';
import dashboardRoutes from './report-dashboard.js';
import mgmtRoutes from './report-mgmt.js';
import taskRoutes from './report-tasks.js';

const app = new Hono();

// Mount dashboard (today view, history, alert acknowledge)
app.route('/', dashboardRoutes);

// Mount management (template editor, crew & tokens)
app.route('/', mgmtRoutes);

// Mount task management (task list, inbox, schedule)
app.route('/', taskRoutes);

export default app;
