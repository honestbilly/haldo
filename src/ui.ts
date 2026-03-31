// Shared UI components for Haldo
// Stitch design system: iOS Maritime with Material Symbols icons

/**
 * Bottom tab bar — iOS style with Material Symbols Outlined icons.
 * Fixed position, backdrop blur, 84px height with safe area padding.
 * Active tab: filled icon on tinted pill background.
 */
export function bottomNav(active: string): string {
  const tabs = [
    { id: 'home',    label: 'Home',    icon: 'home',        href: '/today' },
    { id: 'tasks',   label: 'Tasks',   icon: 'checklist',   href: '/tasks/queue' },
    { id: 'weather', label: 'Weather', icon: 'wb_sunny',    href: '/weather' },
    { id: 'submit',  label: 'Note',    icon: 'description', href: '/submit' },
    { id: 'more',    label: 'More',    icon: 'more_horiz',  href: '/more' },
  ];

  const tabsHtml = tabs.map(t => {
    const isActive = t.id === active;
    const activeClass = isActive
      ? 'nav-tab nav-active'
      : 'nav-tab';
    const fillStyle = isActive ? "font-variation-settings: 'FILL' 1, 'wght' 600;" : '';

    return `
      <a href="${t.href}" class="${activeClass}">
        <span class="material-symbols-outlined" style="${fillStyle}">${t.icon}</span>
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
 * Includes Material Symbols font link.
 */
export function htmlHead(title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no">
  <title>${title} — Haldo</title>
  <link rel="stylesheet" href="/public/style.css">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap">
  <link rel="manifest" href="/public/manifest.json">
  <meta name="theme-color" content="#1A6B8A">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <link rel="apple-touch-icon" href="/public/apple-touch-icon.png">
  <link rel="icon" type="image/png" sizes="32x32" href="/public/favicon-32.png">
</head>`;
}

/**
 * Page header with back arrow and vessel badge — Stitch pattern.
 */
export function pageHeader(title: string, vessel: string, backHref: string = '/today'): string {
  return `
    <header class="page-header">
      <a href="${backHref}" class="back-link">
        <span class="material-symbols-outlined" style="font-size:20px">arrow_back</span>
        Home
      </a>
      <h1 class="page-title">${title}</h1>
      <span class="vessel-badge">${vessel.toUpperCase()}</span>
    </header>`;
}
