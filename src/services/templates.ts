import { readdir, readFile, writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import type { Template, ChecklistTemplate, LogbookTemplate } from '../types.js';

const TEMPLATES_DIR = join(process.cwd(), 'templates');

let cachedTemplates: Template[] = [];

// Load all templates from disk
export async function loadTemplates(): Promise<Template[]> {
  const files = await readdir(TEMPLATES_DIR);
  const jsonFiles = files.filter(f => f.endsWith('.json'));

  const templates: Template[] = [];

  for (const file of jsonFiles) {
    try {
      const content = await readFile(join(TEMPLATES_DIR, file), 'utf-8');
      const parsed = JSON.parse(content) as Template;

      // Basic validation
      if (!parsed.id || !parsed.name || !parsed.type || !parsed.vessel || !parsed.role) {
        console.warn(`[templates] Invalid template ${file}: missing required fields`);
        continue;
      }

      if (parsed.type !== 'checklist' && parsed.type !== 'logbook') {
        console.warn(`[templates] Invalid template ${file}: unknown type "${(parsed as any).type}"`);
        continue;
      }

      templates.push(parsed);
    } catch (err) {
      console.warn(`[templates] Failed to load ${file}:`, err);
    }
  }

  cachedTemplates = templates;
  console.log(`[templates] Loaded ${templates.length} templates`);
  return templates;
}

// Get cached templates (call loadTemplates first)
export function getAllTemplates(): Template[] {
  return cachedTemplates;
}

// Get a single template by ID
export function getTemplateById(id: string): Template | undefined {
  return cachedTemplates.find(t => t.id === id);
}

// Get templates that are due today for a given context
export function getTemplatesForContext(
  vessel: string,
  role: string,
  date: Date
): Template[] {
  const dayOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][date.getDay()];
  const isoDate = date.toISOString().split('T')[0]; // e.g., '2026-03-30'

  // Step 1: Collect all candidates matching vessel + role
  const candidates = cachedTemplates.filter(t => {
    // Vessel match
    if (t.vessel !== 'all' && t.vessel !== vessel) return false;

    // Role match
    if (t.role !== 'all' && t.role !== role) return false;

    // Recurrence match
    if (t.type === 'checklist') {
      const ct = t as ChecklistTemplate;
      switch (ct.recurrence) {
        case 'daily':
          // Daily tasks with trigger_day only show on that day
          if (ct.trigger_day && ct.trigger_day.toLowerCase() !== dayOfWeek) return false;
          return true;
        case 'weekly':
          return ct.trigger_day?.toLowerCase() === dayOfWeek;
        case 'monthly':
          return ct.trigger_dates?.includes(isoDate) ?? false;
        case 'per-trip':
          return true; // Always available
        case 'one-time':
          return ct.trigger_dates?.includes(isoDate) ?? false;
        default:
          return true;
      }
    }

    // Logbooks are always available (per-trip)
    if (t.type === 'logbook') return true;

    return false;
  });

  // Step 2: Apply supersedes logic
  const superseded = new Set<string>();
  for (const t of candidates) {
    if (t.type === 'checklist') {
      const ct = t as ChecklistTemplate;
      if (ct.supersedes) {
        for (const sid of ct.supersedes) {
          // Only supersede if the superseding template is actually in candidates
          superseded.add(sid);
        }
      }
    }
  }

  const filtered = candidates.filter(t => !superseded.has(t.id));

  // Step 3: Sort by display_order (lower first), then by priority (higher first), then by name
  return filtered.sort((a, b) => {
    const da = (a as any).display_order ?? 999;
    const db = (b as any).display_order ?? 999;
    if (da !== db) return da - db;
    const pa = (a.type === 'checklist' ? (a as ChecklistTemplate).priority : 0) ?? 0;
    const pb = (b.type === 'checklist' ? (b as ChecklistTemplate).priority : 0) ?? 0;
    if (pb !== pa) return pb - pa;
    return a.name.localeCompare(b.name);
  });
}

// Preview schedule for a date range (MCP tool)
export function previewSchedule(
  vessel: string,
  role: string,
  startDate: Date,
  days: number
): Array<{ date: string; templates: Array<{ id: string; name: string; type: string; superseded: boolean }> }> {
  const result = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().split('T')[0];
    const active = getTemplatesForContext(vessel, role, d);
    const allCandidates = cachedTemplates.filter(t =>
      (t.vessel === 'all' || t.vessel === vessel) &&
      (t.role === 'all' || t.role === role)
    );
    result.push({
      date: dateStr,
      templates: allCandidates.map(t => ({
        id: t.id,
        name: t.name,
        type: t.type,
        superseded: !active.find(a => a.id === t.id) && allCandidates.includes(t),
      })).filter(t => active.find(a => a.id === t.id) || t.superseded),
    });
  }
  return result;
}

// Write a template to disk (MCP tool: create/update)
export async function saveTemplate(template: Template): Promise<void> {
  const filePath = join(TEMPLATES_DIR, `${template.id}.json`);
  await writeFile(filePath, JSON.stringify(template, null, 2), 'utf-8');
  // Reload cache
  await loadTemplates();
}

// Delete a template from disk (MCP tool)
export async function deleteTemplate(templateId: string): Promise<boolean> {
  const filePath = join(TEMPLATES_DIR, `${templateId}.json`);
  try {
    await unlink(filePath);
    await loadTemplates();
    return true;
  } catch {
    return false;
  }
}
