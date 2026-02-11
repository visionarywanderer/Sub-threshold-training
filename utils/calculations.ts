import { UserProfile, WeeklyPlan, WorkoutType, WorkoutSession, DailyPlan, DayType } from '../types';
export const MIN_TREADMILL_INCLINE = 0;
export const MAX_TREADMILL_INCLINE = 15;
export const DEFAULT_TREADMILL_INCLINE = 1;

export const formatThresholdSessionTitle = (reps: number, distanceMeters: number): string => {
  const safeReps = Math.max(1, Math.round(Number(reps) || 1));
  const dist = Math.max(0, Number(distanceMeters) || 0);
  const distLabel = dist >= 1000 ? `${Math.round((dist / 1000) * 10) / 10}km` : `${Math.round(dist)}m`;
  return `SubT ${safeReps}x${distLabel}`;
};

export const timeToSeconds = (time: string): number => {
  if (!time) return 0;
  const parts = time.split(':').map(part => parseInt(part) || 0);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
};

export const secondsToTime = (seconds: number): string => {
  if (isNaN(seconds) || seconds <= 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);

  const mStr = m < 10 && h > 0 ? `0${m}` : `${m}`;
  const sStr = s < 10 ? `0${s}` : `${s}`;

  if (h > 0) return `${h}:${mStr}:${sStr}`;
  return `${mStr}:${sStr}`;
};

export const getWeatherPaceDeltaSeconds = (
  basePaceSec: number,
  temperatureC: number,
  humidityPct: number,
  windKmh: number
): number => {
  if (!isFinite(basePaceSec) || basePaceSec <= 0) return 0;

  let delta = 0;

  // Baseline comfort window around 10-12C.
  if (temperatureC > 12) delta += (temperatureC - 12) * 0.5;
  if (temperatureC < 5) delta += (5 - temperatureC) * 0.25;

  // Humidity hurts mostly in warm conditions.
  if (temperatureC >= 18 && humidityPct > 60) {
    delta += ((humidityPct - 60) / 10) * 0.6;
  }

  // Generic wind drag penalty beyond light breeze.
  if (windKmh > 12) delta += (windKmh - 12) * 0.12;

  // Keep adjustments within a practical range for training pacing.
  const bounded = Math.max(-5, Math.min(20, delta));
  return Math.round(bounded);
};

export const applyPaceCorrection = (paceSec: number, deltaSec: number): number => {
  if (!isFinite(paceSec) || paceSec <= 0) return 0;
  return Math.max(1, paceSec + deltaSec);
};

export const getTreadmillPaceDeltaSeconds = (inclinePct: number, basePaceSec = 300): number => {
  const parsed = Number(inclinePct);
  const rawIncline = Number.isFinite(parsed) ? parsed : DEFAULT_TREADMILL_INCLINE;
  const incline = Math.min(MAX_TREADMILL_INCLINE, Math.max(MIN_TREADMILL_INCLINE, rawIncline));
  if (!Number.isFinite(basePaceSec) || basePaceSec <= 0) return 0;
  const g = incline / 100;

  // Standard treadmill grade conversion using equal oxygen-cost approximation
  // from ACSM running equation terms:
  // 0.2 * v_flat = (0.2 + 0.9 * grade) * v_grade
  // pace is inverse of speed.
  const vFlat = 1000 / (basePaceSec / 60); // m/min
  const vGrade = (0.2 * vFlat) / (0.2 + (0.9 * g));
  if (!Number.isFinite(vGrade) || vGrade <= 0) return 0;
  const gradePaceSec = (1000 / vGrade) * 60;
  return Math.round(gradePaceSec - basePaceSec);
};

export const predictRaceTime = (raceDistMeters: number, raceTimeStr: string, targetDistMeters: number): number => {
  const tInput = timeToSeconds(raceTimeStr);
  if (tInput === 0 || raceDistMeters === 0 || targetDistMeters === 0) return 0;
  const fatigueFactor = 1.06;
  return tInput * Math.pow(targetDistMeters / raceDistMeters, fatigueFactor);
};

export const calculatePaceForDistance = (
  raceDistMeters: number,
  raceTimeStr: string,
  targetDistMeters: number
): number => {
  const predictedSeconds = predictRaceTime(raceDistMeters, raceTimeStr, targetDistMeters);
  if (predictedSeconds === 0) return 0;
  return predictedSeconds / (targetDistMeters / 1000);
};

export const calculateVDOTFromRace = (raceDistMeters: number, raceTimeStr: string): number => {
  const tSec = timeToSeconds(raceTimeStr);
  if (!raceDistMeters || !tSec || tSec <= 0) return 0;

  const timeMin = tSec / 60;
  const velocityMPerMin = raceDistMeters / timeMin;

  // Jack Daniels VO2 approximation based on running velocity.
  const vo2 = -4.60 + (0.182258 * velocityMPerMin) + (0.000104 * velocityMPerMin * velocityMPerMin);

  // Fraction of VO2max sustained for race duration.
  const percent = 0.80 + (0.1894393 * Math.exp(-0.012778 * timeMin)) + (0.2989558 * Math.exp(-0.1932605 * timeMin));
  if (percent <= 0) return 0;

  const vdot = vo2 / percent;
  return Math.round(vdot * 10) / 10;
};

const getRaceEquivalentPaces = (profile: UserProfile) => {
  const p15k = calculatePaceForDistance(profile.raceDistance, profile.raceTime, 15000);
  const pHalf = calculatePaceForDistance(profile.raceDistance, profile.raceTime, 21097);
  const p30k = calculatePaceForDistance(profile.raceDistance, profile.raceTime, 30000);
  const pMarathon = calculatePaceForDistance(profile.raceDistance, profile.raceTime, 42195);
  return { p15k, pHalf, p30k, pMarathon };
};

export const getEasyRunPaceRange = (profile: UserProfile, correctionSec = 0): { low: number; high: number; center: number } => {
  const { pMarathon } = getRaceEquivalentPaces(profile);

  // Calibrated from user anchor:
  // 5K 19:07 -> MP ~4:21/km, easy should be ~5:35-6:05/km.
  // So easy range = MP + 74..104 sec/km.
  let low = pMarathon > 0 ? pMarathon + 74 : 0;
  let high = pMarathon > 0 ? pMarathon + 104 : 0;

  if (low <= 0 || high <= 0) {
    const threshold = calculateThresholdPace(profile.raceDistance, profile.raceTime, profile as any);
    low = threshold * 1.32;
    high = threshold * 1.44;
  }

  const correctedLow = applyPaceCorrection(low, correctionSec);
  const correctedHigh = applyPaceCorrection(high, correctionSec);
  const correctedCenter = (correctedLow + correctedHigh) / 2;

  return { low: correctedLow, high: correctedHigh, center: correctedCenter };
};

/**
 * A1. Estimate 60-minute threshold pace (sec/km) by finding the distance where
 * the Riegel predictor returns ~3600 seconds, then converting to pace.
 */
const estimate60MinThresholdFromSingleResult = (raceDistMeters: number, raceTimeStr: string): number => {
  const tInput = timeToSeconds(raceTimeStr);
  if (tInput === 0 || raceDistMeters === 0) return 0;

  const targetTimeSec = 3600;

  // Wider bounds to avoid clamping for faster runners.
  let low = 6000;
  let high = 30000;

  // If the race result itself is near 60 minutes, use its pace.
  if (Math.abs(tInput - targetTimeSec) <= 30) {
    return tInput / (raceDistMeters / 1000);
  }

  for (let i = 0; i < 30; i++) {
    const mid = (low + high) / 2;
    const tMid = predictRaceTime(raceDistMeters, raceTimeStr, mid);
    if (tMid === 0) break;

    // If predicted time is above 60 minutes, distance is too long. Reduce it.
    if (tMid > targetTimeSec) high = mid;
    else low = mid;
  }

  const distAt60 = (low + high) / 2;
  if (!isFinite(distAt60) || distAt60 <= 0) return 0;

  return targetTimeSec / (distAt60 / 1000);
};

/**
 * C3. Optional Critical Speed from two race results if the optional fields exist.
 * Uses the linear distance-time model: CS = (d2 - d1) / (t2 - t1).
 * Converts CS to a conservative 60-minute threshold pace (sec/km).
 */
const estimate60MinThresholdFromCriticalSpeed = (profile: any): number => {
  const d1 = Number(profile?.raceDistance);
  const t1 = timeToSeconds(String(profile?.raceTime || ""));
  const d2 = Number(profile?.raceDistance2);
  const t2 = timeToSeconds(String(profile?.raceTime2 || ""));

  if (!isFinite(d1) || !isFinite(d2) || d1 <= 0 || d2 <= 0) return 0;
  if (!isFinite(t1) || !isFinite(t2) || t1 <= 0 || t2 <= 0) return 0;

  // Need t2 > t1 and d2 > d1 for a valid 2-point model.
  if (t2 <= t1 || d2 <= d1) return 0;

  const cs = (d2 - d1) / (t2 - t1); // m/s
  if (!isFinite(cs) || cs <= 0) return 0;

  const paceCS = 1000 / cs; // sec/km

  // Slightly conservative factor.
  return paceCS * 1.01;
};

const get60MinThresholdPace = (profile: UserProfile | any): number => {
  const csPace = estimate60MinThresholdFromCriticalSpeed(profile);
  if (csPace > 0) return csPace;
  return estimate60MinThresholdFromSingleResult(profile.raceDistance, profile.raceTime);
};

/**
 * B. Norwegian Singles style pacing offsets from the 60-minute threshold anchor.
 * The goal here is to produce distinct paces across 400-5000m, similar to NSA tables.
 *
 * Key behaviour:
 * - 400-600m are slightly faster than 1k.
 * - 800-1200m sit around threshold to a touch slower.
 * - 1600-2000m are a bit slower.
 * - 3000m is slower again.
 * - 5000m aligns to Marathon Pace.
 *
 * Returns a target pace (sec/km) and an effort label.
 */
const getSinglesTargetPace = (
  profile: UserProfile,
  repDistanceMeters: number,
  threshold60PaceSec: number,
  correctionSec = 0
): { paceSec: number; effort: string } => {
  if (!threshold60PaceSec || threshold60PaceSec <= 0) {
    return { paceSec: 0, effort: "NSA Singles" };
  }

  const { p15k, pHalf, p30k, pMarathon } = getRaceEquivalentPaces(profile);

  // Dynamic race-equivalent anchors:
  // 1k reps -> 15K pace
  // 2k reps -> Half Marathon pace
  // 3k reps -> 30K pace
  // 5k reps -> Marathon pace
  // Shorter reps (400-1000) stay on the 15K anchor to avoid aggressive targets.
  let base = threshold60PaceSec;
  let effort = "Subthreshold Pace";

  if (repDistanceMeters <= 450 && p15k > 0) {
    base = p15k - 9;
    effort = "400m Pace";
  } else if (repDistanceMeters <= 650 && p15k > 0) {
    base = p15k - 6;
    effort = "600m Pace";
  } else if (repDistanceMeters <= 850 && p15k > 0) {
    base = p15k - 3;
    effort = "800m Pace";
  } else if (repDistanceMeters <= 1000 && p15k > 0) {
    base = p15k;
    effort = "1K Pace";
  } else if (repDistanceMeters <= 2000 && pHalf > 0) {
    base = pHalf;
    effort = "Half Marathon Pace";
  } else if (repDistanceMeters <= 3500 && p30k > 0) {
    base = p30k;
    effort = "30K Pace";
  } else if (pMarathon > 0) {
    base = pMarathon;
    effort = "Marathon Pace";
  }

  return { paceSec: applyPaceCorrection(base, correctionSec), effort };
};

export const getIntervalPaceRange = (profile: UserProfile, distanceMeters: number, correctionSec = 0): { range: string; effort: string } => {
  const threshold60 = get60MinThresholdPace(profile);
  const { paceSec, effort } = getSinglesTargetPace(profile, distanceMeters, threshold60, correctionSec);

  if (!paceSec) return { range: "0:00-0:00", effort };

  // NSA style tight band. This also makes 400m vs 1k visibly different.
  const rangeSeconds = 10;

  return {
    range: `${secondsToTime(paceSec)}-${secondsToTime(paceSec + rangeSeconds)}`,
    effort
  };
};

/**
 * Keeps the same exported name. Internals now return 60-minute threshold pace (sec/km).
 * Accepts an optional profile to enable C3 without changing types or UI.
 */
export const calculateThresholdPace = (raceDistMeters: number, raceTimeStr: string, profile?: UserProfile | any): number => {
  if (profile) return get60MinThresholdPace(profile);
  return estimate60MinThresholdFromSingleResult(raceDistMeters, raceTimeStr);
};

export const generatePlan = (profile: UserProfile, correctionSec = 0): WeeklyPlan => {
  const tPace = applyPaceCorrection(calculateThresholdPace(profile.raceDistance, profile.raceTime, profile as any), correctionSec);
  const easyRange = getEasyRunPaceRange(profile, correctionSec);
  const easyPace = easyRange.center;
  const easyRangeText = `${secondsToTime(easyRange.low)}-${secondsToTime(easyRange.high)}`;
  const targetKm = Math.max(0, Number(profile.weeklyVolume) || 0);
  const wu = profile.warmupDist;
  const cd = profile.cooldownDist;

  const thresholdTemplates = [
    { reps: 5, dist: 2000, rest: '60s' }, // 5x2km
    { reps: 8, dist: 1000, rest: '60s' }, // 8x1km
    { reps: 3, dist: 3000, rest: '90s' }, // 3x3km
  ];
  const thresholdDays = Object.entries(profile.schedule)
    .filter(([, t]) => t === DayType.THRESHOLD)
    .map(([day]) => day);
  const thresholdSessionDists = thresholdDays.map((_, idx) => {
    const tpl = thresholdTemplates[idx % thresholdTemplates.length];
    return wu + cd + ((tpl.reps * tpl.dist) / 1000);
  });
  const maxThresholdDist = thresholdSessionDists.length ? Math.max(...thresholdSessionDists) : 0;

  let lrDist = Math.max(15, Math.round(targetKm * 0.28));
  lrDist = Math.max(lrDist, maxThresholdDist + 1);
  const easyDaysCount = Object.values(profile.schedule).filter(t => t === DayType.EASY).length;
  const minEasyDist = easyDaysCount > 0 ? 6 : 0;
  lrDist = Math.max(lrDist, minEasyDist + 1);

  const thresholdTotalKm = thresholdSessionDists.reduce((a, b) => a + b, 0);
  const easyDays = Object.entries(profile.schedule).filter(([, t]) => t === DayType.EASY).map(([d]) => d);
  const minEasyTotalKm = easyDays.length * minEasyDist;
  const baseFixedKm = thresholdTotalKm + lrDist + minEasyTotalKm;
  const remainingKm = Math.max(0, targetKm - baseFixedKm);
  const easyBonusPerDay = easyDays.length > 0 ? (remainingKm / easyDays.length) : 0;
  const easyDist = easyDays.length > 0 ? Math.max(minEasyDist, Math.round((minEasyDist + easyBonusPerDay) * 10) / 10) : 0;

  const createThresholdSession = (id: string, dayName: string): WorkoutSession => {
    const templateIdx = Math.max(0, thresholdDays.indexOf(dayName));
    const tpl = thresholdTemplates[templateIdx % thresholdTemplates.length];
    const dist = tpl.dist;
    const reps = tpl.reps;

    const paceData = getIntervalPaceRange(profile, dist, correctionSec);
    const sessionDist = wu + cd + (reps * dist / 1000);

    return {
      id: id,
      title: formatThresholdSessionTitle(reps, dist),
      type: WorkoutType.THRESHOLD,
      sport: 'run',
      environment: 'road',
      treadmillInclinePct: DEFAULT_TREADMILL_INCLINE,
      useHeartRateTarget: false,
      distance: Math.round(sessionDist * 10) / 10,
      duration: Math.round(sessionDist * (tPace / 60) * 1.05),
      description: `Strictly controlled sub-threshold. Stay below lactate turnpoint.`,
      intervals: [{
        distance: dist, count: reps, pace: paceData.range, rest: tpl.rest, description: paceData.effort
      }],
      warmup: `${wu}km easy pace`,
      cooldown: `${cd}km easy pace`
    };
  };

  const createLongRun = (id: string): WorkoutSession => {
    const mpSec = applyPaceCorrection(calculatePaceForDistance(profile.raceDistance, profile.raceTime, 42195), correctionSec);
    const steadyPaceSec = (easyPace + mpSec) / 2;

    const variants: WorkoutSession[] = [
      {
        id: `${id}-easy`,
        title: `Easy Long Run`,
        type: WorkoutType.LONG_RUN,
        sport: 'run',
        environment: 'road',
        treadmillInclinePct: DEFAULT_TREADMILL_INCLINE,
        useHeartRateTarget: false,
        distance: lrDist,
        duration: Math.round(lrDist * (easyPace / 60)),
        description: `Continuous easy endurance run.`,
        intervals: [{ distance: lrDist * 1000, count: 1, pace: easyRangeText, rest: '0', description: 'Easy' }],
        warmup: 'Direct start', cooldown: 'Walk off'
      },
      {
        id: `${id}-prog`,
        title: `Progressive Long Run`,
        type: WorkoutType.LONG_RUN,
        sport: 'run',
        environment: 'road',
        treadmillInclinePct: DEFAULT_TREADMILL_INCLINE,
        useHeartRateTarget: false,
        distance: lrDist,
        duration: Math.round(lrDist * (steadyPaceSec / 60)),
        description: `Build: 50% Easy, 30% Steady, 20% Marathon Pace.`,
        intervals: [
          { distance: Math.round(lrDist * 0.5 * 1000), count: 1, pace: secondsToTime(easyPace), rest: '0', description: 'Easy' },
          { distance: Math.round(lrDist * 0.3 * 1000), count: 1, pace: secondsToTime(steadyPaceSec), rest: '0', description: 'Steady' },
          { distance: Math.round(lrDist * 0.2 * 1000), count: 1, pace: secondsToTime(mpSec), rest: '0', description: 'MP' }
        ],
        warmup: 'Direct start', cooldown: 'Walk off'
      },
      {
        id: `${id}-blocks`,
        title: `3x5km MP Long Run`,
        type: WorkoutType.LONG_RUN,
        sport: 'run',
        environment: 'road',
        treadmillInclinePct: DEFAULT_TREADMILL_INCLINE,
        useHeartRateTarget: false,
        distance: Math.round((wu + cd + 15) * 10) / 10,
        duration: Math.round(15 * (mpSec / 60) + (wu + cd) * 5),
        description: `High specificity. 3 blocks of 5km at Marathon Pace.`,
        intervals: [{ distance: 5000, count: 3, pace: secondsToTime(mpSec), rest: '1km float', description: 'Marathon Pace' }],
        warmup: `${wu}km Easy`, cooldown: `${cd}km Easy`
      }
    ];

    return { ...variants[0], variants };
  };

  const createEasyRun = (id: string, dist: number): WorkoutSession => ({
    id: id, title: `Easy Run`, type: WorkoutType.EASY, sport: 'run', distance: dist,
    environment: 'road',
    treadmillInclinePct: DEFAULT_TREADMILL_INCLINE,
    useHeartRateTarget: false,
    duration: Math.round(dist * (easyPace / 60)),
    description: `Target Pace: ${secondsToTime(easyRange.low)}-${secondsToTime(easyRange.high)}/km`,
    warmup: 'N/A', cooldown: 'N/A'
  });
  const bikeSpeedKmh = (type: WorkoutType): number => {
    if (type === WorkoutType.THRESHOLD) return 34;
    if (type === WorkoutType.LONG_RUN) return 31;
    return 30;
  };
  const createBikeEasy = (id: string): WorkoutSession => {
    const runEquivalentMin = Math.round(easyDist * (easyPace / 60));
    const distanceKm = Math.max(20, Math.round((runEquivalentMin / 60) * bikeSpeedKmh(WorkoutType.EASY)));
    return {
      id,
      title: 'Easy Ride',
      type: WorkoutType.EASY,
      sport: 'bike',
      environment: 'road',
      treadmillInclinePct: 0,
      useHeartRateTarget: true,
      distance: distanceKm,
      duration: runEquivalentMin,
      description: profile.ftp && profile.ftp > 0
        ? `Zone 2 endurance ride (${Math.round(profile.ftp * 0.56)}-${Math.round(profile.ftp * 0.75)}w).`
        : 'Zone 2 endurance ride.',
      intervals: [{ distance: distanceKm * 1000, count: 1, pace: '', rest: '0', description: 'Zone 2', targetZone: 'Z2' }],
      warmup: '10m easy spin',
      cooldown: '5m easy spin',
    };
  };
  const createBikeThreshold = (id: string, dayName: string): WorkoutSession => {
    const templateIdx = Math.max(0, thresholdDays.indexOf(dayName));
    const tpl = thresholdTemplates[templateIdx % thresholdTemplates.length];
    const reps = tpl.reps;
    const runPace = getIntervalPaceRange(profile, tpl.dist, correctionSec).range.split('-')[0];
    const runRepSec = timeToSeconds(runPace) * (tpl.dist / 1000);
    const bikeRepKm = ((runRepSec / 3600) * bikeSpeedKmh(WorkoutType.THRESHOLD));
    const bikeRepMeters = Math.max(1000, Math.round(bikeRepKm * 1000));
    const rest = '120s';
    const workMinutes = Math.round(((runRepSec * reps) / 60));
    const duration = 15 + workMinutes + (Math.max(0, reps - 1) * 2) + 10;
    const ftp = Number(profile.ftp) || 0;
    const targetPowerLow = ftp > 0 ? Math.round(ftp * 0.92) : undefined;
    const targetPowerHigh = ftp > 0 ? Math.round(ftp * 0.98) : undefined;
    return {
      id,
      title: `SubT ${reps}x${Math.round((bikeRepMeters / 1000) * 10) / 10}km`,
      type: WorkoutType.THRESHOLD,
      sport: 'bike',
      environment: 'road',
      useHeartRateTarget: true,
      distance: Math.round(((bikeRepMeters * reps) / 1000) * 10) / 10,
      duration,
      description: ftp > 0
        ? `Subthreshold cycling. ${targetPowerLow}-${targetPowerHigh}w (92-98% FTP).`
        : 'Subthreshold cycling. Zone 3 effort.',
      intervals: [{
        distance: bikeRepMeters,
        count: reps,
        pace: '',
        rest,
        description: ftp > 0 ? `${targetPowerLow}-${targetPowerHigh}w` : 'Zone 3',
        targetZone: 'Z3',
        targetPowerLow,
        targetPowerHigh,
      }],
      warmup: '15m easy spin',
      cooldown: '10m easy spin',
    };
  };
  const createBikeLong = (id: string): WorkoutSession => {
    const ftp = Number(profile.ftp) || 0;
    const easyRide: WorkoutSession = {
      id: `${id}-easy`,
      title: 'Easy Long Ride',
      type: WorkoutType.LONG_RUN,
      sport: 'bike',
      environment: 'road',
      useHeartRateTarget: true,
      distance: 0,
      duration: 120,
      description: ftp > 0 ? `Aerobic long ride ${Math.round(ftp * 0.56)}-${Math.round(ftp * 0.75)}w.` : 'Aerobic long ride in Zone 2.',
      intervals: [{ distance: Math.round((120 / 60) * bikeSpeedKmh(WorkoutType.LONG_RUN) * 1000), count: 1, pace: '', rest: '0', description: 'Zone 2', targetZone: 'Z2' }],
      warmup: '10m easy spin',
      cooldown: '5m easy spin',
    };
    const progRide: WorkoutSession = {
      id: `${id}-prog`,
      title: 'Progressive Long Ride',
      type: WorkoutType.LONG_RUN,
      sport: 'bike',
      environment: 'road',
      useHeartRateTarget: true,
      distance: 0,
      duration: 120,
      description: ftp > 0 ? `Progressive ride with tempo finish (${Math.round(ftp * 0.8)}-${Math.round(ftp * 0.88)}w).` : 'Progressive ride finishing upper aerobic.',
      intervals: [
        { distance: Math.round((60 / 60) * bikeSpeedKmh(WorkoutType.LONG_RUN) * 1000), count: 1, pace: '', rest: '0', description: 'Zone 2', targetZone: 'Z2' },
        { distance: Math.round((36 / 60) * bikeSpeedKmh(WorkoutType.LONG_RUN) * 1000), count: 1, pace: '', rest: '0', description: ftp > 0 ? `${Math.round(ftp * 0.8)}-${Math.round(ftp * 0.88)}w` : 'Zone 3', targetZone: 'Z3', targetPowerLow: ftp > 0 ? Math.round(ftp * 0.8) : undefined, targetPowerHigh: ftp > 0 ? Math.round(ftp * 0.88) : undefined },
        { distance: Math.round((24 / 60) * bikeSpeedKmh(WorkoutType.LONG_RUN) * 1000), count: 1, pace: '', rest: '0', description: 'Zone 2', targetZone: 'Z2' }
      ],
      warmup: '10m easy spin',
      cooldown: '5m easy spin',
    };
    const blockRide: WorkoutSession = {
      id: `${id}-blocks`,
      title: '3x20min Tempo Ride',
      type: WorkoutType.LONG_RUN,
      sport: 'bike',
      environment: 'road',
      useHeartRateTarget: true,
      distance: 0,
      duration: 130,
      description: ftp > 0 ? `3x20 min tempo at ${Math.round(ftp * 0.85)}-${Math.round(ftp * 0.92)}w.` : '3x20 min tempo in Zone 3.',
      intervals: [{ distance: Math.round((20 / 60) * bikeSpeedKmh(WorkoutType.LONG_RUN) * 1000), count: 3, pace: '', rest: '300s', description: ftp > 0 ? `${Math.round(ftp * 0.85)}-${Math.round(ftp * 0.92)}w` : 'Zone 3', targetZone: 'Z3', targetPowerLow: ftp > 0 ? Math.round(ftp * 0.85) : undefined, targetPowerHigh: ftp > 0 ? Math.round(ftp * 0.92) : undefined }],
      warmup: '15m easy spin',
      cooldown: '10m easy spin',
    };
    return { ...easyRide, variants: [easyRide, progRide, blockRide] };
  };

  const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const dailyPlans: DailyPlan[] = dayOrder.map(dayName => {
    const type = profile.schedule[dayName] || DayType.REST;
    const id = dayName.toLowerCase();
    let session: WorkoutSession | null = null;
    const sport = profile.scheduleSport?.[dayName] || 'run';
    if (type === DayType.THRESHOLD) session = sport === 'bike' ? createBikeThreshold(id, dayName) : createThresholdSession(id, dayName);
    else if (type === DayType.LONG_RUN) session = sport === 'bike' ? createBikeLong(id) : createLongRun(id);
    else if (type === DayType.EASY) session = sport === 'bike' ? createBikeEasy(id) : (easyDist >= 4 ? createEasyRun(id, easyDist) : null);
    return { day: dayName, type, session };
  });

  const actualTotal = dailyPlans.reduce((sum, d) => sum + (d.session?.distance || 0), 0);
  if (easyDays.length > 0 && actualTotal !== targetKm) {
    const delta = targetKm - actualTotal;
    const perEasyDelta = delta / easyDays.length;
    dailyPlans.forEach((d) => {
      if (d.session?.type === WorkoutType.EASY) {
        d.session.distance = Math.max(4, Math.round((d.session.distance + perEasyDelta) * 10) / 10);
      }
    });
  }
  const newTotal = dailyPlans.reduce((sum, d) => sum + (d.session?.distance || 0), 0);
  return { totalDistance: Math.round(newTotal * 10) / 10, days: dailyPlans };
};
