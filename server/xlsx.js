// CSV and XLSX exports. Spreadsheet formulas in cell values are neutralised so
// a pasted note can never execute in Excel.

import ExcelJS from 'exceljs';
import { formatMoney } from '../shared/money.js';
import { monthLabel } from '../shared/dates.js';
import { describeRule } from '../shared/commission.js';
import { PURPOSE_LABELS } from '../shared/record.js';
import { stageLabel } from '../shared/stages.js';

const FORMULA_START = /^[=+\-@\t\r]/;

/** Prefix a leading =, +, -, @, tab or CR so Excel treats the cell as text. */
export function neutraliseCell(value) {
  if (value == null) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  const text = String(value);
  if (FORMULA_START.test(text)) return `'${text}`;
  return text;
}

function csvCell(value) {
  const safe = neutraliseCell(value);
  const text = typeof safe === 'string' ? safe : String(safe);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(rows) {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

/** One statement, partner-safe columns: no loan figures. */
export function statementRows(statement, { firm = null } = {}) {
  const rows = [];
  rows.push(['PARTNER PULSE referral commission statement']);
  rows.push(['Firm', firm?.name || '']);
  rows.push(['Partner', statement.partnerName || statement.partnerId || '']);
  rows.push(['Period', statement.periodLabel || monthLabel(statement.period)]);
  rows.push(['Statement id', statement.id || '']);
  rows.push(['Status', statement.status || '']);
  rows.push(['Issued', statement.issuedAt || '']);
  rows.push(['Paid', statement.paidAt || '']);
  rows.push([]);
  rows.push(['Deals referred (this period)', statement.numbers?.dealsReferred ?? 0]);
  rows.push(['Settled this month', statement.numbers?.settledThisMonth ?? 0]);
  rows.push(['Referral comms due', statement.numbers?.commsDue ?? 0]);
  rows.push(['In flight', statement.numbers?.inFlight ?? 0]);
  rows.push(['Paid year to date', statement.numbers?.paidYtd ?? 0]);
  rows.push([]);
  rows.push(['Deal ref', 'Deal id', 'Client', 'Security property', 'Settled', 'Rule id', 'Rule', 'Basis', 'Amount']);
  for (const line of statement.lines || []) {
    rows.push([
      line.dealRef || '',
      line.dealId || '',
      line.clientLabel || '',
      line.address || '',
      line.settledAt || '',
      line.ruleId || '',
      line.ruleName || '',
      line.basis || '',
      line.amount ?? '',
    ]);
  }
  rows.push([]);
  rows.push(['Total', '', '', '', '', '', '', '', statement.total ?? 0]);
  if (statement.coverNote) {
    rows.push([]);
    rows.push(['Cover note', statement.coverNote]);
  }
  if ((statement.anomalies || []).length) {
    rows.push([]);
    rows.push(['Anomalies']);
    for (const a of statement.anomalies) rows.push([a.type, a.label, a.dealRef || a.dealId || '']);
  }
  return rows;
}

export function statementCsv(statement, opts = {}) {
  return toCsv(statementRows(statement, opts));
}

function styleHeader(sheet, rowNumber = 1) {
  const row = sheet.getRow(rowNumber);
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF008B8B' } };
  row.commit?.();
}

function addSheet(workbook, name, header, rows, widths) {
  const sheet = workbook.addWorksheet(name.slice(0, 31));
  sheet.addRow(header.map(neutraliseCell));
  styleHeader(sheet);
  for (const row of rows) sheet.addRow(row.map(neutraliseCell));
  sheet.columns.forEach((col, i) => { col.width = widths?.[i] || Math.min(40, Math.max(12, String(header[i] || '').length + 6)); });
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  return sheet;
}

export async function statementWorkbook(statement, { firm = null } = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'PARTNER PULSE';
  const cover = workbook.addWorksheet('Statement');
  for (const row of statementRows(statement, { firm })) {
    cover.addRow(row.map(neutraliseCell));
  }
  cover.getColumn(1).width = 34;
  cover.getColumn(2).width = 30;
  for (let i = 3; i <= 9; i += 1) cover.getColumn(i).width = 20;
  cover.getRow(1).font = { bold: true, size: 14 };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** The whole register: seven sheets. */
export async function registerWorkbook(data, { anomalies = [], today = null } = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'PARTNER PULSE';
  workbook.created = today ? new Date(`${today}T00:00:00Z`) : new Date();
  const partnerName = (id) => data.partners.find((p) => p.id === id)?.name || (id === 'direct' ? 'Direct' : (id || 'Unknown'));

  addSheet(workbook, 'Deals', [
    'Ref', 'Deal id', 'Client', 'Phone', 'Email', 'Broker', 'Referred by', 'Stage', 'Purpose',
    'Loan amount', 'Lender', 'Security property', 'Contract', 'Finance due', 'Settlement due',
    'Pre-approval expiry', 'Settled', 'RAG', 'RAG on arrival', 'Consent to share', 'Fee disclosed',
    'Comms rule', 'Comms amount', 'Comms status', 'Updates sent', 'Created',
  ], (data.deals || []).map((d) => [
    d.ref, d.id, d.client?.name, d.client?.phone, d.client?.email, d.broker,
    d.referredBy ? partnerName(d.referredBy) : 'Unknown', stageLabel(d.stage),
    d.purpose ? PURPOSE_LABELS[d.purpose] : '', d.loanAmount ?? '', d.lender, d.propertyAddress,
    d.keyDates?.contract, d.keyDates?.financeDue, d.keyDates?.settlementDue,
    d.keyDates?.preApprovalExpiry, d.keyDates?.settledAt, d.rag, d.arrivalRag,
    d.consent?.shareStatus ? 'yes' : 'no', d.consent?.feeDisclosed ? 'yes' : 'no',
    d.referralComms?.ruleName || '', d.referralComms?.amount ?? '', d.referralComms?.status,
    d.updateCount ?? 0, d.createdAt,
  ]), [12, 16, 22, 16, 26, 12, 20, 18, 14, 14, 16, 34, 12, 12, 14, 16, 12, 8, 12, 14, 12, 22, 14, 14, 12, 22]);

  addSheet(workbook, 'Partners', [
    'Partner id', 'Name', 'Agency', 'Office', 'Phone', 'Email', 'Deals referred', 'Settled', 'Portal token set', 'Open homes',
  ], (data.partners || []).map((p) => {
    const mine = (data.deals || []).filter((d) => d.referredBy === p.id);
    return [
      p.id, p.name, p.agency, p.office, p.phone, p.email,
      mine.length, mine.filter((d) => d.stage === 'settled').length,
      p.portalToken ? 'yes' : 'no', (p.openHomes || []).length,
    ];
  }), [16, 22, 22, 20, 18, 28, 14, 10, 16, 12]);

  addSheet(workbook, 'Messages', [
    'Message id', 'At', 'Deal ref', 'Partner', 'Kind', 'Channels', 'Status', 'Provider', 'SMS', 'Email subject',
  ], (data.messages || []).map((m) => [
    m.id, m.sentAt || m.createdAt, m.dealRef, m.partnerName, m.kind,
    (m.channels || []).join(' + '), m.status, m.provider, m.smsBody, m.emailSubject,
  ]), [16, 22, 12, 20, 12, 14, 10, 12, 60, 34]);

  addSheet(workbook, 'Statements', [
    'Statement id', 'Partner', 'Period', 'Status', 'Lines', 'Total', 'Created', 'Issued', 'Paid', 'Void reason', 'Production seconds',
  ], (data.statements || []).map((s) => [
    s.id, s.partnerName, s.periodLabel || monthLabel(s.period), s.status,
    (s.lines || []).length, s.total ?? 0, s.createdAt, s.issuedAt, s.paidAt, s.voidReason, s.productionSeconds ?? '',
  ]), [16, 22, 18, 10, 8, 12, 22, 22, 22, 26, 18]);

  addSheet(workbook, 'Statement lines', [
    'Statement id', 'Partner', 'Period', 'Deal ref', 'Deal id', 'Client', 'Security property', 'Settled', 'Rule id', 'Rule', 'Basis', 'Amount',
  ], (data.statements || []).flatMap((s) => (s.lines || []).map((l) => [
    s.id, s.partnerName, s.period, l.dealRef, l.dealId, l.clientLabel, l.address, l.settledAt, l.ruleId, l.ruleName, l.basis, l.amount ?? '',
  ])), [16, 20, 12, 12, 16, 20, 30, 12, 16, 20, 30, 12]);

  addSheet(workbook, 'Rules', [
    'Rule id', 'Name', 'Scope', 'Partner', 'Type', 'Description', 'Effective from', 'Active', 'Note',
  ], (data.rules || []).map((r) => [
    r.id, r.name, r.scope, r.partnerId ? partnerName(r.partnerId) : 'All partners', r.type,
    describeRule(r), r.effectiveFrom, r.active === false ? 'no' : 'yes', r.note,
  ]), [16, 24, 10, 20, 16, 40, 14, 8, 30]);

  addSheet(workbook, 'Anomalies', [
    'Type', 'What it means', 'Deal ref', 'Partner',
  ], (anomalies || []).map((a) => [
    a.type, a.label, a.dealRef || a.dealId || '', a.partnerId ? partnerName(a.partnerId) : '',
  ]), [26, 44, 12, 20]);

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export function statementFileName(statement, ext) {
  const partner = String(statement.partnerName || statement.partnerId || 'partner').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  return `pulse-statement-${partner}-${statement.period}.${ext}`;
}

export { formatMoney };
