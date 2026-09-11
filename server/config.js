// Configuration from the environment. No secrets are ever logged.

import path from 'node:path';
import { DEFAULT_TZ } from '../shared/dates.js';
import { DEFAULT_BASELINES } from '../shared/metrics.js';

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on', 'y']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off', 'n']);

function bool(value, fallback) {
  if (value == null || value === '') return fallback;
  const v = String(value).trim().toLowerCase();
  if (TRUE_VALUES.has(v)) return true;
  if (FALSE_VALUES.has(v)) return false;
  return fallback;
}

function int(value, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function str(value, fallback = null) {
  if (value == null) return fallback;
  const s = String(value).trim();
  return s ? s : fallback;
}

export const WEAK_PASSCODES = new Set([
  'pulse', 'password', 'passcode', 'demo', 'letmein', 'changeme', 'admin',
  '1234', '12345', '123456', 'partner', 'partnerpulse', 'test',
]);

export function loadConfig(env = process.env) {
  const dataDir = path.resolve(str(env.PULSE_DATA_DIR, path.join(process.cwd(), 'data')));
  const passcode = str(env.PULSE_PASSCODE);
  const apiKey = str(env.ANTHROPIC_API_KEY);
  const publicUrl = str(env.PULSE_PUBLIC_URL);

  return {
    nodeEnv: str(env.NODE_ENV, 'development'),
    port: int(env.PORT, 3000),
    trustProxy: int(env.PULSE_TRUST_PROXY, 1),
    dataDir,
    tz: str(env.PULSE_TZ, DEFAULT_TZ),
    firm: {
      name: str(env.PULSE_FIRM_NAME, 'Coronis Finance'),
      broker: str(env.PULSE_BROKER_NAME, 'Nathan'),
      office: str(env.PULSE_OFFICE, 'Coronis Lutwyche'),
    },
    auth: {
      passcode,
      enabled: Boolean(passcode),
      weakPasscode: Boolean(passcode) && WEAK_PASSCODES.has(passcode.toLowerCase()),
      sessionHours: int(env.PULSE_SESSION_HOURS, 12),
      maxAttempts: int(env.PULSE_LOGIN_MAX_ATTEMPTS, 5),
      lockoutMinutes: int(env.PULSE_LOGIN_LOCKOUT_MINUTES, 15),
      cookieName: 'pulse_session',
      secureCookie: bool(env.PULSE_SECURE_COOKIE, str(env.NODE_ENV) === 'production'),
    },
    publicUrl,
    seedDemo: bool(env.PULSE_SEED_DEMO, true),
    ai: {
      apiKey,
      enabled: Boolean(apiKey),
      model: str(env.PULSE_MODEL, 'claude-opus-5'),
      effort: str(env.PULSE_AI_EFFORT, 'medium'),
      fallbacks: bool(env.PULSE_AI_FALLBACKS, true),
      timeoutMs: int(env.PULSE_AI_TIMEOUT_MS, 45000),
      maxRetries: int(env.PULSE_AI_MAX_RETRIES, 1),
      maxTokens: int(env.PULSE_AI_MAX_TOKENS, 4096),
      logLimit: int(env.PULSE_AI_LOG_LIMIT, 200),
    },
    sms: {
      provider: str(env.PULSE_SMS_PROVIDER, 'log'),
      twilio: {
        accountSid: str(env.TWILIO_ACCOUNT_SID),
        authToken: str(env.TWILIO_AUTH_TOKEN),
        from: str(env.TWILIO_FROM),
      },
    },
    email: {
      provider: str(env.PULSE_EMAIL_PROVIDER, 'log'),
      resend: {
        apiKey: str(env.RESEND_API_KEY),
        from: str(env.RESEND_FROM, 'PARTNER PULSE <onboarding@resend.dev>'),
      },
    },
    publicForm: {
      windowMinutes: int(env.PULSE_FORM_WINDOW_MINUTES, 10),
      maxPerWindow: int(env.PULSE_FORM_MAX_PER_WINDOW, 5),
      maxPerDay: int(env.PULSE_FORM_MAX_PER_DAY, 50),
    },
    baselines: { ...DEFAULT_BASELINES },
  };
}

/** What the health endpoint reports. Never includes a secret. */
export function configHealth(config) {
  const warnings = [];
  if (!config.auth.enabled) warnings.push('No PULSE_PASSCODE set: the broker pages are open to anyone who can reach this server.');
  if (config.auth.weakPasscode) warnings.push('PULSE_PASSCODE is a well-known value. Change it before sharing the link.');
  if (!config.publicUrl) warnings.push('PULSE_PUBLIC_URL is not set: portal links and QR codes will use relative URLs.');
  if (!config.ai.enabled) warnings.push('ANTHROPIC_API_KEY is not set: every AI step falls back to the offline heuristics.');
  if (config.sms.provider === 'twilio' && !config.sms.twilio.accountSid) warnings.push('SMS provider is twilio but TWILIO_ACCOUNT_SID is missing.');
  if (config.email.provider === 'resend' && !config.email.resend.apiKey) warnings.push('Email provider is resend but RESEND_API_KEY is missing.');
  return {
    ok: true,
    warnings,
    tz: config.tz,
    authEnabled: config.auth.enabled,
    aiEnabled: config.ai.enabled,
    model: config.ai.model,
    smsProvider: config.sms.provider,
    emailProvider: config.email.provider,
    publicUrlSet: Boolean(config.publicUrl),
    seedDemo: config.seedDemo,
  };
}
