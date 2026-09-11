// Delivery adapters. The default "log" provider records the send and hands the
// broker sms: and mailto: links, so their own phone is the pilot channel.

import { randomId } from './ids.js';

function encode(value) {
  return encodeURIComponent(String(value ?? ''));
}

export function smsLink(to, body) {
  const number = String(to || '').replace(/[^\d+]/g, '');
  return `sms:${number}${number ? '' : ''}?&body=${encode(body)}`;
}

export function mailtoLink(to, subject, body) {
  return `mailto:${String(to || '').trim()}?subject=${encode(subject)}&body=${encode(body)}`;
}

/**
 * @param {{config: object, logger?: object, fetchImpl?: Function, now?: Function}} opts
 */
export function createDelivery(opts = {}) {
  const config = opts.config;
  const logger = opts.logger || console;
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const nowFn = opts.now || (() => new Date());

  async function twilioSms({ to, body }) {
    const { accountSid, authToken, from } = config.sms.twilio;
    if (!accountSid || !authToken || !from) {
      return { ok: false, provider: 'twilio', error: 'Twilio is selected but TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN or TWILIO_FROM is missing.' };
    }
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
    const form = new URLSearchParams({ To: to, From: from, Body: body });
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, provider: 'twilio', error: payload?.message || `Twilio returned ${res.status}` };
      }
      return { ok: true, provider: 'twilio', id: payload?.sid || randomId('sms', 8) };
    } catch (err) {
      return { ok: false, provider: 'twilio', error: `Twilio request failed: ${err.message}` };
    }
  }

  async function resendEmail({ to, subject, body }) {
    const { apiKey, from } = config.email.resend;
    if (!apiKey) {
      return { ok: false, provider: 'resend', error: 'Resend is selected but RESEND_API_KEY is missing.' };
    }
    try {
      const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from, to: [to], subject, text: body }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, provider: 'resend', error: payload?.message || `Resend returned ${res.status}` };
      }
      return { ok: true, provider: 'resend', id: payload?.id || randomId('em', 8) };
    } catch (err) {
      return { ok: false, provider: 'resend', error: `Resend request failed: ${err.message}` };
    }
  }

  return {
    status() {
      return {
        sms: config.sms.provider,
        email: config.email.provider,
        smsReady: config.sms.provider !== 'twilio' || Boolean(config.sms.twilio.accountSid && config.sms.twilio.authToken && config.sms.twilio.from),
        emailReady: config.email.provider !== 'resend' || Boolean(config.email.resend.apiKey),
      };
    },

    async sendSms({ to, body }) {
      const at = nowFn().toISOString();
      if (config.sms.provider === 'twilio') {
        const result = await twilioSms({ to, body });
        return { channel: 'sms', at, to: to || null, ...result };
      }
      logger.info?.(`[delivery] sms logged for ${to || 'unknown number'} (${body.length} chars)`);
      return {
        channel: 'sms',
        at,
        ok: true,
        provider: 'log',
        id: randomId('sms', 8),
        to: to || null,
        link: smsLink(to, body),
      };
    },

    async sendEmail({ to, subject, body }) {
      const at = nowFn().toISOString();
      if (config.email.provider === 'resend') {
        const result = await resendEmail({ to, subject, body });
        return { channel: 'email', at, to: to || null, ...result };
      }
      logger.info?.(`[delivery] email logged for ${to || 'unknown address'} (${subject})`);
      return {
        channel: 'email',
        at,
        ok: true,
        provider: 'log',
        id: randomId('em', 8),
        to: to || null,
        link: mailtoLink(to, subject, body),
      };
    },
  };
}
