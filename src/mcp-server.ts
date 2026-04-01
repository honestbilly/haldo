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
          role: { type: 'string', enum: ['captain', 'deckhand'] },
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
          role: { type: 'string', enum: ['captain', 'deckhand'] },
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
          role: { type: 'string', enum: ['captain', 'deckhand'] },
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
          role: { type: 'string', enum: ['captain', 'deckhand'] },
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
    // ── MAINTENANCE TRACKER MCP TOOLS ──
    {
      name: 'query_tasks',
      description: 'Query maintenance tasks/work orders. Filter by status, vessel, category, tags, assignee, priority, parent. Returns tasks with assignee names.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          status: { type: 'string', description: 'Filter: pending, in-progress, completed, cancelled, blocked, snoozed' },
          vessel: { type: 'string', description: 'Filter by vessel slug' },
          category: { type: 'string', description: 'Filter: maintenance, repair, inspection, cleaning, safety, regulatory, upgrade, cosmetic, general' },
          tag: { type: 'string', description: 'Filter by tag (exact match in tags array)' },
          assigned_to: { type: 'string', description: 'Filter by crew ID assigned to' },
          priority: { type: 'string', description: 'Filter: low, medium, high, urgent' },
          parent_task_id: { type: 'string', description: 'Get children of a parent task' },
          include_completed: { type: 'boolean', description: 'Include completed/cancelled tasks (default: false)' },
          limit: { type: 'number', description: 'Max results (default 50)' },
        },
      },
    },
    {
      name: 'get_task',
      description: 'Get a single task with full details, children, and comments.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          task_id: { type: 'string', description: 'Task ID' },
        },
        required: ['task_id'],
      },
    },
    {
      name: 'create_task',
      description: 'Create a new maintenance task/work order with all fields.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          title: { type: 'string', description: 'Task title (required)' },
          description: { type: 'string', description: 'Detailed description' },
          vessel: { type: 'string', description: 'Vessel slug or "shore"/"yard"/"office"' },
          assigned_to: { type: 'string', description: 'Crew ID to assign to' },
          priority: { type: 'string', description: 'low, medium, high, urgent' },
          category: { type: 'string', description: 'maintenance, repair, inspection, etc.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags array' },
          due_date: { type: 'string', description: 'Due date (ISO)' },
          estimated_minutes: { type: 'number', description: 'Estimated time in minutes' },
          notes: { type: 'string', description: 'Notes (warranty, vendor, instructions)' },
          parent_task_id: { type: 'string', description: 'Parent task ID for subtasks' },
          skill_level: { type: 'string', description: 'any, deckhand, captain, mechanic, specialist' },
          location: { type: 'string', description: 'Specific location (engine room, dock, etc.)' },
          source_type: { type: 'string', description: 'manual, submission, logbook, checklist, ai, recurring, telegram' },
          source_id: { type: 'string', description: 'Source record ID' },
        },
        required: ['title'],
      },
    },
    {
      name: 'update_task',
      description: 'Update any field on a task. Only provide the fields you want to change.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          task_id: { type: 'string', description: 'Task ID (required)' },
          title: { type: 'string' }, description: { type: 'string' },
          status: { type: 'string' }, priority: { type: 'string' },
          vessel: { type: 'string' }, assigned_to: { type: 'string' },
          category: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } },
          due_date: { type: 'string' }, notes: { type: 'string' },
          estimated_minutes: { type: 'number' }, actual_minutes: { type: 'number' },
          skill_level: { type: 'string' }, location: { type: 'string' },
          snoozed_until: { type: 'string' },
        },
        required: ['task_id'],
      },
    },
    {
      name: 'add_task_comment',
      description: 'Add a comment/note to a task thread.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          task_id: { type: 'string', description: 'Task ID' },
          comment: { type: 'string', description: 'Comment text' },
          author_name: { type: 'string', description: 'Who is commenting (default: "AI")' },
        },
        required: ['task_id', 'comment'],
      },
    },
    {
      name: 'create_subtask',
      description: 'Create a child task under a parent task.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          parent_task_id: { type: 'string', description: 'Parent task ID' },
          title: { type: 'string', description: 'Subtask title' },
          description: { type: 'string' },
          assigned_to: { type: 'string' },
          priority: { type: 'string' },
          estimated_minutes: { type: 'number' },
        },
        required: ['parent_task_id', 'title'],
      },
    },
    {
      name: 'merge_tasks',
      description: 'Merge task B into task A. A absorbs B notes/comments. B is cancelled with merged_into_id = A.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          primary_task_id: { type: 'string', description: 'Task A — the one that stays' },
          secondary_task_id: { type: 'string', description: 'Task B — merged into A, then cancelled' },
        },
        required: ['primary_task_id', 'secondary_task_id'],
      },
    },
    {
      name: 'query_submissions',
      description: 'Query crew-submitted issues/feedback. Filter by status, category, vessel.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          status: { type: 'string', description: 'new, reviewed, in-progress, resolved' },
          category: { type: 'string', description: 'maintenance, suggestion, safety, etc.' },
          vessel: { type: 'string' },
          limit: { type: 'number' },
        },
      },
    },
    {
      name: 'convert_submission',
      description: 'Convert a crew submission into a maintenance task.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          submission_id: { type: 'string', description: 'Submission ID to convert' },
          priority: { type: 'string', description: 'Task priority (default: medium)' },
          category: { type: 'string', description: 'Task category' },
          tags: { type: 'array', items: { type: 'string' } },
          assigned_to: { type: 'string' },
          notes: { type: 'string', description: 'Additional manager notes' },
        },
        required: ['submission_id'],
      },
    },
    {
      name: 'get_task_stats',
      description: 'Get task statistics: completion rate, overdue count, avg time, by vessel, crew leaderboard.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          from_date: { type: 'string', description: 'Start date for stats period' },
          to_date: { type: 'string', description: 'End date for stats period' },
          vessel: { type: 'string', description: 'Filter by vessel' },
        },
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

      // ── MAINTENANCE TRACKER HANDLERS ──

      case 'query_tasks': {
        let q = `SELECT t.*, ca.name as assignee_name, cb.name as completed_by_name,
          (SELECT COUNT(*) FROM assigned_tasks c WHERE c.parent_task_id = t.id) as child_count
          FROM assigned_tasks t
          LEFT JOIN crew ca ON t.assigned_to = ca.id
          LEFT JOIN crew cb ON t.completed_by = cb.id WHERE 1=1`;
        const p: any[] = []; let pi = 1;
        if (args?.status) { q += ` AND t.status = $${pi++}`; p.push(args.status); }
        else if (!args?.include_completed) { q += ` AND t.status NOT IN ('completed','cancelled')`; }
        if (args?.vessel) { q += ` AND t.vessel = $${pi++}`; p.push(args.vessel); }
        if (args?.category) { q += ` AND t.category = $${pi++}`; p.push(args.category); }
        if (args?.tag) { q += ` AND $${pi++} = ANY(t.tags)`; p.push(args.tag); }
        if (args?.assigned_to) { q += ` AND t.assigned_to = $${pi++}`; p.push(args.assigned_to); }
        if (args?.priority) { q += ` AND t.priority = $${pi++}`; p.push(args.priority); }
        if (args?.parent_task_id) { q += ` AND t.parent_task_id = $${pi++}`; p.push(args.parent_task_id); }
        q += ` ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, t.created_at DESC`;
        q += ` LIMIT ${Math.min(Number(args?.limit) || 50, 500)}`;
        const tasks = await pool.query(q, p);
        return { content: [{ type: 'text', text: JSON.stringify(tasks.rows, null, 2) }] };
      }

      case 'get_task': {
        const task = await pool.query(
          `SELECT t.*, ca.name as assignee_name FROM assigned_tasks t LEFT JOIN crew ca ON t.assigned_to = ca.id WHERE t.id = $1`,
          [args?.task_id]
        );
        if (task.rows.length === 0) return { content: [{ type: 'text', text: 'Task not found' }] };
        const children = await pool.query(`SELECT id, title, status, priority FROM assigned_tasks WHERE parent_task_id = $1`, [args?.task_id]);
        const comments = await pool.query(`SELECT * FROM task_comments WHERE task_id = $1 ORDER BY created_at ASC`, [args?.task_id]);
        const merged = await pool.query(`SELECT id, title FROM assigned_tasks WHERE merged_into_id = $1`, [args?.task_id]);
        return { content: [{ type: 'text', text: JSON.stringify({ ...task.rows[0], children: children.rows, comments: comments.rows, merged_from: merged.rows }, null, 2) }] };
      }

      case 'create_task': {
        const id = nanoid();
        const tags = args?.tags || [];
        await pool.query(
          `INSERT INTO assigned_tasks (id, title, description, vessel, assigned_to, assigned_by, priority, category, tags, due_date, estimated_minutes, notes, parent_task_id, skill_level, location, source_type, source_id, status)
           VALUES ($1,$2,$3,$4,$5,'ai',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'pending')`,
          [id, args?.title, args?.description||null, args?.vessel||null, args?.assigned_to||null,
           args?.priority||'medium', args?.category||'general', tags,
           args?.due_date||null, args?.estimated_minutes||null, args?.notes||null,
           args?.parent_task_id||null, args?.skill_level||'any', args?.location||null,
           args?.source_type||'ai', args?.source_id||null]
        );
        return { content: [{ type: 'text', text: JSON.stringify({ id, title: args?.title, status: 'pending' }) }] };
      }

      case 'update_task': {
        const fields: string[] = []; const vals: any[] = []; let idx = 1;
        const updatable = ['title','description','status','priority','vessel','assigned_to','category','due_date','notes','estimated_minutes','actual_minutes','skill_level','location','snoozed_until'];
        for (const f of updatable) {
          if (args?.[f] !== undefined) { fields.push(`${f} = $${idx++}`); vals.push(args[f]); }
        }
        if (args?.tags) { fields.push(`tags = $${idx++}`); vals.push(args.tags); }
        if (args?.status === 'completed') { fields.push(`completed_at = NOW()`); }
        if (args?.status === 'in-progress' && !args?.started_at) { fields.push(`started_at = NOW()`); }
        fields.push('updated_at = NOW()');
        vals.push(args?.task_id);
        await pool.query(`UPDATE assigned_tasks SET ${fields.join(', ')} WHERE id = $${idx}`, vals);
        return { content: [{ type: 'text', text: `Task ${args?.task_id} updated` }] };
      }

      case 'add_task_comment': {
        const cid = nanoid();
        await pool.query(
          `INSERT INTO task_comments (id, task_id, author_name, comment) VALUES ($1,$2,$3,$4)`,
          [cid, args?.task_id, args?.author_name || 'AI', args?.comment]
        );
        return { content: [{ type: 'text', text: JSON.stringify({ id: cid, task_id: args?.task_id }) }] };
      }

      case 'create_subtask': {
        const sid = nanoid();
        await pool.query(
          `INSERT INTO assigned_tasks (id, title, description, parent_task_id, assigned_to, priority, estimated_minutes, status, source_type, assigned_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'pending','ai','ai')`,
          [sid, args?.title, args?.description||null, args?.parent_task_id, args?.assigned_to||null, args?.priority||'medium', args?.estimated_minutes||null]
        );
        // Copy vessel/category/tags from parent
        await pool.query(
          `UPDATE assigned_tasks SET vessel = p.vessel, category = p.category, tags = p.tags
           FROM assigned_tasks p WHERE assigned_tasks.id = $1 AND p.id = $2`,
          [sid, args?.parent_task_id]
        );
        return { content: [{ type: 'text', text: JSON.stringify({ id: sid, parent_task_id: args?.parent_task_id }) }] };
      }

      case 'merge_tasks': {
        const primary = args?.primary_task_id;
        const secondary = args?.secondary_task_id;
        // Append secondary notes to primary
        const secTask = await pool.query('SELECT title, notes FROM assigned_tasks WHERE id = $1', [secondary]);
        if (secTask.rows[0]?.notes) {
          await pool.query(`UPDATE assigned_tasks SET notes = COALESCE(notes,'') || E'\n\n--- Merged from: ' || $2 || E' ---\n' || $3, updated_at = NOW() WHERE id = $1`,
            [primary, secTask.rows[0].title, secTask.rows[0].notes]);
        }
        // Move comments from secondary to primary
        await pool.query('UPDATE task_comments SET task_id = $1 WHERE task_id = $2', [primary, secondary]);
        // Mark secondary as merged
        await pool.query(`UPDATE assigned_tasks SET status = 'cancelled', merged_into_id = $1, updated_at = NOW() WHERE id = $2`, [primary, secondary]);
        return { content: [{ type: 'text', text: `Merged ${secondary} into ${primary}` }] };
      }

      case 'query_submissions': {
        let sq = `SELECT s.*, cr.name as crew_name FROM submissions s JOIN crew cr ON s.crew_id = cr.id WHERE 1=1`;
        const sp: any[] = []; let spi = 1;
        if (args?.status) { sq += ` AND s.status = $${spi++}`; sp.push(args.status); }
        if (args?.category) { sq += ` AND s.category = $${spi++}`; sp.push(args.category); }
        if (args?.vessel) { sq += ` AND s.vessel = $${spi++}`; sp.push(args.vessel); }
        sq += ` ORDER BY s.created_at DESC LIMIT ${Math.min(Number(args?.limit) || 50, 500)}`;
        const subs = await pool.query(sq, sp);
        return { content: [{ type: 'text', text: JSON.stringify(subs.rows, null, 2) }] };
      }

      case 'convert_submission': {
        const sub = await pool.query('SELECT * FROM submissions WHERE id = $1', [args?.submission_id]);
        if (sub.rows.length === 0) return { content: [{ type: 'text', text: 'Submission not found' }] };
        const s = sub.rows[0];
        const tid = nanoid();
        await pool.query(
          `INSERT INTO assigned_tasks (id, title, description, vessel, priority, category, tags, source_type, source_id, source_submission_id, notes, assigned_to, assigned_by, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'submission',$8,$8,$9,$10,'ai','pending')`,
          [tid, s.title, s.details, s.vessel, args?.priority||'medium', args?.category||s.category||'maintenance',
           args?.tags||[], args?.submission_id, args?.notes||null, args?.assigned_to||null]
        );
        await pool.query(`UPDATE submissions SET status = 'in-progress', updated_at = NOW() WHERE id = $1`, [args?.submission_id]);
        return { content: [{ type: 'text', text: JSON.stringify({ task_id: tid, submission_id: args?.submission_id }) }] };
      }

      case 'get_task_stats': {
        const from = args?.from_date || new Date(Date.now() - 30*24*60*60*1000).toISOString().split('T')[0];
        const to = args?.to_date || new Date().toISOString().split('T')[0];
        let vesselFilter = '';
        const statsParams: any[] = [from, to];
        if (args?.vessel) { vesselFilter = ' AND vessel = $3'; statsParams.push(args.vessel); }

        const total = await pool.query(`SELECT COUNT(*) FROM assigned_tasks WHERE created_at >= $1 AND created_at <= $2${vesselFilter}`, statsParams);
        const completed = await pool.query(`SELECT COUNT(*) FROM assigned_tasks WHERE status = 'completed' AND completed_at >= $1 AND completed_at <= $2${vesselFilter}`, statsParams);
        const overdue = await pool.query(`SELECT COUNT(*) FROM assigned_tasks WHERE due_date < CURRENT_DATE AND status NOT IN ('completed','cancelled','snoozed')${vesselFilter ? ' AND vessel = $1' : ''}`, args?.vessel ? [args.vessel] : []);
        const avgTime = await pool.query(`SELECT AVG(actual_minutes) as avg_minutes FROM assigned_tasks WHERE status = 'completed' AND actual_minutes IS NOT NULL AND completed_at >= $1 AND completed_at <= $2${vesselFilter}`, statsParams);

        // Crew leaderboard
        const leaderboard = await pool.query(
          `SELECT cr.name, COUNT(*) as tasks_completed, SUM(t.actual_minutes) as total_minutes
           FROM assigned_tasks t JOIN crew cr ON t.completed_by = cr.id
           WHERE t.status = 'completed' AND t.completed_at >= $1 AND t.completed_at <= $2${vesselFilter}
           GROUP BY cr.name ORDER BY tasks_completed DESC LIMIT 10`, statsParams
        );

        // By vessel
        const byVessel = await pool.query(
          `SELECT vessel, status, COUNT(*) as count FROM assigned_tasks WHERE created_at >= $1 AND created_at <= $2 GROUP BY vessel, status ORDER BY vessel`, [from, to]
        );

        return { content: [{ type: 'text', text: JSON.stringify({
          period: { from, to },
          total: parseInt(total.rows[0].count),
          completed: parseInt(completed.rows[0].count),
          overdue: parseInt(overdue.rows[0].count),
          avg_minutes: avgTime.rows[0]?.avg_minutes ? Math.round(parseFloat(avgTime.rows[0].avg_minutes)) : null,
          completion_rate: total.rows[0].count > 0 ? Math.round(completed.rows[0].count / total.rows[0].count * 100) : 0,
          leaderboard: leaderboard.rows,
          by_vessel: byVessel.rows,
        }, null, 2) }] };
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
