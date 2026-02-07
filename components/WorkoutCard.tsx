import React, { useEffect, useMemo, useState } from 'react';
import { GripVertical, RefreshCw } from 'lucide-react';
import { WorkoutSession, WorkoutType, UserProfile } from '../types';
import { applyPaceCorrection, calculatePaceForDistance, calculateThresholdPace, getEasyRunPaceRange, getIntervalPaceRange, secondsToTime } from '../utils/calculations';

interface WorkoutCardProps {
  session: WorkoutSession;
  profile: UserProfile;
  paceCorrectionSec?: number;
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

  useEffect(() => {
    setCurrentSession(initialSession);
  }, [initialSession]);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth >= 1024) {
      setDetailsOpen(true);
    }
  }, []);

  const isEasy = currentSession.type === WorkoutType.EASY;
  const isLongRun = currentSession.type === WorkoutType.LONG_RUN;
  const isThreshold = currentSession.type === WorkoutType.THRESHOLD;

  const getTone = () => {
    if (dayTypeLabel.includes('Threshold')) {
      return {
        shell: 'bg-rose-50/55 border-rose-200/70',
        chip: 'bg-rose-100 text-rose-700',
        pace: 'bg-rose-100/50 border-rose-200 text-rose-800',
      };
    }
    if (dayTypeLabel.includes('Long')) {
      return {
        shell: 'bg-indigo-50/55 border-indigo-200/70',
        chip: 'bg-indigo-100 text-indigo-700',
        pace: 'bg-indigo-100/50 border-indigo-200 text-indigo-800',
      };
    }
    return {
      shell: 'bg-emerald-50/55 border-emerald-200/70',
      chip: 'bg-emerald-100 text-emerald-700',
      pace: 'bg-emerald-100/50 border-emerald-200 text-emerald-800',
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
      return { ...session, intervals: newIntervals };
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

  return (
    <article className={`border rounded-2xl shadow-sm hover:shadow-md transition-shadow dark:bg-slate-900/90 dark:border-slate-700 ${tone.shell}`}>
      <div className="px-5 py-4 border-b border-slate-200/80 dark:border-slate-700 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">{dayLabel}</h3>
            <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${tone.chip}`}>
              {dayTypeLabel}
            </span>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{currentSession.title}</p>
        </div>

        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full border ${isSynced ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200 dark:border-emerald-800' : 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'}`}>
            {isSynced ? 'Synced' : 'Not synced'}
          </span>
          <button
            onClick={() => onSync(currentSession)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold hover:bg-slate-800 dark:hover:bg-white focus:outline-none focus:ring-2 focus:ring-slate-400"
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
        </div>
      </div>

      <div className="px-5 py-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3.5 py-3">
            <p className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">Distance</p>
            <p className="text-lg font-semibold text-slate-900 dark:text-slate-100 mt-1">{currentSession.distance} km</p>
          </div>
          <div className="rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3.5 py-3">
            <p className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">Est. Time</p>
            <p className="text-lg font-semibold text-slate-900 dark:text-slate-100 mt-1">{currentSession.duration || 0} min</p>
          </div>
          <div className={`rounded-xl border px-3.5 py-3 ${tone.pace}`}>
            <p className="text-[10px] uppercase tracking-wide font-semibold">Target Pace</p>
            <p className="text-lg font-bold mt-1">{getPrimaryPaceRange()}/km</p>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <button
            type="button"
            onClick={() => setDetailsOpen((prev) => !prev)}
            className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 text-left text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
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
                      className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm font-semibold w-28"
                    />
                  </div>
                  <div className="text-xs text-slate-500">Threshold {thresholdPace}/km</div>
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
                          className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm font-semibold"
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
                          className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm font-semibold"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] text-slate-500 font-semibold uppercase">Rest</span>
                        <select
                          value={int.rest}
                          onChange={(e) => updateInterval(i, 'rest', e.target.value)}
                          className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm font-semibold"
                        >
                          {['30s', '45s', '60s', '90s', '120s', '180s'].map(r => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] text-slate-500 font-semibold uppercase">Target</span>
                        <div className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm font-bold text-slate-800">
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
                      className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm font-semibold w-64"
                    >
                      {variants!.map(v => (
                        <option key={v.id} value={v.id}>{v.title}</option>
                      ))}
                    </select>
                  </div>
                  <div className="text-xs text-slate-500">Variant updates session details</div>
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
                    <div key={idx} className="text-xs text-slate-700 bg-white border border-slate-200 rounded-xl p-2.5">
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
      </div>
    </article>
  );
};

export default WorkoutCard;
