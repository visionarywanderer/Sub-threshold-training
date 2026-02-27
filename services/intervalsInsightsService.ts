import { IntervalsIcuConfig } from '../types';

export type InsightsRangeKey = '1y' | '6m' | '3m' | '1m' | '1w' | '1d';

export interface RunningEconomyPoint {
  date: string;
  economyScore: number;
  paceSecPerKm: number;
  avgHr: number;
  cadence?: number;
  strideLengthM?: number;
  verticalOscillationCm?: number;
  groundContactMs?: number;
  sampleCount: number;
}

export interface RecoveryPoint {
  date: string;
  recoveryScore: number;
  hrv?: number;
  restingHr?: number;
  acuteLoad7: number;
  chronicLoad28: number;
  loadRatio?: number;
}

export interface ThresholdProgressPoint {
  date: string;
  thresholdSpeedKmh: number;
  thresholdPaceSecPerKm: number;
  norwegianMethodScore: number;
  subthresholdSharePct: number;
  subthresholdMinutes: number;
  totalRunMinutes: number;
}

export interface InsightsDataset {
  economy: RunningEconomyPoint[];
  recovery: RecoveryPoint[];
  thresholdProgress: ThresholdProgressPoint[];
  fetchedAt: string;
}

interface RawActivity {
  [key: string]: any;
}

interface RawWellness {
  [key: string]: any;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const asNumber = (value: unknown): number | undefined => {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};
const getWeekStartIso = (dateIso: string): string => {
  const d = new Date(`${dateIso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateIso;
  const day = d.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + mondayOffset);
  const year = d.getFullYear();
  const month = `${d.getMonth() + 1}`.padStart(2, '0');
  const dayOfMonth = `${d.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${dayOfMonth}`;
};

const getAuthHeaders = (apiKey: string): Record<string, string> => ({
  Authorization: `Basic ${btoa(`API_KEY:${apiKey}`)}`,
});

const toIsoDate = (value: unknown): string | null => {
  if (!value) return null;
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const year = d.getFullYear();
  const month = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const fromDateOffset = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const year = d.getFullYear();
  const month = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const isRunActivity = (activity: RawActivity): boolean => {
  const sport = String(activity.sport || activity.type || activity.activity_type || '').toLowerCase();
  const subtype = String(activity.sub_type || activity.subtype || '').toLowerCase();
  return sport.includes('run') || subtype.includes('run') || sport === 'trail' || sport === 'treadmill';
};
const isSubthresholdActivity = (activity: RawActivity): boolean => {
  const haystack = [
    activity.name,
    activity.title,
    activity.description,
    activity.workout_name,
    activity.notes,
    activity.subtype,
  ].map((v) => String(v || '').toLowerCase()).join(' ');
  return /(subt|sub[-\s]?threshold|threshold|norwegian)/i.test(haystack);
};

const extractDistanceMeters = (activity: RawActivity): number => {
  const directMeters = asNumber(activity.distance) ?? asNumber(activity.distance_m) ?? asNumber(activity.moving_distance);
  if (directMeters && directMeters > 300) return directMeters;
  if (directMeters && directMeters > 0 && directMeters <= 300) return directMeters * 1000;

  const km = asNumber(activity.distance_km) ?? asNumber(activity.km);
  if (km && km > 0) return km * 1000;

  return 0;
};

const extractMovingSeconds = (activity: RawActivity): number => {
  const sec = asNumber(activity.moving_time) ?? asNumber(activity.elapsed_time) ?? asNumber(activity.duration);
  if (sec && sec > 0) return sec;
  return 0;
};

const extractAverageSpeedMps = (activity: RawActivity, distanceM: number, movingSec: number): number => {
  const speed = asNumber(activity.average_speed) ?? asNumber(activity.avg_speed) ?? asNumber(activity.speed_avg);
  if (speed && speed > 0 && speed < 20) return speed;
  if (distanceM > 0 && movingSec > 0) return distanceM / movingSec;
  return 0;
};

const median = (values: number[]): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

const avg = (values: number[]): number => {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const rollingAverage = (rows: Array<{ value: number }>, index: number, window: number): number => {
  const start = Math.max(0, index - window + 1);
  const slice = rows.slice(start, index + 1).map((r) => r.value);
  return avg(slice);
};

const fetchJson = async (url: string, headers: Record<string, string>): Promise<any> => {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Intervals request failed (${response.status}): ${text || url}`);
  }
  return response.json();
};

const fetchActivities = async (config: IntervalsIcuConfig, oldest: string, newest: string): Promise<RawActivity[]> => {
  const athlete = config.athleteId || '0';
  const headers = getAuthHeaders(config.apiKey);
  const endpoints = [
    `https://intervals.icu/api/v1/athlete/${athlete}/activities?oldest=${oldest}&newest=${newest}`,
    `https://intervals.icu/api/v1/athlete/${athlete}/athlete-activities?oldest=${oldest}&newest=${newest}`,
  ];

  for (const endpoint of endpoints) {
    try {
      const data = await fetchJson(endpoint, headers);
      if (Array.isArray(data)) return data;
      if (Array.isArray(data?.activities)) return data.activities;
    } catch {
      // fallback to next endpoint
    }
  }

  return [];
};

const fetchWellness = async (config: IntervalsIcuConfig, oldest: string, newest: string): Promise<RawWellness[]> => {
  const athlete = config.athleteId || '0';
  const headers = getAuthHeaders(config.apiKey);
  const endpoints = [
    `https://intervals.icu/api/v1/athlete/${athlete}/wellness?oldest=${oldest}&newest=${newest}`,
  ];

  for (const endpoint of endpoints) {
    try {
      const data = await fetchJson(endpoint, headers);
      if (Array.isArray(data)) return data;
      if (Array.isArray(data?.wellness)) return data.wellness;
    } catch {
      // fallback to next endpoint
    }
  }

  return [];
};

export const loadInsightsDataset = async (config: IntervalsIcuConfig): Promise<InsightsDataset> => {
  if (!config.connected || !config.apiKey) {
    throw new Error('Intervals.icu is not connected.');
  }

  const newest = fromDateOffset(0);
  const oldest = fromDateOffset(380);

  const [activities, wellness] = await Promise.all([
    fetchActivities(config, oldest, newest),
    fetchWellness(config, oldest, newest),
  ]);

  const runs = activities.filter(isRunActivity);

  const economyByDate = new Map<string, {
    economyScores: number[];
    paces: number[];
    hrs: number[];
    cadences: number[];
    strideLens: number[];
    verticalOsc: number[];
    contactTimes: number[];
  }>();

  const loadByDate = new Map<string, number>();
  const totalRunMinutesByWeek = new Map<string, number>();
  const subthresholdMinutesByWeek = new Map<string, number>();
  const subthresholdSpeedSamplesByWeek = new Map<string, number[]>();

  for (const activity of runs) {
    const date = toIsoDate(activity.start_date_local || activity.start_date || activity.id);
    if (!date) continue;

    const distanceM = extractDistanceMeters(activity);
    const movingSec = extractMovingSeconds(activity);
    const speedMps = extractAverageSpeedMps(activity, distanceM, movingSec);
    const avgHr = asNumber(activity.average_heartrate) ?? asNumber(activity.avg_hr) ?? asNumber(activity.average_hr) ?? asNumber(activity.hr_avg) ?? 0;
    const cadence = asNumber(activity.average_run_cadence) ?? asNumber(activity.cadence);
    const strideLengthM = asNumber(activity.average_stride_length) ?? asNumber(activity.stride_length);
    const verticalOscillationCm = asNumber(activity.average_vertical_oscillation) ?? asNumber(activity.vertical_oscillation);
    const groundContactMs = asNumber(activity.average_ground_contact_time) ?? asNumber(activity.ground_contact_time);

    if (!economyByDate.has(date)) {
      economyByDate.set(date, {
        economyScores: [],
        paces: [],
        hrs: [],
        cadences: [],
        strideLens: [],
        verticalOsc: [],
        contactTimes: [],
      });
    }

    const bucket = economyByDate.get(date)!;
    const paceSecPerKm = speedMps > 0 ? 1000 / speedMps : 0;
    const week = getWeekStartIso(date);
    const movingMinutes = movingSec > 0 ? movingSec / 60 : 0;
    if (movingMinutes > 0) {
      totalRunMinutesByWeek.set(week, (totalRunMinutesByWeek.get(week) || 0) + movingMinutes);
    }
    if (isSubthresholdActivity(activity) && movingMinutes > 0) {
      subthresholdMinutesByWeek.set(week, (subthresholdMinutesByWeek.get(week) || 0) + movingMinutes);
      if (speedMps > 0 && paceSecPerKm > 180 && paceSecPerKm < 420) {
        const speeds = subthresholdSpeedSamplesByWeek.get(week) || [];
        speeds.push(speedMps);
        subthresholdSpeedSamplesByWeek.set(week, speeds);
      }
    }

    // Running Economy proxy:
    // economyScore = meters per heartbeat while running at endurance/tempo paces.
    // score = (speed m/s * 60) / HR * 100
    if (speedMps > 0 && avgHr > 0 && paceSecPerKm > 180 && paceSecPerKm < 480) {
      const economyScore = ((speedMps * 60) / avgHr) * 100;
      bucket.economyScores.push(economyScore);
      bucket.paces.push(paceSecPerKm);
      bucket.hrs.push(avgHr);
      if (cadence && cadence > 0) bucket.cadences.push(cadence);
      if (strideLengthM && strideLengthM > 0) bucket.strideLens.push(strideLengthM);
      if (verticalOscillationCm && verticalOscillationCm > 0) bucket.verticalOsc.push(verticalOscillationCm);
      if (groundContactMs && groundContactMs > 0) bucket.contactTimes.push(groundContactMs);
    }

    const trainingLoad = asNumber(activity.icu_training_load)
      ?? asNumber(activity.training_load)
      ?? asNumber(activity.load)
      ?? asNumber(activity.trimp)
      ?? (movingSec > 0 ? (movingSec / 60) : (distanceM / 1000));

    loadByDate.set(date, (loadByDate.get(date) || 0) + Math.max(0, trainingLoad || 0));
  }

  const economy: RunningEconomyPoint[] = Array.from(economyByDate.entries())
    .map(([date, bucket]) => {
      if (!bucket.economyScores.length) return null;
      return {
        date,
        economyScore: Number(avg(bucket.economyScores).toFixed(2)),
        paceSecPerKm: Number(avg(bucket.paces).toFixed(2)),
        avgHr: Number(avg(bucket.hrs).toFixed(1)),
        cadence: bucket.cadences.length ? Number(avg(bucket.cadences).toFixed(1)) : undefined,
        strideLengthM: bucket.strideLens.length ? Number(avg(bucket.strideLens).toFixed(2)) : undefined,
        verticalOscillationCm: bucket.verticalOsc.length ? Number(avg(bucket.verticalOsc).toFixed(2)) : undefined,
        groundContactMs: bucket.contactTimes.length ? Number(avg(bucket.contactTimes).toFixed(1)) : undefined,
        sampleCount: bucket.economyScores.length,
      };
    })
    .filter((row): row is RunningEconomyPoint => !!row)
    .sort((a, b) => a.date.localeCompare(b.date));

  const wellnessByDate = new Map<string, { hrv?: number; restingHr?: number }>();
  for (const row of wellness) {
    const date = toIsoDate(row.id || row.date || row.localDate || row.start_date_local);
    if (!date) continue;

    const hrv = asNumber(row.hrv) ?? asNumber(row.hrv_rmssd) ?? asNumber(row.rmssd);
    const restingHr = asNumber(row.resting_hr) ?? asNumber(row.restingHeartrate) ?? asNumber(row.rhr);
    wellnessByDate.set(date, {
      hrv: hrv && hrv > 0 ? hrv : undefined,
      restingHr: restingHr && restingHr > 0 ? restingHr : undefined,
    });
  }

  const allDates = new Set<string>([...Array.from(loadByDate.keys()), ...Array.from(wellnessByDate.keys())]);
  const orderedDates = Array.from(allDates).sort((a, b) => a.localeCompare(b));

  const loadRows = orderedDates.map((date) => ({ date, value: loadByDate.get(date) || 0 }));
  const validHrv = orderedDates.map((d) => wellnessByDate.get(d)?.hrv).filter((v): v is number => Number.isFinite(v));
  const validRhr = orderedDates.map((d) => wellnessByDate.get(d)?.restingHr).filter((v): v is number => Number.isFinite(v));
  const baselineHrv = median(validHrv);
  const baselineRhr = median(validRhr);

  const recovery: RecoveryPoint[] = loadRows.map((row, index) => {
    const acuteLoad7 = rollingAverage(loadRows, index, 7);
    const chronicLoad28 = rollingAverage(loadRows, index, 28);
    const loadRatio = chronicLoad28 > 0 ? acuteLoad7 / chronicLoad28 : undefined;

    const wellnessData = wellnessByDate.get(row.date);
    const hrv = wellnessData?.hrv;
    const restingHr = wellnessData?.restingHr;

    const hrvScore = (hrv && baselineHrv > 0)
      ? clamp(50 + ((hrv - baselineHrv) / baselineHrv) * 80, 0, 100)
      : undefined;

    const rhrScore = (restingHr && baselineRhr > 0)
      ? clamp(50 + ((baselineRhr - restingHr) / baselineRhr) * 80, 0, 100)
      : undefined;

    const loadScore = loadRatio
      ? clamp(100 - Math.max(0, (loadRatio - 1) * 60), 20, 100)
      : 70;

    const scoreCandidates: number[] = [];
    if (Number.isFinite(hrvScore)) scoreCandidates.push((hrvScore as number) * 0.45);
    if (Number.isFinite(rhrScore)) scoreCandidates.push((rhrScore as number) * 0.35);
    scoreCandidates.push(loadScore * 0.20);

    const totalWeight = (Number.isFinite(hrvScore) ? 0.45 : 0) + (Number.isFinite(rhrScore) ? 0.35 : 0) + 0.20;
    const weighted = scoreCandidates.reduce((sum, value) => sum + value, 0);
    const recoveryScore = totalWeight > 0 ? clamp(weighted / totalWeight, 0, 100) : 0;

    return {
      date: row.date,
      recoveryScore: Number(recoveryScore.toFixed(1)),
      hrv,
      restingHr,
      acuteLoad7: Number(acuteLoad7.toFixed(2)),
      chronicLoad28: Number(chronicLoad28.toFixed(2)),
      loadRatio: loadRatio ? Number(loadRatio.toFixed(2)) : undefined,
    };
  });

  const thresholdWeeks = Array.from(new Set([
    ...Array.from(totalRunMinutesByWeek.keys()),
    ...Array.from(subthresholdMinutesByWeek.keys()),
    ...Array.from(subthresholdSpeedSamplesByWeek.keys()),
  ])).sort((a, b) => a.localeCompare(b));

  const thresholdProgress: ThresholdProgressPoint[] = thresholdWeeks
    .map((week) => {
      const totalRunMinutes = totalRunMinutesByWeek.get(week) || 0;
      const subthresholdMinutes = subthresholdMinutesByWeek.get(week) || 0;
      const speeds = subthresholdSpeedSamplesByWeek.get(week) || [];
      if (totalRunMinutes <= 0 || subthresholdMinutes <= 0 || !speeds.length) return null;

      const avgSpeedMps = avg(speeds);
      const thresholdSpeedKmh = avgSpeedMps * 3.6;
      const thresholdPaceSecPerKm = avgSpeedMps > 0 ? (1000 / avgSpeedMps) : 0;
      const subthresholdSharePct = (subthresholdMinutes / totalRunMinutes) * 100;
      // Score centered on the Norwegian-method subthreshold distribution band.
      const norwegianMethodScore = clamp(100 - (Math.abs(subthresholdSharePct - 40) * 3), 0, 100);

      return {
        date: week,
        thresholdSpeedKmh: Number(thresholdSpeedKmh.toFixed(2)),
        thresholdPaceSecPerKm: Number(thresholdPaceSecPerKm.toFixed(1)),
        norwegianMethodScore: Number(norwegianMethodScore.toFixed(1)),
        subthresholdSharePct: Number(subthresholdSharePct.toFixed(1)),
        subthresholdMinutes: Number(subthresholdMinutes.toFixed(1)),
        totalRunMinutes: Number(totalRunMinutes.toFixed(1)),
      };
    })
    .filter((row): row is ThresholdProgressPoint => !!row);

  return {
    economy,
    recovery,
    thresholdProgress,
    fetchedAt: new Date().toISOString(),
  };
};

export const filterByRange = <T extends { date: string }>(rows: T[], range: InsightsRangeKey): T[] => {
  if (!rows.length) return rows;
  const days = (() => {
    if (range === '1d') return 1;
    if (range === '1w') return 7;
    if (range === '1m') return 31;
    if (range === '3m') return 92;
    if (range === '6m') return 183;
    return 366;
  })();

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days + 1);
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  const filtered = rows.filter((row) => row.date >= cutoffIso);
  if (!filtered.length) return rows;
  return filtered;
};
