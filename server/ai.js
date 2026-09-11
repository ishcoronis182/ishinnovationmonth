// The AI adapter: four decision points inside deterministic software.
// Every task has a deterministic fallback, and no AI failure can break a
// workflow. meta.provider always says who produced the output.

import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM, SCHEMAS, userTurnExtractHandover, userTurnParseMilestone, userTurnDraftUpdate, userTurnDraftNudge, userTurnStatementNote } from './prompts.js';
import { extractHandoverOffline, parseMilestoneOffline, matchPartner, questionsForGaps } from './heuristics.js';
import { draftUpdate as templateDraftUpdate, draftNudge as templateDraftNudge, statementNote as templateStatementNote, statementNoteAllowedNumbers, SMS_MAX } from '../shared/templates.js';
import { checkCompliance } from '../shared/guard.js';
import { normaliseDeal, ragForDeal } from '../shared/record.js';
import { ALL_STAGES } from '../shared/stages.js';
import { isValidISODate, todayISO } from '../shared/dates.js';
import { randomId } from './ids.js';

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** Turn any thrown value into a stable reason code. */
export function classifyError(err) {
  if (!err) return { reason: 'unknown', message: 'Unknown error', fatal: false };
  if (err instanceof Anthropic.AuthenticationError || err?.status === 401) {
    return { reason: 'auth', message: 'API key rejected. AI is off for this process.', fatal: true };
  }
  if (err instanceof Anthropic.PermissionDeniedError || err?.status === 403) {
    return { reason: 'permission', message: 'API key is not allowed to use this model.', fatal: true };
  }
  if (err instanceof Anthropic.RateLimitError || err?.status === 429) {
    return { reason: 'rate_limit', message: 'Rate limited.', fatal: false };
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError || err?.name === 'APIConnectionTimeoutError' || /timeout/i.test(err?.message || '')) {
    return { reason: 'timeout', message: 'The model did not answer in time.', fatal: false };
  }
  if (err instanceof Anthropic.APIConnectionError || err?.name === 'APIConnectionError') {
    return { reason: 'network', message: 'Could not reach the API.', fatal: false };
  }
  if (err instanceof Anthropic.BadRequestError || err?.status === 400) {
    return { reason: 'bad_request', message: err?.message || 'The request was rejected.', fatal: false };
  }
  if (err?.status >= 500) {
    return { reason: 'server_error', message: 'The API had a server error.', fatal: false };
  }
  if (err?.status === 404) {
    return { reason: 'not_found', message: 'Model not found for this key.', fatal: true };
  }
  return { reason: 'unknown', message: err?.message || String(err), fatal: false };
}

function mentionsBetaFallback(message) {
  const m = String(message || '').toLowerCase();
  return m.includes('fallback') || m.includes('beta') || m.includes('betas');
}

function textFromContent(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
    .trim();
}

function usageOf(response) {
  const u = response?.usage || {};
  return {
    input: Number(u.input_tokens) || 0,
    output: Number(u.output_tokens) || 0,
    cacheRead: Number(u.cache_read_input_tokens) || 0,
    cacheWrite: Number(u.cache_creation_input_tokens) || 0,
  };
}

/**
 * @param {{config: object, logger?: object, clientFactory?: Function, onLog?: Function, now?: Function}} opts
 */
export function createAi(opts = {}) {
  const config = opts.config;
  const logger = opts.logger || console;
  let onLog = opts.onLog || (() => {});
  const nowFn = opts.now || (() => new Date());
  const aiConfig = config?.ai || {};
  let client = null;
  let disabled = !aiConfig.enabled;
  let disabledReason = aiConfig.enabled ? null : 'no_api_key';
  let betaSupported = aiConfig.fallbacks !== false;
  const recent = [];

  function getClient() {
    if (client) return client;
    if (opts.clientFactory) {
      client = opts.clientFactory({ config });
      return client;
    }
    client = new Anthropic({
      apiKey: aiConfig.apiKey,
      timeout: aiConfig.timeoutMs ?? 45000,
      maxRetries: aiConfig.maxRetries ?? 1,
    });
    return client;
  }

  function record(entry) {
    const row = {
      id: randomId('ai', 8),
      at: nowFn().toISOString(),
      ...entry,
    };
    recent.push(row);
    if (recent.length > (aiConfig.logLimit || 200)) recent.shift();
    try {
      onLog(row);
    } catch (err) {
      logger.warn?.(`[ai] log sink failed: ${err.message}`);
    }
    return row;
  }

  /**
   * One structured call. Returns {ok, data, reason, message, usage, ms, model}.
   */
  async function callJson({ task, system, user, schema, maxTokens }) {
    const started = Date.now();
    if (disabled) {
      return { ok: false, reason: disabledReason || 'ai_disabled', message: 'AI is off', ms: 0 };
    }
    const baseParams = {
      model: aiConfig.model,
      max_tokens: maxTokens || aiConfig.maxTokens || 4096,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: user }],
      output_config: {
        effort: aiConfig.effort || 'medium',
        format: { type: 'json_schema', schema },
      },
    };

    const attempt = async (withBeta) => {
      const c = getClient();
      if (withBeta) {
        return c.beta.messages.create({
          ...baseParams,
          betas: [FALLBACK_BETA],
          fallbacks: 'default',
        });
      }
      return c.messages.create(baseParams);
    };

    let response;
    const useBeta = betaSupported && aiConfig.fallbacks !== false;
    try {
      response = await attempt(useBeta);
    } catch (err) {
      const info = classifyError(err);
      if (useBeta && info.reason === 'bad_request' && mentionsBetaFallback(info.message)) {
        betaSupported = false;
        try {
          response = await attempt(false);
        } catch (err2) {
          const info2 = classifyError(err2);
          if (info2.fatal) { disabled = true; disabledReason = info2.reason; }
          return { ok: false, reason: info2.reason, message: info2.message, ms: Date.now() - started };
        }
      } else {
        if (info.fatal) { disabled = true; disabledReason = info.reason; }
        return { ok: false, reason: info.reason, message: info.message, ms: Date.now() - started };
      }
    }

    const ms = Date.now() - started;
    const usage = usageOf(response);
    const model = response?.model || aiConfig.model;

    if (response?.stop_reason === 'refusal') {
      return {
        ok: false,
        reason: 'refusal',
        message: `The model declined this request${response?.stop_details?.category ? ` (${response.stop_details.category})` : ''}.`,
        usage,
        ms,
        model,
      };
    }
    if (response?.stop_reason === 'max_tokens') {
      return {
        ok: false,
        reason: 'max_tokens',
        message: 'The answer was cut off by the token limit.',
        usage,
        ms,
        model,
      };
    }

    const text = textFromContent(response?.content);
    if (!text) {
      return { ok: false, reason: 'empty_response', message: 'The model returned no text.', usage, ms, model };
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          data = JSON.parse(text.slice(start, end + 1));
        } catch {
          return { ok: false, reason: 'malformed_json', message: 'The model did not return valid JSON.', usage, ms, model };
        }
      } else {
        return { ok: false, reason: 'malformed_json', message: 'The model did not return valid JSON.', usage, ms, model };
      }
    }
    if (!data || typeof data !== 'object') {
      return { ok: false, reason: 'malformed_json', message: 'The model returned JSON that was not an object.', usage, ms, model };
    }
    return { ok: true, data, usage, ms, model, fallbackRan: fallbackRan(response) };
  }

  function fallbackRan(response) {
    const iterations = response?.usage?.iterations;
    if (Array.isArray(iterations) && iterations.some((i) => i?.type === 'fallback_message')) return true;
    return Array.isArray(response?.content) && response.content.some((b) => b?.type === 'fallback');
  }

  function meta({ task, provider, result, reason = null, extra = {} }) {
    const row = record({
      task,
      provider,
      model: provider === 'claude' ? (result?.model || aiConfig.model) : null,
      ms: result?.ms ?? 0,
      tokens: result?.usage || null,
      ok: provider === 'claude',
      reason,
      ...extra,
    });
    return {
      task,
      provider,
      model: row.model,
      ms: row.ms,
      tokens: row.tokens,
      ok: row.ok,
      reason,
      logId: row.id,
      ...extra,
    };
  }

  function normaliseAiRecord(raw, { tz, today, partners, channel, broker }) {
    const r = raw?.record || {};
    const stage = ALL_STAGES.includes(r.stage) ? r.stage : 'referred';
    const partnerName = r.referredByName || raw?.partnerMatch?.name || null;
    let partnerId = raw?.partnerMatch?.partnerId || null;
    if (partnerId && !(partners || []).some((p) => p.id === partnerId)) partnerId = null;
    if (!partnerId && partnerName) {
      const matches = matchPartner(partnerName, partners, partnerName);
      if (matches[0] && matches[0].score >= 0.7) partnerId = matches[0].partnerId;
    }
    const keyDates = {};
    for (const [key, value] of Object.entries(r.keyDates || {})) {
      keyDates[key] = isValidISODate(value) ? value : null;
    }
    const deal = normaliseDeal({
      clientName: r.clientName,
      clientPhone: r.clientPhone,
      clientEmail: r.clientEmail,
      broker: r.broker || broker,
      referredBy: partnerId,
      referredByName: partnerName,
      stage,
      purpose: r.purpose,
      loanAmount: r.loanAmount,
      lender: r.lender,
      propertyAddress: r.propertyAddress,
      keyDates,
      channel,
    }, { tz, today });
    const rag = ragForDeal(deal);
    const questions = Array.isArray(raw?.questions) && raw.questions.length
      ? raw.questions.filter((q) => typeof q === 'string' && q.trim()).slice(0, 5)
      : questionsForGaps(deal, rag);
    const consent = raw?.suggestedConsent || {};
    return {
      record: {
        client: deal.client,
        broker: deal.broker,
        referredBy: deal.referredBy,
        referredByName: deal.referredByName,
        stage: deal.stage,
        purpose: deal.purpose,
        loanAmount: deal.loanAmount,
        lender: deal.lender,
        propertyAddress: deal.propertyAddress,
        keyDates: deal.keyDates,
        channel,
      },
      summary: typeof raw?.summary === 'string' ? raw.summary.slice(0, 300) : '',
      missing: rag.missing,
      rag: rag.rag,
      questions,
      confidence: sanitiseConfidence(raw?.confidence),
      partnerMatch: partnerId
        ? {
          partnerId,
          name: partnerName,
          score: Number(raw?.partnerMatch?.score) || 0.8,
          reason: String(raw?.partnerMatch?.reason || 'named in the handover').slice(0, 200),
        }
        : null,
      partnerAlternates: matchPartner(String(partnerName || ''), partners, partnerName).slice(0, 4),
      suggestedConsent: {
        shareStatus: consent.shareStatus === true && Boolean(consent.shareStatusEvidence),
        shareStatusEvidence: consent.shareStatusEvidence ? String(consent.shareStatusEvidence).slice(0, 200) : null,
        feeDisclosed: consent.feeDisclosed === true && Boolean(consent.feeDisclosedEvidence),
        feeDisclosedEvidence: consent.feeDisclosedEvidence ? String(consent.feeDisclosedEvidence).slice(0, 200) : null,
      },
      provider: 'claude',
    };
  }

  function sanitiseConfidence(input) {
    const out = {};
    for (const [key, value] of Object.entries(input || {})) {
      const n = Number(value);
      if (!Number.isFinite(n)) continue;
      out[key] = Math.max(0, Math.min(1, n > 1 ? n / 100 : n));
    }
    return out;
  }

  return {
    /** Where the activity log is persisted. Set by the app once the store exists. */
    setLogSink(sink) {
      if (typeof sink === 'function') onLog = sink;
    },

    status() {
      return {
        enabled: !disabled,
        configured: Boolean(aiConfig.enabled),
        model: aiConfig.model,
        effort: aiConfig.effort,
        fallbacks: aiConfig.fallbacks !== false,
        timeoutMs: aiConfig.timeoutMs,
        disabledReason: disabled ? disabledReason : null,
      };
    },

    recentLog() {
      return [...recent].reverse();
    },

    /** Task 1: pasted handover -> ten-field record, questions, consent evidence. */
    async extractHandover({ text, channel = 'notes', partners = [], today, tz, broker, firm, useAi = true }) {
      const day = today || todayISO(tz);
      const offline = () => extractHandoverOffline(text, { partners, today: day, tz, broker, channel, firmName: firm });
      if (!useAi || disabled) {
        const data = offline();
        return {
          data,
          meta: meta({ task: 'extractHandover', provider: 'heuristic', result: { ms: 0 }, reason: disabled ? (disabledReason || 'ai_disabled') : 'ai_not_requested' }),
        };
      }
      const result = await callJson({
        task: 'extractHandover',
        system: SYSTEM.extractHandover,
        user: userTurnExtractHandover({ text, channel, partners, today: day, broker, firm }),
        schema: SCHEMAS.extractHandover,
      });
      if (!result.ok) {
        const data = offline();
        return {
          data,
          meta: meta({ task: 'extractHandover', provider: 'heuristic', result, reason: result.reason, extra: { degraded: true, message: result.message } }),
        };
      }
      try {
        const data = normaliseAiRecord(result.data, { tz, today: day, partners, channel, broker });
        return { data, meta: meta({ task: 'extractHandover', provider: 'claude', result }) };
      } catch (err) {
        const data = offline();
        return {
          data,
          meta: meta({ task: 'extractHandover', provider: 'heuristic', result, reason: 'normalise_failed', extra: { degraded: true, message: err.message } }),
        };
      }
    },

    /** Task 2: BPU milestone email -> stage, dates, matched deal. */
    async parseMilestone({ text, openDeals = [], today, tz, useAi = true }) {
      const day = today || todayISO(tz);
      const offline = () => parseMilestoneOffline(text, openDeals, { today: day, tz });
      if (!useAi || disabled) {
        return {
          data: offline(),
          meta: meta({ task: 'parseMilestone', provider: 'heuristic', result: { ms: 0 }, reason: disabled ? (disabledReason || 'ai_disabled') : 'ai_not_requested' }),
        };
      }
      const result = await callJson({
        task: 'parseMilestone',
        system: SYSTEM.parseMilestone,
        user: userTurnParseMilestone({ text, openDeals, today: day }),
        schema: SCHEMAS.parseMilestone,
      });
      if (!result.ok) {
        return {
          data: offline(),
          meta: meta({ task: 'parseMilestone', provider: 'heuristic', result, reason: result.reason, extra: { degraded: true, message: result.message } }),
        };
      }
      const raw = result.data;
      const heuristic = offline();
      const noMilestone = raw.noMilestone === true || heuristic.noMilestone;
      let dealId = typeof raw.dealId === 'string' ? raw.dealId : null;
      if (dealId && !openDeals.some((d) => d.id === dealId)) dealId = null;
      const stage = ALL_STAGES.includes(raw.stage) ? raw.stage : null;
      const keyDates = {};
      for (const [key, value] of Object.entries(raw.keyDates || {})) {
        keyDates[key] = isValidISODate(value) ? value : null;
      }
      // A surname-only match is never auto-linked, whoever proposed it.
      const alt = heuristic.alternates.find((a) => a.dealId === dealId);
      if (alt && alt.surnameOnly) dealId = null;
      const data = {
        noMilestone,
        stage: noMilestone ? null : stage,
        eventDate: noMilestone ? null : (isValidISODate(raw.eventDate) ? raw.eventDate : heuristic.eventDate),
        keyDates,
        dealId,
        score: Number.isFinite(Number(raw.score)) ? Math.max(0, Math.min(1, Number(raw.score))) : heuristic.score,
        reason: String(raw.reason || heuristic.reason).slice(0, 300),
        alternates: heuristic.alternates,
        provider: 'claude',
      };
      return { data, meta: meta({ task: 'parseMilestone', provider: 'claude', result }) };
    },

    /** Task 3: partner-safe stage update. Guarded before it is returned. */
    async draftUpdate({ context, useAi = true }) {
      const template = templateDraftUpdate(context);
      if (!useAi || disabled) {
        return {
          data: { ...template, provider: 'template' },
          meta: meta({ task: 'draftUpdate', provider: 'template', result: { ms: 0 }, reason: disabled ? (disabledReason || 'ai_disabled') : 'ai_not_requested' }),
        };
      }
      const result = await callJson({
        task: 'draftUpdate',
        system: SYSTEM.draftUpdate,
        user: userTurnDraftUpdate(context),
        schema: SCHEMAS.draftUpdate,
        maxTokens: 1200,
      });
      if (!result.ok) {
        return {
          data: { ...template, provider: 'template' },
          meta: meta({ task: 'draftUpdate', provider: 'template', result, reason: result.reason, extra: { degraded: true, message: result.message } }),
        };
      }
      const sms = cleanSms(result.data.sms);
      const emailBody = String(result.data.emailBody || '').trim();
      const emailSubject = String(result.data.emailSubject || template.email.subject).trim().slice(0, 160);
      const smsCheck = checkCompliance(sms);
      const emailCheck = checkCompliance(emailBody);
      if (!sms || !emailBody || !smsCheck.ok || !emailCheck.ok || sms.length > SMS_MAX) {
        return {
          data: { ...template, provider: 'template' },
          meta: meta({
            task: 'draftUpdate',
            provider: 'template',
            result,
            reason: !smsCheck.ok || !emailCheck.ok ? 'guard_blocked' : 'draft_unusable',
            extra: {
              degraded: true,
              message: !smsCheck.ok ? smsCheck.summary : (!emailCheck.ok ? emailCheck.summary : 'The draft was empty or too long'),
              aiDraftRejected: true,
            },
          }),
        };
      }
      return {
        data: { sms, email: { subject: emailSubject, body: emailBody }, provider: 'claude' },
        meta: meta({ task: 'draftUpdate', provider: 'claude', result }),
      };
    },

    /** Task 4: the Friday nudge. */
    async draftNudge({ context, useAi = true }) {
      const template = templateDraftNudge(context);
      if (!useAi || disabled) {
        return {
          data: { ...template, provider: 'template' },
          meta: meta({ task: 'draftNudge', provider: 'template', result: { ms: 0 }, reason: disabled ? (disabledReason || 'ai_disabled') : 'ai_not_requested' }),
        };
      }
      const result = await callJson({
        task: 'draftNudge',
        system: SYSTEM.draftNudge,
        user: userTurnDraftNudge(context),
        schema: SCHEMAS.draftNudge,
        maxTokens: 800,
      });
      if (!result.ok) {
        return {
          data: { ...template, provider: 'template' },
          meta: meta({ task: 'draftNudge', provider: 'template', result, reason: result.reason, extra: { degraded: true, message: result.message } }),
        };
      }
      const sms = cleanSms(result.data.sms);
      const check = checkCompliance(sms);
      if (!sms || !check.ok || sms.length > SMS_MAX) {
        return {
          data: { ...template, provider: 'template' },
          meta: meta({
            task: 'draftNudge',
            provider: 'template',
            result,
            reason: check.ok ? 'draft_unusable' : 'guard_blocked',
            extra: { degraded: true, message: check.summary, aiDraftRejected: true },
          }),
        };
      }
      return { data: { sms, provider: 'claude' }, meta: meta({ task: 'draftNudge', provider: 'claude', result }) };
    },

    /** Task 5: statement cover note. Only the statement's own totals allowed. */
    async writeStatementNote({ statement, partner, firm, broker, useAi = true }) {
      const context = {
        partnerFirstName: String(partner?.name || '').split(' ')[0],
        periodLabel: statement?.periodLabel,
        numbers: statement?.numbers,
        broker,
        firm,
      };
      const template = templateStatementNote(context);
      const allowed = statementNoteAllowedNumbers(statement);
      if (!useAi || disabled) {
        return {
          data: { note: template.text, provider: 'template' },
          meta: meta({ task: 'writeStatementNote', provider: 'template', result: { ms: 0 }, reason: disabled ? (disabledReason || 'ai_disabled') : 'ai_not_requested' }),
        };
      }
      const result = await callJson({
        task: 'writeStatementNote',
        system: SYSTEM.writeStatementNote,
        user: userTurnStatementNote(context),
        schema: SCHEMAS.writeStatementNote,
        maxTokens: 800,
      });
      if (!result.ok) {
        return {
          data: { note: template.text, provider: 'template' },
          meta: meta({ task: 'writeStatementNote', provider: 'template', result, reason: result.reason, extra: { degraded: true, message: result.message } }),
        };
      }
      const note = String(result.data.note || '').trim();
      const check = checkCompliance(note, { allowNumbers: allowed });
      if (!note || !check.ok) {
        return {
          data: { note: template.text, provider: 'template' },
          meta: meta({
            task: 'writeStatementNote',
            provider: 'template',
            result,
            reason: check.ok ? 'draft_unusable' : 'guard_blocked',
            extra: { degraded: true, message: check.summary, aiDraftRejected: true },
          }),
        };
      }
      return { data: { note, provider: 'claude' }, meta: meta({ task: 'writeStatementNote', provider: 'claude', result }) };
    },
  };
}

/** Plain hyphens, single spaces, no smart quotes that break SMS encoding. */
export function cleanSms(value) {
  return String(value || '')
    .replace(/[‐-―−]/g, '-')
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/[ \t]*\n[ \t]*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
