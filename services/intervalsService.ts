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
      const step = int.count > 1 ? `- ${int.count}x\n  ` : '- ';
      const effort = int.pace ? `${int.pace}/km` : "Sub-T";

      const distStr = int.distance > 0 ? (int.distance < 1000 ? `${int.distance}m` : `${int.distance/1000}km`) : "";
      const indent = int.count > 1 ? "  " : "";
      
      text += `${step}${distStr} ${effort}\n`;
      if (int.rest && int.rest !== "0") {
          text += `${indent}- Rest ${int.rest}\n`;
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

export const syncWorkoutToIcu = async (
  config: IntervalsIcuConfig, 
  session: WorkoutSession, 
  date: string
): Promise<number | null> => {
  if (!config.connected || !config.athleteId || !config.apiKey) return null;

  const auth = btoa(`API_KEY:${config.apiKey}`);
  const icuWorkout = formatIcuWorkoutText(session);
  
  const payload = {
    category: 'WORKOUT',
    type: getIcuType(session.type),
    name: session.title,
    description: session.description,
    start_date_local: `${date}T08:00:00`,
    workout: icuWorkout,
    moving_time: session.duration * 60
  };

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

    if (!response.ok) throw new Error('Failed to sync to Intervals.icu');
    
    const data = await response.json();
    return data.id; // Returns the event ID
  } catch (error) {
    console.error('Intervals.icu Sync Error:', error);
    return null;
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