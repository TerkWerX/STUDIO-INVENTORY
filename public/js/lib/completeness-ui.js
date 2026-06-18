import { escapeHtml } from '../utils.js';

const CHECK_ICONS = { photo: '📷', serial: '#', receipt: '🧾', manual: '📄', valueCurrent: '$' };

export const STUDIO_STATUS_LABELS = {
  in_studio: 'In studio',
  loaned: 'Loaned out',
  in_repair: 'In repair',
  storage: 'In storage',
  away: 'Away'
};

export function renderCompletenessBadge(completeness, { compact = false } = {}) {
  if (!completeness) return '';
  const cls = `completeness-badge completeness-${completeness.status}`;
  if (compact) {
    return `<span class="${cls}" title="${escapeHtml(completeness.missing.join(', ') || 'Complete')}">${completeness.score}%</span>`;
  }
  return `<span class="${cls}">${completeness.score}% documented</span>`;
}

export function renderCompletenessChecklist(completeness) {
  if (!completeness) return '';
  const rows = Object.entries(completeness.checks).map(([key, ok]) => `
    <div class="completeness-check ${ok ? 'check-ok' : 'check-miss'}">
      <span class="completeness-check-icon">${CHECK_ICONS[key] || '•'}</span>
      <span class="completeness-check-label">${escapeHtml(completeness.labels?.[key] || key)}</span>
      <span class="completeness-check-state">${ok ? '✓' : '—'}</span>
    </div>
  `).join('');

  return `
    <div class="completeness-panel completeness-${completeness.status}">
      <div class="completeness-panel-header">
        <strong>Documentation</strong>
        ${renderCompletenessBadge(completeness)}
      </div>
      <div class="completeness-checks">${rows}</div>
      ${completeness.missing?.length
        ? `<p class="completeness-missing text-muted-sm">Still needed: ${escapeHtml(completeness.missing.join(', '))}</p>`
        : '<p class="completeness-missing text-muted-sm">Fully documented for insurance.</p>'}
    </div>
  `;
}

export function renderStudioStatusBadge(item) {
  const status = item.studio_status || 'in_studio';
  if (status === 'in_studio') return '';
  const label = STUDIO_STATUS_LABELS[status] || status;
  const note = item.studio_status_note ? ` — ${escapeHtml(item.studio_status_note)}` : '';
  return `<span class="studio-status-badge status-${status}">${escapeHtml(label)}${note}</span>`;
}

export const MAINTENANCE_TYPES = {
  maintenance: 'General maintenance',
  repair: 'Repair',
  calibration: 'Calibration',
  strings: 'Strings / heads',
  tubes: 'Tube swap',
  cleaning: 'Cleaning',
  other: 'Other'
};