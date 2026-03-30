import { nanoid } from 'nanoid';
import pool from '../db.js';
import { sendAlertEmail } from './email.js';
import type { Template, ChecklistTemplate, Item, AlertRow } from '../types.js';

interface TriggeredAlert {
  item_id: string;
  item_label: string;
  current_value: string;
  threshold_value: string;
  severity: 'warning' | 'critical';
  message: string;
}

// Evaluate all items in a template against submitted values
export function evaluateAlerts(
  template: Template,
  values: Record<string, unknown>
): TriggeredAlert[] {
  const alerts: TriggeredAlert[] = [];

  // Collect all items from sections (checklist) or steps (logbook)
  const items: Item[] = [];
  if (template.type === 'checklist') {
    for (const section of template.sections) {
      items.push(...section.items);
    }
  } else {
    for (const step of template.steps) {
      items.push(...step.items);
    }
  }

  for (const item of items) {
    const value = values[item.id];
    if (value === undefined || value === null || value === '') continue;

    // Number items: check alert_below_min
    if (item.type === 'number' && item.alert_below_min && item.min !== undefined) {
      const numValue = Number(value);
      if (!isNaN(numValue) && numValue < item.min) {
        const message = item.alert_below_min.message.replace('{value}', String(numValue));
        alerts.push({
          item_id: item.id,
          item_label: item.label,
          current_value: String(numValue),
          threshold_value: String(item.min),
          severity: item.alert_below_min.severity,
          message,
        });
      }
    }

    // Select items: check alert_below
    if (item.type === 'select' && item.alert_below && item.options) {
      const selectedValue = String(value);
      const selectedIndex = item.options.findIndex(
        o => o.toLowerCase() === selectedValue.toLowerCase()
      );
      const thresholdIndex = item.options.findIndex(
        o => o.toLowerCase() === item.alert_below!.toLowerCase()
      );

      if (selectedIndex !== -1 && thresholdIndex !== -1 && selectedIndex < thresholdIndex) {
        const message = item.alert_message
          || `${item.label} is at ${selectedValue}. Restock.`;
        alerts.push({
          item_id: item.id,
          item_label: item.label,
          current_value: selectedValue,
          threshold_value: item.alert_below,
          severity: 'warning',
          message,
        });
      }
    }
  }

  return alerts;
}

// Save alerts to database and trigger email
export async function processAlerts(
  completionId: string,
  templateId: string,
  alerts: TriggeredAlert[],
  context: { vessel: string; crewName: string; templateName: string }
): Promise<AlertRow[]> {
  if (alerts.length === 0) return [];

  const rows: AlertRow[] = [];
  const client = await pool.connect();
  try {
    for (const alert of alerts) {
      const id = nanoid();
      await client.query(
        `INSERT INTO alerts (id, completion_id, template_id, item_id, item_label,
         current_value, threshold_value, severity, message)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, completionId, templateId, alert.item_id, alert.item_label,
         alert.current_value, alert.threshold_value, alert.severity, alert.message]
      );
      rows.push({
        id,
        completion_id: completionId,
        template_id: templateId,
        ...alert,
        notified_at: null,
        acknowledged_at: null,
        created_at: new Date(),
      });
    }
  } finally {
    client.release();
  }

  // Send email notification (async, don't block response)
  sendAlertEmail(alerts, context).catch(err => {
    console.error('[alerts] Email failed:', err);
  });

  return rows;
}
