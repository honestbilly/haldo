// ============================================================
// Template types — the core schema that drives everything.
// Templates are JSON files in /templates/. Claude manages them.
// ============================================================

export interface MediaAttachment {
  type: 'image' | 'video' | 'link';
  url: string;
  caption?: string;
  alt?: string;
}

export interface HelpBox {
  title: string;
  body: string;
}

export interface SopReference {
  title: string;
  steps: string[];
  source: string; // KB reference, e.g. "squid-on-board-binder / §4.1"
}

export interface AlertRule {
  message: string;       // '{value}' gets interpolated
  notify: ('manager')[];
  severity: 'warning' | 'critical';
}

export interface CompletionConfig {
  require_all: boolean;
  sign_off: boolean;
  notes_field: boolean;
  notes_prompt?: string;
}

export interface Item {
  id: string;
  label: string;
  type: 'checkbox' | 'number' | 'select' | 'multi_select' | 'text' | 'photo';
  required?: boolean;
  description_media?: MediaAttachment[];
  // number fields
  min?: number;
  max?: number;
  unit?: string;
  alert_below_min?: AlertRule;
  // select fields
  options?: string[];
  alert_below?: string;
  alert_message?: string;
  // photo fields
  placeholder?: string;
  max_photos?: number;
  // conditional
  info?: string;
  help?: HelpBox;
  sop?: SopReference;
  requires?: string;
}

export interface Section {
  title: string;
  description?: string;
  description_media?: MediaAttachment[];
  items: Item[];
}

export interface LogbookStep {
  step: number;
  title: string;
  captain_only?: boolean;
  items: Item[];
}

// Discriminated union on `type`
export interface ChecklistTemplate {
  id: string;
  name: string;
  type: 'checklist';
  vessel: string;
  role: string;
  recurrence: string;
  trigger_day?: string;
  trigger_dates?: string[];
  priority?: number;
  display_order?: number;
  supersedes?: string[];
  version: string;
  source: string;
  estimated_minutes?: number;
  intro?: string;
  intro_media?: MediaAttachment[];
  sections: Section[];
  completion: CompletionConfig;
}

export interface LogbookTemplate {
  id: string;
  name: string;
  type: 'logbook';
  vessel: string;
  role: string;
  recurrence: 'per-trip';
  display_order?: number;
  version: string;
  source: string;
  estimated_minutes?: number;
  captain_steps?: number[];
  mate_steps?: number[];
  steps: LogbookStep[];
  completion: CompletionConfig;
}

export type Template = ChecklistTemplate | LogbookTemplate;

// ============================================================
// Database row types
// ============================================================

export interface CrewRow {
  id: string;
  name: string;
  role: 'captain' | 'deckhand';
  vessel: string | null;
  active: boolean;
  created_at: Date;
}

export interface CompletionRow {
  id: string;
  template_id: string;
  template_type: 'checklist' | 'logbook';
  vessel: string;
  crew_id: string;
  trip_date: string | null;
  trip_slot: string | null;
  started_at: Date;
  completed_at: Date | null;
  values_json: Record<string, unknown>;
  alerts_json: unknown[] | null;
  notes: string | null;
  signed_off: boolean;
  created_at: Date;
}

export interface AlertRow {
  id: string;
  completion_id: string;
  template_id: string;
  item_id: string;
  item_label: string;
  current_value: string;
  threshold_value: string;
  severity: 'warning' | 'critical';
  message: string;
  notified_at: Date | null;
  acknowledged_at: Date | null;
  created_at: Date;
}

// ============================================================
// Session
// ============================================================

export interface SessionData {
  vessel: string;
  role: 'captain' | 'deckhand';
  crew_id: string;
  crew_name: string;
  trip_date: string;
  trip_slot: string;
  auth_role?: 'crew' | 'manager' | 'admin';
}
