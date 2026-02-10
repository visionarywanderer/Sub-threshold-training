import { UserProfile, WeeklyPlan, WorkoutType, WorkoutSession, DailyPlan, DayType } from '../types';
export const MIN_TREADMILL_INCLINE = 3;
export const MAX_TREADMILL_INCLINE = 15;
export const DEFAULT_TREADMILL_INCLINE = 3;

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

export const getTreadmillPaceDeltaSeconds = (inclinePct: number): number => {
  const incline = Math.min(MAX_TREADMILL_INCLINE, Math.max(MIN_TREADMILL_INCLINE, Number(inclinePct) || DEFAULT_TREADMILL_INCLINE));
  // 1% treadmill baseline is often close to outdoor effort; keep prior +6s/km benefit,
  // then add climbing cost above 1%.
  return Math.round(-6 + ((incline - 1) * 4));
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
  const targetVolume = profile.weeklyVolume;
  const wu = profile.warmupDist;
  const cd = profile.cooldownDist;

  const lrDist = Math.max(12, Math.round(targetVolume * 0.25));
  const thresholdCount = Object.values(profile.schedule).filter(t => t === DayType.THRESHOLD).length;

  const defaultWorkDist = 10;
  const estThresholdSessionVol = wu + cd + defaultWorkDist;
  const totalFixedVol = (thresholdCount * estThresholdSessionVol) + lrDist;
  const remainingVol = Math.max(0, targetVolume - totalFixedVol);
  const easyDaysCount = Object.values(profile.schedule).filter(t => t === DayType.EASY).length;
  const easyDist = easyDaysCount > 0 ? Math.round(remainingVol / easyDaysCount) : 0;

  const createThresholdSession = (id: string, dayName: string): WorkoutSession => {
    let dist = 1000;
    let reps = 10;
    if (dayName === 'Thursday') { dist = 2000; reps = 5; }
    if (dayName === 'Sunday') { dist = 3000; reps = 3; }

    const paceData = getIntervalPaceRange(profile, dist, correctionSec);
    const sessionDist = wu + cd + (reps * dist / 1000);

    return {
      id: id,
      title: formatThresholdSessionTitle(reps, dist),
      type: WorkoutType.THRESHOLD,
      environment: 'road',
      treadmillInclinePct: DEFAULT_TREADMILL_INCLINE,
      useHeartRateTarget: false,
      distance: Math.round(sessionDist * 10) / 10,
      duration: Math.round(sessionDist * (tPace / 60) * 1.05),
      description: `Strictly controlled sub-threshold. Stay below lactate turnpoint.`,
      intervals: [{
        distance: dist, count: reps, pace: paceData.range, rest: '60s', description: paceData.effort
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
    id: id, title: `Easy Run`, type: WorkoutType.EASY, distance: dist,
    environment: 'road',
    treadmillInclinePct: DEFAULT_TREADMILL_INCLINE,
    useHeartRateTarget: false,
    duration: Math.round(dist * (easyPace / 60)),
    description: `Target Pace: ${secondsToTime(easyRange.low)}-${secondsToTime(easyRange.high)}/km`,
    warmup: 'N/A', cooldown: 'N/A'
  });

  const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const dailyPlans: DailyPlan[] = dayOrder.map(dayName => {
    const type = profile.schedule[dayName] || DayType.REST;
    const id = dayName.toLowerCase();
    let session: WorkoutSession | null = null;
    if (type === DayType.THRESHOLD) session = createThresholdSession(id, dayName);
    else if (type === DayType.LONG_RUN) session = createLongRun(id);
    else if (type === DayType.EASY && easyDist >= 4) session = createEasyRun(id, easyDist);
    return { day: dayName, type, session };
  });

  const actualTotal = dailyPlans.reduce((sum, d) => sum + (d.session?.distance || 0), 0);
  return { totalDistance: Math.round(actualTotal * 10) / 10, days: dailyPlans };
};
