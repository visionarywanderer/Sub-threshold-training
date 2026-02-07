import { WorkoutSession, IntervalsIcuConfig, WorkoutType } from '../types';

/**
 * Converts a WorkoutSession into Intervals.icu specific workout text format.
 * Focuses strictly on running metrics.
 */
const formatIcuWorkoutText = (session: WorkoutSession): string => {
  const toPaceToken = (pace: string): string => {
    const trimmed = (pace || '').trim();
    if (!trimmed) return '';
    if (trimmed.includes('/km')) return trimmed;
    return `${trimmed}/km`;
  };

  const hasStructuredIntervals = !!session.intervals?.some((int) => {
    const reps = Math.max(1, Number(int.count) || 1);
    const hasRest = !!int.rest && int.rest !== '0';
    return reps > 1 || hasRest;
  });

  const includeWarmupCooldown = session.type === WorkoutType.THRESHOLD || hasStructuredIntervals;

  let text = `${session.title}\n\n`;

  if (includeWarmupCooldown && session.warmup) {
    text += `Warmup\n- ${session.warmup}\n\n`;
  }

  if (session.intervals && session.intervals.length > 0) {
    text += `Main Set\n`;
    session.intervals.forEach((int) => {
      const paceToken = toPaceToken(int.pace || '');
      const effort = paceToken ? `${paceToken} Pace` : "";
      const distStr = int.distance > 0 ? (int.distance < 1000 ? `${int.distance}m` : `${int.distance / 1000}km`) : "";
      const reps = Math.max(1, Number(int.count) || 1);

      // Expand each rep into an explicit step so Intervals.icu can forward clean step data to Garmin.
      for (let rep = 0; rep < reps; rep++) {
        text += `- ${distStr}${effort ? ` ${effort}` : ''}\n`;
        if (int.rest && int.rest !== "0" && rep < reps - 1) {
          text += `- ${int.rest} Recovery\n`;
        }
      }
    });
    text += `\n`;
  } else {
    // Continuous run
    text += `- ${session.distance}km\n\n`;
  }

  if (includeWarmupCooldown && session.cooldown) {
    text += `Cooldown\n- ${session.cooldown}\n`;
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
    category: 'NOTE',
    type: 'Run',
    name: 'Rest Day',
    description: 'Recovery / no training scheduled.',
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
