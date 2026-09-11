// Deal stages and the transition rules. Pure.

export const STAGES = ['referred', 'application', 'lodged', 'conditional', 'formal', 'settled'];
export const OFF_RAMPS = ['declined', 'withdrawn'];
export const ALL_STAGES = [...STAGES, ...OFF_RAMPS];

export const STAGE_LABELS = {
  referred: 'Referred',
  application: 'Application',
  lodged: 'Lodged',
  conditional: 'Conditional approval',
  formal: 'Formal approval',
  settled: 'Settled',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
};

export const STAGE_SHORT = {
  referred: 'Referred',
  application: 'Application',
  lodged: 'Lodged',
  conditional: 'Conditional',
  formal: 'Formal',
  settled: 'Settled',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
};

export function isStage(value) {
  return ALL_STAGES.includes(value);
}

export function stageLabel(stage) {
  return STAGE_LABELS[stage] || String(stage || 'Unknown');
}

/** Position on the main line; -1 for off-ramps and unknown stages. */
export function stageIndex(stage) {
  return STAGES.indexOf(stage);
}

export function isOffRamp(stage) {
  return OFF_RAMPS.includes(stage);
}

export function isSettled(stage) {
  return stage === 'settled';
}

/** Settled and off-ramp deals are closed; settled ones are also locked. */
export function isClosed(stage) {
  return stage === 'settled' || isOffRamp(stage);
}

export function isLive(stage) {
  return stageIndex(stage) >= 0 && stage !== 'settled';
}

export function atOrPast(stage, marker) {
  const a = stageIndex(stage);
  const b = stageIndex(marker);
  if (a < 0 || b < 0) return false;
  return a >= b;
}

export function nextStage(stage) {
  const i = stageIndex(stage);
  if (i < 0 || i >= STAGES.length - 1) return null;
  return STAGES[i + 1];
}

/**
 * Can a deal move from `from` to `to`?
 * Settled deals are locked: reopening is an explicit action, not a transition.
 * Off-ramped deals are also locked and must be reopened.
 */
export function canTransition(from, to) {
  if (!isStage(to)) return { ok: false, reason: 'unknown_stage', message: `${to} is not a stage` };
  if (!isStage(from)) return { ok: true, backwards: false };
  if (from === to) return { ok: false, reason: 'same_stage', message: `Already at ${stageLabel(to)}` };
  if (from === 'settled') {
    return { ok: false, reason: 'settled_locked', message: 'Settled deals are locked. Reopen the deal first.' };
  }
  if (isOffRamp(from)) {
    return { ok: false, reason: 'off_ramp_locked', message: `${stageLabel(from)} deals are closed. Reopen the deal first.` };
  }
  if (isOffRamp(to)) return { ok: true, backwards: false };
  const a = stageIndex(from);
  const b = stageIndex(to);
  return { ok: true, backwards: b < a };
}

/** The stage a milestone word implies, or null. */
export function stageFromMilestoneWord(word) {
  const w = String(word || '').toLowerCase();
  if (/\bsettled\b|\bsettlement (?:is )?complete|\bdisburs/.test(w)) return 'settled';
  if (/\bformal(?:ly)? (?:approval|approved)\b|\bunconditional\b/.test(w)) return 'formal';
  if (/\bconditional(?:ly)? (?:approval|approved)\b|\bpre-?approval (?:granted|issued)\b/.test(w)) return 'conditional';
  if (/\blodg(?:ed|ement|ment)\b|\bsubmitted to (?:the )?lender\b/.test(w)) return 'lodged';
  if (/\bapplication (?:started|prepared|in progress)\b/.test(w)) return 'application';
  if (/\bdeclin(?:ed|e)\b|\bnot approved\b/.test(w)) return 'declined';
  if (/\bwithdraw(?:n|al)\b|\bcancelled\b/.test(w)) return 'withdrawn';
  return null;
}
