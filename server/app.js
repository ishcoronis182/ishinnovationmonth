// The API. createApp is injectable so tests can drive it without a network.

import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import QRCode from 'qrcode';

import { todayISO, nowStamp, monthKey, previousMonthKey, monthLabel, isValidISODate, addDays, formatShort, formatLong, nextSaturday, dayName } from '../shared/dates.js';
import { normaliseDeal, ragForDeal, clientLabel, clientInitials, daysInStage, nextMilestone, isReferred, PURPOSES, TEN_FIELDS } from '../shared/record.js';
import { STAGES, OFF_RAMPS, ALL_STAGES, stageLabel, isLive, isOffRamp, isStage } from '../shared/stages.js';
import { checkCompliance, checkStatementNote, blockReason } from '../shared/guard.js';
import {
  resolveRule, computeCommission, buildStatement, statementNumbers, recheckLines,
  registerAnomalies, canIssue, canMarkPaid, canVoid, isOnIssuedStatement, normaliseRule,
  describeRule, periodsWithSettlements, RULE_TYPES,
} from '../shared/commission.js';
import { buildUpdateContext, draftUpdate as templateDraftUpdate, statementNoteAllowedNumbers, statementNote as templateStatementNote, SMS_MAX } from '../shared/templates.js';
import { computeMetrics, livePulse, PULSE_QUESTIONS } from '../shared/metrics.js';
import { portalPayload, fridayCard, findForbiddenKeys, portalStatementView } from '../shared/partnerView.js';
import { formatMoney } from '../shared/money.js';

import { createAuth } from './auth.js';
import { configHealth } from './config.js';
import {
  createDeal, patchDeal, moveStage, reopenDeal, setConsent, addNote, logEnquiry,
  recordUpdateSent, applyCommission, consentGate, timelineEvent, appendTimeline, ENQUIRY_KINDS,
} from './deals.js';
import { openDealsFor } from './heuristics.js';
import { buildSamples } from './samples.js';
import { buildSeed, seedSummary } from './seed.js';
import { randomId, portalToken, nextRef } from './ids.js';
import { statementCsv, statementWorkbook, registerWorkbook, statementFileName, neutraliseCell } from './xlsx.js';

const JSON_LIMIT = '512kb';

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function fail(res, status, error, message, extra = {}) {
  res.status(status).json({ error, message, ...extra });
}

function str(value, max = 400) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, max);
}

/**
 * @param {{config: object, store: object, ai: object, delivery: object, logger?: object, now?: Function}} deps
 */
export function createApp(deps) {
  const { config, store, ai, delivery } = deps;
  const logger = deps.logger || console;
  const nowFn = deps.now || (() => new Date());
  const auth = deps.auth || createAuth({ config, logger, now: () => nowFn().getTime() });

  const app = express();
  // One hop by default (Render, Fly, a single nginx). Trusting every hop would
  // let a client spoof X-Forwarded-For and slip the lockout and rate limits.
  app.set('trust proxy', config.trustProxy ?? 1);
  app.set('case sensitive routing', true);
  app.set('strict routing', false);
  app.disable('x-powered-by');

  const json = express.json({ limit: JSON_LIMIT });

  const today = () => todayISO(config.tz, nowFn());
  const stamp = () => nowStamp(nowFn());

  function baseCtx(extra = {}) {
    const data = store.read();
    return {
      now: stamp(),
      today: today(),
      tz: config.tz,
      actor: 'broker',
      rules: data.rules,
      statements: data.statements,
      ...extra,
    };
  }

  function partnerById(data, id) {
    return data.partners.find((p) => p.id === id) || null;
  }

  function partnerName(data, id) {
    if (!id) return null;
    if (id === 'direct') return 'Direct';
    return partnerById(data, id)?.name || id;
  }

  function lastMessageForDeal(data, dealId) {
    let latest = null;
    for (const m of data.messages) {
      if (m.dealId !== dealId || m.status !== 'sent') continue;
      if (!latest || String(m.sentAt || '') > String(latest.sentAt || '')) latest = m;
    }
    return latest;
  }

  /** The deal as the broker UI wants it: the record plus derived facts. */
  function dealView(data, deal) {
    const day = today();
    const rag = ragForDeal(deal);
    const partner = deal.referredBy && deal.referredBy !== 'direct' ? partnerById(data, deal.referredBy) : null;
    const rule = isReferred(deal)
      ? resolveRule(data.rules, { partnerId: deal.referredBy, onDate: deal.keyDates?.settledAt || deal.referredAt || day })
      : null;
    const projected = isReferred(deal) ? computeCommission(deal, rule) : null;
    const last = lastMessageForDeal(data, deal.id);
    return {
      ...deal,
      partnerName: partnerName(data, deal.referredBy),
      partnerConsentReady: deal.consent?.shareStatus === true,
      ragDetail: rag,
      daysInStage: daysInStage(deal, day),
      nextMilestone: nextMilestone(deal, day),
      clientLabel: clientLabel(deal),
      clientInitials: clientInitials(deal),
      stageLabel: stageLabel(deal.stage),
      commission: projected
        ? {
          ruleId: rule?.id || null,
          ruleName: rule?.name || null,
          ruleDescription: rule ? describeRule(rule) : null,
          projectedAmount: projected.amount,
          basis: projected.basis,
          anomalies: projected.anomalies,
          status: deal.referralComms?.status || 'pending',
          recordedAmount: deal.referralComms?.amount ?? null,
          statementId: deal.referralComms?.statementId || null,
          paidAt: deal.referralComms?.paidAt || null,
        }
        : {
          ruleId: null,
          ruleName: null,
          ruleDescription: null,
          projectedAmount: null,
          basis: deal.referredBy === 'direct' ? 'Direct deal, no referral commission' : 'No referrer recorded',
          anomalies: [],
          status: deal.referralComms?.status || 'not_applicable',
          recordedAmount: null,
          statementId: null,
          paidAt: null,
        },
      lastUpdate: last
        ? { id: last.id, at: last.sentAt, stage: last.stage, channels: last.channels, smsBody: last.smsBody }
        : null,
      onIssuedStatement: isOnIssuedStatement(deal.id, data.statements)?.id || null,
      partnerPhone: partner?.phone || null,
      partnerEmail: partner?.email || null,
    };
  }

  function partnerView(data, partner) {
    const day = today();
    const mine = data.deals.filter((d) => d.referredBy === partner.id);
    const settled = mine.filter((d) => d.stage === 'settled');
    const thisMonth = monthKey(day);
    const statements = data.statements.filter((s) => s.partnerId === partner.id);
    return {
      id: partner.id,
      name: partner.name,
      agency: partner.agency || null,
      office: partner.office || null,
      phone: partner.phone || null,
      email: partner.email || null,
      createdAt: partner.createdAt || null,
      tokenRotatedAt: partner.tokenRotatedAt || null,
      portalToken: partner.portalToken || null,
      scanToken: partner.scanToken || null,
      portalUrl: portalUrl(partner),
      scanUrl: scanUrl(partner),
      openHomes: partner.openHomes || [],
      stats: {
        dealsReferred: mine.length,
        inFlight: mine.filter((d) => isLive(d.stage)).length,
        settled: settled.length,
        settledThisMonth: settled.filter((d) => (d.keyDates?.settledAt || '').startsWith(thisMonth)).length,
        consented: mine.filter((d) => d.consent?.shareStatus === true).length,
        updatesSent: data.messages.filter((m) => m.partnerId === partner.id && m.status === 'sent').length,
        enquiries: data.enquiries.filter((e) => e.partnerId === partner.id).length,
        commsDue: statementNumbers({ partnerId: partner.id, deals: data.deals, period: previousMonthKey(thisMonth), today: day, rules: data.rules }).commsDue,
        paidYtd: statementNumbers({ partnerId: partner.id, deals: data.deals, period: thisMonth, today: day, rules: data.rules }).paidYtd,
      },
      statements: statements
        .map((s) => ({ id: s.id, period: s.period, periodLabel: s.periodLabel, status: s.status, total: s.total, issuedAt: s.issuedAt, paidAt: s.paidAt, lines: (s.lines || []).length }))
        .sort((a, b) => (a.period < b.period ? 1 : -1)),
      surveys: data.surveys.filter((s) => s.partnerId === partner.id),
      referrals: data.referrals.filter((r) => r.partnerId === partner.id),
    };
  }

  function portalUrl(partner) {
    if (!partner?.portalToken) return null;
    const base = config.publicUrl ? config.publicUrl.replace(/\/$/, '') : '';
    return `${base}/#/portal/${partner.portalToken}`;
  }

  function scanUrl(partner) {
    if (!partner?.scanToken) return null;
    const base = config.publicUrl ? config.publicUrl.replace(/\/$/, '') : '';
    return `${base}/#/refer/${partner.scanToken}`;
  }

  function ensureTokens(partner) {
    if (!partner.portalToken) partner.portalToken = portalToken();
    if (!partner.scanToken) partner.scanToken = portalToken();
    return partner;
  }

  function findPartnerByToken(data, token, field = 'portalToken') {
    if (!token || String(token).length < 20) return null;
    return data.partners.find((p) => p[field] === token) || null;
  }

  function logAi(entry) {
    store.update((data) => {
      data.aiLog.push(entry);
      if (data.aiLog.length > (config.ai.logLimit || 200)) data.aiLog.shift();
      return entry;
    }).catch((err) => logger.warn?.(`[app] could not persist the AI log: ${err.message}`));
  }
  if (typeof ai.setLogSink === 'function') ai.setLogSink(logAi);

  // ---------------------------------------------------------------- guards --
  app.use(auth.caseGuard());
  app.use(auth.attach());

  // ---------------------------------------------------------------- public --
  app.get('/api/health', (req, res) => {
    const data = store.read();
    const health = configHealth(config);
    const signedIn = Boolean(req.session) || !config.auth.enabled;
    if (!signedIn) {
      // A stranger gets liveness and nothing that enumerates the register.
      res.json({ ok: true, authEnabled: true, signedIn: false, today: today() });
      return;
    }
    res.json({
      ...health,
      signedIn: true,
      today: today(),
      now: stamp(),
      counts: seedSummary(data),
      store: { file: path.basename(store.filePath), writes: store.writeCount },
      ai: ai.status(),
      delivery: delivery.status(),
    });
  });

  app.post('/api/login', json, (req, res) => auth.login(req, res));
  app.post('/api/logout', (req, res) => auth.logout(req, res));
  app.get('/api/session', (req, res) => auth.session(req, res));

  // Agent portal, reached with a private token.
  app.get('/api/portal/:token', asyncRoute(async (req, res) => {
    const data = store.read();
    const partner = findPartnerByToken(data, req.params.token);
    if (!partner) return fail(res, 404, 'not_found', 'That link is not valid any more. Ask for a fresh one.');
    const day = today();
    const mine = data.deals
      .filter((d) => d.referredBy === partner.id)
      .sort((a, b) => (a.stage === 'settled' ? 1 : 0) - (b.stage === 'settled' ? 1 : 0)
        || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    const messagesByDeal = new Map();
    for (const deal of mine) {
      const last = lastMessageForDeal(data, deal.id);
      if (last) messagesByDeal.set(deal.id, last);
    }
    const statements = data.statements
      .filter((s) => s.partnerId === partner.id && (s.status === 'issued' || s.status === 'paid'))
      .sort((a, b) => (a.period < b.period ? 1 : -1));
    const survey = data.surveys
      .filter((s) => s.partnerId === partner.id)
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))[0] || null;

    const payload = portalPayload({
      partner,
      deals: mine,
      statements,
      messagesByDeal,
      firm: data.firm,
      broker: data.firm.broker,
      today: day,
      survey,
      publicUrl: config.publicUrl,
    });
    payload.questions = PULSE_QUESTIONS;
    payload.scanUrl = scanUrl(partner);
    payload.openHomes = (partner.openHomes || []).map((o) => ({ address: o.address, date: o.date, time: o.time || null }));

    const leaks = findForbiddenKeys(payload);
    if (leaks.length) {
      logger.error?.(`[portal] blocked a response that carried ${leaks.join(', ')}`);
      return fail(res, 500, 'portal_leak_blocked', 'The portal response was blocked because it carried a field partners must never see.');
    }
    return res.json(payload);
  }));

  app.get('/api/portal/:token/qr.png', asyncRoute(async (req, res) => {
    const data = store.read();
    const partner = findPartnerByToken(data, req.params.token);
    if (!partner) return fail(res, 404, 'not_found', 'That link is not valid any more.');
    const target = scanUrl(partner) || `#/refer/${partner.scanToken || ''}`;
    const png = await QRCode.toBuffer(target, { width: 512, margin: 1, color: { dark: '#1a2744', light: '#ffffff' } });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(png);
  }));

  app.get('/api/portal/:token/signin-sheet', asyncRoute(async (req, res) => {
    const data = store.read();
    const partner = findPartnerByToken(data, req.params.token);
    if (!partner) return fail(res, 404, 'not_found', 'That link is not valid any more.');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(await signInSheetHtml(data, partner));
  }));

  app.post('/api/portal/:token/survey', auth.formLimiter(), json, asyncRoute(async (req, res) => {
    const data = store.read();
    const partner = findPartnerByToken(data, req.params.token);
    if (!partner) return fail(res, 404, 'not_found', 'That link is not valid any more.');
    const answers = Array.isArray(req.body?.answers) ? req.body.answers.slice(0, 3).map((a) => Number(a)) : [];
    if (answers.length !== 3 || answers.some((a) => !Number.isFinite(a) || a < 1 || a > 5)) {
      return fail(res, 400, 'bad_answers', 'Answer all three questions with a number from 1 to 5.');
    }
    const week = Number(req.body?.week);
    const entry = {
      id: randomId('sv', 8),
      partnerId: partner.id,
      week: Number.isFinite(week) && week > 0 ? Math.min(52, Math.round(week)) : 3,
      at: stamp(),
      answers,
      comment: str(req.body?.comment, 500),
    };
    await store.update((d) => { d.surveys.push(entry); return entry; });
    return res.json({ ok: true, survey: { week: entry.week, at: entry.at } });
  }));

  app.post('/api/portal/:token/refer', auth.formLimiter(), json, asyncRoute(async (req, res) => {
    const data = store.read();
    const partner = findPartnerByToken(data, req.params.token);
    if (!partner) return fail(res, 404, 'not_found', 'That link is not valid any more.');
    return handleReferral(req, res, partner, 'portal');
  }));

  // Public buyer form behind the open-home QR. It exposes nothing but a name.
  app.get('/api/scan/:token', asyncRoute(async (req, res) => {
    const data = store.read();
    const partner = findPartnerByToken(data, req.params.token, 'scanToken');
    if (!partner) return fail(res, 404, 'not_found', 'That code is not valid any more.');
    return res.json({
      partnerFirstName: String(partner.name || '').split(' ')[0],
      agency: partner.agency || null,
      firm: data.firm.name,
      broker: data.firm.broker,
    });
  }));

  app.post('/api/scan/:token/refer', auth.formLimiter(), json, asyncRoute(async (req, res) => {
    const data = store.read();
    const partner = findPartnerByToken(data, req.params.token, 'scanToken');
    if (!partner) return fail(res, 404, 'not_found', 'That code is not valid any more.');
    return handleReferral(req, res, partner, 'scan');
  }));

  async function handleReferral(req, res, partner, source) {
    const buyerName = str(req.body?.buyerName, 120);
    const buyerPhone = str(req.body?.buyerPhone, 40);
    const buyerEmail = str(req.body?.buyerEmail, 160);
    const note = str(req.body?.note, 600);
    if (!buyerName) return fail(res, 400, 'missing_name', 'Add the buyer\'s name so we know who to call.');
    if (!buyerPhone && !buyerEmail) return fail(res, 400, 'missing_contact', 'Add a phone number or an email so we can reach them.');
    if (req.body?.consentToContact !== true) {
      return fail(res, 400, 'consent_required', 'Tick the box to confirm the buyer agreed to be contacted.');
    }
    const entry = {
      id: randomId('ref', 8),
      at: stamp(),
      partnerId: partner.id,
      buyerName,
      buyerPhone,
      buyerEmail,
      note,
      consentToContact: true,
      source,
      status: 'new',
      dealId: null,
    };
    await store.update((d) => { d.referrals.push(entry); return entry; });
    logger.info?.(`[referral] ${partner.name} referred ${buyerName} via ${source}`);
    return res.json({ ok: true, message: `Thanks. ${String(partner.name || '').split(' ')[0]} - we will call ${buyerName} within one business day.` });
  }

  // ------------------------------------------------------------- protected --
  const api = express.Router({ caseSensitive: true });
  app.use('/api', auth.require(), json, api);

  api.get('/bootstrap', (req, res) => {
    const data = store.read();
    const day = today();
    res.json({
      firm: data.firm,
      settings: data.settings,
      today: day,
      tz: config.tz,
      authEnabled: config.auth.enabled,
      publicUrl: config.publicUrl,
      pilotOffice: config.firm.office,
      ai: ai.status(),
      delivery: delivery.status(),
      health: configHealth(config),
      pulse: livePulse({ deals: data.deals, statements: data.statements, messages: data.messages, today: day }),
      counts: seedSummary(data),
      stages: STAGES,
      offRamps: OFF_RAMPS,
      purposes: PURPOSES,
      tenFields: TEN_FIELDS,
      enquiryKinds: ENQUIRY_KINDS,
      ruleTypes: RULE_TYPES,
      pulseQuestions: PULSE_QUESTIONS,
      periods: periodsWithSettlements(data.deals),
    });
  });

  api.get('/samples', (req, res) => {
    res.json({ samples: buildSamples({ today: today(), tz: config.tz, firm: store.read().firm }) });
  });

  /** In-memory first, then anything persisted from an earlier run. */
  function mergedAiLog(data) {
    const seen = new Set();
    const merged = [];
    for (const row of [...(ai.recentLog ? ai.recentLog() : []), ...[...(data.aiLog || [])].reverse()]) {
      if (!row?.id || seen.has(row.id)) continue;
      seen.add(row.id);
      merged.push(row);
    }
    return merged;
  }

  api.get('/ai/log', (req, res) => {
    res.json({ status: ai.status(), log: mergedAiLog(store.read()).slice(0, 100) });
  });

  // --- deals ---------------------------------------------------------------
  api.get('/deals', (req, res) => {
    const data = store.read();
    const stage = str(req.query?.stage, 30);
    const partnerId = str(req.query?.partner, 60);
    const rag = str(req.query?.rag, 10);
    let deals = data.deals;
    if (stage && isStage(stage)) deals = deals.filter((d) => d.stage === stage);
    if (partnerId) deals = deals.filter((d) => d.referredBy === partnerId);
    if (rag) deals = deals.filter((d) => d.rag === rag);
    const views = deals
      .map((d) => dealView(data, d))
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    res.json({
      deals: views,
      byStage: ALL_STAGES.reduce((acc, key) => {
        acc[key] = views.filter((d) => d.stage === key).map((d) => d.id);
        return acc;
      }, {}),
      partners: data.partners.map((p) => ({ id: p.id, name: p.name, agency: p.agency })),
      today: today(),
    });
  });

  api.get('/deals/:id', (req, res) => {
    const data = store.read();
    const deal = data.deals.find((d) => d.id === req.params.id);
    if (!deal) return fail(res, 404, 'not_found', 'That deal is not in the register.');
    return res.json({ deal: dealView(data, deal), partners: data.partners.map((p) => ({ id: p.id, name: p.name })) });
  });

  api.post('/deals', asyncRoute(async (req, res) => {
    const body = req.body || {};
    const result = await store.update((data) => {
      const ctx = baseCtx({ rules: data.rules, statements: data.statements, refCounter: data.counters.deal });
      const deal = createDeal({
        ...(body.record || body),
        consent: body.consent,
        channel: body.channel || 'manual',
        source: body.source || null,
        summary: body.summary,
        questions: body.questions,
        confidence: body.confidence,
        arrivalRag: body.arrivalRag,
        aiProvider: body.aiProvider,
      }, ctx);
      if (body.consent && typeof body.consent === 'object') {
        const applied = setConsent(deal, {
          shareStatus: body.consent.shareStatus === true,
          feeDisclosed: body.consent.feeDisclosed === true,
          evidence: body.consent.shareStatusEvidence || body.consent.feeDisclosedEvidence || null,
        }, ctx);
        Object.assign(deal, applied.deal);
      }
      data.counters.deal = (data.counters.deal || 1) + 1;
      data.deals.push(deal);
      return deal;
    });
    const data = store.read();
    return res.status(201).json({ deal: dealView(data, result) });
  }));

  api.patch('/deals/:id', asyncRoute(async (req, res) => {
    let error = null;
    const result = await store.update((data) => {
      const index = data.deals.findIndex((d) => d.id === req.params.id);
      if (index < 0) { error = { status: 404, code: 'not_found', message: 'That deal is not in the register.' }; return null; }
      const ctx = baseCtx({ rules: data.rules, statements: data.statements });
      const current = data.deals[index];
      const locking = ['loanAmount', 'referredBy'].filter((key) => req.body?.[key] !== undefined);
      if (current.stage === 'settled' && locking.length && isOnIssuedStatement(current.id, data.statements)) {
        error = {
          status: 409,
          code: 'locked',
          message: `This deal is on an issued statement. Void that statement before changing the ${locking.join(' or ')}.`,
        };
        return null;
      }
      const { deal, changes } = patchDeal(current, req.body || {}, ctx);
      data.deals[index] = deal;
      return { deal, changes };
    });
    if (error) return fail(res, error.status, error.code, error.message);
    const data = store.read();
    return res.json({ deal: dealView(data, result.deal), changes: result.changes });
  }));

  api.post('/deals/:id/stage', asyncRoute(async (req, res) => {
    let error = null;
    const result = await store.update((data) => {
      const index = data.deals.findIndex((d) => d.id === req.params.id);
      if (index < 0) { error = { status: 404, code: 'not_found', message: 'That deal is not in the register.' }; return null; }
      const ctx = baseCtx({ rules: data.rules, statements: data.statements });
      const stage = str(req.body?.stage, 30);
      if (!stage || !isStage(stage)) {
        error = { status: 400, code: 'bad_stage', message: `${stage || 'That'} is not a stage.` };
        return null;
      }
      const eventDate = isValidISODate(req.body?.eventDate) ? req.body.eventDate : null;
      const moved = moveStage(data.deals[index], {
        stage,
        eventDate,
        keyDates: req.body?.keyDates,
        reason: str(req.body?.reason, 200),
      }, ctx);
      if (!moved.ok) {
        error = { status: 409, code: moved.error.reason, message: moved.error.message };
        return null;
      }
      data.deals[index] = moved.deal;
      return moved;
    });
    if (error) return fail(res, error.status, error.code, error.message);
    const data = store.read();
    return res.json({ deal: dealView(data, result.deal), from: result.from, to: result.to });
  }));

  api.post('/deals/:id/reopen', asyncRoute(async (req, res) => {
    let error = null;
    const result = await store.update((data) => {
      const index = data.deals.findIndex((d) => d.id === req.params.id);
      if (index < 0) { error = { status: 404, code: 'not_found', message: 'That deal is not in the register.' }; return null; }
      const ctx = baseCtx({ rules: data.rules, statements: data.statements });
      const stage = str(req.body?.stage, 30) || 'formal';
      const outcome = reopenDeal(data.deals[index], { stage, reason: str(req.body?.reason, 200) }, ctx);
      if (!outcome.ok) {
        error = { status: 409, code: outcome.error.reason, message: outcome.error.message, extra: { statementId: outcome.error.statementId } };
        return null;
      }
      const dealId = outcome.deal.id;
      const removedFrom = [];
      for (const statement of data.statements) {
        if (statement.status !== 'draft') continue;
        const before = (statement.lines || []).length;
        statement.lines = (statement.lines || []).filter((l) => l.dealId !== dealId);
        if (statement.lines.length !== before) {
          statement.total = statement.lines.reduce((acc, l) => acc + (Number(l.amount) || 0), 0);
          statement.history = [...(statement.history || []), {
            at: ctx.now,
            type: 'line_removed',
            message: `Line for ${outcome.deal.ref} removed because the deal was reopened.`,
          }];
          removedFrom.push(statement.id);
        }
      }
      if (removedFrom.length) {
        appendTimeline(outcome.deal, timelineEvent({
          type: 'statement_line_removed',
          message: `Removed from draft statement ${removedFrom.join(', ')} on reopen.`,
          meta: { statements: removedFrom },
          actor: 'system',
          at: ctx.now,
        }));
      }
      data.deals[index] = outcome.deal;
      return { deal: outcome.deal, removedFrom };
    });
    if (error) return fail(res, error.status, error.code, error.message, error.extra || {});
    const data = store.read();
    return res.json({ deal: dealView(data, result.deal), removedFromStatements: result.removedFrom });
  }));

  api.post('/deals/:id/consent', asyncRoute(async (req, res) => {
    let error = null;
    const result = await store.update((data) => {
      const index = data.deals.findIndex((d) => d.id === req.params.id);
      if (index < 0) { error = { status: 404, code: 'not_found', message: 'That deal is not in the register.' }; return null; }
      const ctx = baseCtx({ rules: data.rules, statements: data.statements });
      const applied = setConsent(data.deals[index], {
        shareStatus: typeof req.body?.shareStatus === 'boolean' ? req.body.shareStatus : undefined,
        feeDisclosed: typeof req.body?.feeDisclosed === 'boolean' ? req.body.feeDisclosed : undefined,
        evidence: str(req.body?.evidence, 300),
      }, ctx);
      data.deals[index] = applied.deal;
      return applied;
    });
    if (error) return fail(res, error.status, error.code, error.message);
    const data = store.read();
    return res.json({ deal: dealView(data, result.deal), changes: result.changes });
  }));

  api.post('/deals/:id/notes', asyncRoute(async (req, res) => {
    let error = null;
    const result = await store.update((data) => {
      const index = data.deals.findIndex((d) => d.id === req.params.id);
      if (index < 0) { error = { status: 404, code: 'not_found', message: 'That deal is not in the register.' }; return null; }
      const ctx = baseCtx({ rules: data.rules, statements: data.statements });
      const text = str(req.body?.text, 2000);
      if (!text) { error = { status: 400, code: 'empty_note', message: 'Write something before saving the note.' }; return null; }
      const applied = addNote(data.deals[index], { text, author: str(req.body?.author, 60) || 'broker' }, ctx);
      data.deals[index] = applied.deal;
      return applied;
    });
    if (error) return fail(res, error.status, error.code, error.message);
    const data = store.read();
    return res.json({ deal: dealView(data, result.deal), note: result.note });
  }));

  api.post('/deals/:id/enquiry', asyncRoute(async (req, res) => {
    let error = null;
    const result = await store.update((data) => {
      const index = data.deals.findIndex((d) => d.id === req.params.id);
      if (index < 0) { error = { status: 404, code: 'not_found', message: 'That deal is not in the register.' }; return null; }
      const ctx = baseCtx({ rules: data.rules, statements: data.statements });
      const applied = logEnquiry(data.deals[index], {
        kind: str(req.body?.kind, 40) || 'where_is_my_deal',
        note: str(req.body?.note, 400),
        partnerId: str(req.body?.partnerId, 60),
      }, ctx);
      data.deals[index] = applied.deal;
      data.enquiries.push({ ...applied.enquiry, dealId: applied.deal.id });
      return applied;
    });
    if (error) return fail(res, error.status, error.code, error.message);
    const data = store.read();
    return res.json({ deal: dealView(data, result.deal), enquiry: result.enquiry });
  }));

  api.post('/deals/:id/recompute-comms', asyncRoute(async (req, res) => {
    let error = null;
    const result = await store.update((data) => {
      const index = data.deals.findIndex((d) => d.id === req.params.id);
      if (index < 0) { error = { status: 404, code: 'not_found', message: 'That deal is not in the register.' }; return null; }
      const ctx = baseCtx({ rules: data.rules, statements: data.statements });
      const deal = { ...data.deals[index] };
      const outcome = applyCommission(deal, ctx);
      appendTimeline(deal, timelineEvent({
        type: 'commission_computed',
        message: outcome.rule
          ? `Referral commission recomputed to ${formatMoney(outcome.amount)} (${outcome.basis}).`
          : 'Recomputed: no commission rule applies.',
        meta: { amount: outcome.amount, ruleId: outcome.rule?.id || null },
        actor: 'broker',
        at: ctx.now,
      }));
      deal.updatedAt = ctx.now;
      data.deals[index] = deal;
      return deal;
    });
    if (error) return fail(res, error.status, error.code, error.message);
    const data = store.read();
    return res.json({ deal: dealView(data, result) });
  }));

  // --- handover ------------------------------------------------------------
  api.post('/handover/extract', asyncRoute(async (req, res) => {
    const text = str(req.body?.text, 20000);
    if (!text) return fail(res, 400, 'empty_text', 'Paste the handover first.');
    const data = store.read();
    const useAi = req.body?.useAi !== false;
    const { data: extraction, meta } = await ai.extractHandover({
      text,
      channel: str(req.body?.channel, 20) || 'notes',
      partners: data.partners,
      today: today(),
      tz: config.tz,
      broker: data.firm.broker,
      firm: data.firm.name,
      useAi,
    });
    const preview = normaliseDeal(extraction.record, { tz: config.tz, today: today() });
    const rag = ragForDeal(preview);
    return res.json({
      extraction: { ...extraction, rag: rag.rag, missing: rag.missing, missingFields: rag.missingFields },
      preview: {
        ...preview,
        partnerName: partnerName(data, preview.referredBy),
        clientLabel: clientLabel(preview),
        ragDetail: rag,
      },
      meta,
    });
  }));

  api.post('/handover/commit', asyncRoute(async (req, res) => {
    const body = req.body || {};
    if (!body.record) return fail(res, 400, 'missing_record', 'There is nothing to add to the queue yet.');
    const consent = body.consent || {};
    const result = await store.update((data) => {
      const ctx = baseCtx({ rules: data.rules, statements: data.statements, refCounter: data.counters.deal });
      const deal = createDeal({
        ...body.record,
        channel: body.channel || body.record.channel || 'manual',
        source: str(body.source, 40),
        summary: str(body.summary, 400),
        questions: Array.isArray(body.questions) ? body.questions : [],
        confidence: body.confidence,
        aiProvider: str(body.provider, 30),
      }, ctx);
      const applied = setConsent(deal, {
        shareStatus: consent.shareStatus === true,
        feeDisclosed: consent.feeDisclosed === true,
        evidence: str(consent.shareStatusEvidence || consent.feeDisclosedEvidence, 300),
      }, ctx);
      const finalDeal = applied.deal;
      data.counters.deal = (data.counters.deal || 1) + 1;
      data.deals.push(finalDeal);
      return finalDeal;
    });
    const data = store.read();
    return res.status(201).json({ deal: dealView(data, result) });
  }));

  // --- milestone -----------------------------------------------------------
  api.post('/milestone/parse', asyncRoute(async (req, res) => {
    const text = str(req.body?.text, 20000);
    if (!text) return fail(res, 400, 'empty_text', 'Paste the BPU email first.');
    const data = store.read();
    const openDeals = openDealsFor(data.deals);
    const { data: parsed, meta } = await ai.parseMilestone({
      text,
      openDeals,
      today: today(),
      tz: config.tz,
      useAi: req.body?.useAi !== false,
    });
    const matched = parsed.dealId ? data.deals.find((d) => d.id === parsed.dealId) : null;
    return res.json({
      parsed,
      matched: matched ? dealView(data, matched) : null,
      alternates: (parsed.alternates || []).map((a) => {
        const deal = data.deals.find((d) => d.id === a.dealId);
        return {
          ...a,
          stageLabel: deal ? stageLabel(deal.stage) : null,
          partnerName: deal ? partnerName(data, deal.referredBy) : null,
        };
      }),
      meta,
    });
  }));

  api.post('/milestone/apply', asyncRoute(async (req, res) => {
    const dealId = str(req.body?.dealId, 60);
    const stage = str(req.body?.stage, 30);
    if (!dealId) return fail(res, 400, 'missing_deal', 'Pick which file this milestone belongs to.');
    if (!stage || !isStage(stage)) return fail(res, 400, 'missing_stage', 'Pick the milestone stage.');
    let error = null;
    const result = await store.update((data) => {
      const index = data.deals.findIndex((d) => d.id === dealId);
      if (index < 0) { error = { status: 404, code: 'not_found', message: 'That deal is not in the register.' }; return null; }
      const ctx = baseCtx({ rules: data.rules, statements: data.statements });
      const moved = moveStage(data.deals[index], {
        stage,
        eventDate: isValidISODate(req.body?.eventDate) ? req.body.eventDate : null,
        keyDates: req.body?.keyDates,
        reason: 'Read from a BPU milestone email.',
      }, ctx);
      if (!moved.ok) { error = { status: 409, code: moved.error.reason, message: moved.error.message }; return null; }
      const deal = moved.deal;
      deal.channel = deal.channel || 'milestone';
      appendTimeline(deal, timelineEvent({
        type: 'milestone_applied',
        message: `Milestone applied from a pasted BPU email (${stageLabel(stage)}).`,
        meta: { stage, provider: str(req.body?.provider, 30) },
        actor: 'broker',
        at: ctx.now,
      }));
      data.deals[index] = deal;
      return moved;
    });
    if (error) return fail(res, error.status, error.code, error.message);
    const data = store.read();
    return res.json({ deal: dealView(data, result.deal), from: result.from, to: result.to });
  }));

  // --- partner updates -----------------------------------------------------
  function draftContextFor(data, deal, { stage, eventDate }) {
    const partner = partnerById(data, deal.referredBy);
    return buildUpdateContext({
      deal,
      partner,
      firm: data.firm.name,
      broker: deal.broker || data.firm.broker,
      today: today(),
      eventDate: eventDate || today(),
      stage: stage || deal.stage,
    });
  }

  api.post('/deals/:id/draft-update', asyncRoute(async (req, res) => {
    const data = store.read();
    const deal = data.deals.find((d) => d.id === req.params.id);
    if (!deal) return fail(res, 404, 'not_found', 'That deal is not in the register.');
    const partner = partnerById(data, deal.referredBy);
    const gate = consentGate(deal, partner);
    const stage = str(req.body?.stage, 30) || deal.stage;
    const eventDate = isValidISODate(req.body?.eventDate) ? req.body.eventDate : today();
    const context = draftContextFor(data, deal, { stage, eventDate });
    const { data: draft, meta } = await ai.draftUpdate({ context, useAi: req.body?.useAi !== false });
    const smsCheck = checkCompliance(draft.sms);
    const emailCheck = checkCompliance(draft.email.body);
    return res.json({
      draft: {
        sms: draft.sms,
        emailSubject: draft.email.subject,
        emailBody: draft.email.body,
        provider: draft.provider,
        stage,
        eventDate,
      },
      compliance: { sms: smsCheck, email: emailCheck },
      gate,
      partner: partner ? { id: partner.id, name: partner.name, phone: partner.phone, email: partner.email } : null,
      smsLength: draft.sms.length,
      smsMax: SMS_MAX,
      meta,
    });
  }));

  api.post('/deals/:id/check-draft', (req, res) => {
    const sms = str(req.body?.sms, 2000) || '';
    const emailBody = str(req.body?.emailBody, 8000) || '';
    res.json({
      compliance: { sms: checkCompliance(sms), email: checkCompliance(emailBody) },
      smsLength: sms.length,
      smsMax: SMS_MAX,
    });
  });

  api.post('/deals/:id/send-update', asyncRoute(async (req, res) => {
    const data = store.read();
    const deal = data.deals.find((d) => d.id === req.params.id);
    if (!deal) return fail(res, 404, 'not_found', 'That deal is not in the register.');
    const partner = partnerById(data, deal.referredBy);
    const gate = consentGate(deal, partner);
    if (!gate.ok) return fail(res, 403, gate.reason, gate.message);

    const channels = Array.isArray(req.body?.channels) && req.body.channels.length
      ? req.body.channels.filter((c) => c === 'sms' || c === 'email')
      : ['sms'];
    if (!channels.length) return fail(res, 400, 'no_channel', 'Pick SMS, email or both.');

    const sms = str(req.body?.sms, 2000);
    const emailSubject = str(req.body?.emailSubject, 200);
    const emailBody = str(req.body?.emailBody, 8000);
    if (channels.includes('sms') && !sms) return fail(res, 400, 'empty_sms', 'The SMS is empty.');
    if (channels.includes('email') && (!emailSubject || !emailBody)) return fail(res, 400, 'empty_email', 'The email needs a subject and a body.');

    if (channels.includes('sms') && !partner.phone) {
      return fail(res, 400, 'no_partner_phone', `${partner.name} has no mobile number on file. Add one on the partner page.`);
    }
    if (channels.includes('email') && !partner.email) {
      return fail(res, 400, 'no_partner_email', `${partner.name} has no email address on file. Add one on the partner page.`);
    }
    const smsCheck = sms ? checkCompliance(sms) : { ok: true, blocked: [], warnings: [], hits: [] };
    const emailCheck = emailBody ? checkCompliance(emailBody) : { ok: true, blocked: [], warnings: [], hits: [] };
    const subjectCheck = emailSubject ? checkCompliance(emailSubject) : { ok: true, blocked: [], warnings: [], hits: [] };
    if ((channels.includes('sms') && !smsCheck.ok)
      || (channels.includes('email') && (!emailCheck.ok || !subjectCheck.ok))) {
      return fail(res, 422, 'compliance_blocked', blockReason(smsCheck.ok ? (emailCheck.ok ? subjectCheck : emailCheck) : smsCheck), {
        compliance: { sms: smsCheck, email: emailCheck, subject: subjectCheck },
      });
    }
    if (sms && sms.length > SMS_MAX) {
      return fail(res, 422, 'sms_too_long', `The SMS is ${sms.length} characters. Keep it under ${SMS_MAX}.`);
    }

    const deliveries = [];
    for (const channel of channels) {
      if (channel === 'sms') {
        deliveries.push(await delivery.sendSms({ to: partner.phone, body: sms }));
      } else {
        deliveries.push(await delivery.sendEmail({ to: partner.email, subject: emailSubject, body: emailBody }));
      }
    }
    const failed = deliveries.filter((d) => !d.ok);

    const message = {
      id: randomId('msg', 8),
      kind: 'update',
      status: failed.length === deliveries.length ? 'failed' : 'sent',
      createdAt: stamp(),
      sentAt: stamp(),
      dealId: deal.id,
      dealRef: deal.ref,
      partnerId: partner.id,
      partnerName: partner.name,
      stage: str(req.body?.stage, 30) || deal.stage,
      eventDate: isValidISODate(req.body?.eventDate) ? req.body.eventDate : today(),
      channels,
      smsBody: sms,
      emailSubject,
      emailBody,
      provider: str(req.body?.provider, 30) || 'template',
      deliveries,
      compliance: {
        ok: true,
        warnings: [...(smsCheck.warnings || []), ...(emailCheck.warnings || [])].map((w) => w.label),
      },
    };

    await store.update((d) => {
      d.messages.push(message);
      const index = d.deals.findIndex((x) => x.id === deal.id);
      if (index >= 0) {
        const ctx = baseCtx({ rules: d.rules, statements: d.statements });
        d.deals[index] = recordUpdateSent(d.deals[index], { message }, ctx);
      }
      return message;
    });

    const after = store.read();
    return res.json({
      message,
      deal: dealView(after, after.deals.find((d) => d.id === deal.id)),
      failed: failed.length ? failed : null,
    });
  }));

  api.get('/messages', (req, res) => {
    const data = store.read();
    const partnerId = str(req.query?.partner, 60);
    const dealId = str(req.query?.deal, 60);
    let messages = [...data.messages];
    if (partnerId) messages = messages.filter((m) => m.partnerId === partnerId);
    if (dealId) messages = messages.filter((m) => m.dealId === dealId);
    messages.sort((a, b) => String(b.sentAt || b.createdAt || '').localeCompare(String(a.sentAt || a.createdAt || '')));
    res.json({ messages: messages.slice(0, 200) });
  });

  // --- partners ------------------------------------------------------------
  api.get('/partners', (req, res) => {
    const data = store.read();
    res.json({ partners: data.partners.map((p) => partnerView(data, p)) });
  });

  api.get('/partners/:id', (req, res) => {
    const data = store.read();
    const partner = partnerById(data, req.params.id);
    if (!partner) return fail(res, 404, 'not_found', 'That partner is not in the register.');
    const mine = data.deals.filter((d) => d.referredBy === partner.id);
    return res.json({
      partner: partnerView(data, partner),
      deals: mine.map((d) => dealView(data, d)),
      messages: data.messages
        .filter((m) => m.partnerId === partner.id)
        .sort((a, b) => String(b.sentAt || '').localeCompare(String(a.sentAt || '')))
        .slice(0, 50),
      statements: data.statements
        .filter((s) => s.partnerId === partner.id)
        .sort((a, b) => (a.period < b.period ? 1 : -1)),
    });
  });

  api.post('/partners', asyncRoute(async (req, res) => {
    const name = str(req.body?.name, 120);
    if (!name) return fail(res, 400, 'missing_name', 'A partner needs a name.');
    const partner = ensureTokens({
      id: randomId('p', 8),
      name,
      agency: str(req.body?.agency, 120),
      office: str(req.body?.office, 120) || config.firm.office,
      phone: str(req.body?.phone, 40),
      email: str(req.body?.email, 160),
      createdAt: stamp(),
      tokenRotatedAt: stamp(),
      openHomes: [],
    });
    await store.update((data) => { data.partners.push(partner); return partner; });
    const data = store.read();
    return res.status(201).json({ partner: partnerView(data, partner) });
  }));

  api.patch('/partners/:id', asyncRoute(async (req, res) => {
    let error = null;
    const result = await store.update((data) => {
      const partner = partnerById(data, req.params.id);
      if (!partner) { error = { status: 404, code: 'not_found', message: 'That partner is not in the register.' }; return null; }
      for (const key of ['name', 'agency', 'office', 'phone', 'email']) {
        if (req.body?.[key] !== undefined) partner[key] = str(req.body[key], 160);
      }
      return partner;
    });
    if (error) return fail(res, error.status, error.code, error.message);
    const data = store.read();
    return res.json({ partner: partnerView(data, result) });
  }));

  api.post('/partners/:id/rotate-token', asyncRoute(async (req, res) => {
    let error = null;
    const result = await store.update((data) => {
      const partner = partnerById(data, req.params.id);
      if (!partner) { error = { status: 404, code: 'not_found', message: 'That partner is not in the register.' }; return null; }
      partner.portalToken = portalToken();
      partner.scanToken = portalToken();
      partner.tokenRotatedAt = stamp();
      return partner;
    });
    if (error) return fail(res, error.status, error.code, error.message);
    const data = store.read();
    return res.json({ partner: partnerView(data, result), message: 'New link created. The old one stops working now.' });
  }));

  api.put('/partners/:id/open-homes', asyncRoute(async (req, res) => {
    let error = null;
    const result = await store.update((data) => {
      const partner = partnerById(data, req.params.id);
      if (!partner) { error = { status: 404, code: 'not_found', message: 'That partner is not in the register.' }; return null; }
      const list = Array.isArray(req.body?.openHomes) ? req.body.openHomes : [];
      partner.openHomes = list.slice(0, 20).map((o) => ({
        id: str(o?.id, 30) || randomId('oh', 6),
        address: str(o?.address, 200) || 'Address to confirm',
        date: isValidISODate(o?.date) ? o.date : nextSaturday(today()),
        time: str(o?.time, 20),
      }));
      return partner;
    });
    if (error) return fail(res, error.status, error.code, error.message);
    const data = store.read();
    return res.json({ partner: partnerView(data, result) });
  }));

  api.get('/partners/:id/qr.png', asyncRoute(async (req, res) => {
    const data = store.read();
    const partner = partnerById(data, req.params.id);
    if (!partner) return fail(res, 404, 'not_found', 'That partner is not in the register.');
    const which = req.query?.kind === 'portal' ? portalUrl(partner) : scanUrl(partner);
    const png = await QRCode.toBuffer(which || 'about:blank', { width: 512, margin: 1, color: { dark: '#1a2744', light: '#ffffff' } });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(png);
  }));

  api.get('/partners/:id/signin-sheet', asyncRoute(async (req, res) => {
    const data = store.read();
    const partner = partnerById(data, req.params.id);
    if (!partner) return fail(res, 404, 'not_found', 'That partner is not in the register.');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(await signInSheetHtml(data, partner));
  }));

  api.get('/referrals', (req, res) => {
    const data = store.read();
    res.json({
      referrals: [...data.referrals]
        .sort((a, b) => String(b.at).localeCompare(String(a.at)))
        .map((r) => ({ ...r, partnerName: partnerName(data, r.partnerId) })),
    });
  });

  // --- Friday note ---------------------------------------------------------
  api.get('/friday', asyncRoute(async (req, res) => {
    const data = store.read();
    const day = today();
    const saturday = nextSaturday(day);
    const cards = [];
    for (const partner of data.partners) {
      const mine = data.deals.filter((d) => d.referredBy === partner.id);
      const opens = (partner.openHomes || []).filter((o) => o.date >= day);
      const card = fridayCard({ partner, deals: mine, today: day, openHomes: opens });
      const { data: nudge, meta } = await ai.draftNudge({
        context: {
          partnerFirstName: card.firstName,
          opensCount: card.opensCount,
          openDay: opens[0]?.date ? dayName(opens[0].date) : 'Saturday',
          settledCount: card.agentHears.settledThisMonth,
          inFlightCount: card.agentHears.inFlight,
          broker: data.firm.broker,
          firm: data.firm.name,
        },
        useAi: req.query?.useAi === '1',
      });
      const compliance = checkCompliance(nudge.sms);
      cards.push({
        ...card,
        nudge: { sms: nudge.sms, provider: nudge.provider },
        compliance,
        meta,
        phone: partner.phone,
        email: partner.email,
        scanUrl: scanUrl(partner),
      });
    }
    return res.json({ today: day, saturday, saturdayLabel: formatLong(saturday), cards });
  }));

  api.post('/friday/:partnerId/draft', asyncRoute(async (req, res) => {
    const data = store.read();
    const partner = partnerById(data, req.params.partnerId);
    if (!partner) return fail(res, 404, 'not_found', 'That partner is not in the register.');
    const day = today();
    const mine = data.deals.filter((d) => d.referredBy === partner.id);
    const opens = (partner.openHomes || []).filter((o) => o.date >= day);
    const card = fridayCard({ partner, deals: mine, today: day, openHomes: opens });
    const { data: nudge, meta } = await ai.draftNudge({
      context: {
        partnerFirstName: card.firstName,
        opensCount: card.opensCount,
        openDay: opens[0]?.date ? dayName(opens[0].date) : 'Saturday',
        settledCount: card.agentHears.settledThisMonth,
        inFlightCount: card.agentHears.inFlight,
        broker: data.firm.broker,
        firm: data.firm.name,
      },
      useAi: req.body?.useAi !== false,
    });
    return res.json({ nudge, compliance: checkCompliance(nudge.sms), card, meta });
  }));

  api.post('/friday/:partnerId/send', asyncRoute(async (req, res) => {
    const data = store.read();
    const partner = partnerById(data, req.params.partnerId);
    if (!partner) return fail(res, 404, 'not_found', 'That partner is not in the register.');
    const sms = str(req.body?.sms, 1000);
    if (!sms) return fail(res, 400, 'empty_sms', 'The nudge is empty.');
    const check = checkCompliance(sms);
    if (!check.ok) return fail(res, 422, 'compliance_blocked', blockReason(check), { compliance: check });
    if (sms.length > SMS_MAX) return fail(res, 422, 'sms_too_long', `Keep the nudge under ${SMS_MAX} characters.`);

    const result = await delivery.sendSms({ to: partner.phone, body: sms });
    const message = {
      id: randomId('msg', 8),
      kind: 'nudge',
      status: result.ok ? 'sent' : 'failed',
      createdAt: stamp(),
      sentAt: stamp(),
      dealId: null,
      dealRef: null,
      partnerId: partner.id,
      partnerName: partner.name,
      stage: null,
      eventDate: today(),
      channels: ['sms'],
      smsBody: sms,
      emailSubject: null,
      emailBody: null,
      provider: str(req.body?.provider, 30) || 'template',
      deliveries: [result],
      compliance: { ok: true, warnings: (check.warnings || []).map((w) => w.label) },
    };
    await store.update((d) => { d.messages.push(message); return message; });
    return res.json({ message });
  }));

  // --- statements ----------------------------------------------------------
  api.get('/statements', (req, res) => {
    const data = store.read();
    const day = today();
    res.json({
      statements: [...data.statements]
        .sort((a, b) => (String(b.period).localeCompare(String(a.period))) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
        .map((s) => ({
          id: s.id,
          partnerId: s.partnerId,
          partnerName: s.partnerName,
          period: s.period,
          periodLabel: s.periodLabel || monthLabel(s.period),
          status: s.status,
          total: s.total,
          lineCount: (s.lines || []).length,
          anomalyCount: (s.anomalies || []).length,
          createdAt: s.createdAt,
          issuedAt: s.issuedAt,
          paidAt: s.paidAt,
          numbers: s.numbers,
        })),
      periods: periodsWithSettlements(data.deals),
      suggestedPeriod: previousMonthKey(monthKey(day)),
      registerAnomalies: registerAnomalies({ deals: data.deals, partners: data.partners, rules: data.rules, today: day })
        .map((a) => ({ ...a, partnerName: partnerName(data, a.partnerId) })),
    });
  });

  api.post('/statements/generate', asyncRoute(async (req, res) => {
    const period = str(req.body?.period, 10) || previousMonthKey(monthKey(today()));
    if (!/^\d{4}-\d{2}$/.test(period)) return fail(res, 400, 'bad_period', 'Use a period like 2026-08.');
    const day = today();
    const created = await store.update((data) => {
      const out = [];
      for (const partner of data.partners) {
        const existing = data.statements.find((s) => s.partnerId === partner.id && s.period === period && s.status !== 'void');
        if (existing) { out.push({ statement: existing, existing: true }); continue; }
        const statement = buildStatement({
          partner,
          deals: data.deals,
          rules: data.rules,
          period,
          today: day,
          statements: data.statements,
          id: `st_${period.replace('-', '')}_${partner.id}`,
          createdAt: stamp(),
        });
        if (!statement.lines.length) continue;
        const note = templateStatementNote({
          partnerFirstName: String(partner.name || '').split(' ')[0],
          periodLabel: statement.periodLabel,
          numbers: statement.numbers,
          broker: data.firm.broker,
          firm: data.firm.name,
        });
        statement.coverNote = note.text;
        statement.coverNoteProvider = note.provider;
        statement.history = [{ at: statement.createdAt, type: 'generated', message: `Generated for ${statement.periodLabel}` }];
        data.statements.push(statement);
        data.counters.statement = (data.counters.statement || 1) + 1;
        out.push({ statement, existing: false });
      }
      return out;
    });
    return res.json({
      period,
      periodLabel: monthLabel(period),
      created: created.filter((c) => !c.existing).map((c) => c.statement.id),
      existing: created.filter((c) => c.existing).map((c) => c.statement.id),
      statements: created.map((c) => c.statement),
    });
  }));

  function statementDetail(data, statement) {
    // A draft reports the live five numbers; an issued or paid statement keeps
    // the numbers it was issued with, because that is what the partner was sent.
    const numbers = statement.status === 'draft'
      ? statementNumbers({
        partnerId: statement.partnerId,
        deals: data.deals,
        period: statement.period,
        today: today(),
        rules: data.rules,
      })
      : statement.numbers;
    return {
      ...statement,
      numbers,
      partnerName: statement.partnerName || partnerName(data, statement.partnerId),
      periodLabel: statement.periodLabel || monthLabel(statement.period),
      lines: (statement.lines || []).map((l) => ({ ...l })),
      anomalies: statement.anomalies || [],
      allowedNumbers: statementNoteAllowedNumbers(statement),
      coverNoteCompliance: statement.coverNote
        ? checkStatementNote(statement.coverNote, statementNoteAllowedNumbers(statement))
        : null,
    };
  }

  api.get('/statements/:id', (req, res) => {
    const data = store.read();
    const statement = data.statements.find((s) => s.id === req.params.id);
    if (!statement) return fail(res, 404, 'not_found', 'That statement does not exist.');
    const partner = partnerById(data, statement.partnerId);
    return res.json({
      statement: statementDetail(data, statement),
      partner: partner ? { id: partner.id, name: partner.name, phone: partner.phone, email: partner.email, portalUrl: portalUrl(partner) } : null,
      recheck: recheckLines(statement, data.deals, data.rules, today()),
    });
  });

  api.patch('/statements/:id', asyncRoute(async (req, res) => {
    let error = null;
    const result = await store.update((data) => {
      const statement = data.statements.find((s) => s.id === req.params.id);
      if (!statement) { error = { status: 404, code: 'not_found', message: 'That statement does not exist.' }; return null; }
      if (req.body?.coverNote !== undefined) {
        const note = str(req.body.coverNote, 2000) || '';
        const check = checkStatementNote(note, statementNoteAllowedNumbers(statement));
        if (!check.ok) {
          error = { status: 422, code: 'compliance_blocked', message: blockReason(check), extra: { compliance: check } };
          return null;
        }
        statement.coverNote = note;
        statement.coverNoteProvider = str(req.body?.provider, 30) || 'broker';
        statement.history = [...(statement.history || []), { at: stamp(), type: 'note_edited', message: 'Cover note edited' }];
      }
      return statement;
    });
    if (error) return fail(res, error.status, error.code, error.message, error.extra || {});
    const data = store.read();
    return res.json({ statement: statementDetail(data, result) });
  }));

  api.post('/statements/:id/note', asyncRoute(async (req, res) => {
    const data = store.read();
    const statement = data.statements.find((s) => s.id === req.params.id);
    if (!statement) return fail(res, 404, 'not_found', 'That statement does not exist.');
    const partner = partnerById(data, statement.partnerId);
    const { data: note, meta } = await ai.writeStatementNote({
      statement,
      partner,
      firm: data.firm.name,
      broker: data.firm.broker,
      useAi: req.body?.useAi !== false,
    });
    const check = checkStatementNote(note.note, statementNoteAllowedNumbers(statement));
    return res.json({ note: note.note, provider: note.provider, compliance: check, meta });
  }));

  api.post('/statements/:id/issue', asyncRoute(async (req, res) => {
    let error = null;
    const result = await store.update((data) => {
      const statement = data.statements.find((s) => s.id === req.params.id);
      if (!statement) { error = { status: 404, code: 'not_found', message: 'That statement does not exist.' }; return null; }
      const gate = canIssue(statement);
      if (!gate.ok) { error = { status: 409, code: gate.reason, message: gate.message }; return null; }
      const day = today();
      const rechecked = recheckLines(statement, data.deals, data.rules, day);
      statement.lines = rechecked.lines;
      statement.total = rechecked.total;
      if (!statement.lines.length) {
        error = { status: 409, code: 'empty_after_recheck', message: 'Every line dropped out when re-checked against the register. Nothing to issue.', extra: { changes: rechecked.changes } };
        return null;
      }
      statement.numbers = statementNumbers({ partnerId: statement.partnerId, deals: data.deals, period: statement.period, today: day, rules: data.rules });
      statement.status = 'issued';
      statement.issuedAt = stamp();
      const startedAt = statement.createdAt ? Date.parse(statement.createdAt) : null;
      statement.productionSeconds = startedAt ? Math.max(0, Math.round((Date.parse(statement.issuedAt) - startedAt) / 1000)) : null;
      statement.history = [...(statement.history || []),
        { at: statement.issuedAt, type: 'issued', message: `Issued with ${statement.lines.length} line${statement.lines.length === 1 ? '' : 's'}`, changes: rechecked.changes },
      ];
      const ctx = baseCtx({ rules: data.rules, statements: data.statements });
      for (const line of statement.lines) {
        const index = data.deals.findIndex((d) => d.id === line.dealId);
        if (index < 0) continue;
        const deal = { ...data.deals[index] };
        deal.referralComms = {
          ...deal.referralComms,
          ruleId: line.ruleId,
          ruleName: line.ruleName,
          amount: line.amount,
          status: 'on_statement',
          statementId: statement.id,
        };
        appendTimeline(deal, timelineEvent({
          type: 'statement_issued',
          message: `On statement ${statement.id} for ${statement.periodLabel}: ${formatMoney(line.amount)}.`,
          meta: { statementId: statement.id, amount: line.amount, ruleId: line.ruleId },
          actor: 'broker',
          at: ctx.now,
        }));
        deal.updatedAt = ctx.now;
        data.deals[index] = deal;
      }
      return { statement, changes: rechecked.changes };
    });
    if (error) return fail(res, error.status, error.code, error.message, error.extra || {});
    const data = store.read();
    return res.json({ statement: statementDetail(data, result.statement), changes: result.changes });
  }));

  api.post('/statements/:id/paid', asyncRoute(async (req, res) => {
    let error = null;
    const result = await store.update((data) => {
      const statement = data.statements.find((s) => s.id === req.params.id);
      if (!statement) { error = { status: 404, code: 'not_found', message: 'That statement does not exist.' }; return null; }
      const gate = canMarkPaid(statement);
      if (!gate.ok) { error = { status: 409, code: gate.reason, message: gate.message }; return null; }
      const day = today();
      const rechecked = recheckLines(statement, data.deals, data.rules, day);
      const dropped = rechecked.changes.filter((c) => c.type === 'removed');
      if (dropped.length) {
        error = {
          status: 409,
          code: 'stale_statement',
          message: `${dropped.length} line${dropped.length === 1 ? '' : 's'} no longer match the register (${dropped.map((d) => d.dealRef).join(', ')}). Void this statement and generate it again.`,
          extra: { changes: rechecked.changes },
        };
        return null;
      }
      const changed = rechecked.changes.filter((c) => c.type === 'amount_changed');
      statement.lines = statement.lines.map((line) => {
        const update = rechecked.lines.find((l) => l.dealId === line.dealId);
        return update || line;
      });
      statement.total = rechecked.total;
      statement.status = 'paid';
      statement.paidAt = stamp();
      statement.history = [...(statement.history || []), { at: statement.paidAt, type: 'paid', message: `Marked paid (${formatMoney(statement.total)})`, changes: rechecked.changes }];
      const ctx = baseCtx({ rules: data.rules, statements: data.statements });
      for (const line of statement.lines) {
        const index = data.deals.findIndex((d) => d.id === line.dealId);
        if (index < 0) continue;
        const deal = { ...data.deals[index] };
        deal.referralComms = {
          ...deal.referralComms,
          amount: line.amount,
          status: 'paid',
          statementId: statement.id,
          paidAt: day,
        };
        appendTimeline(deal, timelineEvent({
          type: 'commission_paid',
          message: `Referral commission ${formatMoney(line.amount)} paid on statement ${statement.id}.`,
          meta: { statementId: statement.id, amount: line.amount },
          actor: 'broker',
          at: ctx.now,
        }));
        deal.updatedAt = ctx.now;
        data.deals[index] = deal;
      }
      return { statement, changes: changed };
    });
    if (error) return fail(res, error.status, error.code, error.message, error.extra || {});
    const data = store.read();
    return res.json({ statement: statementDetail(data, result.statement), changes: result.changes });
  }));

  api.post('/statements/:id/void', asyncRoute(async (req, res) => {
    const reason = str(req.body?.reason, 300);
    if (!reason) return fail(res, 400, 'missing_reason', 'Say why this statement is being voided.');
    let error = null;
    const result = await store.update((data) => {
      const statement = data.statements.find((s) => s.id === req.params.id);
      if (!statement) { error = { status: 404, code: 'not_found', message: 'That statement does not exist.' }; return null; }
      const gate = canVoid(statement);
      if (!gate.ok) { error = { status: 409, code: gate.reason, message: gate.message }; return null; }
      const wasPaid = statement.status === 'paid';
      statement.status = 'void';
      statement.voidedAt = stamp();
      statement.voidReason = reason;
      statement.history = [...(statement.history || []), { at: statement.voidedAt, type: 'void', message: `Voided: ${reason}` }];
      const ctx = baseCtx({ rules: data.rules, statements: data.statements });
      for (const line of statement.lines || []) {
        const index = data.deals.findIndex((d) => d.id === line.dealId);
        if (index < 0) continue;
        const deal = { ...data.deals[index] };
        deal.referralComms = {
          ...deal.referralComms,
          status: deal.stage === 'settled' ? 'due' : 'pending',
          statementId: null,
          paidAt: null,
        };
        appendTimeline(deal, timelineEvent({
          type: 'statement_voided',
          message: `Statement ${statement.id} voided (${reason}).${wasPaid ? ' This line had been marked paid.' : ''} Commission is due again.`,
          meta: { statementId: statement.id, reason },
          actor: 'broker',
          at: ctx.now,
        }));
        deal.updatedAt = ctx.now;
        data.deals[index] = deal;
      }
      return statement;
    });
    if (error) return fail(res, error.status, error.code, error.message);
    const data = store.read();
    return res.json({ statement: statementDetail(data, result) });
  }));

  api.post('/statements/:id/send', asyncRoute(async (req, res) => {
    const data = store.read();
    const statement = data.statements.find((s) => s.id === req.params.id);
    if (!statement) return fail(res, 404, 'not_found', 'That statement does not exist.');
    if (statement.status === 'draft') return fail(res, 409, 'not_issued', 'Issue the statement before sending it.');
    const partner = partnerById(data, statement.partnerId);
    if (!partner) return fail(res, 404, 'partner_missing', 'That partner is not in the register.');
    const note = str(req.body?.note, 2000) || statement.coverNote || '';
    const allowed = statementNoteAllowedNumbers(statement);
    const check = checkStatementNote(note, allowed);
    if (!check.ok) return fail(res, 422, 'compliance_blocked', blockReason(check), { compliance: check });

    const link = portalUrl(partner);
    const body = [note, link ? `Your statements are here: ${link}` : null].filter(Boolean).join('\n\n');
    const channels = Array.isArray(req.body?.channels) && req.body.channels.length
      ? req.body.channels.filter((c) => c === 'sms' || c === 'email')
      : ['email'];
    const deliveries = [];
    for (const channel of channels) {
      if (channel === 'sms') deliveries.push(await delivery.sendSms({ to: partner.phone, body }));
      else deliveries.push(await delivery.sendEmail({ to: partner.email, subject: `Your referral statement - ${statement.periodLabel}`, body }));
    }
    const message = {
      id: randomId('msg', 8),
      kind: 'statement',
      status: deliveries.every((d) => !d.ok) ? 'failed' : 'sent',
      createdAt: stamp(),
      sentAt: stamp(),
      dealId: null,
      dealRef: null,
      partnerId: partner.id,
      partnerName: partner.name,
      statementId: statement.id,
      stage: null,
      eventDate: today(),
      channels,
      smsBody: channels.includes('sms') ? body : null,
      emailSubject: `Your referral statement - ${statement.periodLabel}`,
      emailBody: body,
      provider: str(req.body?.provider, 30) || statement.coverNoteProvider || 'template',
      deliveries,
      compliance: { ok: true, warnings: (check.warnings || []).map((w) => w.label) },
    };
    await store.update((d) => {
      d.messages.push(message);
      const target = d.statements.find((s) => s.id === statement.id);
      if (target) {
        target.history = [...(target.history || []), { at: message.sentAt, type: 'sent', message: `Sent to ${partner.name} (${channels.join(' + ')})` }];
      }
      return message;
    });
    return res.json({ message });
  }));

  api.get('/statements/:id/export.csv', (req, res) => {
    const data = store.read();
    const statement = data.statements.find((s) => s.id === req.params.id);
    if (!statement) return fail(res, 404, 'not_found', 'That statement does not exist.');
    const csv = statementCsv(statement, { firm: data.firm });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${statementFileName(statement, 'csv')}"`);
    return res.send(csv);
  });

  api.get('/statements/:id/export.xlsx', asyncRoute(async (req, res) => {
    const data = store.read();
    const statement = data.statements.find((s) => s.id === req.params.id);
    if (!statement) return fail(res, 404, 'not_found', 'That statement does not exist.');
    const buffer = await statementWorkbook(statement, { firm: data.firm });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${statementFileName(statement, 'xlsx')}"`);
    return res.send(buffer);
  }));

  api.get('/register.xlsx', asyncRoute(async (req, res) => {
    const data = store.read();
    const day = today();
    const anomalies = [
      ...registerAnomalies({ deals: data.deals, partners: data.partners, rules: data.rules, today: day }),
      ...data.statements.flatMap((s) => (s.anomalies || []).map((a) => ({ ...a, partnerId: a.partnerId || s.partnerId }))),
    ];
    const buffer = await registerWorkbook(data, { anomalies, today: day });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="pulse-register-${day}.xlsx"`);
    return res.send(buffer);
  }));

  // --- metrics, settings, rules -------------------------------------------
  api.get('/metrics', (req, res) => {
    const data = store.read();
    const day = today();
    const metrics = computeMetrics({
      deals: data.deals,
      partners: data.partners,
      messages: data.messages,
      statements: data.statements,
      enquiries: data.enquiries,
      surveys: data.surveys,
      baselines: data.settings.baselines,
      today: day,
      pilotOffice: config.firm.office,
      valueModelInput: data.settings.valueModel,
    });
    res.json({
      ...metrics,
      aiStatus: ai.status(),
      aiLog: mergedAiLog(data).slice(0, 20),
      anomalies: registerAnomalies({ deals: data.deals, partners: data.partners, rules: data.rules, today: day }),
    });
  });

  api.put('/settings', asyncRoute(async (req, res) => {
    const result = await store.update((data) => {
      if (req.body?.firm && typeof req.body.firm === 'object') {
        for (const key of ['name', 'broker', 'office']) {
          if (req.body.firm[key] !== undefined) data.firm[key] = str(req.body.firm[key], 120) || data.firm[key];
        }
      }
      if (req.body?.baselines && typeof req.body.baselines === 'object') {
        for (const [key, value] of Object.entries(req.body.baselines)) {
          const n = Number(value);
          if (Number.isFinite(n) && n >= 0) data.settings.baselines[key] = n;
        }
      }
      if (req.body?.valueModel && typeof req.body.valueModel === 'object') {
        for (const key of ['extraSettlementsPerMonth', 'loanAmount', 'upfrontRate']) {
          const n = Number(req.body.valueModel[key]);
          if (Number.isFinite(n) && n >= 0) data.settings.valueModel[key] = n;
        }
      }
      return { firm: data.firm, settings: data.settings };
    });
    return res.json(result);
  }));

  api.get('/rules', (req, res) => {
    const data = store.read();
    res.json({
      rules: data.rules.map((r) => ({ ...normaliseRule(r), description: describeRule(r) })),
      partners: data.partners.map((p) => ({ id: p.id, name: p.name })),
      types: RULE_TYPES,
    });
  });

  api.put('/rules', asyncRoute(async (req, res) => {
    const incoming = Array.isArray(req.body?.rules) ? req.body.rules : null;
    if (!incoming) return fail(res, 400, 'bad_rules', 'Send a list of rules.');
    if (incoming.length > 40) return fail(res, 400, 'too_many', 'That is more rules than this tool keeps.');
    const result = await store.update((data) => {
      data.rules = incoming.map((raw) => {
        const rule = normaliseRule(raw);
        rule.id = rule.id || randomId('rule', 8);
        rule.createdAt = rule.createdAt || stamp();
        if (rule.scope === 'partner' && !data.partners.some((p) => p.id === rule.partnerId)) {
          rule.scope = 'global';
          rule.partnerId = null;
        }
        return rule;
      });
      return data.rules;
    });
    return res.json({ rules: result.map((r) => ({ ...r, description: describeRule(r) })) });
  }));

  api.post('/demo/reset', asyncRoute(async (req, res) => {
    const seeded = buildSeed({ config, today: today(), now: stamp() });
    await store.replace(seeded);
    const data = store.read();
    return res.json({ ok: true, counts: seedSummary(data), message: 'Demo data reset.' });
  }));

  // ---------------------------------------------------------------- static --
  async function signInSheetHtml(data, partner) {
    const target = scanUrl(partner) || `#/refer/${partner.scanToken || ''}`;
    const dataUrl = await QRCode.toDataURL(target, { width: 640, margin: 1, color: { dark: '#1a2744', light: '#ffffff' } });
    const escape = (value) => String(value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const rows = Array.from({ length: 12 }, () => '<tr><td></td><td></td><td></td><td></td></tr>').join('');
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Open home sign-in - ${escape(partner.name)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  body { font-family: Poppins, "Segoe UI", system-ui, sans-serif; color: #1a2744; margin: 0; }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; border-bottom: 3px solid #008B8B; padding-bottom: 12px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { color: #4a5568; font-size: 13px; margin: 0; }
  .qr { text-align: center; }
  .qr img { width: 150px; height: 150px; }
  .qr p { font-size: 11px; margin: 4px 0 0; max-width: 160px; }
  table { width: 100%; border-collapse: collapse; margin-top: 18px; }
  th, td { border: 1px solid #cbd5e0; padding: 10px 8px; text-align: left; font-size: 12px; }
  th { background: #f5f6f8; }
  td { height: 28px; }
  footer { margin-top: 14px; font-size: 11px; color: #4a5568; }
  .print { margin-top: 16px; }
  @media print { .print { display: none; } }
</style></head>
<body>
  <header>
    <div>
      <h1>Open home sign-in</h1>
      <p class="sub">${escape(partner.name)}${partner.agency ? ` &middot; ${escape(partner.agency)}` : ''}</p>
      <p class="sub">Pre-approval in one scan. ${escape(data.firm.broker)} calls within one business day.</p>
    </div>
    <div class="qr">
      <img src="${dataUrl}" alt="QR code to the pre-approval form">
      <p>Scan for a free pre-approval chat with ${escape(data.firm.name)}</p>
    </div>
  </header>
  <table>
    <thead><tr><th style="width:26%">Name</th><th style="width:22%">Phone</th><th style="width:30%">Email</th><th style="width:22%">Want a pre-approval call?</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <footer>
    Signing in is voluntary. We only call people who ask us to. ${escape(data.firm.name)} referral fees are disclosed before any advice.
  </footer>
  <div class="print"><button onclick="window.print()">Print this sheet</button></div>
</body></html>`;
  }

  const clientDist = deps.clientDist || path.join(process.cwd(), 'client', 'dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (req, res, next) => {
      const indexFile = path.join(clientDist, 'index.html');
      if (!fs.existsSync(indexFile)) return next();
      return res.sendFile(indexFile);
    });
  }

  app.use('/api', (req, res) => fail(res, 404, 'not_found', 'Unknown API path.'));

  app.use((err, req, res, next) => {
    if (err?.type === 'entity.too.large') {
      return fail(res, 413, 'too_large', 'That paste is too big. Trim it and try again.');
    }
    if (err instanceof SyntaxError && 'body' in err) {
      return fail(res, 400, 'bad_json', 'The request body was not valid JSON.');
    }
    logger.error?.(`[app] ${req.method} ${req.originalUrl} failed: ${err?.stack || err}`);
    return fail(res, 500, 'server_error', 'Something went wrong on the server. Nothing was saved.');
  });

  app.locals.auth = auth;
  return app;
}

export { neutraliseCell };
