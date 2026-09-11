// End-to-end walk of the whole loop in headless Chromium.
//
//   npm start                       # in one terminal
//   npm install --no-save playwright-core
//   node scripts/browser-walk.mjs   # BASE=http://localhost:3000 by default
//
// It resets the demo deck first, so it is repeatable - except that the public
// referral form is rate limited per IP, so a second run inside ten minutes will
// trip that limit on purpose. Restart the server to clear it.
//
// playwright-core is deliberately not a dependency of this project: it is a
// verification tool, not part of the app.

import { chromium } from 'playwright-core';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:3000';
const SHOTS = process.env.SHOTS || './walk-screenshots';
fs.mkdirSync(SHOTS, { recursive: true });

const problems = [];
const steps = [];
let stepNo = 0;

function ok(name, detail = '') {
  steps.push(`OK   ${name}${detail ? ` :: ${detail}` : ''}`);
}
function fail(name, detail = '') {
  problems.push(`${name}${detail ? ` :: ${detail}` : ''}`);
  steps.push(`FAIL ${name}${detail ? ` :: ${detail}` : ''}`);
}
function check(name, cond, detail = '') {
  if (cond) ok(name, detail); else fail(name, detail);
  return cond;
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];

async function newPage(context) {
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(`${page.url()} :: ${msg.text()}`);
  });
  page.on('pageerror', (err) => pageErrors.push(`${page.url()} :: ${err.message}`));
  page.on('requestfailed', (req) => failedRequests.push(`${req.method()} ${req.url()} :: ${req.failure()?.errorText}`));
  page.on('response', (res) => {
    if (res.status() >= 500) failedRequests.push(`${res.status()} ${res.url()}`);
  });
  return page;
}

async function shot(page, name) {
  stepNo += 1;
  await page.screenshot({ path: `${SHOTS}/${String(stepNo).padStart(2, '0')}-${name}.png`, fullPage: true });
}

async function goto(page, hash) {
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(250);
}

const desktop = await browser.newContext({ viewport: { width: 1400, height: 950 }, deviceScaleFactor: 1 });
const page = await newPage(desktop);

try {
  // start from a clean deck so the walk is repeatable
  const reset = await fetch(`${BASE}/api/demo/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  }).then((r) => r.json());
  check('demo reset to the seeded deck', reset.counts?.deals === 16, JSON.stringify(reset.counts));

  // ---------------------------------------------------------------- QUEUE ---
  await goto(page, '#/');
  await page.waitForSelector('.kanban', { timeout: 8000 });
  const cards = await page.locator('.deal-card').count();
  check('queue renders the kanban', cards > 0, `${cards} cards`);
  check('sidebar pulse counters render', await page.locator('.pulse-panel .pulse-row').count() === 4);
  const commsDue = await page.locator('.pulse-row', { hasText: 'Comms due' }).locator('.pulse-row__value').textContent();
  check('comms due counter shows the money', commsDue.trim() === '$1,000', commsDue.trim());
  check('the wordmark ECG line is present', await page.locator('.wordmark__trace').count() === 1);
  await shot(page, 'queue-kanban');

  await page.getByRole('button', { name: 'Table' }).click();
  await page.waitForSelector('table.data');
  check('table toggle works', await page.locator('table.data tbody tr').count() > 0);
  await shot(page, 'queue-table');
  await page.getByRole('button', { name: 'Kanban' }).click();

  await page.locator('#q-rag').selectOption('red');
  await page.waitForTimeout(300);
  const redCount = await page.locator('.deal-card').count();
  check('RAG filter narrows the queue', redCount > 0 && redCount < cards, `${redCount} red of ${cards}`);
  await page.locator('#q-rag').selectOption('');

  // ------------------------------------------------------------- HANDOVER ---
  await goto(page, '#/handover');
  await page.waitForSelector('#h-text');
  await page.getByRole('button', { name: 'Messy dot-point notes' }).click();
  await page.waitForTimeout(200);
  check('sample loads into the textarea', (await page.locator('#h-text').inputValue()).length > 50);
  await page.getByRole('button', { name: /Extract \(offline mode\)/ }).click();
  await page.waitForSelector('.chip--red, .chip--amber, .chip--green', { timeout: 8000 });
  await page.waitForTimeout(400);
  const missingCallout = await page.locator('.callout--red').first().textContent();
  check('a messy handover arrives red with the gaps named', /missing/i.test(missingCallout || ''), (missingCallout || '').slice(0, 80));
  check('the ten-field form is editable', await page.locator('#h-name').count() === 1);
  check('confidence bars render', await page.locator('.confidence__fill').count() > 0);
  const consentBoxes = page.locator('.check input[type=checkbox]');
  check('two consent checkboxes, both unticked', await consentBoxes.count() === 2
    && !(await consentBoxes.nth(0).isChecked()) && !(await consentBoxes.nth(1).isChecked()));
  check('questions for the broker are listed', await page.locator('text=Questions for the broker').count() === 1);
  await shot(page, 'handover-red');

  // the email sample, which should arrive green with consent evidence
  await page.getByRole('button', { name: 'Email from the agent' }).click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: /Extract with Claude/ }).click();
  await page.waitForSelector('.callout--green', { timeout: 8000 });
  await page.waitForTimeout(400);
  const consentTicked = await page.locator('.check input[type=checkbox]').nth(0).isChecked();
  check('consent is pre-ticked only with evidence', consentTicked);
  check('the matched phrase is shown', await page.locator('.check__evidence').count() > 0,
    (await page.locator('.check__evidence').first().textContent() || '').slice(0, 60));
  check('the record arrives green', await page.locator('.callout--green').count() > 0);
  await shot(page, 'handover-green');

  await page.getByRole('button', { name: 'Add to queue' }).click();
  await page.waitForURL(/#\/deal\//, { timeout: 8000 });
  await page.waitForTimeout(500);
  check('committing lands on the new deal', page.url().includes('#/deal/'));
  const newRef = await page.locator('.mono.muted').first().textContent();
  check('the new record has a reference', /PP-\d{4}/.test(newRef || ''), newRef);
  await shot(page, 'deal-new-from-handover');

  // ----------------------------------------------------------------- DEAL ---
  await goto(page, '#/deal/deal_taylor');
  await page.waitForSelector('.pipeline');
  check('the deal page shows the stage pipeline', await page.locator('.pipeline__step--current').count() === 1);
  check('the ten fields are on the page', await page.locator('#f-client').count() === 1 && await page.locator('#f-settlementDue').count() === 1);
  check('consent is recorded with its evidence', (await page.locator('.check__evidence').count()) >= 1);
  const commission = await page.locator('.stat__value').first().textContent();
  check('the commission box shows the projected amount', commission.includes('$500'), commission);
  await page.waitForSelector('.bubble', { timeout: 8000 });
  const sms = await page.locator('.bubble').first().textContent();
  check('the partner SMS matches the register', sms.includes('Hi Alex - quick update on the buyers you sent us for 42 Wattlebird Cres.')
    && sms.includes('Their loan was formally approved this morning.')
    && sms.includes('Thanks again for the referral - Nathan, Coronis Finance'), JSON.stringify(sms));
  check('the compliance report says partner safe', (await page.locator('.compliance--ok').count()) >= 1);
  await shot(page, 'deal-taylor');

  // editing in a figure must block the send
  await page.locator('#u-sms').fill('Hi Alex - their $600,000 loan was approved at 5.89%. Thanks - Nathan');
  await page.waitForTimeout(700);
  check('a figure blocks the draft', await page.locator('.compliance--blocked').count() >= 1);
  check('the blocked figure is highlighted', await page.locator('mark.hit').count() > 0);
  const sendBtn = page.getByRole('button', { name: 'Send SMS' });
  check('send is disabled while blocked', await sendBtn.isDisabled());
  await shot(page, 'deal-blocked-draft');

  // put the safe draft back and send
  await page.getByRole('button', { name: 'Redraft offline' }).click();
  await page.waitForTimeout(900);
  check('redrafting restores a safe SMS', await page.locator('.compliance--ok').count() >= 1);
  await page.getByRole('button', { name: 'Send both' }).click();
  await page.waitForSelector('.toast--ok', { timeout: 8000 });
  const toast = await page.locator('.toast--ok').first().textContent();
  check('sending reports success', /Sent to Alex Sample/.test(toast || ''), (toast || '').slice(0, 60));
  await page.waitForTimeout(600);
  check('the send is on the timeline', await page.locator('.timeline__body', { hasText: 'Partner update sent' }).count() >= 1);
  await shot(page, 'deal-sent');

  // ------------------------------------------------------------ MILESTONE ---
  await goto(page, '#/handover');
  await page.getByRole('button', { name: 'BPU milestone' }).click();
  await page.waitForSelector('#m-text');
  await page.getByRole('button', { name: 'BPU email with no milestone' }).click();
  await page.getByRole('button', { name: 'Read this email' }).click();
  await page.waitForSelector('.callout--amber', { timeout: 8000 });
  check('an explicit no-milestone is respected', await page.locator('text=No milestone in that email').count() === 1);
  await shot(page, 'milestone-none');

  await page.getByRole('button', { name: 'BPU milestone email (settled)' }).click();
  await page.getByRole('button', { name: 'Read this email' }).click();
  await page.waitForSelector('input[name=milestone-deal]', { timeout: 8000 });
  await page.waitForTimeout(300);
  const radios = await page.locator('input[name=milestone-deal]').count();
  check('the matched file is offered with alternates', radios >= 1, `${radios} candidates`);
  check('the matched file is preselected', await page.locator('input[name=milestone-deal]:checked').count() === 1);
  await shot(page, 'milestone-matched');
  await page.getByRole('button', { name: 'Apply to this file' }).click();
  await page.waitForURL(/#\/deal\//, { timeout: 8000 });
  await page.waitForTimeout(500);
  check('applying the milestone lands on the deal', page.url().includes('#/deal/'));
  const settledChip = await page.locator('.pipeline__step--current').first().textContent();
  check('the deal is now settled', (settledChip || '').includes('Settled'), settledChip);
  await shot(page, 'deal-settled-from-milestone');

  // -------------------------------------------------------------- FRIDAY ----
  await goto(page, '#/friday');
  await page.waitForSelector('.bubble', { timeout: 8000 });
  const nudge = await page.locator('.bubble').first().textContent();
  check('the Friday nudge matches the register', nudge.includes("you've got 4 opens on Saturday")
    && nudge.includes('2 of your referred buyers settled this month')
    && nudge.includes('Want a pre-approval QR code for the sign-in sheet?'), nudge.slice(0, 80));
  check('what the agent hears is separated from the register', await page.locator('text=What Alex will hear').count() === 1
    && await page.locator('text=Your register').count() >= 1);
  check('the consent gap is called out', await page.locator('text=/we cannot mention yet/').count() >= 1);
  await shot(page, 'friday');
  await page.getByRole('button', { name: 'Send the nudge' }).first().click();
  await page.waitForSelector('.toast--ok', { timeout: 8000 });
  check('the nudge sends', /Nudge sent/.test(await page.locator('.toast--ok').first().textContent() || ''));

  // ---------------------------------------------------------- STATEMENTS ----
  await goto(page, '#/statements');
  await page.waitForSelector('#st-period');
  await page.getByRole('button', { name: 'Generate statements' }).click();
  await page.waitForSelector('.toast--ok, .toast--warn', { timeout: 10000 });
  await page.waitForTimeout(700);
  check('the register anomalies are listed', await page.locator('text=/Settled with no referrer recorded/').count() >= 1);
  await shot(page, 'statements-list');

  const alexRow = page.locator('table.data tbody tr', { hasText: 'Alex Sample' }).first();
  await alexRow.locator('a').first().click();
  await page.waitForURL(/#\/statement\//, { timeout: 8000 });
  await page.waitForSelector('.five-numbers', { timeout: 8000 });
  await page.waitForTimeout(400);
  const numbers = await page.locator('.five-numbers .stat').allTextContents();
  check('the statement shows the five numbers', numbers.length === 5, numbers.join(' | ').replace(/\s+/g, ' '));
  const numbersText = numbers.join(' ');
  check('deals referred is 3', /Deals referred \(this period\)\s*3/.test(numbersText.replace(/\s+/g, ' ')), numbersText.replace(/\s+/g, ' ').slice(0, 120));
  check('comms due is $1,000', numbersText.includes('$1,000'));
  check('paid year to date is $3,500', numbersText.includes('$3,500'));
  check('every line carries a rule id', (await page.locator('td .mono.muted').count()) >= 1);
  await shot(page, 'statement-detail');

  await page.getByRole('button', { name: 'Issue' }).click();
  await page.waitForSelector('.chip--teal:has-text("issued")', { timeout: 8000 });
  check('issuing works', await page.locator('.chip--teal:has-text("issued")').count() >= 1);
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Mark paid' }).click();
  await page.waitForSelector('.chip--green:has-text("paid")', { timeout: 8000 });
  check('marking paid works', await page.locator('.chip--green:has-text("paid")').count() >= 1);
  await page.waitForTimeout(400);
  await shot(page, 'statement-paid');

  // ------------------------------------------------------------- METRICS ----
  await goto(page, '#/metrics');
  await page.waitForSelector('table.data');
  const metricRows = await page.locator('table.data tbody tr').count();
  check('the metrics table has every row', metricRows >= 6, `${metricRows} rows`);
  check('the sparkline renders', await page.locator('.sparkline').count() === 1);
  check('the value model reads about 45k a year', (await page.locator('text=/\\$46,800/').count()) >= 1);
  check('the AI activity panel names the provider', (await page.locator('.tag--heuristic, .tag--template, .tag--claude').count()) >= 1);
  check('the offline reason is stated', (await page.locator('text=/no api key/i').count()) >= 1);
  await shot(page, 'metrics');

  // ------------------------------------------------------------ PARTNERS ----
  await goto(page, '#/partners');
  await page.waitForSelector('.card');
  check('partner cards render', await page.locator('h2 a').count() >= 3);
  await page.locator('h2 a', { hasText: 'Alex Sample' }).click();
  await page.waitForURL(/#\/partner\//, { timeout: 8000 });
  await page.waitForSelector('img[alt*="QR code"]', { timeout: 8000 });
  await page.waitForTimeout(400);
  check('the partner page shows their deals', await page.locator('table.data tbody tr').count() > 0);
  check('the QR code renders', await page.locator('img[alt*="QR code"]').count() >= 1);
  check('both links are explained', (await page.locator('text=/private to/').count()) >= 1);
  await shot(page, 'partner-alex');

  const portalHref = await page.locator('a', { hasText: 'Open the portal' }).getAttribute('href');
  check('the portal link is on the page', Boolean(portalHref), portalHref);

  // --------------------------------------------------------- SETTINGS -------
  await goto(page, '#/settings');
  await page.waitForSelector('#s-firm');
  check('the rules editor renders the demo rule', (await page.locator('text=/per settled referred loan/').count()) >= 1);
  check('integration chips render', await page.locator('.chip').count() >= 5);
  await shot(page, 'settings');

  // ------------------------------------------------------- PORTAL (phone) ---
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const mobile = await newPage(phone);
  await mobile.goto(`${BASE}/${portalHref}`, { waitUntil: 'networkidle' });
  await mobile.waitForSelector('.portal__hero', { timeout: 8000 });
  await mobile.waitForTimeout(400);
  check('the portal loads on a phone', await mobile.locator('.portal-tabs button').count() === 3);
  const portalText = await mobile.locator('body').innerText();
  check('the portal shows initials, not full names', portalText.includes('S. & J. T.') && !portalText.includes('Sam & Jo Taylor'));
  check('no loan figure on the portal', !/600,000|\$600k|600000/.test(portalText));
  check('no lender on the portal', !/Macquarie/.test(portalText));
  check('the stage pipeline is there', await mobile.locator('.pipeline').count() >= 1);
  check('the portal has no sidebar', await mobile.locator('.sidebar').count() === 0);
  stepNo += 1;
  await mobile.screenshot({ path: `${SHOTS}/${String(stepNo).padStart(2, '0')}-portal-deals-phone.png`, fullPage: true });

  await mobile.getByRole('button', { name: 'My money' }).click();
  await mobile.waitForTimeout(400);
  const moneyText = await mobile.locator('body').innerText();
  check('the money tab shows due and paid', /due to you/i.test(moneyText) && /paid/i.test(moneyText));
  check('no loan figures on the money tab', !/600,000|585,000|430,000/.test(moneyText));
  stepNo += 1;
  await mobile.screenshot({ path: `${SHOTS}/${String(stepNo).padStart(2, '0')}-portal-money-phone.png`, fullPage: true });

  await mobile.getByRole('button', { name: 'Refer a buyer' }).click();
  await mobile.waitForSelector('#rf-name');
  await mobile.locator('#rf-name').fill('Walk Test Buyer');
  await mobile.locator('#rf-phone').fill('0400 111 222');
  const referBtn = mobile.getByRole('button', { name: 'Send the referral' });
  check('the referral button is disabled until consent is ticked', await referBtn.isDisabled());
  await mobile.locator('.check input[type=checkbox]').first().check();
  await referBtn.click();
  await mobile.waitForSelector('.callout--green:has-text("Walk Test Buyer")', { timeout: 8000 });
  check('the referral is accepted with consent', await mobile.locator('.callout--green:has-text("Walk Test Buyer")').count() === 1);
  stepNo += 1;
  await mobile.screenshot({ path: `${SHOTS}/${String(stepNo).padStart(2, '0')}-portal-refer-phone.png`, fullPage: true });

  // the pulse survey
  await mobile.getByRole('button', { name: 'My deals' }).click();
  await mobile.waitForTimeout(300);
  const answerAgain = mobile.getByRole('button', { name: /answer it again/i });
  check('a partner who already answered sees when they did', await answerAgain.count() === 1);
  if (await answerAgain.count()) {
    await answerAgain.click();
    await mobile.waitForTimeout(300);
  }
  const scaleButtons = mobile.locator('.scale');
  if (await scaleButtons.count() >= 3) {
    for (let i = 0; i < 3; i += 1) {
      await scaleButtons.nth(i).getByRole('button', { name: /5 out of 5/ }).click();
    }
    await mobile.getByRole('button', { name: 'Send my answers' }).click();
    await mobile.waitForSelector('.toast--ok', { timeout: 8000 });
    check('the pulse survey submits', true);
  } else {
    fail('the pulse survey renders three scales', `${await scaleButtons.count()} found`);
  }
  stepNo += 1;
  await mobile.screenshot({ path: `${SHOTS}/${String(stepNo).padStart(2, '0')}-portal-survey-phone.png`, fullPage: true });

  // ------------------------------------------- buyer form behind the QR ------
  const scanUrl = await page.evaluate(async () => {
    const res = await fetch('/api/partners/p_alex');
    const data = await res.json();
    return data.partner.scanUrl;
  });
  const buyer = await newPage(phone);
  await buyer.goto(scanUrl.startsWith('http') ? scanUrl : `${BASE}/${scanUrl}`, { waitUntil: 'networkidle' });
  await buyer.waitForSelector('#sc-name', { timeout: 8000 });
  const buyerText = await buyer.locator('body').innerText();
  check('the buyer form exposes no deals', !/Wattlebird|Taylor|settled/i.test(buyerText));
  check('the buyer form names who will call', /Nathan/.test(buyerText));
  await buyer.locator('#sc-name').fill('Open Home Visitor');
  await buyer.locator('#sc-phone').fill('0400 333 444');
  await buyer.locator('.check input[type=checkbox]').first().check();
  await buyer.getByRole('button', { name: 'Ask for a call' }).click();
  await buyer.waitForSelector('.callout--green', { timeout: 8000 });
  check('the buyer form accepts a referral', true);
  stepNo += 1;
  await buyer.screenshot({ path: `${SHOTS}/${String(stepNo).padStart(2, '0')}-buyer-form-phone.png`, fullPage: true });

  // ------------------------------------------------ queue at phone width -----
  const mobileQueue = await newPage(phone);
  await mobileQueue.goto(`${BASE}/#/`, { waitUntil: 'networkidle' });
  await mobileQueue.waitForSelector('.kanban', { timeout: 8000 });
  const scrollWidth = await mobileQueue.evaluate(() => document.documentElement.scrollWidth);
  check('the broker app does not scroll sideways at 390px', scrollWidth <= 400, `${scrollWidth}px`);
  stepNo += 1;
  await mobileQueue.screenshot({ path: `${SHOTS}/${String(stepNo).padStart(2, '0')}-queue-phone.png`, fullPage: false });
} catch (err) {
  fail('walk threw', err.message);
  try { await page.screenshot({ path: `${SHOTS}/99-crash.png`, fullPage: true }); } catch { /* ignore */ }
} finally {
  await browser.close();
}

// The Google Fonts stylesheet is unreachable in this sandbox; the CSS stack
// falls back to system fonts. That is the environment, not the app.
const isExternalFont = (line) => line.includes('fonts.googleapis.com') || line.includes('fonts.gstatic.com');
const fontNoise = consoleErrors.filter(isExternalFont).length + failedRequests.filter(isExternalFont).length;
const realConsole = consoleErrors.filter((l) => !isExternalFont(l) && !l.includes('ERR_CONNECTION_RESET'));
const realRequests = failedRequests.filter((l) => !isExternalFont(l));

console.log(steps.join('\n'));
console.log('\n--- console errors:', consoleErrors.length);
for (const e of consoleErrors.slice(0, 12)) console.log('  ', e);
console.log('--- page errors:', pageErrors.length);
for (const e of pageErrors.slice(0, 12)) console.log('  ', e);
console.log('--- failed requests:', failedRequests.length);
for (const e of failedRequests.slice(0, 12)) console.log('  ', e);

const total = problems.length + pageErrors.length + realConsole.length + realRequests.length;
console.log(`\n${steps.filter((s) => s.startsWith('OK')).length} checks passed, ${problems.length} failed`);
console.log(`external font requests blocked by the sandbox (ignored): ${fontNoise}`);
console.log(total ? `${problems.length} check failures, ${pageErrors.length + realConsole.length} JS errors, ${realRequests.length} failed requests` : 'WALK CLEAN');
process.exit(total ? 1 : 0);
