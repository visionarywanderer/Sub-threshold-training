import { WorkoutSession, IntervalsIcuConfig, WorkoutType } from '../types';

/**
 * Converts a WorkoutSession into Intervals.icu specific workout text format.
 * Focuses strictly on running metrics.
 */
const formatIcuWorkoutText = (session: WorkoutSession): string => {
  const kmTokenFromMeters = (meters: number): string => {
    const km = Math.max(0, Number(meters) || 0) / 1000;
    const rounded = Math.round(km * 1000) / 1000;
    return `${rounded}km`;
  };

  const normalizeEasyStep = (raw: string): string => {
    const value = (raw || '').trim();
    if (!value) return '10m Z2 Pace';

    const kmMatch = value.match(/(\d+(?:\.\d+)?)\s*km/i);
    if (kmMatch) return `${kmMatch[1]}km Z2 Pace`;

    const secMatch = value.match(/(\d+(?:\.\d+)?)\s*s/i);
    if (secMatch) return `${secMatch[1]}s Easy`;

    const minMatch = value.match(/(\d+(?:\.\d+)?)\s*m(?![a-z])/i);
    if (minMatch) return `${minMatch[1]}m Easy`;

    return value;
  };

  const normalizeRecoveryStep = (raw: string): string => {
    const value = (raw || '').trim();
    if (!value || value === '0') return '';

    const kmMatch = value.match(/(\d+(?:\.\d+)?)\s*km/i);
    if (kmMatch) return `${kmMatch[1]}km Z2 Pace`;

    const secMatch = value.match(/(\d+(?:\.\d+)?)\s*s/i);
    if (secMatch) return `${secMatch[1]}s Easy`;

    const minMatch = value.match(/(\d+(?:\.\d+)?)\s*m(?![a-z])/i);
    if (minMatch) return `${minMatch[1]}m Easy`;

    const numericOnly = value.match(/^(\d+(?:\.\d+)?)$/);
    if (numericOnly) return `${numericOnly[1]}s Easy`;

    return `${value} Easy`;
  };

  const toSinglePaceToken = (pace: string): string => {
    const trimmed = (pace || '').trim();
    if (!trimmed) return '';
    const value = trimmed.replace('/km', '').trim();
    const parts = value.split('-').map((p) => p.trim()).filter(Boolean);
    const toSec = (p: string): number => {
      const [m, s] = p.split(':').map((n) => Number(n));
      if (!Number.isFinite(m) || !Number.isFinite(s)) return 0;
      return (m * 60) + s;
    };
    const toPace = (sec: number): string => {
      const total = Math.max(0, Math.round(sec));
      const m = Math.floor(total / 60);
      const s = String(total % 60).padStart(2, '0');
      return `${m}:${s}/km`;
    };

    if (parts.length === 0) return '';
    if (parts.length === 1) {
      return parts[0].includes('/km') ? parts[0] : `${parts[0]}/km`;
    }

    const a = toSec(parts[0]);
    const b = toSec(parts[1]);
    if (!a || !b) return `${parts[0]}/km`;
    return toPace((a + b) / 2);
  };

  const extractEasyPaceFromDescription = (description: string): string => {
    const text = (description || '').trim();
    if (!text) return '';
    const m = text.match(/Target Pace:\s*([0-9]+:[0-9]{2})(?:-([0-9]+:[0-9]{2}))?\/km/i);
    if (!m) return '';
    const low = (m[1] || '').trim();
    const high = (m[2] || '').trim();
    if (!low) return '';
    if (!high) return `${low}/km Pace`;
    const mid = toSinglePaceToken(`${low}-${high}`);
    return `${mid} Pace`;
  };

  const hasStructuredIntervals = !!session.intervals?.some((int) => {
    const reps = Math.max(1, Number(int.count) || 1);
    const hasRest = !!int.rest && int.rest !== '0';
    return reps > 1 || hasRest;
  });

  const includeWarmupCooldown = session.type === WorkoutType.THRESHOLD || hasStructuredIntervals;

  let text = `${session.title}\n\n`;

  if (includeWarmupCooldown && session.warmup) {
    text += `Warmup\n- ${normalizeEasyStep(session.warmup)}\n\n`;
  }

  if (session.intervals && session.intervals.length > 0) {
    if (session.type !== WorkoutType.THRESHOLD && session.intervals.length === 1) {
      // Easy/steady/long single-session workouts must stay one step for Garmin sync.
      const only = session.intervals[0];
      const distStr = only.distance > 0 ? kmTokenFromMeters(only.distance) : `${session.distance}km`;
      const pace = toSinglePaceToken(only.pace || '');
      text += `Main Set\n- ${distStr}${pace ? ` ${pace} Pace` : ''}\n\n`;
    } else {
      text += `Main Set\n`;
      session.intervals.forEach((int) => {
        const pace = toSinglePaceToken(int.pace || '');
        const effort = pace ? `${pace} Pace` : '';
        const distStr = int.distance > 0 ? kmTokenFromMeters(int.distance) : '';
        const reps = Math.max(1, Number(int.count) || 1);
        const recoveryStep = normalizeRecoveryStep(int.rest || '');

        if (reps > 1) {
          // Keep a compact repeat block so Garmin gets a repeat, not a long flat list.
          text += `${reps}x\n`;
          text += `- ${distStr}${effort ? ` ${effort}` : ''}\n`;
          if (recoveryStep) text += `- ${recoveryStep}\n`;
        } else {
          text += `- ${distStr}${effort ? ` ${effort}` : ''}\n`;
          if (recoveryStep) {
            text += `- ${recoveryStep}\n`;
          }
        }
      });
      text += `\n`;
    }
  } else {
    const easyPace = extractEasyPaceFromDescription(session.description || '');
    text += `Main Set\n- ${session.distance}km${easyPace ? ` ${easyPace}` : ''}\n\n`;
  }

  if (includeWarmupCooldown && session.cooldown) {
    text += `Cooldown\n- ${normalizeEasyStep(session.cooldown)}\n`;
  }

  return text;
};

const getIcuType = (type: WorkoutType): string => {
    return 'Run';
};

const buildWorkoutPayload = (session: WorkoutSession, date: string) => {
  const icuWorkout = formatIcuWorkoutText(session);
  const movingTimeSec = Math.max(0, Math.round((Number(session.duration) || 0) * 60));
  return {
    category: 'WORKOUT',
    type: getIcuType(session.type),
    name: session.title,
    // Intervals.icu expects native workout text in "description" for planned workout parsing.
    description: icuWorkout,
    start_date_local: `${date}T00:00:00`,
    moving_time: movingTimeSec
  };
};

export interface IcuSyncResult {
  ok: boolean;
  eventId: number | null;
  status?: number;
  error?: string;
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
    description: 'Rest Day\n\nMain Set\n- 20m Easy Recovery\n',
    start_date_local: `${date}T00:00:00`
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
    const response = await fetch(`https://intervals.icu/api/v1/athlete/${config.athleteId}/events/${eventId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Basic ${auth}` }
    });
    return response.ok;
  } catch (error) {
    console.error('Intervals.icu Delete Error:', error);
    return false;
  }
};
