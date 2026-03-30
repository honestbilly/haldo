// Shared UI components for Haldo
// Reference: docs/modules/gizmo/haldo-navigation.md

/**
 * Persistent bottom navigation bar for all crew pages.
 * @param active - which tab is currently active: 'tasks' | 'notes' | 'feedback' | 'more'
 * @param handoffCount - number of unresolved handoff notes (for badge)
 */
export function bottomNav(active: string, handoffCount: number = 0): string {
  const tabs = [
    { id: 'tasks', label: 'Tasks', icon: '📋', href: '/today' },
    { id: 'notes', label: 'Notes', icon: '📝', href: '/handoff', badge: handoffCount },
    { id: 'feedback', label: 'Feedback', icon: '💬', href: '/feedback' },
    { id: 'more', label: 'More', icon: '⚙️', href: '/more' },
  ];

  const tabsHtml = tabs.map(t => {
    const isActive = t.id === active;
    const badge = t.badge && t.badge > 0 ? `<span class="nav-badge">${t.badge}</span>` : '';
    return `
      <a href="${t.href}" class="nav-tab ${isActive ? 'nav-active' : ''}">
        <span class="nav-icon">${t.icon}${badge}</span>
        <span class="nav-label">${t.label}</span>
      </a>`;
  }).join('');

  return `
    <nav class="bottom-nav" id="bottom-nav">
      ${tabsHtml}
    </nav>`;
}

/**
 * Standard HTML head tags for all crew pages.
 */
export function htmlHead(title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>${title} — Haldo</title>
  <link rel="stylesheet" href="/public/style.css">
  <link rel="manifest" href="/public/manifest.json">
  <meta name="theme-color" content="#006950">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <link rel="apple-touch-icon" href="/public/apple-touch-icon.png">
  <link rel="icon" type="image/png" sizes="32x32" href="/public/favicon-32.png">
</head>`;
}

/**
 * Page header with back button and vessel badge.
 */
export function pageHeader(title: string, vessel: string, backHref: string = '/today'): string {
  return `
    <header class="page-header">
      <a href="${backHref}" class="back-link">← Back</a>
      <h1 class="page-title">${title}</h1>
      <span class="vessel-badge">${vessel.toUpperCase()}</span>
    </header>`;
}
