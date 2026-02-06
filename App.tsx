import React, { useState, useEffect, useCallback } from 'react';
import { UserProfile, DistanceUnit, WeeklyPlan, DayType, UserSchedule, IntervalsIcuConfig } from './types';
import { generatePlan, calculateThresholdPace, secondsToTime } from './utils/calculations';
import { syncWorkoutToIcu } from './services/intervalsService';
import WorkoutCard from './components/WorkoutCard';
import PacingTable from './components/PacingTable';
import IntervalsModal from './components/IntervalsModal';
import { ChevronUp, ChevronDown, MoreHorizontal, PlayCircle, LogOut, Check, Globe, RefreshCw } from 'lucide-react';

declare global {
  interface Window {
    google: any;
  }
}

const RUN_STORAGE_KEY = 'norskflow_run_profile';
const ICU_CONFIG_KEY = 'norskflow_icu_config';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID as string | undefined;
const FIVE_K_DISTANCE = 5000;

const formatLocalDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const DEFAULT_RUN_SCHEDULE: UserSchedule = {
  'Monday': DayType.EASY, 'Tuesday': DayType.THRESHOLD, 'Wednesday': DayType.EASY,
  'Thursday': DayType.THRESHOLD, 'Friday': DayType.EASY, 'Saturday': DayType.REST, 'Sunday': DayType.THRESHOLD
};

const DEFAULT_RUN_PROFILE: UserProfile = {
  name: "Guest Runner", raceDistance: FIVE_K_DISTANCE, raceTime: "19:07", maxHR: 190, weeklyVolume: 80,
  unit: DistanceUnit.KM, schedule: DEFAULT_RUN_SCHEDULE, warmupDist: 2.0, cooldownDist: 1.0
};

const normalizeTo5kProfile = (profile: UserProfile): UserProfile => ({
  ...profile,
  raceDistance: FIVE_K_DISTANCE,
});

const App: React.FC = () => {
  const [profile, setProfile] = useState<UserProfile>(DEFAULT_RUN_PROFILE);
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [activeTab, setActiveTab] = useState<'plan' | 'pacing' | 'settings'>('plan'); 
  const [showIntervalsModal, setShowIntervalsModal] = useState(false);
  const [intervalsConfig, setIntervalsConfig] = useState<IntervalsIcuConfig>({ athleteId: '', apiKey: '', connected: false });
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'error' | 'success'>('idle');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + (1 - d.getDay() + 7) % 7); // Next Monday
    return formatLocalDate(d);
  });

  // Load configs on mount
  useEffect(() => {
    const savedIcu = localStorage.getItem(ICU_CONFIG_KEY);
    if (savedIcu) setIntervalsConfig(JSON.parse(savedIcu));

    const savedProfile = localStorage.getItem(RUN_STORAGE_KEY);
    if (savedProfile) {
      const parsed = normalizeTo5kProfile(JSON.parse(savedProfile));
      setProfile(parsed);
      setIsAuthenticated(!!parsed.uid);
      setPlan(generatePlan(parsed));
    } else {
      setPlan(generatePlan(DEFAULT_RUN_PROFILE));
    }
  }, []);

  const handleCredentialResponse = useCallback((response: any) => {
    const userData = JSON.parse(atob(response.credential.split('.')[1]));
    if (userData) {
      setProfile(prev => {
        const newProfile = normalizeTo5kProfile({ ...prev, uid: userData.sub, email: userData.email, name: userData.name });
        localStorage.setItem(RUN_STORAGE_KEY, JSON.stringify(newProfile));
        setPlan(generatePlan(newProfile));
        return newProfile;
      });
      setIsAuthenticated(true);
    }
  }, []);

  useEffect(() => {
    const initGoogle = () => {
      if (!GOOGLE_CLIENT_ID) return;
      if (typeof window.google !== 'undefined' && window.google.accounts) {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleCredentialResponse,
          auto_select: false,
          cancel_on_tap_outside: true,
          use_fedcm_for_prompt: false, 
        });
        const btnContainer = document.getElementById('google-login-btn');
        if (btnContainer && !isAuthenticated) {
          window.google.accounts.id.renderButton(btnContainer, { theme: 'outline', size: 'large', shape: 'pill', width: 200 });
        }
      }
    };
    const interval = setInterval(initGoogle, 500);
    return () => clearInterval(interval);
  }, [handleCredentialResponse, isAuthenticated]);

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setProfile(prev => ({
      ...prev,
      [name]: parseFloat(value) || 0
    }));
  };

  const handleLogout = () => {
    localStorage.removeItem(RUN_STORAGE_KEY);
    setIsAuthenticated(false);
    setProfile(DEFAULT_RUN_PROFILE);
    if (window.google) window.google.accounts.id.disableAutoSelect();
  };

  const handleGeneratePlan = () => {
    const normalized = normalizeTo5kProfile(profile);
    const newPlan = generatePlan(normalized);
    setProfile(normalized);
    setPlan(newPlan);
    setActiveTab('plan');
    localStorage.setItem(RUN_STORAGE_KEY, JSON.stringify(normalized));
  };

  const handleSyncEntireWeekToIcu = async () => {
    if (!plan || !intervalsConfig.connected) return;
    setSyncStatus('syncing');
    
    try {
      const newDays = [...plan.days];
      for (let i = 0; i < newDays.length; i++) {
        const day = newDays[i];
        if (day.session) {
          const targetDate = new Date(startDate);
          targetDate.setDate(targetDate.getDate() + i);
          const dateStr = formatLocalDate(targetDate);
          
          const eventId = await syncWorkoutToIcu(intervalsConfig, day.session, dateStr);
          if (eventId) {
            newDays[i] = { ...day, session: { ...day.session, icuEventId: eventId } };
          }
        }
      }
      setPlan({ ...plan, days: newDays });
      setSyncStatus('success');
      setTimeout(() => setSyncStatus('idle'), 3000);
    } catch (e) {
      setSyncStatus('error');
    }
  };

  const moveSession = async (index: number, direction: 'up' | 'down') => {
    if (!plan) return;
    const newDays = [...plan.days];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newDays.length) return;

    // Swap content
    const tempType = newDays[index].type;
    const tempSession = newDays[index].session;
    newDays[index].type = newDays[targetIndex].type;
    newDays[index].session = newDays[targetIndex].session;
    newDays[targetIndex].type = tempType;
    newDays[targetIndex].session = tempSession;

    setPlan({ ...plan, days: newDays });

    if (intervalsConfig.connected && (newDays[index].session?.icuEventId || newDays[targetIndex].session?.icuEventId)) {
        handleSyncEntireWeekToIcu();
    }
  };

  // Logic updated to pass profile for new threshold pacing
  const currentThreshold = calculateThresholdPace(profile.raceDistance, profile.raceTime, profile);

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-slate-900 font-sans pb-20">
      <header className="bg-white border-b border-slate-100 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-6 bg-slate-800 rounded flex items-center justify-center relative shadow-sm">
               <div className="absolute left-0 top-0 bottom-0 w-1/3 bg-norway-red rounded-l"></div>
            </div>
            <h1 className="font-bold text-xl tracking-tight text-norway-blue">Threshold Works</h1>
          </div>
          
          <div className="flex items-center gap-4">
             {isAuthenticated ? (
               <div className="flex items-center gap-3 bg-slate-50 p-1 pl-4 rounded-full border border-slate-100">
                  <div className="hidden md:block">
                    <p className="text-[10px] font-bold text-slate-900 uppercase leading-none">{profile.name}</p>
                    <p className="text-[9px] text-slate-400 leading-none">{profile.email}</p>
                  </div>
                  <button onClick={handleLogout} className="w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-400 hover:text-norway-red transition-colors shadow-sm">
                    <LogOut size={14} />
                  </button>
               </div>
             ) : GOOGLE_CLIENT_ID ? (
               <div id="google-login-btn"></div>
             ) : (
               <span className="text-xs text-slate-400">Set GOOGLE_CLIENT_ID to enable sign-in</span>
             )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10">
        <section className="mb-12">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6 mb-10">
                <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Benchmark</p>
                    <p className="text-2xl font-bold text-slate-900">{profile.raceTime} (5K)</p>
                </div>
                <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">SubT Pace</p>
                    <p className="text-2xl font-bold text-slate-900">{secondsToTime(currentThreshold)}</p>
                </div>
                <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Week Target</p>
                    <p className="text-2xl font-bold text-slate-900">{profile.weeklyVolume}km</p>
                </div>
                <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Plan Volume</p>
                    <p className="text-2xl font-bold text-slate-900">{plan?.totalDistance || 0}km</p>
                </div>
            </div>
            
            <div className="flex items-center justify-between mb-8">
              <nav className="flex gap-2 bg-slate-100 p-1 rounded-xl">
                 <button onClick={() => setActiveTab('plan')} className={`px-5 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'plan' ? 'bg-white shadow-sm text-norway-blue' : 'text-slate-500 hover:text-slate-700'}`}>Weekly Plan</button>
                 <button onClick={() => setActiveTab('pacing')} className={`px-5 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'pacing' ? 'bg-white shadow-sm text-norway-blue' : 'text-slate-500 hover:text-slate-700'}`}>Pacing Table</button>
              </nav>
              <div className="flex gap-2">
                 {intervalsConfig.connected && (
                   <div className="flex items-center gap-3 bg-white border border-slate-200 px-4 py-1.5 rounded-xl shadow-sm">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Starts:</span>
                      <input 
                        type="date" 
                        value={startDate} 
                        onChange={(e) => setStartDate(e.target.value)} 
                        className="text-xs font-bold text-slate-700 outline-none"
                      />
                      <button 
                        onClick={handleSyncEntireWeekToIcu}
                        disabled={syncStatus === 'syncing'}
                        className={`flex items-center gap-2 text-xs font-bold transition-all ${syncStatus === 'syncing' ? 'text-slate-300' : 'text-norway-red hover:text-red-700'}`}
                      >
                        {syncStatus === 'syncing' ? <RefreshCw className="animate-spin" size={14} /> : syncStatus === 'success' ? <Check size={14} /> : <Globe size={14} />}
                        {syncStatus === 'syncing' ? 'Syncing...' : syncStatus === 'success' ? 'Synced!' : 'Sync Week'}
                      </button>
                   </div>
                 )}
                 <button onClick={() => setActiveTab('settings')} className="p-3 bg-white border border-slate-200 rounded-xl text-slate-500 hover:text-norway-blue hover:border-norway-blue transition-all shadow-sm">
                   <MoreHorizontal size={20}/>
                 </button>
              </div>
            </div>

            {activeTab === 'plan' && plan && (
              <div className="animate-in fade-in slide-in-from-bottom-2 space-y-1">
                {plan.days.map((day, idx) => (
                    <div key={day.day} className="relative group">
                        <div className="flex items-center justify-between mb-2 pt-8">
                            <div className="flex items-center gap-4">
                                <h3 className="text-lg font-bold text-slate-900 tracking-tight">{day.day}</h3>
                                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${day.type.includes('Threshold') ? 'bg-norway-red/10 text-norway-red' : 'bg-slate-100 text-slate-400'}`}>
                                    {day.type}
                                </span>
                            </div>
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => moveSession(idx, 'up')} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"><ChevronUp size={16}/></button>
                                <button onClick={() => moveSession(idx, 'down')} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"><ChevronDown size={16}/></button>
                            </div>
                        </div>
                        {day.session ? (
                            <WorkoutCard 
                                session={{...day.session}} 
                                isSynced={!!day.session.icuEventId}
                                onSync={async (id) => {
                                    if(!intervalsConfig.connected) {
                                        setShowIntervalsModal(true);
                                        return;
                                    }
                                    const targetDate = new Date(startDate);
                                    targetDate.setDate(targetDate.getDate() + idx);
                                    const newEventId = await syncWorkoutToIcu(intervalsConfig, day.session!, formatLocalDate(targetDate));
                                    if(newEventId) {
                                        const newDays = [...plan.days];
                                        newDays[idx].session = { ...day.session!, icuEventId: newEventId };
                                        setPlan({ ...plan, days: newDays });
                                    }
                                }} 
                                profile={profile}
                                onUpdateSession={(updated) => {
                                  const newDays = [...plan.days];
                                  newDays[idx].session = updated;
                                  setPlan({ ...plan, days: newDays });
                                }}
                            />
                        ) : (
                          <div className="p-8 bg-white border border-slate-100 rounded-2xl mb-6 flex items-center justify-center">
                              <p className="text-slate-300 font-medium text-sm italic">Rest or Recovery</p>
                          </div>
                        )}
                    </div>
                ))}
              </div>
            )}

            {activeTab === 'pacing' && (
               <div className="animate-in fade-in slide-in-from-bottom-2">
                 <PacingTable profile={profile} />
               </div>
            )}

            {activeTab === 'settings' && (
              <div className="fixed inset-0 bg-white/98 backdrop-blur-md z-50 overflow-y-auto p-6 sm:p-10 animate-in fade-in duration-300">
                 <div className="max-w-2xl mx-auto space-y-10">
                    <div className="flex justify-between items-center sticky top-0 bg-white/10 py-4 z-10">
                        <h2 className="text-3xl font-bold text-norway-blue tracking-tight">Plan Config</h2>
                        <button onClick={() => setActiveTab('plan')} className="w-10 h-10 rounded-full hover:bg-slate-100 flex items-center justify-center border border-slate-100"><MoreHorizontal size={24}/></button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                        <div className="space-y-6">
                            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest border-b pb-2">Running Benchmark</h4>
                            <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-2 ml-1">Benchmark Distance</label>
                                <div className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-slate-800">
                                  5K (fixed)
                                </div>
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-2 ml-1">5K Time (M:S)</label>
                                <input type="text" value={profile.raceTime} onChange={(e) => setProfile(p => ({...p, raceTime: e.target.value}))} className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold" />
                            </div>
                        </div>

                        <div className="space-y-6">
                            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest border-b pb-2">Volume Settings</h4>
                            <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-2 ml-1">Weekly Target (km)</label>
                                <input type="number" name="weeklyVolume" value={profile.weeklyVolume} onChange={handleNumberChange} className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold" />
                            </div>
                            <div className="flex gap-2">
                                <div className="w-1/2">
                                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-2 ml-1">Warmup (km)</label>
                                  <input type="number" name="warmupDist" value={profile.warmupDist} onChange={handleNumberChange} className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-center" />
                                </div>
                                <div className="w-1/2">
                                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-2 ml-1">Cooldown (km)</label>
                                  <input type="number" name="cooldownDist" value={profile.cooldownDist} onChange={handleNumberChange} className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-center" />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-6 ml-1">Training Frequency</label>
                        <div className="grid grid-cols-1 gap-2">
                            {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => (
                                <div key={day} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                                    <span className="font-bold text-slate-700 text-xs w-20">{day}</span>
                                    <div className="flex gap-1 overflow-x-auto scrollbar-hide">
                                        {[DayType.REST, DayType.EASY, DayType.THRESHOLD, DayType.LONG_RUN].map(type => (
                                            <button 
                                              key={type} 
                                              onClick={() => setProfile(p => ({ ...p, schedule: { ...p.schedule, [day]: type } }))}
                                              className={`px-3 py-1.5 rounded-lg text-[9px] font-bold uppercase whitespace-nowrap border transition-all ${profile.schedule[day] === type ? 'bg-norway-blue text-white' : 'bg-white text-slate-400 border-slate-100'}`}
                                            >
                                                {type.replace('Threshold', 'SubT')}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="pt-10 flex flex-col items-center gap-6">
                        <button onClick={handleGeneratePlan} className="bg-norway-red text-white px-12 py-5 rounded-3xl font-bold text-xl hover:bg-slate-900 transition-all shadow-2xl flex items-center gap-4 w-full justify-center sm:w-auto">
                            <PlayCircle size={28} /> Update Plan
                        </button>
                        
                        <div className="flex flex-wrap gap-4 w-full justify-center">
                            <button 
                                onClick={() => setShowIntervalsModal(true)}
                                className={`flex items-center gap-3 px-8 py-4 rounded-2xl font-bold text-sm shadow-lg transition-all ${intervalsConfig.connected ? 'bg-green-600 text-white' : 'bg-slate-800 text-white hover:bg-black'}`}
                            >
                                {intervalsConfig.connected ? <Check size={18} /> : <Globe size={18} />}
                                {intervalsConfig.connected ? 'Intervals.icu Connected' : 'Connect Intervals.icu'}
                            </button>
                        </div>
                    </div>
                 </div>
              </div>
            )}
        </section>
      </main>

      <IntervalsModal 
        isOpen={showIntervalsModal} 
        onClose={() => setShowIntervalsModal(false)} 
        onConnect={(c) => {
            setIntervalsConfig(c);
            localStorage.setItem(ICU_CONFIG_KEY, JSON.stringify(c));
        }} 
      />
    </div>
  );
};

export default App;
