import React, { useState, useEffect } from 'react';
import { WorkoutSession, WorkoutType, UserProfile } from '../types';
import { Calendar, CheckCircle, Minus, Plus, Timer, Clock } from 'lucide-react';
import { getIntervalPaceRange, calculateThresholdPace } from '../utils/calculations';

interface WorkoutCardProps {
  session: WorkoutSession;
  onSync: (id: string) => void;
  isSynced: boolean;
  profile: UserProfile;
  onUpdateSession: (updated: WorkoutSession) => void;
}

const INTERVAL_DISTANCES = [400, 600, 800, 1000, 1200, 1600, 2000, 3000, 5000];
const REST_OPTIONS = ["30s", "45s", "60s", "75s", "90s", "2:00", "2:30", "3:00"];

const WorkoutCard: React.FC<WorkoutCardProps> = ({ session: initialSession, onSync, isSynced, profile, onUpdateSession }) => {
  const [currentSession, setCurrentSession] = useState(initialSession);
  const [reps, setReps] = useState(0);
  const [dist, setDist] = useState(0);
  const [rest, setRest] = useState("");

  useEffect(() => {
    setCurrentSession(initialSession);
    if(initialSession.intervals && initialSession.intervals.length > 0) {
        setReps(initialSession.intervals[0].count);
        setDist(initialSession.intervals[0].distance);
        setRest(initialSession.intervals[0].rest);
    }
  }, [initialSession]);

  const handleVariantChange = (variant: WorkoutSession) => {
    onUpdateSession({ ...variant, variants: currentSession.variants });
  };

  const updateIntervals = (newReps: number, newDist: number, newRest: string) => {
    if (!currentSession.intervals || currentSession.intervals.length === 0) return;
    const paceData = getIntervalPaceRange(profile, newDist);
    const newTotalDist = Math.round(((newReps * newDist / 1000) + profile.warmupDist + profile.cooldownDist) * 10) / 10;
    
    const updatedIntervals = [{
        ...currentSession.intervals[0],
        count: newReps,
        distance: newDist,
        pace: paceData.range,
        description: paceData.effort,
        rest: newRest
    }];

    onUpdateSession({
        ...currentSession,
        intervals: updatedIntervals,
        distance: newTotalDist
    });
  };

  const handleEasyDistChange = (change: number) => {
    const nextDist = Math.max(1, currentSession.distance + change);
    const tPace = calculateThresholdPace(profile.raceDistance, profile.raceTime);
    const easyPaceSec = tPace * 1.25;
    
    onUpdateSession({
      ...currentSession,
      distance: nextDist,
      duration: Math.round(nextDist * (easyPaceSec / 60))
    });
  };

  const handleRepsChange = (change: number) => {
    const nextReps = reps + change;
    if (nextReps < 1) return;
    setReps(nextReps);
    updateIntervals(nextReps, dist, rest);
  };

  const handleDistChange = (newDist: number) => {
    setDist(newDist);
    updateIntervals(reps, newDist, rest);
  };

  const handleRestChange = (newRest: string) => {
    setRest(newRest);
    updateIntervals(reps, dist, newRest);
  };

  const isSubT = currentSession.type === WorkoutType.THRESHOLD;
  const isLR = currentSession.type === WorkoutType.LONG_RUN;
  const isEasy = currentSession.type === WorkoutType.EASY;

  return (
    <div className={`relative p-6 rounded-xl border border-slate-100 bg-white mb-6 transition-all hover:shadow-sm ${isSubT ? 'border-l-4 border-l-norway-red' : isLR ? 'border-l-4 border-l-norway-blue' : isEasy ? 'border-l-4 border-l-green-500' : ''}`}>
      <div className="flex justify-between items-start mb-6">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-bold text-slate-900 text-lg leading-tight">{currentSession.title}</h3>
            {isLR && currentSession.variants && (
              <div className="flex gap-1 ml-2">
                {currentSession.variants.map((v, i) => (
                  <button 
                    key={i}
                    onClick={() => handleVariantChange(v)}
                    className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase transition-all ${v.id === currentSession.id ? 'bg-norway-blue text-white' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}
                  >
                    {v.title.split(' ')[0]}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="text-sm font-semibold text-slate-900">{currentSession.distance}km</div>
      </div>

      <div className="space-y-6">
        {!isEasy && currentSession.warmup && (
          <div className="space-y-1">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Warm-up</h4>
            <p className="text-sm text-slate-700">{currentSession.warmup}</p>
          </div>
        )}

        <div className="space-y-4">
          {isSubT ? (
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Sub-t block</h4>
              <div className="space-y-1">
                <p className="text-sm text-slate-800 font-medium">
                  Repeat {reps}×{dist < 1000 ? `${dist}m` : `${dist/1000}km`} @{currentSession.intervals?.[0]?.description} effort
                </p>
                <p className="text-sm text-slate-600">Target pace: {currentSession.intervals?.[0]?.pace}/km</p>
              </div>

              <div className="grid grid-cols-3 gap-4 pt-4 border-t border-slate-100">
                 <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Distance</span>
                    <select 
                        value={dist} 
                        onChange={(e) => handleDistChange(parseInt(e.target.value))}
                        className="bg-slate-50 border border-slate-200 rounded-md py-1 px-2 text-xs font-bold text-slate-700 outline-none"
                    >
                        {INTERVAL_DISTANCES.map(d => <option key={d} value={d}>{d < 1000 ? `${d}m` : `${d/1000}km`}</option>)}
                    </select>
                 </div>
                 <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Reps</span>
                    <div className="flex items-center bg-slate-50 border border-slate-200 rounded-md py-1 px-1">
                        <button onClick={() => handleRepsChange(-1)} className="p-0.5 hover:bg-white rounded text-slate-500"><Minus size={12}/></button>
                        <span className="px-2 font-mono font-bold text-slate-700 text-xs">{reps}</span>
                        <button onClick={() => handleRepsChange(1)} className="p-0.5 hover:bg-white rounded text-slate-500"><Plus size={12}/></button>
                    </div>
                 </div>
                 <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Rest</span>
                    <select 
                        value={rest} 
                        onChange={(e) => handleRestChange(e.target.value)}
                        className="bg-slate-50 border border-slate-200 rounded-md py-1 px-2 text-xs font-bold text-slate-700 outline-none"
                    >
                        {REST_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                 </div>
              </div>
            </div>
          ) : isEasy ? (
            <div className="space-y-4">
              <div className="space-y-1">
                <p className="text-sm text-slate-700">{currentSession.description}</p>
                <p className="text-xs text-slate-400 font-medium">Estimated duration: {currentSession.duration} mins</p>
              </div>
              <div className="flex items-center gap-4 p-3 bg-slate-50 rounded-lg border border-slate-100">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Adjust Distance</span>
                <div className="flex items-center bg-white border border-slate-200 rounded-md py-1 px-2">
                    <button onClick={() => handleEasyDistChange(-1)} className="p-1 hover:bg-slate-50 rounded text-slate-500"><Minus size={14}/></button>
                    <span className="px-3 font-mono font-bold text-slate-700 text-sm w-12 text-center">{currentSession.distance}</span>
                    <button onClick={() => handleEasyDistChange(1)} className="p-1 hover:bg-slate-50 rounded text-slate-500"><Plus size={14}/></button>
                    <span className="ml-1 text-[10px] font-bold text-slate-400 uppercase">km</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              {currentSession.intervals && currentSession.intervals.length > 1 ? (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Progression</h4>
                  {currentSession.intervals.map((int, i) => (
                    <p key={i} className="text-sm text-slate-700">{int.distance/1000}km @{int.pace}/km ({int.description})</p>
                  ))}
                </div>
              ) : (
                <>
                  <p className="text-sm text-slate-700">{currentSession.description}</p>
                </>
              )}
            </div>
          )}
        </div>

        {!isEasy && currentSession.cooldown && (
          <div className="space-y-1">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Cooldown</h4>
            <p className="text-sm text-slate-700">{currentSession.cooldown}</p>
          </div>
        )}
      </div>

      <div className="mt-8 flex items-center justify-between pt-4 border-t border-slate-50">
        <button
          onClick={() => onSync(currentSession.id)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm border ${
            isSynced 
              ? 'bg-green-50 text-green-700 border-green-100' 
              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
          }`}
        >
          {isSynced ? <CheckCircle size={14} /> : <Calendar size={14} />}
          {isSynced ? 'Synced' : 'Schedule Day'}
        </button>
      </div>
    </div>
  );
};

export default WorkoutCard;