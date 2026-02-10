export enum DistanceUnit {
  KM = 'km',
  MILES = 'miles'
}

export enum DayType {
  REST = 'Rest',
  EASY = 'Easy Run',
  THRESHOLD = 'Threshold',
  LONG_RUN = 'Long Run'
}

export type TrainingSport = 'run' | 'bike';

export interface UserSchedule {
  [key: string]: DayType;
}

export interface UserProfile {
  uid?: string;
  email?: string;
  name: string;
  raceDistance: number;
  raceTime: string;
  maxHR: number;
  ftp?: number;
  weeklyVolume: number;
  unit: DistanceUnit;
  schedule: UserSchedule;
  scheduleSport?: Record<string, TrainingSport>;
  warmupDist: number;
  cooldownDist: number;
}

export enum WorkoutType {
  EASY = 'Easy',
  THRESHOLD = 'Threshold',
  LONG_RUN = 'Long Run',
  REST = 'Rest',
  RACE = 'Race'
}

export interface Interval {
  distance: number;
  durationSec?: number;
  count: number;
  pace: string;
  rest: string;
  description: string;
  targetZone?: string;
  targetPowerLow?: number;
  targetPowerHigh?: number;
}

export interface WorkoutSession {
  id: string;
  title: string;
  type: WorkoutType;
  sport?: TrainingSport;
  environment?: 'road' | 'treadmill' | 'trail';
  treadmillInclinePct?: number;
  useHeartRateTarget?: boolean;
  targetHrLow?: number;
  targetHrHigh?: number;
  distance: number;
  duration: number;
  description: string;
  intervals?: Interval[];
  scheduled?: boolean;
  warmup?: string;
  cooldown?: string;
  variants?: WorkoutSession[]; 
  icuEventId?: number; // Intervals.icu event ID for updates
}

export interface DailyPlan {
  day: string;
  date?: string; // ISO format date
  type: DayType;
  session: WorkoutSession | null;
  icuEventId?: number; // Intervals.icu event ID for non-workout day events (e.g., rest day)
}

export interface WeeklyPlan {
  totalDistance: number;
  days: DailyPlan[];
}

export interface IntervalsIcuConfig {
  athleteId: string;
  apiKey: string;
  connected: boolean;
}
