import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, GripVertical, RefreshCw, Cloud, CloudRain, CloudSun, Snowflake, Sun } from 'lucide-react';
import { WorkoutSession, WorkoutType, UserProfile } from '../types';
import { applyPaceCorrection, calculatePaceForDistance, calculateThresholdPace, formatThresholdSessionTitle, getEasyRunPaceRange, getIntervalPaceRange, secondsToTime } from '../utils/calculations';

interface DailyForecast {
  date: string;
  temperatureC: number;
  humidityPct: number;
  windKmh: number;
  weatherCode: number;
}

interface WorkoutCardProps {
  session: WorkoutSession;
  profile: UserProfile;
  paceCorrectionSec?: number;
  forecast?: DailyForecast;
  dayLabel: string;
  dayTypeLabel: string;
  onUpdateSession: (session: WorkoutSession) => void;
  onSync: (session: WorkoutSession) => void;
  isSynced?: boolean;
  dragHandleListeners?: Record<string, any>;
  dragHandleAttributes?: Record<string, any>;
}

const WorkoutCard: React.FC<WorkoutCardProps> = ({
  session: initialSession,
  profile,
  paceCorrectionSec = 0,
  forecast,
  dayLabel,
  dayTypeLabel,
  onUpdateSession,
  onSync,
  isSynced,
  dragHandleListeners,
  dragHandleAttributes,
}) => {
  const [currentSession, setCurrentSession] = useState<WorkoutSession>(initialSession);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [cardOpen, setCardOpen] = useState(true);

  useEffect(() => {
    setCurrentSession(initialSession);
  }, [initialSession]);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth >= 1024) {
      setDetailsOpen(true);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncViewport = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      setCardOpen(!mobile);
    };
    syncViewport();
    window.addEventListener('resize', syncViewport);
    return () => window.removeEventListener('resize', syncViewport);
  }, []);

  const isEasy = currentSession.type === WorkoutType.EASY;
  const isLongRun = currentSession.type === WorkoutType.LONG_RUN;
  const isThreshold = currentSession.type === WorkoutType.THRESHOLD;
  const displayDayTypeLabel = dayTypeLabel.replace('Threshold', 'Subthreshold');
  const getWeatherIcon = (weatherCode: number) => {
    if (weatherCode === 0) return Sun;
    if ([1, 2].includes(weatherCode)) return CloudSun;
    if ([3, 45, 48].includes(weatherCode)) return Cloud;
    if ((weatherCode >= 71 && weatherCode <= 77) || (weatherCode >= 85 && weatherCode <= 86)) return Snowflake;
    return CloudRain;
  };

  const parseTimeToSec = (timeStr: string): number => {
    const cleaned = timeStr.trim();
    if (!cleaned) return 0;
    const parts = cleaned.split(':').map((p) => Number(p));
    if (parts.length === 2 && parts.every((p) => Number.isFinite(p))) {
      return parts[0] * 60 + parts[1];
    }
    if (parts.length === 3 && parts.every((p) => Number.isFinite(p))) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return 0;
  };

  const parsePaceRangeMidSec = (pace: string): number => {
    if (!pace) return 0;
    const [low, high] = pace.split('-').map((p) => parseTimeToSec(p));
    if (low > 0 && high > 0) return (low + high) / 2;
    if (low > 0) return low;
    return 0;
  };

  const parseRestToSec = (rest: string): number => {
    if (!rest || rest === '0') return 0;
    const v = rest.trim().toLowerCase();
    if (v.endsWith('s')) return Number(v.replace('s', '')) || 0;
    if (v.endsWith('m')) return (Number(v.replace('m', '')) || 0) * 60;
    return 0;
  };

  const getTone = () => {
    if (dayTypeLabel.includes('Threshold')) {
      return {
        shell: 'bg-white/95 dark:bg-slate-900/95 border-slate-200/80 dark:border-slate-700/90',
        chip: 'bg-amber-50 text-amber-700 border border-amber-200/70 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-800/60',
        pace: 'bg-amber-50/70 border-amber-200/70 text-amber-900 dark:bg-amber-900/25 dark:border-amber-800/70 dark:text-amber-100',
        accent: 'bg-amber-400/90 dark:bg-amber-500/90',
      };
    }
    if (dayTypeLabel.includes('Long')) {
      return {
        shell: 'bg-white/95 dark:bg-slate-900/95 border-slate-200/80 dark:border-slate-700/90',
        chip: 'bg-blue-50 text-blue-700 border border-blue-200/70 dark:bg-blue-900/30 dark:text-blue-200 dark:border-blue-800/60',
        pace: 'bg-blue-50/70 border-blue-200/70 text-blue-900 dark:bg-blue-900/25 dark:border-blue-800/70 dark:text-blue-100',
        accent: 'bg-blue-400/90 dark:bg-blue-500/90',
      };
    }
    return {
      shell: 'bg-white/95 dark:bg-slate-900/95 border-slate-200/80 dark:border-slate-700/90',
      chip: 'bg-teal-50 text-teal-700 border border-teal-200/70 dark:bg-teal-900/30 dark:text-teal-200 dark:border-teal-800/60',
      pace: 'bg-teal-50/70 border-teal-200/70 text-teal-900 dark:bg-teal-900/25 dark:border-teal-800/70 dark:text-teal-100',
      accent: 'bg-teal-400/90 dark:bg-teal-500/90',
    };
  };
  const tone = getTone();

  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

  const recalcDerived = (session: WorkoutSession): WorkoutSession => {
    if (session.type === WorkoutType.EASY) {
      const easyRange = getEasyRunPaceRange(profile, paceCorrectionSec);
      const easyPace = easyRange.center;
      return {
        ...session,
        duration: Math.round(session.distance * (easyPace / 60)),
        description: `Target Pace: ${secondsToTime(easyRange.low)}-${secondsToTime(easyRange.high)}/km`,
      };
    }

    if (session.type === WorkoutType.THRESHOLD) {
      const newIntervals = (session.intervals || []).map((int) => {
        const dist = Number(int.distance) || 0;
        const paceData = getIntervalPaceRange(profile, dist, paceCorrectionSec);
        return { ...int, distance: dist, pace: paceData.range, description: paceData.effort };
      });

      const wuKm = Math.max(0, Number(profile.warmupDist) || 0);
      const cdKm = Math.max(0, Number(profile.cooldownDist) || 0);
      const easyCenter = getEasyRunPaceRange(profile, paceCorrectionSec).center;

      const intervalKm = newIntervals.reduce((sum, int) => {
        const reps = Math.max(1, Number(int.count) || 1);
        const distKm = Math.max(0, Number(int.distance) || 0) / 1000;
        return sum + (reps * distKm);
      }, 0);

      const workSec = newIntervals.reduce((sum, int) => {
        const reps = Math.max(1, Number(int.count) || 1);
        const distKm = Math.max(0, Number(int.distance) || 0) / 1000;
        const repPaceSec = parsePaceRangeMidSec(int.pace || '');
        return sum + (reps * distKm * repPaceSec);
      }, 0);

      const restSec = newIntervals.reduce((sum, int) => {
        const reps = Math.max(1, Number(int.count) || 1);
        const perRest = parseRestToSec(int.rest || '');
        const countRests = Math.max(0, reps - 1);
        return sum + (perRest * countRests);
      }, 0);

      const wuCdSec = (wuKm + cdKm) * easyCenter;
      const sessionDistance = Math.round((wuKm + cdKm + intervalKm) * 10) / 10;
      const sessionDuration = Math.round((workSec + restSec + wuCdSec) / 60);

      return {
        ...session,
        title: newIntervals.length
          ? formatThresholdSessionTitle(Math.max(1, Number(newIntervals[0].count) || 1), Math.max(0, Number(newIntervals[0].distance) || 0))
          : session.title,
        intervals: newIntervals,
        distance: sessionDistance,
        duration: sessionDuration,
        warmup: `${wuKm}km easy pace`,
        cooldown: `${cdKm}km easy pace`,
      };
    }

    return session;
  };

  const pushUpdate = (next: WorkoutSession) => {
    setCurrentSession(next);
    onUpdateSession(next);
  };

  const updateInterval = (index: number, field: 'distance' | 'count' | 'rest', value: any) => {
    setCurrentSession((prev) => {
      const prevIntervals = prev.intervals || [];
      const nextIntervals = [...prevIntervals];
      const current = nextIntervals[index] || { distance: 1000, count: 10, rest: '60s', pace: '', description: '' };

      const updated = {
        ...current,
        [field]: field === 'distance' || field === 'count' ? Number(value) : value,
      };

      if (field === 'distance' || field === 'count') {
        const d = Number(updated.distance);
        if (d <= 1000) updated.count = clamp(Number(updated.count) || 10, 8, 20);
        else if (d === 2000) updated.count = clamp(Number(updated.count) || 5, 4, 6);
        else if (d >= 3000) updated.count = clamp(Number(updated.count) || 3, 2, 4);
      }

      if (field === 'distance') {
        const paceData = getIntervalPaceRange(profile, Number(updated.distance), paceCorrectionSec);
        updated.pace = paceData.range;
        updated.description = paceData.effort;
      }

      nextIntervals[index] = updated;
      const nextSession = recalcDerived({ ...prev, intervals: nextIntervals });
      onUpdateSession(nextSession);
      return nextSession;
    });
  };

  const updateEasyDistance = (distance: number) => {
    const next = recalcDerived({ ...currentSession, distance: Math.max(0, distance) });
    pushUpdate(next);
  };

  useEffect(() => {
    if (currentSession.type !== WorkoutType.THRESHOLD) return;
    const next = recalcDerived(currentSession);
    const hasChange =
      next.distance !== currentSession.distance ||
      next.duration !== currentSession.duration ||
      next.warmup !== currentSession.warmup ||
      next.cooldown !== currentSession.cooldown;
    if (!hasChange) return;
    setCurrentSession(next);
    onUpdateSession(next);
  }, [profile.warmupDist, profile.cooldownDist, paceCorrectionSec]);

  const variants = (currentSession as any).variants as WorkoutSession[] | undefined;
  const hasVariants = Array.isArray(variants) && variants.length > 0;

  const selectedVariantId = useMemo(() => {
    if (!hasVariants) return currentSession.id;
    const match = variants!.find(v => v.id === currentSession.id);
    return match ? currentSession.id : variants![0].id;
  }, [currentSession.id, hasVariants, variants]);

  const selectLongRunVariant = (variantId: string) => {
    if (!hasVariants) return;
    const v = variants!.find(x => x.id === variantId);
    if (!v) return;
    const next: WorkoutSession = { ...v, variants, icuEventId: currentSession.icuEventId };
    pushUpdate(next);
  };

  const thresholdPace = useMemo(() => {
    const p = applyPaceCorrection(calculateThresholdPace(profile.raceDistance, profile.raceTime, profile as any), paceCorrectionSec);
    return p > 0 ? secondsToTime(p) : '0:00';
  }, [profile, paceCorrectionSec]);

  const displayTitle = useMemo(() => {
    if (!isThreshold || !currentSession.intervals?.length) return currentSession.title;
    const first = currentSession.intervals[0];
    const reps = Math.max(1, Number(first.count) || 1);
    const dist = Math.max(0, Number(first.distance) || 0);
    const distLabel = dist >= 1000 ? `${Math.round((dist / 1000) * 10) / 10}km` : `${Math.round(dist)}m`;
    return `SubT ${reps}x${distLabel}`;
  }, [currentSession.intervals, currentSession.title, isThreshold]);

  const getPrimaryPaceRange = () => {
    if (isThreshold && currentSession.intervals?.length) {
      const dist = Number(currentSession.intervals[0].distance);
      return getIntervalPaceRange(profile, dist, paceCorrectionSec).range;
    }
    if (isEasy) {
      const easyRange = getEasyRunPaceRange(profile, paceCorrectionSec);
      return `${secondsToTime(easyRange.low)}-${secondsToTime(easyRange.high)}`;
    }
    if (isLongRun && currentSession.title.toLowerCase().includes('easy')) {
      const easyRange = getEasyRunPaceRange(profile, paceCorrectionSec);
      return `${secondsToTime(easyRange.low)}-${secondsToTime(easyRange.high)}`;
    }
    const mp = applyPaceCorrection(calculatePaceForDistance(profile.raceDistance, profile.raceTime, 42195), paceCorrectionSec);
    return secondsToTime(mp);
  };

  const getIdealPaceRange = () => {
    if (isThreshold && currentSession.intervals?.length) {
      const dist = Number(currentSession.intervals[0].distance);
      return getIntervalPaceRange(profile, dist, 0).range;
    }
    if (isEasy) {
      const easyRange = getEasyRunPaceRange(profile, 0);
      return `${secondsToTime(easyRange.low)}-${secondsToTime(easyRange.high)}`;
    }
    if (isLongRun && currentSession.title.toLowerCase().includes('easy')) {
      const easyRange = getEasyRunPaceRange(profile, 0);
      return `${secondsToTime(easyRange.low)}-${secondsToTime(easyRange.high)}`;
    }
    const mp = calculatePaceForDistance(profile.raceDistance, profile.raceTime, 42195);
    return secondsToTime(mp);
  };

  const getIntervalDisplayPace = (distanceMeters: number, paceFromSession?: string) => {
    if (isThreshold) {
      return getIntervalPaceRange(profile, Number(distanceMeters), paceCorrectionSec).range;
    }
    // For long runs and other sessions, keep the pace defined by the selected variant/session.
    if (paceFromSession && paceFromSession.trim().length > 0) {
      return paceFromSession;
    }
    return getIntervalPaceRange(profile, Number(distanceMeters), paceCorrectionSec).range;
  };

  const formatDuration = (minutes: number) => {
    const total = Math.max(0, Math.round(minutes || 0));
    if (total < 60) return `${total} min`;
    const h = Math.floor(total / 60);
    const m = total % 60;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  };

  return (
    <article className={`relative overflow-hidden border rounded-3xl shadow-[0_1px_0_0_rgba(15,23,42,0.05),0_10px_24px_-18px_rgba(15,23,42,0.35)] hover:shadow-[0_1px_0_0_rgba(15,23,42,0.07),0_18px_30px_-20px_rgba(15,23,42,0.42)] transition-all ${tone.shell}`}>
      <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${tone.accent}`} />
      <div className="px-6 py-5 border-b border-slate-200/80 dark:border-slate-700/80 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-[22px] leading-none font-semibold tracking-tight text-slate-900 dark:text-slate-100">{dayLabel}</h3>
            <span className={`text-[10px] font-bold uppercase px-2.5 py-1 rounded-full ${tone.chip}`}>
              {displayDayTypeLabel}
            </span>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-300 mt-2">{displayTitle}</p>
          {forecast ? (
            <div className="mt-2 inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-full px-2.5 py-1">
              {(() => {
                const Icon = getWeatherIcon(forecast.weatherCode);
                return <Icon size={12} />;
              })()}
              <span>{Math.round(forecast.temperatureC)}C</span>
              <span className="text-slate-400">·</span>
              <span>{Math.round(forecast.humidityPct)}%</span>
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full border ${isSynced ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200 dark:border-emerald-800' : 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'}`}>
            {isSynced ? 'Synced' : 'Not synced'}
          </span>
          <button
            onClick={() => onSync(currentSession)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold hover:bg-slate-800 dark:hover:bg-white focus:outline-none focus:ring-2 focus:ring-slate-400"
          >
            <RefreshCw size={12} />
            Sync
          </button>
          <button
            type="button"
            className="p-2 rounded-full border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-300 hover:text-slate-700 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800 cursor-grab active:cursor-grabbing focus:outline-none focus:ring-2 focus:ring-slate-300"
            aria-label={`Drag to reorder ${dayLabel}`}
            {...dragHandleAttributes}
            {...dragHandleListeners}
          >
            <GripVertical size={16} />
          </button>
          {isMobile && (
            <button
              type="button"
              onClick={() => setCardOpen((prev) => !prev)}
              className="p-2 rounded-full border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-300 hover:text-slate-700 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-300"
              aria-label={cardOpen ? `Collapse ${dayLabel}` : `Expand ${dayLabel}`}
            >
              {cardOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          )}
        </div>
      </div>

      {cardOpen && <div className="px-6 py-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
          <div className="rounded-2xl bg-slate-50/85 dark:bg-slate-800/85 border border-slate-200/80 dark:border-slate-700/90 px-4 py-3.5">
            <p className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">Distance</p>
            <p className="text-lg font-semibold text-slate-900 dark:text-slate-100 mt-1">{currentSession.distance} km</p>
          </div>
          <div className="rounded-2xl bg-slate-50/85 dark:bg-slate-800/85 border border-slate-200/80 dark:border-slate-700/90 px-4 py-3.5">
            <p className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">Est. Time</p>
            <p className="text-lg font-semibold text-slate-900 dark:text-slate-100 mt-1">{formatDuration(currentSession.duration || 0)}</p>
          </div>
          <div className={`rounded-2xl border px-4 py-3.5 ${tone.pace}`}>
            <p className="text-[10px] uppercase tracking-wide font-semibold">Target Pace</p>
            <p className="text-xl font-bold mt-1 leading-none">{getPrimaryPaceRange()}/km</p>
            <p className="text-[11px] mt-1.5 opacity-80">Ideal: {getIdealPaceRange()}/km</p>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-200/80 dark:border-slate-700/90 overflow-hidden bg-white/65 dark:bg-slate-900/70">
          <button
            type="button"
            onClick={() => setDetailsOpen((prev) => !prev)}
            className="w-full px-4 py-3 bg-slate-50/85 dark:bg-slate-800/85 text-left text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100/90 dark:hover:bg-slate-700/85 transition-colors"
          >
            Session details {detailsOpen ? '−' : '+'}
          </button>

          {detailsOpen && (
            <div className="p-4 space-y-4 bg-white dark:bg-slate-900">
              {currentSession.description ? (
                <div className="text-xs text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3">
                  {currentSession.description}
                </div>
              ) : null}

              {isEasy && (
                <div className="flex items-end justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-slate-500 font-semibold uppercase">Easy distance (km)</span>
                    <input
                      type="number"
                      value={currentSession.distance}
                      min={0}
                      step={1}
                      onChange={(e) => updateEasyDistance(Number(e.target.value))}
                      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100 w-28"
                    />
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-300">Subthreshold {thresholdPace}/km</div>
                </div>
              )}

              {isThreshold && (currentSession.intervals?.length || 0) > 0 && (
                <div className="space-y-3">
                  {currentSession.intervals!.map((int, i) => (
                    <div key={i} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] text-slate-500 font-semibold uppercase">Distance</span>
                        <select
                          value={int.distance}
                          onChange={(e) => updateInterval(i, 'distance', e.target.value)}
                          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100"
                        >
                          {[400, 600, 800, 1000, 1200, 1600, 2000, 3000, 5000].map((d) => (
                            <option key={d} value={d}>{d}m</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] text-slate-500 font-semibold uppercase">Reps</span>
                        <input
                          type="number"
                          value={int.count}
                          min={1}
                          step={1}
                          onChange={(e) => updateInterval(i, 'count', e.target.value)}
                          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] text-slate-500 font-semibold uppercase">Rest</span>
                        <select
                          value={int.rest}
                          onChange={(e) => updateInterval(i, 'rest', e.target.value)}
                          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100"
                        >
                          {['30s', '45s', '60s', '90s', '120s', '180s'].map(r => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] text-slate-500 font-semibold uppercase">Target</span>
                        <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-sm font-bold text-slate-800 dark:text-slate-100">
                          {getIntervalPaceRange(profile, Number(int.distance), paceCorrectionSec).range}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {isLongRun && hasVariants && (
                <div className="flex items-end justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-slate-500 font-semibold uppercase">Long run type</span>
                    <select
                      value={selectedVariantId}
                      onChange={(e) => selectLongRunVariant(e.target.value)}
                      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100 w-64"
                    >
                      {variants!.map(v => (
                        <option key={v.id} value={v.id}>{v.title}</option>
                      ))}
                    </select>
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-300">Variant updates session details</div>
                </div>
              )}

              {(currentSession.intervals?.length || 0) > 0 && !isEasy && (
                <div className="space-y-2 pt-1">
                  {currentSession.warmup ? (
                    <div className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-xl p-2.5">
                      <span className="font-semibold">Warmup:</span> {currentSession.warmup}
                    </div>
                  ) : null}
                  {currentSession.intervals!.map((int, idx) => (
                    <div key={idx} className="text-xs text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-2.5">
                      <span className="font-semibold">{int.count} × {int.distance}m</span>
                      <span className="mx-2 text-slate-400">·</span>
                      <span>{getIntervalDisplayPace(Number(int.distance), int.pace)}/km</span>
                      <span className="mx-2 text-slate-400">·</span>
                      <span>Rest {int.rest}</span>
                    </div>
                  ))}
                  {currentSession.cooldown ? (
                    <div className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-xl p-2.5">
                      <span className="font-semibold">Cooldown:</span> {currentSession.cooldown}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </div>
      </div>}
    </article>
  );
};

export default WorkoutCard;
