// ConnectTeam Time Clock Integration
const CT_API = 'https://api.connecteam.com';
const CT_KEY = '0af7db1a-5ba3-4288-83e6-2883c5c22a9c';
const CT_CLOCK_ID = '15189443';

let ctUsers = [];
let ctActivities = [];
let currentWeekStart = getWeekStart(new Date());
let timeTab = 'timesheet';

// Pay rates and OT rules
const PAY_CONFIG = {
  13683320: { name: 'Brady Raines', rate: 0, salary: true, ot: false },
  14122558: { name: 'Michael Peacock', rate: 20, salary: false, ot: false },
  14122559: { name: 'Mandy Phillips', rate: 13, salary: false, ot: false },
  14122560: { name: 'Emanuel Marshall', rate: 0, salary: false, ot: false },
  14122561: { name: 'Braden Crates', rate: 15, salary: false, ot: false },
  14149649: { name: 'John Stephens', rate: 15, salary: false, ot: true },
  14153485: { name: 'Shaun Jackson', rate: 0, salary: true, ot: false },
  14293284: { name: 'Jacob Flemming', rate: 15, salary: false, ot: true },
  14298749: { name: 'Scotty Wood', rate: 20, salary: false, ot: true },
  14893074: { name: 'Michael Jackson', rate: 0, salary: true, ot: false }
};

function getPayRate(userId) { return PAY_CONFIG[userId] || { rate: 0, salary: false, ot: false }; }
function isOTEligible(userId) { return PAY_CONFIG[userId] ? PAY_CONFIG[userId].ot : false; }

function getWeekStart(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0,0,0,0);
  return d;
}

function getWeekEnd(weekStart) {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + 6);
  return d;
}

function formatWeekLabel(weekStart) {
  const end = getWeekEnd(weekStart);
  const opts = { month: 'short', day: 'numeric' };
  const now = getWeekStart(new Date());
  const label = weekStart.toLocaleDateString('en-US', opts) + ' — ' + end.toLocaleDateString('en-US', opts);
  if (weekStart.getTime() === now.getTime()) return label + ' (This Week)';
  return label;
}

async function ctRequest(path, method, body) {
  const opts = { method: method || 'GET', headers: { 'X-API-KEY': CT_KEY, 'Accept': 'application/json' } };
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(CT_API + path, opts);
  if (!r.ok) throw new Error('ConnectTeam API error: ' + r.status);
  return r.json();
}

async function loadTimeClock() {
  const content = document.getElementById('timeClockContent');
  content.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);">Loading time data...</div>';

  try {
    if (ctUsers.length === 0) {
      const usersResp = await ctRequest('/users/v1/users?limit=50');
      ctUsers = usersResp.data.users || [];
    }
    await loadWeekData();
    renderTimeClock();
  } catch (e) {
    content.innerHTML = '<div style="text-align:center;padding:40px;color:var(--red);">Failed to load: ' + e.message + '</div>';
  }
}

async function loadWeekData() {
  const start = currentWeekStart.toISOString().split('T')[0];
  const end = getWeekEnd(currentWeekStart).toISOString().split('T')[0];
  const actResp = await ctRequest('/time-clock/v1/time-clocks/' + CT_CLOCK_ID + '/time-activities?startDate=' + start + '&endDate=' + end);
  ctActivities = actResp.data.timeActivitiesByUsers || [];
}

function getUserName(userId) {
  const u = ctUsers.find(x => x.userId === userId);
  return u ? (u.firstName + ' ' + u.lastName).trim() : 'Unknown';
}

function renderTimeClock() {
  const content = document.getElementById('timeClockContent');
  const now = Math.floor(Date.now() / 1000);
  const isCurrentWeek = currentWeekStart.getTime() === getWeekStart(new Date()).getTime();

  // Calculate stats
  let totalHours = 0;
  let clockedInNow = [];
  const employeeData = [];

  for (const entry of ctActivities) {
    const name = getUserName(entry.userId);
    const shifts = entry.shifts || [];
    let hours = 0;
    let currentShift = null;

    for (const s of shifts) {
      const startTs = s.start ? s.start.timestamp : 0;
      const endTs = s.end ? s.end.timestamp : 0;
      if (startTs && endTs) hours += (endTs - startTs) / 3600;
      else if (startTs && !endTs) { hours += (now - startTs) / 3600; currentShift = s; clockedInNow.push({ userId: entry.userId, name, startTs }); }
    }
    totalHours += hours;
    employeeData.push({ userId: entry.userId, name, shifts, hours, currentShift });
  }

  // Add users with 0 shifts
  for (const u of ctUsers) {
    if (!employeeData.find(e => e.userId === u.userId)) {
      employeeData.push({ userId: u.userId, name: (u.firstName + ' ' + u.lastName).trim(), shifts: [], hours: 0, currentShift: null });
    }
  }
  employeeData.sort((a, b) => b.hours - a.hours);

  content.innerHTML = `
    <div class="stats-grid" style="padding:0 0 16px;">
      <div class="stat-card"><div class="stat-label">Employees</div><div class="stat-value">${ctUsers.length}</div></div>
      <div class="stat-card"><div class="stat-label">Clocked In</div><div class="stat-value" style="color:var(--green);">${clockedInNow.length}</div></div>
      <div class="stat-card"><div class="stat-label">Week Hours</div><div class="stat-value">${totalHours.toFixed(1)}</div></div>
      <div class="stat-card"><div class="stat-label">Shifts</div><div class="stat-value">${ctActivities.reduce((s, e) => s + (e.shifts || []).length, 0)}</div></div>
    </div>

    ${clockedInNow.length > 0 && isCurrentWeek ? '<div style="background:var(--dark2);border-left:3px solid var(--green);border-radius:6px;padding:12px 16px;margin-bottom:16px;"><h4 style="color:var(--green);font-size:13px;margin-bottom:8px;">CLOCKED IN NOW</h4>' + clockedInNow.map(c => {
      const elapsed = ((now - c.startTs) / 3600).toFixed(1);
      const clockIn = new Date(c.startTs * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;"><span style="font-weight:600;">' + c.name + '</span><span style="color:var(--green);font-size:12px;">Since ' + clockIn + ' (' + elapsed + ' hrs)</span></div>';
    }).join('') + '</div>' : ''}

    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <div style="display:flex;gap:0;">
        <button class="board-tab ${timeTab === 'timesheet' ? 'active' : ''}" onclick="switchTimeTab('timesheet',this)">Weekly Timesheet</button>
        <button class="board-tab ${timeTab === 'employees' ? 'active' : ''}" onclick="switchTimeTab('employees',this)">By Employee</button>
        <button class="board-tab ${timeTab === 'all' ? 'active' : ''}" onclick="switchTimeTab('all',this)">All Shifts</button>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <button class="btn-secondary" style="padding:4px 12px;font-size:12px;" onclick="prevWeek()">&larr; Prev</button>
        <span style="font-size:13px;font-weight:600;min-width:200px;text-align:center;">${formatWeekLabel(currentWeekStart)}</span>
        <button class="btn-secondary" style="padding:4px 12px;font-size:12px;" onclick="nextWeek()">Next &rarr;</button>
        ${!isCurrentWeek ? '<button class="btn-secondary" style="padding:4px 12px;font-size:12px;" onclick="goToCurrentWeek()">Today</button>' : ''}
      </div>
    </div>
    <div id="timeTabContent"></div>`;

  switchTimeTab(timeTab);
}

async function prevWeek() {
  currentWeekStart = new Date(currentWeekStart.getTime() - 7 * 86400000);
  await loadWeekData();
  renderTimeClock();
}

async function nextWeek() {
  const next = new Date(currentWeekStart.getTime() + 7 * 86400000);
  if (next <= new Date()) {
    currentWeekStart = next;
    await loadWeekData();
    renderTimeClock();
  }
}

async function goToCurrentWeek() {
  currentWeekStart = getWeekStart(new Date());
  await loadWeekData();
  renderTimeClock();
}

function switchTimeTab(tab, btn) {
  timeTab = tab;
  if (btn) {
    document.querySelectorAll('#view-timeclock .board-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
  }

  const wrap = document.getElementById('timeTabContent');
  const now = Math.floor(Date.now() / 1000);
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  if (tab === 'timesheet') {
    // Weekly timesheet grid — rows are employees, columns are days
    let headerRow = '<th style="width:15%;">Employee</th>';
    for (let i = 0; i < 7; i++) {
      const d = new Date(currentWeekStart.getTime() + i * 86400000);
      const isToday = d.toDateString() === new Date().toDateString();
      headerRow += '<th style="text-align:center;' + (isToday ? 'color:var(--green);' : '') + '">' + days[i] + '<br><span style="font-size:9px;">' + (d.getMonth()+1) + '/' + d.getDate() + '</span></th>';
    }
    headerRow += '<th style="text-align:center;">Total</th><th style="text-align:right;">Cost</th>';

    let bodyRows = '';
    const allEmployees = [...new Set([...ctActivities.map(e => e.userId), ...ctUsers.map(u => u.userId)])].filter(uid => {
      const cfg = PAY_CONFIG[uid];
      return !cfg || !cfg.salary;
    });

    for (const userId of allEmployees) {
      const name = getUserName(userId);
      const entry = ctActivities.find(e => e.userId === userId);
      const shifts = entry ? entry.shifts || [] : [];
      let weekTotal = 0;
      let dayCells = '';

      for (let i = 0; i < 7; i++) {
        const dayStart = new Date(currentWeekStart.getTime() + i * 86400000);
        const dayEnd = new Date(dayStart.getTime() + 86400000);
        const dayStartTs = Math.floor(dayStart.getTime() / 1000);
        const dayEndTs = Math.floor(dayEnd.getTime() / 1000);

        const dayShifts = shifts.filter(s => {
          const st = s.start ? s.start.timestamp : 0;
          return st >= dayStartTs && st < dayEndTs;
        });

        let dayHours = 0;
        let cellContent = '-';
        if (dayShifts.length > 0) {
          for (const s of dayShifts) {
            const st = s.start ? s.start.timestamp : 0;
            const en = s.end ? s.end.timestamp : now;
            dayHours += (en - st) / 3600;
          }
          weekTotal += dayHours;
          const isActive = dayShifts.some(s => !s.end);
          cellContent = '<span style="cursor:pointer;' + (isActive ? 'color:var(--green);font-weight:700;' : '') + '" ondblclick="editDayShifts(' + userId + ',' + i + ')">' + dayHours.toFixed(1) + '</span>';
        }
        const isToday = dayStart.toDateString() === new Date().toDateString();
        dayCells += '<td style="text-align:center;' + (isToday ? 'background:var(--dark3);' : '') + '">' + cellContent + '</td>';
      }

      const pay = getPayRate(userId);
      const otEligible = isOTEligible(userId);
      const regHours = otEligible ? Math.min(weekTotal, 40) : weekTotal;
      const otHours = otEligible && weekTotal > 40 ? weekTotal - 40 : 0;
      const regCost = regHours * pay.rate;
      const otCost = otHours * pay.rate * 1.5;
      const totalCost = regCost + otCost;
      const overtime = otEligible && otHours > 0 ? '<span style="color:var(--red);font-size:10px;"> +' + otHours.toFixed(1) + ' OT</span>' : '';
      const rateStr = pay.salary ? '<span style="font-size:10px;color:var(--muted);">Salary</span>' : (pay.rate > 0 ? '$' + pay.rate + '/hr' : '-');
      bodyRows += '<tr><td><strong>' + name + '</strong><br><span style="font-size:10px;color:var(--muted);">' + rateStr + '</span></td>' + dayCells + '<td style="text-align:center;font-weight:700;color:var(--brand);">' + weekTotal.toFixed(1) + overtime + '</td><td style="text-align:right;font-weight:600;color:' + (otHours > 0 ? 'var(--red)' : 'var(--light)') + ';">' + (pay.rate > 0 ? '$' + totalCost.toFixed(2) : '-') + '</td></tr>';
    }

    // Calculate totals row
    let grandHours = 0, grandCost = 0;
    for (const userId of allEmployees) {
      const entry = ctActivities.find(e => e.userId === userId);
      const shifts = entry ? entry.shifts || [] : [];
      let wh = 0;
      for (const s of shifts) {
        const st = s.start ? s.start.timestamp : 0;
        const en = s.end ? s.end.timestamp : now;
        if (st) wh += (en - st) / 3600;
      }
      grandHours += wh;
      const pay = getPayRate(userId);
      const otE = isOTEligible(userId);
      const reg = otE ? Math.min(wh, 40) : wh;
      const ot = otE && wh > 40 ? wh - 40 : 0;
      grandCost += reg * pay.rate + ot * pay.rate * 1.5;
    }
    bodyRows += '<tr style="border-top:2px solid var(--brand);background:var(--dark3);"><td colspan="8" style="font-weight:700;">Weekly Total</td><td style="text-align:center;font-weight:700;color:var(--brand);">' + grandHours.toFixed(1) + '</td><td style="text-align:right;font-weight:700;color:var(--brand);">$' + grandCost.toFixed(2) + '</td></tr>';

    wrap.innerHTML = '<table class="data-table"><thead><tr>' + headerRow + '</tr></thead><tbody>' + bodyRows + '</tbody></table><div style="font-size:11px;color:var(--muted);margin-top:8px;">Double-click a cell to edit time entries</div>';
  }

  if (tab === 'employees') {
    const rows = [];
    for (const u of ctUsers.filter(u => { const cfg = PAY_CONFIG[u.userId]; return !cfg || !cfg.salary; })) {
      const entry = ctActivities.find(e => e.userId === u.userId);
      const shifts = entry ? entry.shifts || [] : [];
      let hours = 0;
      let isClockedIn = false;

      for (const s of shifts) {
        const st = s.start ? s.start.timestamp : 0;
        const en = s.end ? s.end.timestamp : 0;
        if (st && en) hours += (en - st) / 3600;
        else if (st && !en) { hours += (now - st) / 3600; isClockedIn = true; }
      }

      const name = (u.firstName + ' ' + u.lastName).trim();
      const status = isClockedIn ? '<span class="badge badge-green">Clocked In</span>' : '<span class="badge badge-gray">Off</span>';
      const pay = getPayRate(u.userId);
      const otE = isOTEligible(u.userId);
      const reg = otE ? Math.min(hours, 40) : hours;
      const ot = otE && hours > 40 ? hours - 40 : 0;
      const cost = reg * pay.rate + ot * pay.rate * 1.5;
      const overtime = otE && ot > 0 ? '<span style="color:var(--red);font-size:10px;"> +' + ot.toFixed(1) + ' OT</span>' : '';
      const rateStr = pay.salary ? 'Salary' : (pay.rate > 0 ? '$' + pay.rate + '/hr' : '-');
      rows.push('<tr><td><strong>' + name + '</strong></td><td style="font-size:12px;">' + rateStr + '</td><td>' + status + '</td><td>' + shifts.length + '</td><td><strong>' + hours.toFixed(1) + ' hrs</strong>' + overtime + '</td><td style="text-align:right;font-weight:600;">' + (pay.rate > 0 ? '$' + cost.toFixed(2) : '-') + '</td><td class="actions"><button onclick="viewEmployeeShifts(\'' + u.userId + '\')">View</button></td></tr>');
    }
    wrap.innerHTML = '<table class="data-table"><thead><tr><th>Employee</th><th>Rate</th><th>Status</th><th>Shifts</th><th>Hours</th><th style="text-align:right;">Cost</th><th>Actions</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>';
  }

  if (tab === 'all') {
    const allShifts = [];
    for (const entry of ctActivities) {
      const name = getUserName(entry.userId);
      for (const s of (entry.shifts || [])) {
        const startTs = s.start ? s.start.timestamp : 0;
        const endTs = s.end ? s.end.timestamp : 0;
        const hours = startTs && endTs ? (endTs - startTs) / 3600 : (startTs ? (now - startTs) / 3600 : 0);
        allShifts.push({ id: s.id, userId: entry.userId, name, startTs, endTs, hours, active: startTs && !endTs, date: new Date(startTs * 1000) });
      }
    }
    allShifts.sort((a, b) => b.startTs - a.startTs);

    wrap.innerHTML = '<table class="data-table"><thead><tr><th>Date</th><th>Employee</th><th>Clock In</th><th>Clock Out</th><th>Hours</th><th>Status</th><th>Actions</th></tr></thead><tbody>' +
      allShifts.map(s => {
        const dateStr = s.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        const inStr = new Date(s.startTs * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        const outStr = s.endTs ? new Date(s.endTs * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '-';
        const badge = s.active ? '<span class="badge badge-green">Active</span>' : '<span class="badge badge-gray">Done</span>';
        return '<tr><td style="font-size:12px;">' + dateStr + '</td><td><strong>' + s.name + '</strong></td><td>' + inStr + '</td><td>' + outStr + '</td><td><strong>' + s.hours.toFixed(1) + '</strong></td><td>' + badge + '</td><td class="actions"><button onclick="editShift(\'' + s.userId + '\',\'' + s.id + '\')">Edit</button></td></tr>';
      }).join('') +
      '</tbody></table>';
  }
}

function editDayShifts(userId, dayIndex) {
  const entry = ctActivities.find(e => e.userId === userId);
  if (!entry) return;

  const dayStart = new Date(currentWeekStart.getTime() + dayIndex * 86400000);
  const dayEnd = new Date(dayStart.getTime() + 86400000);
  const dayStartTs = Math.floor(dayStart.getTime() / 1000);
  const dayEndTs = Math.floor(dayEnd.getTime() / 1000);

  const dayShifts = (entry.shifts || []).filter(s => {
    const st = s.start ? s.start.timestamp : 0;
    return st >= dayStartTs && st < dayEndTs;
  });

  if (dayShifts.length === 0) return;

  const name = getUserName(userId);
  const dateStr = dayStart.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

  let shiftRows = dayShifts.map((s, i) => {
    const inTime = s.start ? new Date(s.start.timestamp * 1000).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }).substring(0,5) : '';
    const outTime = s.end ? new Date(s.end.timestamp * 1000).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }).substring(0,5) : '';
    const hours = s.start && s.end ? ((s.end.timestamp - s.start.timestamp) / 3600).toFixed(1) : '-';
    return '<div style="display:flex;gap:12px;align-items:center;margin-bottom:8px;padding:8px;background:var(--dark);border-radius:6px;">' +
      '<span style="font-size:12px;color:var(--muted);width:20px;">#' + (i+1) + '</span>' +
      '<div class="form-group" style="margin:0;flex:1;"><label style="font-size:10px;">Clock In</label><input type="time" id="shiftIn_' + i + '" value="' + inTime + '" style="padding:6px;background:var(--dark2);border:1px solid var(--border);color:var(--light);border-radius:4px;width:100%;"></div>' +
      '<div class="form-group" style="margin:0;flex:1;"><label style="font-size:10px;">Clock Out</label><input type="time" id="shiftOut_' + i + '" value="' + outTime + '" style="padding:6px;background:var(--dark2);border:1px solid var(--border);color:var(--light);border-radius:4px;width:100%;"></div>' +
      '<span style="font-size:13px;font-weight:600;color:var(--brand);width:50px;text-align:right;">' + hours + ' hrs</span>' +
      '<input type="hidden" id="shiftId_' + i + '" value="' + (s.id || '') + '">' +
      '</div>';
  }).join('');

  document.getElementById('customerModalTitle').textContent = name + ' — ' + dateStr;
  document.getElementById('customerModalBody').innerHTML = `
    ${shiftRows}
    <input type="hidden" id="editUserId" value="${userId}">
    <input type="hidden" id="editDayIndex" value="${dayIndex}">
    <input type="hidden" id="editShiftCount" value="${dayShifts.length}">
    <div class="form-actions" style="margin-top:16px;">
      <button class="btn-primary" onclick="saveShiftEdits()">Save Changes</button>
      <button class="btn-secondary" onclick="closeCustomerModal()">Cancel</button>
    </div>`;
  document.getElementById('customerModal').classList.add('active');
}

async function saveShiftEdits() {
  const userId = parseInt(document.getElementById('editUserId').value);
  const dayIndex = parseInt(document.getElementById('editDayIndex').value);
  const shiftCount = parseInt(document.getElementById('editShiftCount').value);
  const dayStart = new Date(currentWeekStart.getTime() + dayIndex * 86400000);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const updates = [];
  for (let i = 0; i < shiftCount; i++) {
    const shiftId = document.getElementById('shiftId_' + i).value;
    const inTime = document.getElementById('shiftIn_' + i).value;
    const outTime = document.getElementById('shiftOut_' + i).value;

    if (!shiftId || !inTime) continue;

    const inDate = new Date(dayStart.toISOString().split('T')[0] + 'T' + inTime + ':00');
    const shift = { id: shiftId, start: { timestamp: Math.floor(inDate.getTime() / 1000), timezone: tz } };
    if (outTime) {
      const outDate = new Date(dayStart.toISOString().split('T')[0] + 'T' + outTime + ':00');
      shift.end = { timestamp: Math.floor(outDate.getTime() / 1000), timezone: tz };
    }
    updates.push(shift);
  }

  if (updates.length === 0) { toast('No changes', 'error'); return; }

  try {
    await ctRequest('/time-clock/v1/time-clocks/' + CT_CLOCK_ID + '/time-activities', 'PUT', {
      timeActivities: [{ userId, shifts: updates }]
    });
    toast('Time updated', 'success');
    closeCustomerModal();
    await loadWeekData();
    renderTimeClock();
  } catch (e) { toast('Update failed: ' + e.message, 'error'); }
}

function editShift(userId, shiftId) {
  const entry = ctActivities.find(e => e.userId == userId);
  if (!entry) return;
  const shift = (entry.shifts || []).find(s => s.id === shiftId);
  if (!shift) return;

  // Find which day this shift is on
  const shiftDate = new Date(shift.start.timestamp * 1000);
  const dayIndex = Math.floor((shiftDate.getTime() - currentWeekStart.getTime()) / 86400000);
  editDayShifts(parseInt(userId), dayIndex);
}

function viewEmployeeShifts(userId) {
  const entry = ctActivities.find(e => e.userId == userId);
  const name = getUserName(parseInt(userId));
  const shifts = entry ? entry.shifts || [] : [];
  const now = Math.floor(Date.now() / 1000);

  let totalHours = 0;
  const rows = shifts.sort((a, b) => (b.start?.timestamp || 0) - (a.start?.timestamp || 0)).map(s => {
    const startTs = s.start ? s.start.timestamp : 0;
    const endTs = s.end ? s.end.timestamp : 0;
    const hours = startTs && endTs ? (endTs - startTs) / 3600 : (startTs ? (now - startTs) / 3600 : 0);
    totalHours += hours;
    const clockIn = startTs ? new Date(startTs * 1000) : null;
    const clockOut = endTs ? new Date(endTs * 1000) : null;
    const dateStr = clockIn ? clockIn.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '-';
    const inStr = clockIn ? clockIn.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '-';
    const outStr = clockOut ? clockOut.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '-';
    const active = startTs && !endTs;
    return '<tr><td>' + dateStr + '</td><td>' + inStr + '</td><td>' + outStr + '</td><td><strong>' + hours.toFixed(1) + '</strong></td><td>' + (active ? '<span class="badge badge-green">Active</span>' : '<span class="badge badge-gray">Done</span>') + '</td></tr>';
  }).join('');

  const overtime = totalHours > 40 ? '<div style="color:var(--red);font-size:12px;margin-top:4px;">Overtime: ' + (totalHours - 40).toFixed(1) + ' hrs</div>' : '';

  document.getElementById('customerModalTitle').textContent = name + ' — ' + formatWeekLabel(currentWeekStart);
  document.getElementById('customerModalBody').innerHTML = `
    <div style="display:flex;gap:12px;margin-bottom:16px;">
      <div class="stat-card" style="flex:1;"><div class="stat-label">Shifts</div><div class="stat-value" style="font-size:18px;">${shifts.length}</div></div>
      <div class="stat-card" style="flex:1;"><div class="stat-label">Hours</div><div class="stat-value" style="font-size:18px;">${totalHours.toFixed(1)}</div>${overtime}</div>
      <div class="stat-card" style="flex:1;"><div class="stat-label">Avg/Shift</div><div class="stat-value" style="font-size:18px;">${shifts.length > 0 ? (totalHours / shifts.length).toFixed(1) : '0'}</div></div>
    </div>
    <table class="data-table" style="font-size:12px;">
      <thead><tr><th>Date</th><th>Clock In</th><th>Clock Out</th><th>Hours</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="form-actions" style="margin-top:16px;">
      <button class="btn-secondary" onclick="closeCustomerModal()">Close</button>
    </div>`;
  document.getElementById('customerModal').classList.add('active');
}
