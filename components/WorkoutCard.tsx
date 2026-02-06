import React, { useState, useEffect } from 'react';
import { WorkoutSession, WorkoutType, UserProfile, Interval } from '../types';
import { CheckCircle, Zap, Globe, Clock, Activity, Plus, Minus, Settings2, ChevronRight } from 'lucide-react';

interface WorkoutCardProps {
  session: WorkoutSession;
  onSync: (id: string) => void;
  isSynced: boolean;
  profile: UserProfile;
  onUpdateSession: (updated: WorkoutSession) => void;
}

const WorkoutCard: React.FC<WorkoutCardProps> = ({ session: initialSession, onSync, isSynced, onUpdateSession }) => {
  const [currentSession, setCurrentSession] = useState(initialSession);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    setCurrentSession(initialSession);
  }, [initialSession]);

  const isSubT = currentSession.type === WorkoutType.THRESHOLD;
  const isEasy = currentSession.type === WorkoutType.EASY;
  const isLongRun = currentSession.type === WorkoutType.LONG_RUN;

  const updateInterval = (index: number, field: keyof Interval, value: any) => {
    if (!currentSession.intervals) return;
    const newIntervals = [...currentSession.intervals];
    newIntervals[index] = { ...newIntervals[index], [field]: value };
    
    // Recalculate total distance if it's a simple interval session
    let newDist = currentSession.distance;
    if (isSubT) {
      const intervalsDist = newIntervals.reduce((sum, int) => sum + (int.count * int.distance / 1000), 0);
      // Assuming 3km total for WU/CD if not specified, or use profile defaults
      newDist = Math.round((3 + intervalsDist) * 10) / 10;
    }

    const updated = { ...currentSession, intervals: newIntervals, distance: newDist };
    setCurrentSession(updated);
    onUpdateSession(updated);
  };

  const updateEasyDistance = (delta: number) => {
    const newDist = Math.max(1, Math.round((currentSession.distance + delta) * 10) / 10);
    const updated = { 
      ...currentSession, 
      distance: newDist,
      duration: Math.round(newDist * 5.5) // Approximate 5:30 pace for duration calc
    };
    setCurrentSession(updated);
    onUpdateSession(updated);
  };

  const handleVariantSelect = (variant: WorkoutSession) => {
    const updated = { ...variant, variants: currentSession.variants };
    setCurrentSession(updated);
    onUpdateSession(updated);
  };

  return (
    <div className={`relative p-6 rounded-xl border border-slate-100 bg-white mb-6 transition-all hover:shadow-sm ${isSubT ? 'border-l-4 border-l-norway-red' : 'border-l-4 border-l-slate-200'}`}>
      <div className="flex justify-between items-start mb-6">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Activity size={18} className={`${isSubT ? 'text-norway-red' : 'text-slate-400'}`} />
            <h3 className="font-bold text-slate-900 text-lg leading-tight">{currentSession.title}</h3>
            {isSynced && <span className="text-[8px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">Synced</span>}
          </div>
          <p className="text-xs text-slate-400 font-medium">{currentSession.type} Session</p>
        </div>
        <div className="text-right flex flex-col items-end">
          <div className="flex items-center gap-2">
            {isEasy && (
              <div className="flex items-center bg-slate-50 rounded-lg p-1 mr-2 border border-slate-100">
                <button onClick={() => updateEasyDistance(-0.5)} className="p-1 hover:bg-white rounded text-slate-400 hover:text-norway-red transition-colors"><Minus size={12}/></button>
                <span className="text-[10px] font-bold px-2 text-slate-600 w-8 text-center">{currentSession.distance}</span>
                <button onClick={() => updateEasyDistance(0.5)} className="p-1 hover:bg-white rounded text-slate-400 hover:text-norway-red transition-colors"><Plus size={12}/></button>
              </div>
            )}
            <div className="text-sm font-bold text-slate-900">{currentSession.distance}km</div>
          </div>
          <div className="text-[10px] text-slate-400 font-mono">~{currentSession.duration}m</div>
        </div>
      </div>

      {/* Editor Controls for SubT and Long Run */}
      <div className="space-y-4">
        {isLongRun && currentSession.variants && (
          <div className="flex flex-wrap gap-2 mb-4">
            {currentSession.variants.map((v) => (
              <button
                key={v.id}
                onClick={() => handleVariantSelect(v)}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase border transition-all ${currentSession.id === v.id ? 'bg-norway-blue text-white border-norway-blue' : 'bg-white text-slate-400 border-slate-100 hover:border-slate-200'}`}
              >
                {v.title.replace(' Long Run', '')}
              </button>
            ))}
          </div>
        )}

        {isSubT && (
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Interval Config</h4>
              <button onClick={() => setIsEditing(!isEditing)} className="text-slate-400 hover:text-norway-red transition-colors">
                <Settings2 size={14} />
              </button>
            </div>
            {currentSession.intervals?.map((int, i) => (
              <div key={i} className="flex flex-col gap-3">
                <div className="flex items-center gap-4">
                  <div className="flex-1 flex flex-col gap-1">
                    <span className="text-[9px] text-slate-400 font-bold uppercase">Reps</span>
                    <input 
                      type="number" 
                      value={int.count} 
                      onChange={(e) => updateInterval(i, 'count', parseInt(e.target.value) || 1)}
                      className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold w-full"
                    />
                  </div>
                  <div className="flex-1 flex flex-col gap-1">
                    <span className="text-[9px] text-slate-400 font-bold uppercase">Dist (m)</span>
                    <select 
                      value={int.distance} 
                      onChange={(e) => updateInterval(i, 'distance', parseInt(e.target.value))}
                      className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold w-full"
                    >
                      {[400, 600, 800, 1000, 1200, 1600, 2000, 3000].map(d => <option key={d} value={d}>{d}m</option>)}
                    </select>
                  </div>
                  <div className="flex-1 flex flex-col gap-1">
                    <span className="text-[9px] text-slate-400 font-bold uppercase">Rest</span>
                    <select 
                      value={int.rest} 
                      onChange={(e) => updateInterval(i, 'rest', e.target.value)}
                      className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold w-full"
                    >
                      {['30s', '45s', '60s', '90s', '2m'].map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-2">
          <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Session Details</h4>
          {currentSession.intervals?.map((int, i) => (
            <div key={i} className="flex items-center justify-between group">
              <p className="text-sm text-slate-800 font-bold flex items-center gap-2">
                <ChevronRight size={14} className="text-norway-red" />
                {int.count}x {int.distance >= 1000 ? `${int.distance/1000}km` : `${int.distance}m`} @ {int.pace}/km
              </p>
              {int.rest !== '0' && <span className="text-[10px] font-mono text-slate-400">Rest: {int.rest}</span>}
            </div>
          ))}
          {!currentSession.intervals?.length && <p className="text-sm text-slate-600 leading-relaxed">{currentSession.description}</p>}
        </div>

        {(currentSession.warmup || currentSession.cooldown) && (
          <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-50">
            {currentSession.warmup && (
              <div>
                <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Warm-up</h4>
                <p className="text-xs text-slate-500">{currentSession.warmup}</p>
              </div>
            )}
            {currentSession.cooldown && (
              <div>
                <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Cooldown</h4>
                <p className="text-xs text-slate-500">{currentSession.cooldown}</p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-8 flex items-center justify-between pt-4 border-t border-slate-50">
        <button
          onClick={() => onSync(currentSession.id)}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition-all border ${isSynced ? 'bg-green-50 text-green-700 border-green-200' : 'bg-slate-900 text-white border-slate-900 hover:bg-black'}`}
        >
          {isSynced ? <CheckCircle size={14} /> : <Globe size={14} />}
          {isSynced ? 'Updated in ICU' : 'Sync to Intervals.icu'}
        </button>
        <div className="flex items-center gap-2 text-[10px] font-bold text-slate-300 uppercase">
           <Clock size={12}/> {currentSession.duration}m
        </div>
      </div>
    </div>
  );
};

export default WorkoutCard;