import { Encoder, Profile } from '@garmin/fitsdk';
import { WorkoutSession, IntervalsIcuConfig, WorkoutType } from '../types';

interface FitStepSpec {
  wktStepName: string;
  durationType: 'distance' | 'time' | 'repeatUntilStepsCmplt';
  durationValue: number;
  targetType: 'speed' | 'heartRate' | 'power' | 'open';
  targetValue?: number;
  customTargetValueLow?: number;
  customTargetValueHigh?: number;
  intensity?: 'active' | 'rest' | 'warmup' | 'cooldown' | 'recovery' | 'interval' | 'other';
}

const PLACEHOLDER_STEP_VALUES = new Set(['', '0', 'n/a', 'na', 'direct start', 'walk off', 'none']);
const ICU_GARMIN_SAFE_INTENSITY = String(import.meta.env.VITE_ICU_GARMIN_SAFE_INTENSITY ?? 'true').toLowerCase() !== 'false';

const getDynamicTitle = (session: WorkoutSession): string => {
  if (session.type !== WorkoutType.THRESHOLD || !session.intervals?.length) return session.title;
  const first = session.intervals[0];
  const reps = Math.max(1, Number(first.count) || 1);
  const durationSec = Number(first.durationSec) || 0;
  if (durationSec > 0) {
    const mins = Math.max(1, Math.round(durationSec / 60));
    return `SubT ${reps}x${mins}:00`;
  }
  const dist = Math.max(0, Number(first.distance) || 0);
  const distLabel = dist >= 1000 ? `${Math.round((dist / 1000) * 10) / 10}km` : `${Math.round(dist)}m`;
  return `SubT ${reps}x${distLabel}`;
};

const getIcuType = (_type: WorkoutType, sport: WorkoutSession['sport']): string => (sport === 'bike' ? 'Ride' : 'Run');

const isPlaceholderStep = (raw?: string): boolean => {
  const value = (raw || '').trim().toLowerCase();
  return PLACEHOLDER_STEP_VALUES.has(value);
};

const kmTokenFromMeters = (meters: number): string => {
  const km = Math.max(0, Number(meters) || 0) / 1000;
  const rounded = Math.round(km * 1000) / 1000;
  return `${rounded}km`;
};

const normalizePaceRange = (pace: string): string => {
  const cleaned = (pace || '').replace(/\/km/gi, '').replace(/pace/gi, '').trim();
  if (!cleaned) return '';
  const parts = cleaned.split('-').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return `${parts[0]}/km`;
  return `${parts[0]}-${parts[1]}/km`;
};

const normalizeEasyStep = (raw: string): string => {
  const value = (raw || '').trim();
  if (!value) return '10m easy run';

  const kmMatch = value.match(/(\d+(?:\.\d+)?)\s*km/i);
  if (kmMatch) return `${kmMatch[1]}km easy run`;

  const secMatch = value.match(/(\d+(?:\.\d+)?)\s*s/i);
  if (secMatch) return `${secMatch[1]}s easy run`;

  const minMatch = value.match(/(\d+(?:\.\d+)?)\s*m(?![a-z])/i);
  if (minMatch) return `${minMatch[1]}m easy run`;

  return `${value} easy run`;
};

const normalizeRecoveryStep = (raw: string): string => {
  const value = (raw || '').trim();
  if (!value || value === '0') return '';

  const kmMatch = value.match(/(\d+(?:\.\d+)?)\s*km/i);
  if (kmMatch) return `${kmMatch[1]}km recovery run`;

  const secMatch = value.match(/(\d+(?:\.\d+)?)\s*s/i);
  if (secMatch) return `${secMatch[1]}s recovery`;

  const minMatch = value.match(/(\d+(?:\.\d+)?)\s*m(?![a-z])/i);
  if (minMatch) return `${minMatch[1]}m recovery`;

  const numericOnly = value.match(/^(\d+(?:\.\d+)?)$/);
  if (numericOnly) return `${numericOnly[1]}s recovery`;

  return `${value} recovery`;
};

const extractEasyPaceFromDescription = (description: string): string => {
  const text = (description || '').trim();
  if (!text) return '';
  const m = text.match(/Target Pace:\s*([0-9]+:[0-9]{2})(?:-([0-9]+:[0-9]{2}))?\/km/i);
  if (!m) return '';
  const low = (m[1] || '').trim();
  const high = (m[2] || '').trim();
  if (!low) return '';
  return high ? `${low}-${high}/km` : `${low}/km`;
};

const sanitizeFilename = (name: string): string => {
  const safe = (name || 'workout')
    .replace(/[^a-zA-Z0-9-_]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '');
  return safe || 'workout';
};

const parsePaceRangeToSpeedRaw = (pace?: string): { low: number; high: number } | null => {
  const text = normalizePaceRange(pace || '');
  if (!text) return null;

  const parts = text.replace('/km', '').split('-').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;

  const toSec = (token: string): number => {
    const segments = token.split(':').map((v) => Number(v));
    if (segments.length === 2 && segments.every((v) => Number.isFinite(v))) return (segments[0] * 60) + segments[1];
    if (segments.length === 3 && segments.every((v) => Number.isFinite(v))) return (segments[0] * 3600) + (segments[1] * 60) + segments[2];
    return 0;
  };

  const values = parts.map(toSec).filter((v) => v > 0);
  if (!values.length) return null;

  const slowest = Math.max(...values);
  const fastest = Math.min(...values);
  const lowMs = 1000 / slowest;
  const highMs = 1000 / fastest;

  return {
    low: Math.round(lowMs * 1000),
    high: Math.round(highMs * 1000),
  };
};

const parseDurationToFit = (raw?: string): { durationType: 'distance' | 'time'; durationValue: number } | null => {
  const value = (raw || '').trim().toLowerCase();
  if (isPlaceholderStep(value)) return null;

  const kmMatch = value.match(/(\d+(?:\.\d+)?)\s*km/);
  if (kmMatch) {
    const meters = Math.max(0, Number(kmMatch[1]) * 1000);
    if (meters > 0) return { durationType: 'distance', durationValue: Math.round(meters * 100) };
  }

  const secMatch = value.match(/(\d+(?:\.\d+)?)\s*s/);
  if (secMatch) {
    const seconds = Math.max(0, Number(secMatch[1]));
    if (seconds > 0) return { durationType: 'time', durationValue: Math.round(seconds * 1000) };
  }

  const minMatch = value.match(/(\d+(?:\.\d+)?)\s*m(?![a-z])/);
  if (minMatch) {
    const seconds = Math.max(0, Number(minMatch[1]) * 60);
    if (seconds > 0) return { durationType: 'time', durationValue: Math.round(seconds * 1000) };
  }

  return null;
};

const buildFitStep = (
  name: string,
  duration: { durationType: 'distance' | 'time'; durationValue: number },
  intensity: NonNullable<FitStepSpec['intensity']>,
  paceRange?: string,
  heartRateRange?: { low: number; high: number },
  powerRange?: { low: number; high: number }
): FitStepSpec => {
  const safeIntensity = (() => {
    // Compatibility mode: avoid known problematic active/interval mapping that can appear as "Other" in Garmin.
    if (!ICU_GARMIN_SAFE_INTENSITY) return intensity;
    if (intensity === 'interval' || intensity === 'active') return undefined;
    if (intensity === 'recovery') return 'rest';
    return intensity;
  })();

  if (powerRange && Number.isFinite(powerRange.low) && Number.isFinite(powerRange.high)) {
    return {
      wktStepName: name,
      durationType: duration.durationType,
      durationValue: duration.durationValue,
      targetType: 'power',
      customTargetValueLow: Math.round(powerRange.low),
      customTargetValueHigh: Math.round(powerRange.high),
      intensity: safeIntensity,
    };
  }

  if (heartRateRange && Number.isFinite(heartRateRange.low) && Number.isFinite(heartRateRange.high)) {
    return {
      wktStepName: name,
      durationType: duration.durationType,
      durationValue: duration.durationValue,
      targetType: 'heartRate',
      customTargetValueLow: Math.round(heartRateRange.low),
      customTargetValueHigh: Math.round(heartRateRange.high),
      intensity: safeIntensity,
    };
  }

  const speed = parsePaceRangeToSpeedRaw(paceRange);
  if (!speed) {
    return {
      wktStepName: name,
      durationType: duration.durationType,
      durationValue: duration.durationValue,
      targetType: 'open',
      intensity: safeIntensity,
    };
  }

  return {
    wktStepName: name,
    durationType: duration.durationType,
    durationValue: duration.durationValue,
    targetType: 'speed',
    customTargetValueLow: speed.low,
    customTargetValueHigh: speed.high,
    intensity: safeIntensity,
  };
};

const buildFitWorkoutSteps = (session: WorkoutSession): FitStepSpec[] => {
  const steps: FitStepSpec[] = [];
  const hrRange = session.useHeartRateTarget && session.targetHrLow && session.targetHrHigh
    ? { low: session.targetHrLow, high: session.targetHrHigh }
    : undefined;
  const isBike = (session.sport || 'run') === 'bike';

  const warmup = parseDurationToFit(session.warmup);
  if (warmup) {
    steps.push(buildFitStep(isBike ? 'Warm Up Z2' : 'Warm Up', warmup, 'warmup', undefined, hrRange));
  }

  if (session.intervals?.length) {
    for (const interval of session.intervals) {
      const reps = Math.max(1, Number(interval.count) || 1);
      const repDistance = Math.max(0, Number(interval.distance) || 0);
      const repDuration = ((Number(interval.durationSec) || 0) > 0)
        ? { durationType: 'time' as const, durationValue: Math.max(1000, Math.round((Number(interval.durationSec) || 60) * 1000)) }
        : repDistance > 0
          ? { durationType: 'distance' as const, durationValue: Math.round(repDistance * 100) }
          : { durationType: 'time' as const, durationValue: Math.max(60000, Math.round((Number(session.duration) || 1) * 60000)) };
      const recovery = parseDurationToFit(interval.rest || '');
      const blockStart = steps.length;
      const powerRange = interval.targetPowerLow && interval.targetPowerHigh
        ? { low: interval.targetPowerLow, high: interval.targetPowerHigh }
        : undefined;

      steps.push(buildFitStep(isBike ? `Run ${interval.targetZone || 'Z3'}` : 'Run', repDuration, session.type === WorkoutType.THRESHOLD ? 'interval' : 'active', interval.pace, hrRange, powerRange));
      if (recovery) {
        steps.push(buildFitStep(isBike ? 'Recovery Z2' : 'Recovery', recovery, 'recovery', undefined, hrRange));
      }

      if (reps > 1) {
        steps.push({
          wktStepName: `Repeat ${reps}x`,
          durationType: 'repeatUntilStepsCmplt',
          durationValue: blockStart,
          targetType: 'open',
          targetValue: reps,
          intensity: ICU_GARMIN_SAFE_INTENSITY ? undefined : 'active',
        });
      }
    }
  } else {
    const distMeters = Math.max(0, (Number(session.distance) || 0) * 1000);
    const duration = (isBike || distMeters <= 0)
      ? { durationType: 'time' as const, durationValue: Math.max(60000, Math.round((Number(session.duration) || 1) * 60000)) }
      : distMeters > 0
      ? { durationType: 'distance' as const, durationValue: Math.round(distMeters * 100) }
      : { durationType: 'time' as const, durationValue: Math.max(60000, Math.round((Number(session.duration) || 1) * 60000)) };
    steps.push(buildFitStep(isBike ? `Ride ${session.intervals?.[0]?.targetZone || 'Z2'}` : 'Run', duration, 'active', extractEasyPaceFromDescription(session.description || ''), hrRange));
  }

  const cooldown = parseDurationToFit(session.cooldown);
  if (cooldown) {
    steps.push(buildFitStep(isBike ? 'Cool Down Z2' : 'Cool Down', cooldown, 'cooldown', undefined, hrRange));
  }

  return steps;
};

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...Array.from(chunk));
  }
  return btoa(binary);
};

const buildFitWorkoutFileBase64 = (session: WorkoutSession): string => {
  const workoutName = getDynamicTitle(session);
  const steps = buildFitWorkoutSteps(session);
  const encoder = new Encoder();

  encoder.onMesg(Profile.MesgNum.FILE_ID, {
    type: 'workout',
    manufacturer: 'garmin',
    product: 1,
    timeCreated: new Date(),
  });

  encoder.onMesg(Profile.MesgNum.WORKOUT, {
    sport: (session.sport || 'run') === 'bike' ? 'cycling' : 'running',
    subSport: (session.sport || 'run') === 'bike' ? 'road' : 'street',
    numValidSteps: steps.length,
    wktName: workoutName,
    wktDescription: session.description || workoutName,
  });

  steps.forEach((step, idx) => {
    encoder.onMesg(Profile.MesgNum.WORKOUT_STEP, {
      messageIndex: idx,
      ...step,
    });
  });

  return toBase64(encoder.close());
};

/**
 * Intervals.icu workout text format with explicit run/recovery wording.
 * Example: Wu 2km easy run; 5x[2km @ 4:10-4:20/km run / 60s recovery]; Cd 1km easy run
 */
const formatIcuWorkoutText = (session: WorkoutSession): string => {
  const title = getDynamicTitle(session);
  const chunks: string[] = [];
  const hrToken = session.useHeartRateTarget
    ? (session.targetHrLow && session.targetHrHigh ? `Z2 HR (${session.targetHrLow}-${session.targetHrHigh} bpm)` : 'Z2 HR')
    : '';
  const isBike = (session.sport || 'run') === 'bike';

  if (!isPlaceholderStep(session.warmup) && session.warmup) {
    chunks.push(`Wu ${normalizeEasyStep(session.warmup)}`);
  }

  if (session.intervals && session.intervals.length > 0) {
    for (const int of session.intervals) {
      const reps = Math.max(1, Number(int.count) || 1);
      const durationSec = Number(int.durationSec) || 0;
      const distStr = int.distance > 0 ? kmTokenFromMeters(int.distance) : '';
      const pace = normalizePaceRange(int.pace || '');
      const runStep = isBike
        ? `${distStr} ${int.targetPowerLow && int.targetPowerHigh ? `@ ${int.targetPowerLow}-${int.targetPowerHigh}w` : `@ ${int.targetZone || 'Z2'}`} ride`.trim()
        : session.useHeartRateTarget
          ? `${durationSec > 0 ? `${Math.round(durationSec / 60)}m` : distStr} @ ${hrToken} run`.trim()
          : `${durationSec > 0 ? `${Math.round(durationSec / 60)}m` : distStr}${pace ? ` @ ${pace}` : ''} run`.trim();
      const recovery = normalizeRecoveryStep(int.rest || '');

      if (reps > 1) {
        if (recovery) {
          chunks.push(`${reps}x[${runStep} / ${recovery}]`);
        } else {
          chunks.push(`${reps}x[${runStep}]`);
        }
      } else if (recovery) {
        chunks.push(`${runStep}; ${recovery}`);
      } else {
        chunks.push(runStep);
      }
    }
  } else {
    const easyPace = extractEasyPaceFromDescription(session.description || '');
    const main = isBike
      ? `${Math.round(Number(session.duration) || 0)}m @ ${(session.intervals?.[0]?.targetPowerLow && session.intervals?.[0]?.targetPowerHigh) ? `${session.intervals?.[0]?.targetPowerLow}-${session.intervals?.[0]?.targetPowerHigh}w` : (session.intervals?.[0]?.targetZone || 'Z2')} ride`
      : session.useHeartRateTarget
        ? `${session.distance}km @ ${hrToken} run`
        : `${session.distance}km${easyPace ? ` @ ${easyPace}` : ''} run`;
    chunks.push(main);
  }

  if (!isPlaceholderStep(session.cooldown) && session.cooldown) {
    chunks.push(`Cd ${normalizeEasyStep(session.cooldown)}`);
  }

  const body = chunks.join('; ');
  return `${title}\n\n${body}`;
};

const buildWorkoutPayload = (session: WorkoutSession, date: string) => {
  const dynamicTitle = getDynamicTitle(session);
  const movingTimeSec = Math.max(0, Math.round((Number(session.duration) || 0) * 60));
  const icuWorkout = formatIcuWorkoutText(session);
  const fitWorkoutBase64 = buildFitWorkoutFileBase64(session);

  return {
    category: 'WORKOUT',
    type: getIcuType(session.type, session.sport),
    name: dynamicTitle,
    // Keep ICU text for readability/debugging and fallback parsing.
    description: icuWorkout,
    // Also provide FIT to preserve strict step structure and repeat encoding.
    filename: `${sanitizeFilename(dynamicTitle)}.fit`,
    file_contents_base64: fitWorkoutBase64,
    // Midday local avoids timezone/date rollover issues (e.g. missing Sunday on downstream sync).
    start_date_local: `${date}T12:00:00`,
    moving_time: movingTimeSec,
  };
};

export interface IcuSyncResult {
  ok: boolean;
  eventId: number | null;
  status?: number;
  error?: string;
}

export interface IcuBulkSyncResult {
  ok: boolean;
  eventIdsByExternalId: Record<string, number>;
  status?: number;
  error?: string;
}

export interface BulkWorkoutInput {
  session: WorkoutSession;
  date: string;
  externalId: string;
}

const extractErrorMessage = async (response: Response, fallback: string): Promise<string> => {
  let raw = '';
  try {
    raw = await response.text();
    if (raw) {
      try {
        const data = JSON.parse(raw);
        const msg = data?.message || data?.error || data?.detail;
        if (msg) return String(msg);
      } catch {
        return raw;
      }
      return raw;
    }
  } catch {
    // Ignore read errors and use fallback.
  }

  if (raw) {
    return raw;
  }

  return `${fallback} (${response.status})`;
};

const parseSuccessJson = async (response: Response): Promise<any | null> => {
  const raw = await response.text();
  if (!raw || !raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const resolveEventId = (parsed: any, existingId?: number): number | null => {
  const parsedId = Number(parsed?.id);
  if (Number.isFinite(parsedId) && parsedId > 0) return parsedId;
  if (existingId && Number.isFinite(existingId) && existingId > 0) return existingId;
  return null;
};

const parseAndResolveSuccessId = async (response: Response, existingId?: number): Promise<number | null> => {
  try {
    const data = await parseSuccessJson(response);
    return resolveEventId(data, existingId);
  } catch {
    return existingId || null;
  }
};

export const syncWorkoutsBulkToIcu = async (
  config: IntervalsIcuConfig,
  items: BulkWorkoutInput[]
): Promise<IcuBulkSyncResult> => {
  if (!config.connected || !config.apiKey) {
    return { ok: false, eventIdsByExternalId: {}, error: 'Intervals.icu is not connected.' };
  }

  const auth = btoa(`API_KEY:${config.apiKey}`);
  const payload = items.map((item) => ({
    ...buildWorkoutPayload(item.session, item.date),
    external_id: item.externalId,
  }));

  try {
    const response = await fetch('https://intervals.icu/api/v1/athlete/0/events/bulk?upsert=true', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      return {
        ok: false,
        eventIdsByExternalId: {},
        status: response.status,
        error: await extractErrorMessage(response, 'Failed to bulk sync workouts to Intervals.icu'),
      };
    }

    const data = await response.json();
    const arr = Array.isArray(data) ? data : [];
    const eventIdsByExternalId: Record<string, number> = {};

    for (const item of arr) {
      const externalId = String(item?.external_id || '');
      const eventId = Number(item?.id);
      if (externalId && Number.isFinite(eventId) && eventId > 0) {
        eventIdsByExternalId[externalId] = eventId;
      }
    }

    return { ok: true, eventIdsByExternalId };
  } catch (error) {
    console.error('Intervals.icu Bulk Sync Error:', error);
    return {
      ok: false,
      eventIdsByExternalId: {},
      error: error instanceof Error ? error.message : 'Network error while bulk syncing workouts.',
    };
  }
};

export const syncWorkoutToIcu = async (
  config: IntervalsIcuConfig,
  session: WorkoutSession,
  date: string
): Promise<IcuSyncResult> => {
  if (!config.connected || !config.athleteId || !config.apiKey) {
    return { ok: false, eventId: null, error: 'Intervals.icu is not connected.' };
  }

  const auth = btoa(`API_KEY:${config.apiKey}`);
  const payload = buildWorkoutPayload(session, date);

  try {
    const method = session.icuEventId ? 'PUT' : 'POST';
    const url = `https://intervals.icu/api/v1/athlete/${config.athleteId}/events${session.icuEventId ? `/${session.icuEventId}` : ''}`;

    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      return {
        ok: false,
        eventId: null,
        status: response.status,
        error: await extractErrorMessage(response, 'Failed to sync workout to Intervals.icu'),
      };
    }

    const eventId = await parseAndResolveSuccessId(response, session.icuEventId);
    return { ok: true, eventId };
  } catch (error) {
    console.error('Intervals.icu Sync Error:', error);
    return {
      ok: false,
      eventId: null,
      error: error instanceof Error ? error.message : 'Network error while syncing workout.',
    };
  }
};

export const deleteWorkoutFromIcu = async (config: IntervalsIcuConfig, eventId: number): Promise<boolean> => {
  if (!config.connected || !eventId) return false;
  const auth = btoa(`API_KEY:${config.apiKey}`);

  try {
    const athlete = config.athleteId || '0';
    const response = await fetch(`https://intervals.icu/api/v1/athlete/${athlete}/events/${eventId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Basic ${auth}` }
    });
    return response.ok;
  } catch (error) {
    console.error('Intervals.icu Delete Error:', error);
    return false;
  }
};
