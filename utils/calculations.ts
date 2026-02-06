import { UserProfile, WeeklyPlan, WorkoutType, WorkoutSession, DailyPlan, DayType } from '../types';

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

export const predictRaceTime = (raceDistMeters: number, raceTimeStr: string, targetDistMeters: number): number => {
  const tInput = timeToSeconds(raceTimeStr);
  if (tInput === 0 || raceDistMeters === 0) return 0;
  const fatigueFactor = 1.06;
  return tInput * Math.pow(targetDistMeters / raceDistMeters, fatigueFactor);
};

export const calculatePaceForDistance = (raceDistMeters: number, raceTimeStr: string, targetDistMeters: number): number => {
    const predictedSeconds = predictRaceTime(raceDistMeters, raceTimeStr, targetDistMeters);
    if (predictedSeconds === 0) return 0;
    return predictedSeconds / (targetDistMeters / 1000);
}

export const getIntervalPaceRange = (profile: UserProfile, distanceMeters: number): { range: string, effort: string } => {
  let targetDist = 21097;
  let effortLabel = "Half Marathon";

  if (distanceMeters <= 600) { targetDist = 10000; effortLabel = "10K"; }
  else if (distanceMeters <= 1000) { targetDist = 15000; effortLabel = "15K"; }
  else if (distanceMeters <= 2500) { targetDist = 21097; effortLabel = "Half Marathon"; }
  else if (distanceMeters <= 3500) { targetDist = 30000; effortLabel = "30K"; }
  else { targetDist = 42195; effortLabel = "Marathon"; }

  const paceSec = calculatePaceForDistance(profile.raceDistance, profile.raceTime, targetDist);
  return {
    range: `${secondsToTime(paceSec)}-${secondsToTime(paceSec + 10)}`,
    effort: effortLabel
  };
};

export const calculateThresholdPace = (raceDistMeters: number, raceTimeStr: string): number => {
  return calculatePaceForDistance(raceDistMeters, raceTimeStr, 21097);
};

export const generatePlan = (profile: UserProfile): WeeklyPlan => {
  const tPace = calculateThresholdPace(profile.raceDistance, profile.raceTime);
  const easyPace = tPace * 1.25; 
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

      const paceData = getIntervalPaceRange(profile, dist);
      const sessionDist = wu + cd + (reps * dist / 1000);
      
      return {
          id: id,
          title: `SubT Run`,
          type: WorkoutType.THRESHOLD,
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
    const mpSec = calculatePaceForDistance(profile.raceDistance, profile.raceTime, 42195);
    const steadyPaceSec = (easyPace + mpSec) / 2;

    const variants: WorkoutSession[] = [
      {
        id: `${id}-easy`,
        title: `Easy Long Run`,
        type: WorkoutType.LONG_RUN,
        distance: lrDist,
        duration: Math.round(lrDist * (easyPace / 60)),
        description: `Continuous easy effort. Aerobic base focus.`,
        intervals: [{ distance: lrDist * 1000, count: 1, pace: secondsToTime(easyPace), rest: '0', description: 'Easy' }],
        warmup: 'Direct start', cooldown: 'Walk off'
      },
      {
        id: `${id}-prog`,
        title: `Progressive Long Run`,
        type: WorkoutType.LONG_RUN,
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
        distance: Math.round((wu + cd + 15) * 10) / 10,
        duration: Math.round(15 * (mpSec / 60) + (wu+cd)*5),
        description: `High specificity. 3 blocks of 5km at Marathon Pace.`,
        intervals: [{ distance: 5000, count: 3, pace: secondsToTime(mpSec), rest: '1km float', description: 'Marathon Pace' }],
        warmup: `${wu}km Easy`, cooldown: `${cd}km Easy`
      }
    ];

    return { ...variants[0], variants };
  };

  const createEasyRun = (id: string, dist: number): WorkoutSession => ({
    id: id, title: `Easy Run`, type: WorkoutType.EASY, distance: dist,
    duration: Math.round(dist * (easyPace / 60)),
    description: `Target Pace: ${secondsToTime(easyPace)}-${secondsToTime(easyPace + 30)}/km`,
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