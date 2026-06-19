import { escapeHtml, formatCurrency, formatDate } from '../utils.js';

function dueLabel(loan) {
  if (!loan.due_date) return 'No due date';
  const label = formatDate(loan.due_date);
  return loan.overdue ? `${label} (overdue)` : label;
}

export function renderLoans({ active = [], recent = [] } = {}) {
  const overdue = active.filter(l => l.overdue);

  return `
    <h2 class="page-title">Loans &amp; Checkouts</h2>
    <p class="page-subtitle">Track who has your gear out of the studio</p>

    <div class="loan-summary-grid">
      <div class="loan-summary-card ${active.length ? 'loan-summary-active' : ''}">
        <span class="loan-summary-num">${active.length}</span>
        <span class="loan-summary-label">out now</span>
      </div>
      <div class="loan-summary-card ${overdue.length ? 'loan-summary-overdue' : ''}">
        <span class="loan-summary-num">${overdue.length}</span>
        <span class="loan-summary-label">overdue</span>
      </div>
      <div class="loan-summary-card">
        <span class="loan-summary-num">${recent.length}</span>
        <span class="loan-summary-label">recent returns</span>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h3 class="section-title">Currently Out</h3>
        <button type="button" class="btn btn-secondary btn-sm" data-nav="inventory">Find Item to Check Out</button>
      </div>
      ${active.length === 0 ? `
        <p class="text-muted">Nothing checked out — open any item and use <strong>Check Out</strong> when you loan gear.</p>
      ` : `
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Item</th><th>Borrower</th><th>Out Since</th><th>Due</th><th>Value</th><th></th>
              </tr>
            </thead>
            <tbody>
              ${active.map(loan => `
                <tr class="${loan.overdue ? 'loan-row-overdue' : ''}">
                  <td>
                    <button type="button" class="btn btn-ghost btn-sm loan-item-link" data-action="view-item" data-id="${loan.item_id}">
                      <strong>${escapeHtml(loan.item_name)}</strong>
                    </button>
                    <br><span class="text-muted-sm">${escapeHtml(loan.brand)} ${escapeHtml(loan.model)}</span>
                  </td>
                  <td>
                    <strong>${escapeHtml(loan.borrower_name)}</strong>
                    ${loan.borrower_contact ? `<br><span class="text-muted-sm">${escapeHtml(loan.borrower_contact)}</span>` : ''}
                    ${loan.note ? `<br><span class="text-muted-sm">${escapeHtml(loan.note)}</span>` : ''}
                  </td>
                  <td>${formatDate(loan.loaned_at)}</td>
                  <td>
                    ${loan.overdue ? `<span class="loan-overdue-badge">Overdue</span>` : ''}
                    ${dueLabel(loan)}
                  </td>
                  <td class="value-cell">${formatCurrency(loan.replacement_value)}</td>
                  <td>
                    <button type="button" class="btn btn-primary btn-sm" data-action="return-loan" data-id="${loan.id}" data-item="${loan.item_id}">
                      Mark Returned
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>

    ${recent.length ? `
    <div class="card" style="margin-top:1.5rem">
      <div class="card-header"><h3 class="section-title">Recent Returns</h3></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Item</th><th>Borrower</th><th>Out</th><th>Returned</th><th></th></tr></thead>
          <tbody>
            ${recent.map(loan => `
              <tr>
                <td>
                  <button type="button" class="btn btn-ghost btn-sm" data-action="view-item" data-id="${loan.item_id}">
                    ${escapeHtml(loan.item_name)}
                  </button>
                </td>
                <td>${escapeHtml(loan.borrower_name)}</td>
                <td>${formatDate(loan.loaned_at)}${loan.due_date ? ` → ${formatDate(loan.due_date)}` : ''}</td>
                <td>${formatDate(loan.returned_at)}</td>
                <td>
                  <button type="button" class="btn btn-sm btn-danger btn-ghost" data-action="delete-loan" data-id="${loan.id}">Remove</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
    ` : ''}
  `;
}

export function renderItemLoanSection(item) {
  const active = item.activeLoan;
  const history = (item.loans || []).filter(l => l.returned_at);

  return `
    <div class="card loan-card ${active?.overdue ? 'loan-card-overdue' : ''}">
      <div class="card-header">
        <h3 class="section-title">Loan / Checkout</h3>
        ${active ? `<span class="loan-status-pill ${active.overdue ? 'loan-status-overdue' : 'loan-status-out'}">${active.overdue ? 'Overdue' : 'Out on loan'}</span>` : ''}
      </div>

      ${active ? `
        <div class="loan-active-panel">
          <div class="detail-grid">
            <div class="detail-field"><div class="field-label">Borrower</div><div class="field-value">${escapeHtml(active.borrower_name)}</div></div>
            <div class="detail-field"><div class="field-label">Contact</div><div class="field-value">${escapeHtml(active.borrower_contact) || '—'}</div></div>
            <div class="detail-field"><div class="field-label">Checked Out</div><div class="field-value">${formatDate(active.loaned_at)}</div></div>
            <div class="detail-field"><div class="field-label">Due</div><div class="field-value">${active.due_date ? dueLabel(active) : '—'}</div></div>
          </div>
          ${active.condition_out ? `<p class="text-muted-sm">Condition out: ${escapeHtml(active.condition_out)}</p>` : ''}
          ${active.note ? `<p class="text-muted-sm">${escapeHtml(active.note)}</p>` : ''}
          <form id="loan-return-form" class="loan-return-form" data-loan-id="${active.id}">
            <div class="form-grid">
              <div class="form-group">
                <label for="return-date">Return Date</label>
                <input type="date" id="return-date" value="${new Date().toISOString().slice(0, 10)}">
              </div>
              <div class="form-group full-width">
                <label for="return-condition">Condition In (optional)</label>
                <input type="text" id="return-condition" placeholder="e.g. Returned with case, minor scratch on back">
              </div>
              <div class="form-group full-width">
                <label for="return-note">Return Note (optional)</label>
                <input type="text" id="return-note" placeholder="e.g. All good, used for weekend gig">
              </div>
            </div>
            <button type="submit" class="btn btn-primary btn-sm" style="margin-top:0.75rem">Mark Returned</button>
          </form>
        </div>
      ` : `
        <p class="text-muted-sm" style="margin-bottom:1rem">Check out gear to a bandmate, session player, or repair shop — status updates automatically.</p>
        <form id="loan-checkout-form">
          <div class="form-grid">
            <div class="form-group">
              <label for="loan-borrower">Borrower *</label>
              <input type="text" id="loan-borrower" required placeholder="e.g. Mike, Sweetwater repair">
            </div>
            <div class="form-group">
              <label for="loan-contact">Contact (optional)</label>
              <input type="text" id="loan-contact" placeholder="phone or email">
            </div>
            <div class="form-group">
              <label for="loan-date">Checkout Date</label>
              <input type="date" id="loan-date" value="${new Date().toISOString().slice(0, 10)}">
            </div>
            <div class="form-group">
              <label for="loan-due">Due Date (optional)</label>
              <input type="date" id="loan-due">
            </div>
            <div class="form-group full-width">
              <label for="loan-note">Note</label>
              <input type="text" id="loan-note" placeholder="e.g. Vocal session Saturday, gig Friday night">
            </div>
            <div class="form-group full-width">
              <label for="loan-condition-out">Condition Out (optional)</label>
              <input type="text" id="loan-condition-out" placeholder="e.g. With hard case and spare cable">
            </div>
          </div>
          <button type="submit" class="btn btn-primary btn-sm" style="margin-top:0.75rem">Check Out</button>
        </form>
      `}

      ${history.length ? `
        <div class="loan-history" style="margin-top:1.25rem">
          <h4 class="subsection-title">Loan History</h4>
          ${history.map(loan => `
            <div class="loan-history-entry">
              <div>
                <strong>${escapeHtml(loan.borrower_name)}</strong>
                <span class="text-muted-sm"> · ${formatDate(loan.loaned_at)} → ${formatDate(loan.returned_at)}</span>
                ${loan.due_date ? `<span class="text-muted-sm"> · due ${formatDate(loan.due_date)}</span>` : ''}
                ${loan.note ? `<div class="text-muted-sm">${escapeHtml(loan.note)}</div>` : ''}
              </div>
              <button type="button" class="btn btn-sm btn-danger btn-ghost" data-action="delete-loan" data-id="${loan.id}">Remove</button>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `;
}