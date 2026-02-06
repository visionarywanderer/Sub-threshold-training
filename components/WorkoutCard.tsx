import React, { useEffect, useMemo, useState } from 'react';
import { WorkoutSession, WorkoutType, UserProfile } from '../types';
import { getIntervalPaceRange, secondsToTime, calculateThresholdPace, calculatePaceForDistance } from '../utils/calculations';

interface WorkoutCardProps {
  session: WorkoutSession;
  profile: UserProfile;
  onUpdateSession: (session: WorkoutSession) => void;
  onSync: (session: WorkoutSession) => void;
  isSynced?: boolean;
}

const WorkoutCard: React.FC<WorkoutCardProps> = ({
  session: initialSession,
  profile,
  onUpdateSession,
  onSync,
  isSynced,
}) => {
  const [currentSession, setCurrentSession] = useState<WorkoutSession>(initialSession);

  useEffect(() => {
    setCurrentSession(initialSession);
  }, [initialSession]);

  const isEasy = currentSession.type === WorkoutType.EASY;
  const isLongRun = currentSession.type === WorkoutType.LONG_RUN;
  const isThreshold = currentSession.type === WorkoutType.THRESHOLD;

  // ---------- helpers ----------
  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

  const recalcDerived = (session: WorkoutSession): WorkoutSession => {
    // Recompute distance + duration where safe. Keep plan structure intact.
    if (session.type === WorkoutType.EASY) {
      // easy duration based on easy pace derived from threshold pace
      const tPace = calculateThresholdPace(profile.raceDistance, profile.raceTime, profile as any);
      const easyPace = tPace * 1.25;
      return {
        ...session,
        duration: Math.round(session.distance * (easyPace / 60)),
        description: session.description || `Target Pace: ${secondsToTime(easyPace)}-${secondsToTime(easyPace + 30)}/km`,
      };
    }

    if (session.type === WorkoutType.THRESHOLD) {
      // Update interval pace strings based on current interval distance
      const newIntervals = (session.intervals || []).map((int) => {
        const dist = Number(int.distance) || 0;
        const paceData = getIntervalPaceRange(profile, dist);
        return {
          ...int,
          distance: dist,
          pace: paceData.range,
          description: paceData.effort,
        };
      });

      // Update total session distance if we can infer it from warmup/cooldown strings
      // We do not parse warmup/cooldown here to avoid changing other logic.
      // Keep existing session.distance unless you already update it elsewhere.
      return { ...session, intervals: newIntervals };
    }

    if (session.type === WorkoutType.LONG_RUN) {
      // Long run variants already have interval blocks. Keep as-is to avoid plan changes.
      return session;
    }

    return session;
  };

  const pushUpdate = (next: WorkoutSession) => {
    setCurrentSession(next);
    onUpdateSession(next);
  };

  // ---------- Interval editor ----------
  const updateInterval = (index: number, field: 'distance' | 'count' | 'rest', value: any) => {
    setCurrentSession((prev) => {
      const prevIntervals = prev.intervals || [];
      const nextIntervals = [...prevIntervals];

      const current = nextIntervals[index] || { distance: 1000, count: 10, rest: '60s', pace: '', description: '' };

      const updated = {
        ...current,
        [field]: field === 'distance' || field === 'count' ? Number(value) : value,
      };

      // Clamp reps based on distance band (keeps within your requested constraints)
      if (field === 'distance') {
        const d = Number(updated.distance);

        // default rep ranges, consistent with your earlier rules
        if (d <= 1000) updated.count = clamp(Number(updated.count) || 10, 8, 20);
        else if (d === 2000) updated.count = clamp(Number(updated.count) || 5, 4, 6);
        else if (d >= 3000) updated.count = clamp(Number(updated.count) || 3, 2, 4);
      }

      if (field === 'count') {
        const d = Number(updated.distance);
        if (d <= 1000) updated.count = clamp(Number(updated.count) || 10, 8, 20);
        else if (d === 2000) updated.count = clamp(Number(updated.count) || 5, 4, 6);
        else if (d >= 3000) updated.count = clamp(Number(updated.count) || 3, 2, 4);
      }

      // Recalculate pace when distance changes (the key missing piece)
      if (field === 'distance') {
        const paceData = getIntervalPaceRange(profile, Number(updated.distance));
        updated.pace = paceData.range;
        updated.description = paceData.effort;
      }

      nextIntervals[index] = updated;

      const nextSession: WorkoutSession = recalcDerived({
        ...prev,
        intervals: nextIntervals,
      });

      onUpdateSession(nextSession);
      return nextSession;
    });
  };

  // ---------- Easy editor ----------
  const updateEasyDistance = (distance: number) => {
    const next = recalcDerived({ ...currentSession, distance: Math.max(0, distance) });
    pushUpdate(next);
  };

  // ---------- Long run variant selector ----------
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
    // Keep sync metadata if present, but otherwise replace session content with selected variant.
    const next: WorkoutSession = {
      ...v,
      // preserve any sync fields that may exist on the session object
      ...(currentSession as any).icuEventId ? { ...(currentSession as any) } : {},
    } as any;
    pushUpdate(next);
  };

  // ---------- Header pace display (optional, but helps confirm profile is wired) ----------
  const thresholdPace = useMemo(() => {
    const p = calculateThresholdPace(profile.raceDistance, profile.raceTime, profile as any);
    return p > 0 ? secondsToTime(p) : '0:00';
  }, [profile]);

  const marathonPace = useMemo(() => {
    const mp = calculatePaceForDistance(profile.raceDistance, profile.raceTime, 42195);
    return mp > 0 ? secondsToTime(mp) : '0:00';
  }, [profile]);

  // ---------- UI ----------
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-extrabold text-slate-900">{currentSession.title}</h3>
            {isSynced ? (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                Synced
              </span>
            ) : (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-50 text-slate-600 border border-slate-200">
                Not synced
              </span>
            )}
          </div>

          <div className="text-xs text-slate-600 mt-1">
            <span className="font-bold">Distance:</span> {currentSession.distance} km
            {typeof currentSession.duration === 'number' ? (
              <>
                <span className="mx-2">·</span>
                <span className="font-bold">Est:</span> {currentSession.duration} min
              </>
            ) : null}
          </div>

          <div className="text-[11px] text-slate-500 mt-1">
            Threshold: <span className="font-bold text-slate-700">{thresholdPace}/km</span>
            <span className="mx-2">·</span>
            MP: <span className="font-bold text-slate-700">{marathonPace}/km</span>
          </div>
        </div>

        <button
          onClick={() => onSync(currentSession)}
          className="px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-extrabold hover:bg-slate-800"
        >
          Sync
        </button>
      </div>

      {currentSession.description ? (
        <div className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-xl p-3">
          {currentSession.description}
        </div>
      ) : null}

      {/* EASY RUN EDITOR */}
      {isEasy && (
        <div className="flex items-end justify-between gap-3 border-t border-slate-100 pt-3">
          <div className="flex flex-col gap-1">
            <span className="text-[9px] text-slate-400 font-bold uppercase">Easy distance (km)</span>
            <input
              type="number"
              value={currentSession.distance}
              min={0}
              step={1}
              onChange={(e) => updateEasyDistance(Number(e.target.value))}
              className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold w-28"
            />
          </div>

          <div className="text-xs text-slate-600">
            Pace target in description above.
          </div>
        </div>
      )}

      {/* THRESHOLD / INTERVAL EDITOR */}
      {isThreshold && (currentSession.intervals?.length || 0) > 0 && (
        <div className="border-t border-slate-100 pt-3 flex flex-col gap-3">
          <div className="text-[11px] font-extrabold text-slate-800">Intervals</div>

          {currentSession.intervals!.map((int, i) => (
            <div key={i} className="grid grid-cols-4 gap-3 items-end">
              <div className="flex flex-col gap-1">
                <span className="text-[9px] text-slate-400 font-bold uppercase">Distance</span>
                <select
                  value={int.distance}
                  onChange={(e) => updateInterval(i, 'distance', e.target.value)}
                  className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold w-full"
                >
                  {[400, 600, 800, 1000, 1200, 1600, 2000, 3000, 5000].map((d) => (
                    <option key={d} value={d}>{d}m</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-[9px] text-slate-400 font-bold uppercase">Reps</span>
                <input
                  type="number"
                  value={int.count}
                  min={1}
                  step={1}
                  onChange={(e) => updateInterval(i, 'count', e.target.value)}
                  className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold w-full"
                />
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-[9px] text-slate-400 font-bold uppercase">Rest</span>
                <select
                  value={int.rest}
                  onChange={(e) => updateInterval(i, 'rest', e.target.value)}
                  className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold w-full"
                >
                  {['30s', '45s', '60s', '90s', '120s', '180s'].map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-[9px] text-slate-400 font-bold uppercase">Target pace</span>
                <div className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-extrabold text-slate-800 w-full">
                  {int.pace || getIntervalPaceRange(profile, Number(int.distance)).range}
                </div>
              </div>

              <div className="col-span-4 text-[11px] text-slate-600">
                {int.description || getIntervalPaceRange(profile, Number(int.distance)).effort}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* LONG RUN VARIANTS */}
      {isLongRun && hasVariants && (
        <div className="border-t border-slate-100 pt-3 flex items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-[9px] text-slate-400 font-bold uppercase">Long run type</span>
            <select
              value={selectedVariantId}
              onChange={(e) => selectLongRunVariant(e.target.value)}
              className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold w-60"
            >
              {variants!.map(v => (
                <option key={v.id} value={v.id}>{v.title}</option>
              ))}
            </select>
          </div>

          <div className="text-xs text-slate-600">
            Variant changes update the session details.
          </div>
        </div>
      )}

      {/* WORKOUT DETAILS (interval blocks) */}
      {(currentSession.intervals?.length || 0) > 0 && !isEasy && (
        <div className="border-t border-slate-100 pt-3 flex flex-col gap-2">
          <div className="text-[11px] font-extrabold text-slate-800">Session structure</div>
          <div className="flex flex-col gap-2">
            {currentSession.warmup && !isEasy && (
              <div className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-xl p-2">
                <span className="font-extrabold">Warmup:</span> {currentSession.warmup}
              </div>
            )}

            {currentSession.intervals!.map((int, idx) => (
              <div key={idx} className="text-xs text-slate-700 bg-white border border-slate-200 rounded-xl p-2">
                <div className="font-extrabold">
                  {int.count} × {int.distance}m
                  <span className="mx-2 text-slate-400">·</span>
                  <span className="text-slate-800">{int.pace}</span>
                  <span className="mx-2 text-slate-400">·</span>
                  <span className="text-slate-700">Rest {int.rest}</span>
                </div>
                {int.description ? (
                  <div className="text-[11px] text-slate-600 mt-1">{int.description}</div>
                ) : null}
              </div>
            ))}

            {currentSession.cooldown && !isEasy && (
              <div className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-xl p-2">
                <span className="font-extrabold">Cooldown:</span> {currentSession.cooldown}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkoutCard;
