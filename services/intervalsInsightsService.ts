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
  thresholdContext?: {
    thresholdPaceSecPerKm?: number;
    thresholdHrBpm?: number;
    subTPaceLowSecPerKm?: number;
    subTPaceHighSecPerKm?: number;
    subTHrLowBpm?: number;
    subTHrHighBpm?: number;
  };
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
const parsePaceTokenToSec = (value: unknown): number | undefined => {
  if (value == null) return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Handle either sec/km or min/km-like numbers defensively.
    if (value > 120 && value < 1000) return value;
    if (value > 2 && value < 12) return Math.round(value * 60);
  }
  const raw = String(value).trim().toLowerCase().replace('/km', '');
  if (!raw) return undefined;
  const parts = raw.split(':').map((p) => Number(p));
  if (parts.length === 2 && parts.every((v) => Number.isFinite(v))) {
    return (parts[0] * 60) + parts[1];
  }
  if (parts.length === 3 && parts.every((v) => Number.isFinite(v))) {
    return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
  }
  return undefined;
};

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
const percentile = (values: number[], p: number): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = clamp((p / 100) * (sorted.length - 1), 0, sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low];
  const weight = rank - low;
  return sorted[low] * (1 - weight) + sorted[high] * weight;
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

const fetchAthleteProfile = async (config: IntervalsIcuConfig): Promise<any | null> => {
  const athlete = config.athleteId || '0';
  const headers = getAuthHeaders(config.apiKey);
  const endpoints = [
    `https://intervals.icu/api/v1/athlete/${athlete}/profile`,
    `https://intervals.icu/api/v1/athlete/${athlete}`,
  ];
  for (const endpoint of endpoints) {
    try {
      const data = await fetchJson(endpoint, headers);
      if (data && typeof data === 'object') return data;
    } catch {
      // fallback
    }
  }
  return null;
};

export const loadInsightsDataset = async (config: IntervalsIcuConfig, lookbackDays = 730): Promise<InsightsDataset> => {
  if (!config.connected || !config.apiKey) {
    throw new Error('Intervals.icu is not connected.');
  }

  const newest = fromDateOffset(0);
  const oldest = fromDateOffset(Math.max(30, Math.round(lookbackDays)));

  const [activities, wellness, athleteProfile] = await Promise.all([
    fetchActivities(config, oldest, newest),
    fetchWellness(config, oldest, newest),
    fetchAthleteProfile(config),
  ]);

  const runs = activities.filter(isRunActivity);
  const runSamples: Array<{
    date: string;
    speedMps: number;
    avgHr: number;
    movingMinutes: number;
    taggedSubthreshold: boolean;
  }> = [];

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
    if (speedMps > 0 && avgHr > 0 && movingSec > 0) {
      runSamples.push({
        date,
        speedMps,
        avgHr,
        movingMinutes: movingSec / 60,
        taggedSubthreshold: isSubthresholdActivity(activity),
      });
    }

    const trainingLoad = asNumber(activity.icu_training_load)
      ?? asNumber(activity.training_load)
      ?? asNumber(activity.load)
      ?? asNumber(activity.trimp)
      ?? (movingSec > 0 ? (movingSec / 60) : (distanceM / 1000));

    loadByDate.set(date, (loadByDate.get(date) || 0) + Math.max(0, trainingLoad || 0));
  }

  const hrValues = runSamples.map((s) => s.avgHr).filter((v) => v > 0);
  const speedValues = runSamples.map((s) => s.speedMps).filter((v) => v > 0);
  const hrP50 = percentile(hrValues, 50);
  const hrP70 = percentile(hrValues, 70);
  const hrP90 = percentile(hrValues, 90);
  const speedP55 = percentile(speedValues, 55);
  const thresholdPaceFromProfile = parsePaceTokenToSec(
    athleteProfile?.threshold_pace
    ?? athleteProfile?.thresholdPace
    ?? athleteProfile?.run_threshold_pace
    ?? athleteProfile?.zones?.run?.threshold_pace
    ?? athleteProfile?.zones?.pace?.threshold
  );
  const thresholdHrFromProfile = asNumber(
    athleteProfile?.threshold_hr
    ?? athleteProfile?.thresholdHr
    ?? athleteProfile?.run_threshold_hr
    ?? athleteProfile?.zones?.heart_rate?.threshold
    ?? athleteProfile?.zones?.run?.threshold_hr
  );
  const thresholdPaceSec = thresholdPaceFromProfile && thresholdPaceFromProfile > 0
    ? thresholdPaceFromProfile
    : undefined;
  const nearThresholdHrSamples = runSamples
    .filter((s) => {
      if (!thresholdPaceSec) return false;
      const paceSec = s.speedMps > 0 ? 1000 / s.speedMps : 0;
      return paceSec > 0 && Math.abs((paceSec - thresholdPaceSec) / thresholdPaceSec) <= 0.05;
    })
    .map((s) => s.avgHr)
    .filter((v) => v > 0);
  const inferredThresholdHr = nearThresholdHrSamples.length ? median(nearThresholdHrSamples) : undefined;
  const thresholdHr = thresholdHrFromProfile && thresholdHrFromProfile > 0 ? thresholdHrFromProfile : inferredThresholdHr;
  const normalizationHr = thresholdHr && thresholdHr > 0 ? (thresholdHr * 0.92) : (hrP70 > 0 ? hrP70 : (hrP50 > 0 ? hrP50 : 150));
  const subTPaceLow = thresholdPaceSec ? thresholdPaceSec * 1.02 : undefined;
  const subTPaceHigh = thresholdPaceSec ? thresholdPaceSec * 1.10 : undefined;
  const subTHrLow = thresholdHr ? thresholdHr * 0.88 : undefined;
  const subTHrHigh = thresholdHr ? thresholdHr * 0.95 : undefined;
  const weeklyThresholdByWeek = new Map<string, { speeds: number[]; subMin: number; totalMin: number }>();

  for (const sample of runSamples) {
    const week = getWeekStartIso(sample.date);
    const existing = weeklyThresholdByWeek.get(week) || { speeds: [], subMin: 0, totalMin: 0 };
    existing.totalMin += sample.movingMinutes;

    const paceSec = sample.speedMps > 0 ? (1000 / sample.speedMps) : 0;
    const matchesPaceBand = subTPaceLow && subTPaceHigh
      ? (paceSec >= subTPaceLow && paceSec <= subTPaceHigh)
      : (sample.speedMps >= speedP55 && sample.avgHr >= hrP70);
    const matchesHrBand = subTHrLow && subTHrHigh
      ? (sample.avgHr >= subTHrLow && sample.avgHr <= subTHrHigh)
      : (sample.avgHr >= hrP70 && sample.avgHr <= hrP90);
    const likelySubthreshold = sample.taggedSubthreshold || (
      matchesPaceBand &&
      matchesHrBand &&
      sample.movingMinutes >= 25
    );

    if (likelySubthreshold) {
      existing.subMin += sample.movingMinutes;
      const hrNormalizedSpeed = sample.speedMps * (normalizationHr / Math.max(1, sample.avgHr));
      existing.speeds.push(hrNormalizedSpeed);
    }
    weeklyThresholdByWeek.set(week, existing);
  }

  const economyRaw: RunningEconomyPoint[] = Array.from(economyByDate.entries())
    .map(([date, bucket]) => {
      if (!bucket.economyScores.length) return null;
      const hrNormEconomies = bucket.paces
        .map((paceSec, idx) => {
          const hr = bucket.hrs[idx] || 0;
          const speed = paceSec > 0 ? (1000 / paceSec) : 0;
          if (speed <= 0 || hr <= 0) return 0;
          return (speed * (normalizationHr / hr)) * 100;
        })
        .filter((v) => v > 0);
      return {
        date,
        economyScore: Number(avg(hrNormEconomies.length ? hrNormEconomies : bucket.economyScores).toFixed(2)),
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
  const economyBaseline = median(economyRaw.slice(0, Math.min(28, economyRaw.length)).map((r) => r.economyScore));
  const economy: RunningEconomyPoint[] = economyRaw.map((row) => ({
    ...row,
    economyScore: economyBaseline > 0 ? Number(((row.economyScore / economyBaseline) * 100).toFixed(1)) : row.economyScore,
  }));

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

  const thresholdWeeks = Array.from(weeklyThresholdByWeek.keys()).sort((a, b) => a.localeCompare(b));

  const thresholdProgress: ThresholdProgressPoint[] = thresholdWeeks
    .map((week) => {
      const weekly = weeklyThresholdByWeek.get(week);
      const totalRunMinutes = weekly?.totalMin || 0;
      const subthresholdMinutes = weekly?.subMin || 0;
      const speeds = weekly?.speeds || [];
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
    thresholdContext: {
      thresholdPaceSecPerKm: thresholdPaceSec ? Number(thresholdPaceSec.toFixed(1)) : undefined,
      thresholdHrBpm: thresholdHr ? Math.round(thresholdHr) : undefined,
      subTPaceLowSecPerKm: subTPaceLow ? Number(subTPaceLow.toFixed(1)) : undefined,
      subTPaceHighSecPerKm: subTPaceHigh ? Number(subTPaceHigh.toFixed(1)) : undefined,
      subTHrLowBpm: subTHrLow ? Math.round(subTHrLow) : undefined,
      subTHrHighBpm: subTHrHigh ? Math.round(subTHrHigh) : undefined,
    },
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
  return filtered;
};

export const rangeToDays = (range: InsightsRangeKey): number => {
  if (range === '1d') return 1;
  if (range === '1w') return 7;
  if (range === '1m') return 31;
  if (range === '3m') return 92;
  if (range === '6m') return 183;
  return 366;
};
