#!/usr/bin/env node
/**
 * Haldo MCP Server
 *
 * Lets Claude Code query and manage the Haldo database directly.
 * Billy asks "who completed the snorkel checklist this week?" and Claude
 * calls query_completions to get the answer from live data.
 *
 * Run: npx tsx src/mcp-server.ts
 * Configure in Claude Code's MCP settings (see INSTRUCTIONS.md)
 */

import 'dotenv/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import pg from 'pg';
import { nanoid } from 'nanoid';
import { readdir, readFile, writeFile, unlink } from 'fs/promises';
import { join } from 'path';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/haldo',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const TEMPLATES_DIR = join(process.cwd(), 'templates');

const server = new Server(
  { name: 'haldo', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

// ============================================================
// Tool definitions
// ============================================================

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'query_completions',
      description: 'Query checklist and logbook completion records. Filter by vessel, crew, template, date range, type.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          vessel: { type: 'string', description: 'Filter by vessel slug (squid, blu-q, etc.)' },
          crew_id: { type: 'string', description: 'Filter by crew member ID' },
          crew_name: { type: 'string', description: 'Filter by crew member name (partial match)' },
          template_id: { type: 'string', description: 'Filter by template ID' },
          type: { type: 'string', enum: ['checklist', 'logbook'], description: 'Filter by type' },
          from_date: { type: 'string', description: 'Start date (ISO format, e.g. 2026-03-29)' },
          to_date: { type: 'string', description: 'End date (ISO format)' },
          trip_slot: { type: 'string', description: 'Filter by trip slot (AM, PM)' },
          limit: { type: 'number', description: 'Max results (default 50, max 500)' },
        },
      },
    },
    {
      name: 'query_alerts',
      description: 'Query threshold breach alerts. Filter by acknowledged status, vessel, date range.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          acknowledged: { type: 'boolean', description: 'Filter: true=acknowledged, false=unacknowledged' },
          vessel: { type: 'string' },
          from_date: { type: 'string' },
          to_date: { type: 'string' },
          limit: { type: 'number' },
        },
      },
    },
    {
      name: 'query_crew',
      description: 'List crew members. Filter by active status, role, vessel.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          active: { type: 'boolean' },
          role: { type: 'string', enum: ['captain', 'mate'] },
          vessel: { type: 'string' },
        },
      },
    },
    {
      name: 'get_completion_detail',
      description: 'Get full details for a specific completion, including all submitted values and triggered alerts.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          completion_id: { type: 'string', description: 'The completion ID' },
        },
        required: ['completion_id'],
      },
    },
    {
      name: 'add_crew_member',
      description: 'Add a new crew member to the database.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          name: { type: 'string' },
          role: { type: 'string', enum: ['captain', 'mate'] },
          vessel: { type: 'string', description: 'Default vessel (optional)' },
        },
        required: ['name', 'role'],
      },
    },
    {
      name: 'update_crew',
      description: 'Update a crew member (name, role, vessel, active status). Use active=false to deactivate.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          crew_id: { type: 'string' },
          name: { type: 'string' },
          role: { type: 'string', enum: ['captain', 'mate'] },
          vessel: { type: 'string' },
          active: { type: 'boolean' },
        },
        required: ['crew_id'],
      },
    },
    {
      name: 'get_stats',
      description: 'Get summary statistics: completions today, this week, pending alerts, active crew count.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          vessel: { type: 'string', description: 'Filter stats by vessel (optional)' },
        },
      },
    },
    {
      name: 'acknowledge_alerts',
      description: 'Mark alerts as acknowledged so Billy does not need to visit the dashboard.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          alert_ids: { type: 'array', items: { type: 'string' }, description: 'Array of alert IDs to acknowledge' },
          all_before: { type: 'string', description: 'Acknowledge all alerts before this ISO datetime (alternative to alert_ids)' },
        },
      },
    },
    {
      name: 'list_templates',
      description: 'List all checklist and logbook templates with their schedules.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          vessel: { type: 'string' },
          type: { type: 'string', enum: ['checklist', 'logbook'] },
        },
      },
    },
    {
      name: 'create_template',
      description: 'Create a new checklist or logbook template. Provide the full template JSON object.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          template: { type: 'object', description: 'Full template JSON object matching ChecklistTemplate or LogbookTemplate schema' },
        },
        required: ['template'],
      },
    },
    {
      name: 'update_template',
      description: 'Update fields on an existing template. Merges changes into the existing template JSON.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          template_id: { type: 'string' },
          changes: { type: 'object', description: 'Fields to update (merged into existing template)' },
        },
        required: ['template_id', 'changes'],
      },
    },
    {
      name: 'delete_template',
      description: 'Delete a template by ID. Removes the JSON file from /templates/.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          template_id: { type: 'string' },
        },
        required: ['template_id'],
      },
    },
    {
      name: 'preview_schedule',
      description: 'Preview which checklists would appear for a vessel/role over a date range. Shows override logic.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          vessel: { type: 'string' },
          role: { type: 'string', enum: ['captain', 'mate'] },
          date: { type: 'string', description: 'Start date (ISO format)' },
          days: { type: 'number', description: 'Number of days to preview (default 7)' },
        },
        required: ['vessel', 'role', 'date'],
      },
    },
    {
      name: 'run_sql',
      description: 'Run a read-only SQL query against the Haldo database. For ad-hoc data exploration.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'SQL SELECT query to run' },
        },
        required: ['query'],
      },
    },
  ],
}));

// ============================================================
// Tool handlers
// ============================================================

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params as { name: string; arguments?: Record<string, any> };

  try {
    switch (name) {
      case 'query_completions': {
        let query = `SELECT co.*, cr.name as crew_name FROM completions co JOIN crew cr ON co.crew_id = cr.id WHERE 1=1`;
        const params: any[] = [];
        let idx = 1;

        if (args?.vessel) { query += ` AND co.vessel = $${idx++}`; params.push(args.vessel); }
        if (args?.crew_id) { query += ` AND co.crew_id = $${idx++}`; params.push(args.crew_id); }
        if (args?.crew_name) { query += ` AND cr.name ILIKE $${idx++}`; params.push(`%${args.crew_name}%`); }
        if (args?.template_id) { query += ` AND co.template_id = $${idx++}`; params.push(args.template_id); }
        if (args?.type) { query += ` AND co.template_type = $${idx++}`; params.push(args.type); }
        if (args?.from_date) { query += ` AND co.trip_date >= $${idx++}`; params.push(args.from_date); }
        if (args?.to_date) { query += ` AND co.trip_date <= $${idx++}`; params.push(args.to_date); }
        if (args?.trip_slot) { query += ` AND co.trip_slot = $${idx++}`; params.push(args.trip_slot); }

        const limit = Math.min(Number(args?.limit) || 50, 500);
        query += ` ORDER BY co.completed_at DESC LIMIT $${idx++}`;
        params.push(limit);

        const result = await pool.query(query, params);
        return { content: [{ type: 'text', text: JSON.stringify(result.rows, null, 2) }] };
      }

      case 'query_alerts': {
        let query = `SELECT a.*, c.vessel, cr.name as crew_name FROM alerts a JOIN completions c ON a.completion_id = c.id JOIN crew cr ON c.crew_id = cr.id WHERE 1=1`;
        const params: any[] = [];
        let idx = 1;

        if (args?.acknowledged === true) query += ` AND a.acknowledged_at IS NOT NULL`;
        if (args?.acknowledged === false) query += ` AND a.acknowledged_at IS NULL`;
        if (args?.vessel) { query += ` AND c.vessel = $${idx++}`; params.push(args.vessel); }
        if (args?.from_date) { query += ` AND a.created_at >= $${idx++}`; params.push(args.from_date); }
        if (args?.to_date) { query += ` AND a.created_at <= $${idx++}`; params.push(args.to_date); }

        const limit = Math.min(Number(args?.limit) || 50, 500);
        query += ` ORDER BY a.created_at DESC LIMIT $${idx++}`;
        params.push(limit);

        const result = await pool.query(query, params);
        return { content: [{ type: 'text', text: JSON.stringify(result.rows, null, 2) }] };
      }

      case 'query_crew': {
        let query = 'SELECT * FROM crew WHERE 1=1';
        const params: any[] = [];
        let idx = 1;

        if (args?.active === true) query += ' AND active = TRUE';
        if (args?.active === false) query += ' AND active = FALSE';
        if (args?.role) { query += ` AND role = $${idx++}`; params.push(args.role); }
        if (args?.vessel) { query += ` AND vessel = $${idx++}`; params.push(args.vessel); }

        query += ' ORDER BY role, name';
        const result = await pool.query(query, params);
        return { content: [{ type: 'text', text: JSON.stringify(result.rows, null, 2) }] };
      }

      case 'get_completion_detail': {
        const co = await pool.query(
          `SELECT co.*, cr.name as crew_name FROM completions co JOIN crew cr ON co.crew_id = cr.id WHERE co.id = $1`,
          [args?.completion_id]
        );
        if (co.rows.length === 0) return { content: [{ type: 'text', text: 'Completion not found' }] };

        const alerts = await pool.query(
          'SELECT * FROM alerts WHERE completion_id = $1 ORDER BY created_at',
          [args?.completion_id]
        );

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ completion: co.rows[0], alerts: alerts.rows }, null, 2),
          }],
        };
      }

      case 'add_crew_member': {
        const id = nanoid();
        await pool.query(
          'INSERT INTO crew (id, name, role, vessel) VALUES ($1, $2, $3, $4)',
          [id, args?.name, args?.role, args?.vessel || null]
        );
        const result = await pool.query('SELECT * FROM crew WHERE id = $1', [id]);
        return { content: [{ type: 'text', text: JSON.stringify(result.rows[0], null, 2) }] };
      }

      case 'update_crew': {
        const updates: string[] = [];
        const params: any[] = [];
        let idx = 1;

        if (args?.name !== undefined) { updates.push(`name = $${idx++}`); params.push(args.name); }
        if (args?.role !== undefined) { updates.push(`role = $${idx++}`); params.push(args.role); }
        if (args?.vessel !== undefined) { updates.push(`vessel = $${idx++}`); params.push(args.vessel); }
        if (args?.active !== undefined) { updates.push(`active = $${idx++}`); params.push(args.active); }

        if (updates.length === 0) return { content: [{ type: 'text', text: 'No changes specified' }] };

        params.push(args?.crew_id);
        await pool.query(`UPDATE crew SET ${updates.join(', ')} WHERE id = $${idx}`, params);

        const result = await pool.query('SELECT * FROM crew WHERE id = $1', [args?.crew_id]);
        return { content: [{ type: 'text', text: JSON.stringify(result.rows[0], null, 2) }] };
      }

      case 'get_stats': {
        const today = new Date().toISOString().split('T')[0];
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const vesselFilter = args?.vessel ? ` AND vessel = '${args.vessel}'` : '';

        const [todayCount, weekCount, pendingAlerts, crewCount] = await Promise.all([
          pool.query(`SELECT COUNT(*) FROM completions WHERE trip_date = $1${vesselFilter}`, [today]),
          pool.query(`SELECT COUNT(*) FROM completions WHERE trip_date >= $1${vesselFilter}`, [weekAgo]),
          pool.query(`SELECT COUNT(*) FROM alerts WHERE acknowledged_at IS NULL`),
          pool.query(`SELECT COUNT(*) FROM crew WHERE active = TRUE`),
        ]);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              completions_today: parseInt(todayCount.rows[0].count),
              completions_this_week: parseInt(weekCount.rows[0].count),
              alerts_pending: parseInt(pendingAlerts.rows[0].count),
              crew_active_count: parseInt(crewCount.rows[0].count),
            }, null, 2),
          }],
        };
      }

      case 'acknowledge_alerts': {
        let count = 0;
        if (args?.alert_ids?.length) {
          const result = await pool.query(
            `UPDATE alerts SET acknowledged_at = NOW() WHERE id = ANY($1) AND acknowledged_at IS NULL`,
            [args.alert_ids]
          );
          count = result.rowCount || 0;
        } else if (args?.all_before) {
          const result = await pool.query(
            `UPDATE alerts SET acknowledged_at = NOW() WHERE created_at <= $1 AND acknowledged_at IS NULL`,
            [args.all_before]
          );
          count = result.rowCount || 0;
        }
        return { content: [{ type: 'text', text: `Acknowledged ${count} alerts` }] };
      }

      case 'list_templates': {
        const files = await readdir(TEMPLATES_DIR);
        const templates = [];
        for (const file of files.filter(f => f.endsWith('.json'))) {
          const content = await readFile(join(TEMPLATES_DIR, file), 'utf-8');
          const t = JSON.parse(content);
          if (args?.vessel && t.vessel !== args.vessel && t.vessel !== 'all') continue;
          if (args?.type && t.type !== args.type) continue;
          templates.push({
            id: t.id,
            name: t.name,
            type: t.type,
            vessel: t.vessel,
            role: t.role,
            recurrence: t.recurrence,
            trigger_day: t.trigger_day,
            trigger_dates: t.trigger_dates,
            priority: t.priority,
            supersedes: t.supersedes,
            estimated_minutes: t.estimated_minutes,
            version: t.version,
          });
        }
        return { content: [{ type: 'text', text: JSON.stringify(templates, null, 2) }] };
      }

      case 'create_template': {
        const template = args?.template;
        if (!template?.id || !template?.type) {
          return { content: [{ type: 'text', text: 'Error: template must have id and type' }] };
        }
        await writeFile(join(TEMPLATES_DIR, `${template.id}.json`), JSON.stringify(template, null, 2));
        return { content: [{ type: 'text', text: `Template created: ${template.id}` }] };
      }

      case 'update_template': {
        const filePath = join(TEMPLATES_DIR, `${args?.template_id}.json`);
        try {
          const existing = JSON.parse(await readFile(filePath, 'utf-8'));
          const updated = { ...existing, ...args?.changes };
          await writeFile(filePath, JSON.stringify(updated, null, 2));
          return { content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }] };
        } catch {
          return { content: [{ type: 'text', text: `Template not found: ${args?.template_id}` }] };
        }
      }

      case 'delete_template': {
        try {
          await unlink(join(TEMPLATES_DIR, `${args?.template_id}.json`));
          return { content: [{ type: 'text', text: `Deleted: ${args?.template_id}` }] };
        } catch {
          return { content: [{ type: 'text', text: `Template not found: ${args?.template_id}` }] };
        }
      }

      case 'preview_schedule': {
        // Load templates for preview
        const files = await readdir(TEMPLATES_DIR);
        const allTemplates = [];
        for (const file of files.filter(f => f.endsWith('.json'))) {
          allTemplates.push(JSON.parse(await readFile(join(TEMPLATES_DIR, file), 'utf-8')));
        }

        const startDate = new Date(args?.date);
        const days = args?.days || 7;
        const result = [];

        for (let i = 0; i < days; i++) {
          const d = new Date(startDate);
          d.setDate(d.getDate() + i);
          const dayOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][d.getDay()];
          const isoDate = d.toISOString().split('T')[0];

          const dayTemplates = allTemplates.filter(t => {
            if (t.vessel !== 'all' && t.vessel !== args?.vessel) return false;
            if (t.role !== 'all' && t.role !== args?.role) return false;
            if (t.type === 'checklist') {
              if (t.recurrence === 'weekly') return t.trigger_day?.toLowerCase() === dayOfWeek;
              if (t.recurrence === 'daily') return !t.trigger_day || t.trigger_day.toLowerCase() === dayOfWeek;
              if (t.recurrence === 'monthly') return t.trigger_dates?.includes(isoDate);
              if (t.recurrence === 'per-trip') return true;
            }
            if (t.type === 'logbook') return true;
            return false;
          });

          // Apply supersedes
          const superseded = new Set<string>();
          dayTemplates.forEach(t => t.supersedes?.forEach((s: string) => superseded.add(s)));

          result.push({
            date: isoDate,
            day: dayOfWeek,
            templates: dayTemplates.map(t => ({
              id: t.id,
              name: t.name,
              superseded: superseded.has(t.id),
            })).filter(t => !t.superseded || superseded.has(t.id)),
          });
        }

        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'run_sql': {
        const query = String(args?.query || '');
        if (!query.trim().toLowerCase().startsWith('select')) {
          return { content: [{ type: 'text', text: 'Error: only SELECT queries are allowed' }] };
        }
        const result = await pool.query(query);
        return { content: [{ type: 'text', text: JSON.stringify(result.rows, null, 2) }] };
      }

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
    }
  } catch (err: any) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }] };
  }
});

// Start
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[haldo-mcp] Server running on stdio');
}

main().catch(console.error);
