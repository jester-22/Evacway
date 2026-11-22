const ALERT_SOUND_MUTED_KEY = "evacway_alert_sound_muted";
const SOUND_COOLDOWN_MS = 1200;

let sharedAudioContext = null;
let activeMasterGain = null;
let lastPlayedAt = 0;

function getAudioContextConstructor() {
  if (typeof window === "undefined") return null;
  return window.AudioContext || window.webkitAudioContext || null;
}

function getOrCreateAudioContext() {
  if (sharedAudioContext && sharedAudioContext.state !== "closed") {
    return sharedAudioContext;
  }
  const AudioCtx = getAudioContextConstructor();
  if (!AudioCtx) return null;
  try {
    sharedAudioContext = new AudioCtx();
    return sharedAudioContext;
  } catch {
    return null;
  }
}

export function getAlertSoundKind(notification) {
  if (!notification || typeof notification !== "object") return null;

  const resourceType = String(notification.resource_type || "").toLowerCase();
  const eventType = String(notification.event_type || "").toLowerCase();

  if (
    notification.is_emergency === true ||
    resourceType === "rescue_request" ||
    eventType.includes("rescue")
  ) {
    return "rescue";
  }

  if (resourceType === "hazard_report" || eventType.includes("hazard")) {
    return "hazard";
  }

  return null;
}

export function isAlertSoundNotification(notification) {
  return getAlertSoundKind(notification) !== null;
}

export function getBatchAlertSoundKind(notifications) {
  if (!Array.isArray(notifications) || notifications.length === 0) return null;

  let kind = null;
  for (const item of notifications) {
    const itemKind = getAlertSoundKind(item);
    if (itemKind === "rescue") return "rescue";
    if (itemKind === "hazard") kind = "hazard";
  }
  return kind;
}

export function isAlertSoundMuted() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return false;
    return window.localStorage.getItem(ALERT_SOUND_MUTED_KEY) === "true";
  } catch {
    return false;
  }
}

export function setAlertSoundMuted(muted) {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(ALERT_SOUND_MUTED_KEY, muted ? "true" : "false");
  } catch {
    // Ignore storage errors (private mode / quota)
  }
}

export function unlockAlertAudio() {
  const ctx = getOrCreateAudioContext();
  if (!ctx) return false;
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
  return ctx.state === "running";
}

function stopActiveAlert(ctx) {
  if (!activeMasterGain) return;
  try {
    const now = ctx.currentTime;
    activeMasterGain.gain.cancelScheduledValues(now);
    activeMasterGain.gain.setTargetAtTime(0.0001, now, 0.015);
  } catch {
    // Ignore cleanup errors
  }
  activeMasterGain = null;
}

function createAlertBus(ctx, cutoffHz = 2400) {
  stopActiveAlert(ctx);

  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(1, ctx.currentTime);

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(cutoffHz, ctx.currentTime);
  filter.Q.setValueAtTime(1.2, ctx.currentTime);

  filter.connect(masterGain);
  masterGain.connect(ctx.destination);
  activeMasterGain = masterGain;
  return filter;
}

function scheduleDualToneBurst(ctx, destination, startTime, duration, frequencies, gain = 0.24, type = "square") {
  const burstGain = ctx.createGain();
  const attackEnd = startTime + 0.008;
  const releaseStart = Math.max(attackEnd, startTime + duration - 0.015);

  burstGain.gain.setValueAtTime(0.0001, startTime);
  burstGain.gain.linearRampToValueAtTime(gain, attackEnd);
  burstGain.gain.setValueAtTime(gain, releaseStart);
  burstGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  burstGain.connect(destination);

  frequencies.forEach((freq, idx) => {
    const osc = ctx.createOscillator();
    osc.type = idx === 0 ? type : "triangle";
    osc.frequency.setValueAtTime(freq, startTime);
    osc.connect(burstGain);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
  });
}

function schedulePattern(ctx) {
  const now = ctx.currentTime + 0.02;

  // Urgent NDRRMC/EAS-style 853 Hz + 960 Hz dual-tone emergency alert bursts
  // Used for both hazard reports and emergency rescue requests
  const bus = createAlertBus(ctx, 2600);
  const emergencyFreqs = [853, 960];
  const bursts = [
    { offset: 0.0, duration: 0.24 },
    { offset: 0.34, duration: 0.24 },
    { offset: 0.68, duration: 0.42 },
    { offset: 1.32, duration: 0.24 },
    { offset: 1.66, duration: 0.24 },
    { offset: 2.0, duration: 0.48 },
  ];
  bursts.forEach(({ offset, duration }) => {
    scheduleDualToneBurst(ctx, bus, now + offset, duration, emergencyFreqs, 0.24, "sawtooth");
  });
}

export function playAlertSound(kind = "hazard", { force = false } = {}) {
  if (!kind) return false;
  if (!force && isAlertSoundMuted()) return false;

  const nowMs = Date.now();
  if (!force && nowMs - lastPlayedAt < SOUND_COOLDOWN_MS) {
    return false;
  }

  const ctx = getOrCreateAudioContext();
  if (!ctx) return false;

  lastPlayedAt = nowMs;

  try {
    if (ctx.state === "suspended") {
      ctx
        .resume()
        .then(() => {
          if (ctx.state === "running") {
            schedulePattern(ctx);
          }
        })
        .catch(() => {});
    } else {
      schedulePattern(ctx);
    }
    return true;
  } catch {
    return false;
  }
}
