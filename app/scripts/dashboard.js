async function loadDashboard() {
  try {
    const [dashData, qbDash, bankData] = await Promise.all([
      API.getDashboard().catch(() => ({})),
      API.get('/api/qb/dashboard').catch(() => null),
      API.get('/api/settings/bank-balance').catch(() => ({ balance: 0, updated: null }))
    ]);

    const allJobs = dashData.jobs || jobs || [];
    const total = allJobs.length;
    const completed = allJobs.filter(j => j.stage === 'Completed').length;
    const inProgress = allJobs.filter(j => j.stage !== 'Completed' && j.stage !== 'Quote/Estimate').length;
    const quotes = allJobs.filter(j => j.stage === 'Quote/Estimate').length;

    if (!qbDash) {
      document.getElementById('dashStats').innerHTML = '<div style="padding:24px;color:var(--muted);">QuickBooks not connected. Connect in Settings for financial data.</div>';
      return;
    }

    const inv = qbDash.invoices;
    const aging = qbDash.aging;
    const est = qbDash.estimates;
    const bank = qbDash.bank;
    const pl = qbDash.profitLoss;
    const mo = qbDash.thisMonth;
    const pay = qbDash.payments;

    const fmt = (n) => '$' + (n || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    const fmtK = (n) => n >= 1000 ? '$' + (n/1000).toFixed(1) + 'k' : fmt(n);

    document.getElementById('dashStats').innerHTML = `
      <div class="stat-card" style="border-left:3px solid var(--green);">
        <div class="stat-label">Bank Balance</div>
        <div class="stat-value" style="color:var(--green);cursor:pointer;" onclick="editBankBalance()" title="Click to update">${bankData.balance > 0 ? fmt(bankData.balance) : 'Click to set'}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:4px;">${bankData.updated ? 'Updated ' + new Date(bankData.updated).toLocaleDateString() : 'Not set yet'}</div>
      </div>
      <div class="stat-card" style="border-left:3px solid var(--brand);">
        <div class="stat-label">QB Book Balance</div>
        <div class="stat-value">${fmt(bank.totalBank)}</div>
        <div style="font-size:11px;color:${Math.abs(bank.totalBank - bankData.balance) > 100 && bankData.balance > 0 ? 'var(--yellow)' : 'var(--muted)'};margin-top:4px;">${bankData.balance > 0 ? (bank.totalBank - bankData.balance >= 0 ? '+' : '') + fmt(bank.totalBank - bankData.balance) + ' difference' : bank.accounts.map(a => a.name.substring(0,25)).join(', ')}</div>
      </div>
      <div class="stat-card" style="border-left:3px solid var(--brand);">
        <div class="stat-label">YTD Revenue</div>
        <div class="stat-value">${fmt(pl.income)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:4px;">Expenses: ${fmt(pl.expenses)}</div>
      </div>
      <div class="stat-card" style="border-left:3px solid var(--green);">
        <div class="stat-label">Net Income</div>
        <div class="stat-value" style="color:${pl.netIncome >= 0 ? 'var(--green)' : 'var(--red)'};">${fmt(pl.netIncome)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:4px;">${pl.income > 0 ? Math.round((pl.netIncome / pl.income) * 100) : 0}% margin</div>
      </div>
      <div class="stat-card" style="border-left:3px solid var(--yellow);">
        <div class="stat-label">Outstanding</div>
        <div class="stat-value" style="color:var(--yellow);">${fmt(inv.outstanding)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:4px;">${inv.openCount} open invoices</div>
      </div>
      <div class="stat-card" style="border-left:3px solid var(--red);">
        <div class="stat-label">Overdue</div>
        <div class="stat-value" style="color:var(--red);">${fmt(inv.overdueAmount)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:4px;">${inv.overdueCount} invoices past due</div>
      </div>
      <div class="stat-card" style="border-left:3px solid var(--blue);">
        <div class="stat-label">This Month</div>
        <div class="stat-value">${fmt(mo.invoiced)}</div>
        <div style="font-size:11px;color:var(--green);margin-top:4px;">Collected: ${fmt(mo.collected)}</div>
      </div>
      <div class="stat-card" style="border-left:3px solid var(--blue);">
        <div class="stat-label">Pending Estimates</div>
        <div class="stat-value">${fmt(est.pendingValue)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:4px;">${est.pending} awaiting approval</div>
      </div>
      <div class="stat-card" style="border-left:3px solid var(--green);">
        <div class="stat-label">Accepted Estimates</div>
        <div class="stat-value" style="color:var(--green);">${fmt(est.acceptedValue)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:4px;">${est.accepted} ready to invoice</div>
      </div>`;

    // Build the content area
    const agingTotal = aging.current + aging.days30 + aging.days60 + aging.days90 + aging.over90;
    const agingBar = (val, color) => agingTotal > 0 ? '<div style="width:' + Math.max(((val/agingTotal)*100), val > 0 ? 3 : 0) + '%;background:' + color + ';height:24px;border-radius:3px;" title="$' + val.toFixed(2) + '"></div>' : '';

    document.getElementById('dashContent').innerHTML = `
      <div style="padding:0 24px 24px;display:grid;grid-template-columns:1fr 1fr;gap:20px;">

        <!-- A/R Aging -->
        <div style="background:var(--dark);border-radius:8px;padding:16px;">
          <h3 style="color:var(--brand);font-size:14px;margin:0 0 12px;text-transform:uppercase;letter-spacing:.5px;">Accounts Receivable Aging</h3>
          <div style="display:flex;gap:2px;margin-bottom:12px;border-radius:4px;overflow:hidden;">
            ${agingBar(aging.current, '#4CAF50')}
            ${agingBar(aging.days30, '#FFC107')}
            ${agingBar(aging.days60, '#FF9800')}
            ${agingBar(aging.days90, '#f44336')}
            ${agingBar(aging.over90, '#9C27B0')}
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;">
            <div><span style="display:inline-block;width:10px;height:10px;background:#4CAF50;border-radius:2px;margin-right:6px;"></span>Current: <strong>${fmt(aging.current)}</strong></div>
            <div><span style="display:inline-block;width:10px;height:10px;background:#FFC107;border-radius:2px;margin-right:6px;"></span>1-30 days: <strong>${fmt(aging.days30)}</strong></div>
            <div><span style="display:inline-block;width:10px;height:10px;background:#FF9800;border-radius:2px;margin-right:6px;"></span>31-60 days: <strong>${fmt(aging.days60)}</strong></div>
            <div><span style="display:inline-block;width:10px;height:10px;background:#f44336;border-radius:2px;margin-right:6px;"></span>61-90 days: <strong>${fmt(aging.days90)}</strong></div>
            <div><span style="display:inline-block;width:10px;height:10px;background:#9C27B0;border-radius:2px;margin-right:6px;"></span>90+ days: <strong>${fmt(aging.over90)}</strong></div>
            <div style="color:var(--brand);font-weight:700;">Total: ${fmt(agingTotal)}</div>
          </div>
        </div>

        <!-- Recent Payments -->
        <div style="background:var(--dark);border-radius:8px;padding:16px;">
          <h3 style="color:var(--brand);font-size:14px;margin:0 0 12px;text-transform:uppercase;letter-spacing:.5px;">Recent Payments (30 days)</h3>
          <div style="font-size:22px;font-weight:700;color:var(--green);margin-bottom:12px;">${fmt(pay.last30DaysTotal)} <span style="font-size:12px;color:var(--muted);font-weight:400;">(${pay.last30Days} payments)</span></div>
          <div style="max-height:180px;overflow-y:auto;">
            ${qbDash.recentPayments.map(p => '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;"><span style="color:var(--light);">' + p.customer + '</span><span><strong style="color:var(--green);">' + fmt(p.amount) + '</strong> <span style="color:var(--muted);">' + p.date + '</span></span></div>').join('')}
          </div>
        </div>

        <!-- P&L Summary -->
        <div style="background:var(--dark);border-radius:8px;padding:16px;">
          <h3 style="color:var(--brand);font-size:14px;margin:0 0 12px;text-transform:uppercase;letter-spacing:.5px;">Profit & Loss (YTD ${new Date().getFullYear()})</h3>
          <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;">
            <span>Income</span><strong style="color:var(--green);">${fmt(pl.income)}</strong>
          </div>
          <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;">
            <span>Expenses</span><strong style="color:var(--red);">${fmt(pl.expenses)}</strong>
          </div>
          <div style="display:flex;justify-content:space-between;padding:10px 0;font-size:15px;">
            <span style="color:var(--brand);font-weight:700;">Net Income</span><strong style="color:${pl.netIncome >= 0 ? 'var(--green)' : 'var(--red)'};">${fmt(pl.netIncome)}</strong>
          </div>
          <div style="margin-top:8px;background:var(--dark2);border-radius:4px;height:8px;overflow:hidden;">
            <div style="width:${pl.income > 0 ? Math.round((pl.netIncome / pl.income) * 100) : 0}%;background:var(--green);height:100%;border-radius:4px;"></div>
          </div>
          <div style="text-align:right;font-size:11px;color:var(--muted);margin-top:4px;">${pl.income > 0 ? Math.round((pl.netIncome / pl.income) * 100) : 0}% profit margin</div>
        </div>

        <!-- Job Pipeline -->
        <div style="background:var(--dark);border-radius:8px;padding:16px;">
          <h3 style="color:var(--brand);font-size:14px;margin:0 0 12px;text-transform:uppercase;letter-spacing:.5px;">Job Pipeline</h3>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div style="text-align:center;padding:12px;background:var(--dark2);border-radius:6px;">
              <div style="font-size:24px;font-weight:700;color:var(--blue);">${quotes}</div>
              <div style="font-size:11px;color:var(--muted);">Quotes</div>
            </div>
            <div style="text-align:center;padding:12px;background:var(--dark2);border-radius:6px;">
              <div style="font-size:24px;font-weight:700;color:var(--yellow);">${inProgress}</div>
              <div style="font-size:11px;color:var(--muted);">In Production</div>
            </div>
            <div style="text-align:center;padding:12px;background:var(--dark2);border-radius:6px;">
              <div style="font-size:24px;font-weight:700;color:var(--green);">${completed}</div>
              <div style="font-size:11px;color:var(--muted);">Completed</div>
            </div>
            <div style="text-align:center;padding:12px;background:var(--dark2);border-radius:6px;">
              <div style="font-size:24px;font-weight:700;color:var(--light);">${total}</div>
              <div style="font-size:11px;color:var(--muted);">Total Jobs</div>
            </div>
          </div>
          <div style="margin-top:12px;font-size:12px;">
            <div style="display:flex;justify-content:space-between;padding:4px 0;"><span>Total Invoiced</span><strong>${fmt(inv.totalInvoiced)}</strong></div>
            <div style="display:flex;justify-content:space-between;padding:4px 0;"><span>Collected</span><strong style="color:var(--green);">${fmt(inv.collected)}</strong></div>
            <div style="display:flex;justify-content:space-between;padding:4px 0;"><span>Collection Rate</span><strong>${inv.totalInvoiced > 0 ? Math.round((inv.collected / inv.totalInvoiced) * 100) : 0}%</strong></div>
          </div>
        </div>

      </div>`;

  } catch (e) {
    document.getElementById('dashStats').innerHTML = '<div style="padding:24px;color:var(--red);">Failed to load dashboard: ' + e.message + '</div>';
  }
}

async function editBankBalance() {
  const current = prompt('Enter current bank balance:');
  if (current === null) return;
  const val = parseFloat(current.replace(/[$,]/g, ''));
  if (isNaN(val)) { toast('Invalid amount', 'error'); return; }
  try {
    await API.post('/api/settings/bank-balance', { balance: val });
    toast('Bank balance updated: $' + val.toLocaleString('en-US', {minimumFractionDigits: 2}), 'success');
    loadDashboard();
  } catch (e) { toast('Failed: ' + e.message, 'error'); }
}
