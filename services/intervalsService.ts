import { Encoder, Profile } from '@garmin/fitsdk';
import { WorkoutSession, IntervalsIcuConfig, WorkoutType } from '../types';

interface FitStepSpec {
  wktStepName: string;
  durationType: 'distance' | 'time' | 'repeatUntilStepsCmplt';
  durationValue: number;
  // Used for repeat steps (repeatUntilStepsCmplt): step index to repeat to.
  targetValue?: number;
  targetType: 'speed' | 'open';
  customTargetValueLow?: number;
  customTargetValueHigh?: number;
  intensity: 'active' | 'rest' | 'warmup' | 'cooldown' | 'recovery' | 'interval' | 'other';
}

const PLACEHOLDER_STEP_VALUES = new Set(['', '0', 'n/a', 'na', 'direct start', 'walk off', 'none']);

const getDynamicTitle = (session: WorkoutSession): string => {
  if (session.type !== WorkoutType.THRESHOLD || !session.intervals?.length) return session.title;
  const first = session.intervals[0];
  const reps = Math.max(1, Number(first.count) || 1);
  const dist = Math.max(0, Number(first.distance) || 0);
  const distLabel = dist >= 1000 ? `${Math.round((dist / 1000) * 10) / 10}km` : `${Math.round(dist)}m`;
  return `SubT ${reps}x${distLabel}`;
};

const getIcuType = (_type: WorkoutType): string => 'Run';

const sanitizeFilename = (name: string): string => {
  const safe = (name || 'workout')
    .replace(/[^a-zA-Z0-9-_]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '');
  return safe || 'workout';
};

const isPlaceholderStep = (raw?: string): boolean => {
  const value = (raw || '').trim().toLowerCase();
  return PLACEHOLDER_STEP_VALUES.has(value);
};

const parseTimeTokenToSec = (token: string): number => {
  const parts = token.trim().split(':').map((v) => Number(v));
  if (parts.length === 2 && parts.every((v) => Number.isFinite(v))) {
    return (parts[0] * 60) + parts[1];
  }
  if (parts.length === 3 && parts.every((v) => Number.isFinite(v))) {
    return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
  }
  return 0;
};

const parsePaceRangeToSpeedRaw = (pace?: string): { low: number; high: number } | null => {
  const text = (pace || '').replace(/\/km/gi, '').replace(/pace/gi, '').trim();
  if (!text) return null;

  const pieces = text.split('-').map((v) => v.trim()).filter(Boolean);
  if (pieces.length === 0) return null;

  const seconds = pieces
    .map(parseTimeTokenToSec)
    .filter((v) => Number.isFinite(v) && v > 0);

  if (seconds.length === 0) return null;

  const [a, b] = seconds.length === 1 ? [seconds[0], seconds[0]] : [seconds[0], seconds[1]];
  const speedA = 1000 / a;
  const speedB = 1000 / b;

  return {
    low: Math.round(Math.min(speedA, speedB) * 1000),
    high: Math.round(Math.max(speedA, speedB) * 1000),
  };
};

const extractEasyPaceFromDescription = (description?: string): string => {
  const text = (description || '').trim();
  if (!text) return '';
  const m = text.match(/Target Pace:\s*([0-9]+:[0-9]{2})(?:-([0-9]+:[0-9]{2}))?\/km/i);
  if (!m) return '';
  const low = (m[1] || '').trim();
  const high = (m[2] || '').trim();
  if (!low) return '';
  return high ? `${low}-${high}` : low;
};

const parseDurationToFit = (raw?: string): { durationType: 'distance' | 'time'; durationValue: number } | null => {
  const value = (raw || '').trim().toLowerCase();
  if (isPlaceholderStep(value)) return null;

  const kmMatch = value.match(/(\d+(?:\.\d+)?)\s*km/);
  if (kmMatch) {
    const meters = Math.max(0, Number(kmMatch[1]) * 1000);
    if (meters <= 0) return null;
    return { durationType: 'distance', durationValue: Math.round(meters * 100) };
  }

  const secMatch = value.match(/(\d+(?:\.\d+)?)\s*s/);
  if (secMatch) {
    const seconds = Math.max(0, Number(secMatch[1]));
    if (seconds <= 0) return null;
    return { durationType: 'time', durationValue: Math.round(seconds * 1000) };
  }

  const minMatch = value.match(/(\d+(?:\.\d+)?)\s*m(?![a-z])/);
  if (minMatch) {
    const seconds = Math.max(0, Number(minMatch[1]) * 60);
    if (seconds <= 0) return null;
    return { durationType: 'time', durationValue: Math.round(seconds * 1000) };
  }

  const numeric = value.match(/^(\d+(?:\.\d+)?)$/);
  if (numeric) {
    const seconds = Math.max(0, Number(numeric[1]));
    if (seconds <= 0) return null;
    return { durationType: 'time', durationValue: Math.round(seconds * 1000) };
  }

  return null;
};

const buildFitStep = (
  name: string,
  duration: { durationType: 'distance' | 'time'; durationValue: number },
  intensity: FitStepSpec['intensity'],
  paceRange?: string
): FitStepSpec => {
  const speed = parsePaceRangeToSpeedRaw(paceRange);
  if (!speed) {
    return {
      wktStepName: name,
      durationType: duration.durationType,
      durationValue: duration.durationValue,
      targetType: 'open',
      intensity,
    };
  }

  return {
    wktStepName: name,
    durationType: duration.durationType,
    durationValue: duration.durationValue,
    targetType: 'speed',
    customTargetValueLow: speed.low,
    customTargetValueHigh: speed.high,
    intensity,
  };
};

const buildWorkoutSteps = (session: WorkoutSession): FitStepSpec[] => {
  const steps: FitStepSpec[] = [];

  const warmupDuration = parseDurationToFit(session.warmup);
  if (warmupDuration) {
    steps.push(buildFitStep('Warm Up', warmupDuration, 'warmup'));
  }

  if (session.intervals && session.intervals.length > 0) {
    for (const int of session.intervals) {
      const repDistance = Math.max(0, Number(int.distance) || 0);
      const repDuration = repDistance > 0
        ? { durationType: 'distance' as const, durationValue: Math.round(repDistance * 100) }
        : parseDurationToFit(int.description) || { durationType: 'time' as const, durationValue: 60000 };

      const reps = Math.max(1, Number(int.count) || 1);
      const recoveryDuration = parseDurationToFit(int.rest || '');
      const blockStartIndex = steps.length;

      // Encode one rep pair + a FIT repeat step so Garmin shows repeats instead of flat duplicated steps.
      steps.push(buildFitStep('Run', repDuration, 'active', int.pace));
      if (recoveryDuration) {
        steps.push(buildFitStep('Recover', recoveryDuration, 'rest'));
      }

      if (reps > 1) {
        steps.push({
          wktStepName: `Repeat ${reps}x`,
          durationType: 'repeatUntilStepsCmplt',
          durationValue: blockStartIndex,
          targetType: 'open',
          targetValue: reps,
          intensity: 'active',
        });
      }
    }
  } else {
    const distanceMeters = Math.max(0, (Number(session.distance) || 0) * 1000);
    const duration = distanceMeters > 0
      ? { durationType: 'distance' as const, durationValue: Math.round(distanceMeters * 100) }
      : { durationType: 'time' as const, durationValue: Math.max(60000, Math.round((Number(session.duration) || 0) * 60000)) };

    steps.push(buildFitStep('Run', duration, 'active', extractEasyPaceFromDescription(session.description)));
  }

  const cooldownDuration = parseDurationToFit(session.cooldown);
  if (cooldownDuration) {
    steps.push(buildFitStep('Cool Down', cooldownDuration, 'cooldown'));
  }

  if (steps.length === 0) {
    steps.push({
      wktStepName: 'Run',
      durationType: 'time',
      durationValue: Math.max(60000, Math.round((Number(session.duration) || 1) * 60000)),
      targetType: 'open',
      intensity: 'active',
    });
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
  const steps = buildWorkoutSteps(session);
  const encoder = new Encoder();

  encoder.onMesg(Profile.MesgNum.FILE_ID, {
    type: 'workout',
    manufacturer: 'garmin',
    product: 1,
    timeCreated: new Date(),
  });

  encoder.onMesg(Profile.MesgNum.WORKOUT, {
    sport: 'running',
    subSport: 'street',
    numValidSteps: steps.length,
    wktName: workoutName,
    wktDescription: session.description || workoutName,
  });

  steps.forEach((step, index) => {
    encoder.onMesg(Profile.MesgNum.WORKOUT_STEP, {
      messageIndex: index,
      ...step,
    });
  });

  return toBase64(encoder.close());
};

const buildWorkoutPayload = (session: WorkoutSession, date: string) => {
  const dynamicTitle = getDynamicTitle(session);
  const movingTimeSec = Math.max(0, Math.round((Number(session.duration) || 0) * 60));
  const fileContentsBase64 = buildFitWorkoutFileBase64(session);

  return {
    category: 'WORKOUT',
    type: getIcuType(session.type),
    name: dynamicTitle,
    // Midday local avoids timezone/date rollover issues (e.g. missing Sunday on downstream sync).
    start_date_local: `${date}T12:00:00`,
    moving_time: movingTimeSec,
    filename: `${sanitizeFilename(dynamicTitle)}.fit`,
    file_contents_base64: fileContentsBase64,
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

export const syncRestDayToIcu = async (
  config: IntervalsIcuConfig,
  date: string,
  eventId?: number
): Promise<IcuSyncResult> => {
  if (!config.connected || !config.athleteId || !config.apiKey) {
    return { ok: false, eventId: null, error: 'Intervals.icu is not connected.' };
  }

  const auth = btoa(`API_KEY:${config.apiKey}`);
  const payload = {
    category: 'WORKOUT',
    type: 'Run',
    name: 'Rest Day',
    description: 'Rest Day',
    start_date_local: `${date}T12:00:00`
  };

  try {
    const method = eventId ? 'PUT' : 'POST';
    const url = `https://intervals.icu/api/v1/athlete/${config.athleteId}/events${eventId ? `/${eventId}` : ''}`;
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
        error: await extractErrorMessage(response, 'Failed to sync rest day to Intervals.icu'),
      };
    }
    const syncedEventId = await parseAndResolveSuccessId(response, eventId);
    return { ok: true, eventId: syncedEventId };
  } catch (error) {
    console.error('Intervals.icu Rest Day Sync Error:', error);
    return {
      ok: false,
      eventId: null,
      error: error instanceof Error ? error.message : 'Network error while syncing rest day.',
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
