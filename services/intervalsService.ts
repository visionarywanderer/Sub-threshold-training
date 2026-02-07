import { WorkoutSession, IntervalsIcuConfig, WorkoutType } from '../types';

/**
 * Converts a WorkoutSession into Intervals.icu specific workout text format.
 * Focuses strictly on running metrics.
 */
const formatIcuWorkoutText = (session: WorkoutSession): string => {
  let text = `${session.title}\n\n`;

  if (session.warmup) {
    text += `Warmup\n- ${session.warmup.includes('km') ? session.warmup : '10m 60% HR'}\n\n`;
  }

  if (session.intervals && session.intervals.length > 0) {
    text += `Main Set\n`;
    session.intervals.forEach((int) => {
      const effort = int.pace ? `${int.pace}/km` : "Sub-T";
      const distStr = int.distance > 0 ? (int.distance < 1000 ? `${int.distance}m` : `${int.distance / 1000}km`) : "";
      const reps = Math.max(1, Number(int.count) || 1);

      // Expand each rep into an explicit step so Intervals.icu can forward clean step data to Garmin.
      for (let rep = 0; rep < reps; rep++) {
        text += `- ${distStr} ${effort}\n`;
        if (int.rest && int.rest !== "0" && rep < reps - 1) {
          text += `- Rest ${int.rest}\n`;
        }
      }
    });
    text += `\n`;
  } else {
    // Continuous run
    text += `- ${session.distance}km ${session.type === WorkoutType.EASY ? '65% HR' : 'Steady'}\n\n`;
  }

  if (session.cooldown) {
    text += `Cooldown\n- ${session.cooldown.includes('km') ? session.cooldown : '5m 50% HR'}\n`;
  }

  return text;
};

const getIcuType = (type: WorkoutType): string => {
    return 'Run';
};

const buildWorkoutPayload = (session: WorkoutSession, date: string) => {
  const icuWorkout = formatIcuWorkoutText(session);
  return {
    category: 'WORKOUT',
    type: getIcuType(session.type),
    name: session.title,
    description: session.description,
    start_date_local: `${date}T08:00:00`,
    workout: icuWorkout,
    moving_time: session.duration * 60
  };
};

export interface IcuSyncResult {
  ok: boolean;
  eventId: number | null;
  status?: number;
  error?: string;
}

const extractErrorMessage = async (response: Response, fallback: string): Promise<string> => {
  try {
    const data = await response.json();
    const msg = data?.message || data?.error || data?.detail;
    if (msg) return String(msg);
  } catch {
    // Ignore JSON parse errors and fall back to text/status.
  }

  try {
    const text = await response.text();
    if (text) return text;
  } catch {
    // Ignore text parse errors.
  }

  return `${fallback} (${response.status})`;
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
    
    const data = await response.json();
    return { ok: true, eventId: Number(data.id) || null };
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
    start_date_local: `${date}T08:00:00`
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
    const data = await response.json();
    return { ok: true, eventId: Number(data.id) || null };
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
