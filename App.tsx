
import React, { useState, useEffect, useCallback } from 'react';
import { UserProfile, DistanceUnit, WeeklyPlan, DayType, UserSchedule, DailyPlan, WorkoutSession, IntervalsIcuConfig } from './types';
import { generatePlan, calculateThresholdPace, secondsToTime } from './utils/calculations';
import { analyzePlanWithAI } from './services/geminiService';
import WorkoutCard from './components/WorkoutCard';
import PacingTable from './components/PacingTable';
import GarminModal from './components/GarminModal';
import IntervalsModal from './components/IntervalsModal';
import { Activity, Calendar, ChevronUp, ChevronDown, MoreHorizontal, PlayCircle, Layers, LogIn, User, LogOut, Check, Globe } from 'lucide-react';

// Fix for TypeScript errors regarding the global google object
declare global {
  interface Window {
    google: any;
  }
}

const STORAGE_KEY = 'norskflow_profile';
// Placeholder Client ID - Replace with your actual Google Client ID for production
const GOOGLE_CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com';

const DEFAULT_SCHEDULE: UserSchedule = {
  'Monday': DayType.EASY,
  'Tuesday': DayType.THRESHOLD,
  'Wednesday': DayType.EASY,
  'Thursday': DayType.THRESHOLD,
  'Friday': DayType.EASY,
  'Saturday': DayType.REST,
  'Sunday': DayType.THRESHOLD
};

const DEFAULT_PROFILE: UserProfile = {
  name: "Guest Runner",
  raceDistance: 5000, 
  raceTime: "19:07",
  maxHR: 190,
  weeklyVolume: 80,
  unit: DistanceUnit.KM,
  schedule: DEFAULT_SCHEDULE,
  warmupDist: 2.0,
  cooldownDist: 1.0
};

const RACE_DISTANCES = [
  { label: '1500m', value: 1500 },
  { label: '1 Mile', value: 1609 },
  { label: '3K', value: 3000 },
  { label: '5K', value: 5000 },
  { label: '10K', value: 10000 },
  { label: 'Half Marathon', value: 21097 },
  { label: 'Marathon', value: 42195 },
];

const App: React.FC = () => {
  const [profile, setProfile] = useState<UserProfile>(DEFAULT_PROFILE);
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [activeTab, setActiveTab] = useState<'plan' | 'pacing' | 'settings'>('plan'); 
  const [showGarminModal, setShowGarminModal] = useState(false);
  const [showIntervalsModal, setShowIntervalsModal] = useState(false);
  const [isGarminConnected, setIsGarminConnected] = useState(false);
  const [intervalsConfig, setIntervalsConfig] = useState<IntervalsIcuConfig>({ athleteId: '', apiKey: '', connected: false });
  const [syncedWorkouts, setSyncedWorkouts] = useState<Set<string>>(new Set());
  const [timeInput, setTimeInput] = useState({ h: '', m: '19', s: '07' });
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Helper to decode Google JWT
  const decodeJwt = (token: string) => {
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
      return JSON.parse(jsonPayload);
    } catch (e) {
      console.error("Failed to decode JWT", e);
      return null;
    }
  };

  const handleCredentialResponse = useCallback((response: any) => {
    const userData = decodeJwt(response.credential);
    if (userData) {
      setProfile(prev => {
        const newProfile: UserProfile = {
          ...prev,
          uid: userData.sub,
          email: userData.email,
          name: userData.name,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newProfile));
        // Re-generate plan with existing profile settings but new auth context
        setPlan(generatePlan(newProfile));
        return newProfile;
      });
      setIsAuthenticated(true);
    }
  }, []);

  // Initialize Google Login and Button rendering
  useEffect(() => {
    let interval: any;
    
    const initGoogle = () => {
      if (typeof window.google !== 'undefined' && window.google.accounts) {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleCredentialResponse,
          auto_select: false,
          cancel_on_tap_outside: true,
          // CRITICAL: Force false to bypass NotAllowedError for identity-credentials-get feature policy
          use_fedcm_for_prompt: false, 
        });

        const btnContainer = document.getElementById('google-login-btn');
        if (btnContainer && !isAuthenticated) {
          window.google.accounts.id.renderButton(btnContainer, {
            theme: 'outline',
            size: 'large',
            shape: 'pill',
            text: 'signin_with',
            logo_alignment: 'left',
            width: 200
          });
        }
        
        if (interval) clearInterval(interval);
      }
    };

    interval = setInterval(initGoogle, 200);
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [handleCredentialResponse, isAuthenticated]);

  // Load profile from storage on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      setProfile(parsed);
      setIsAuthenticated(!!parsed.uid);
      
      const parts = parsed.raceTime.split(':');
      if(parts.length === 3) setTimeInput({ h: parts[0], m: parts[1], s: parts[2] });
      else if (parts.length === 2) setTimeInput({ h: '', m: parts[0], s: parts[1] });
      
      setPlan(generatePlan(parsed));
    } else {
      setPlan(generatePlan(DEFAULT_PROFILE));
    }
  }, []);

  const handleLogout = () => {
    const clearedProfile = { ...DEFAULT_PROFILE, uid: undefined, email: undefined };
    localStorage.removeItem(STORAGE_KEY);
    setIsAuthenticated(false);
    setProfile(clearedProfile);
    setPlan(generatePlan(clearedProfile));
    if (window.google && window.google.accounts) {
      window.google.accounts.id.disableAutoSelect();
    }
  };

  const handleTimeChange = (field: 'h'|'m'|'s', value: string) => {
    if (value && !/^\d+$/.test(value)) return;
    const newTime = { ...timeInput, [field]: value };
    setTimeInput(newTime);
    const h = newTime.h.padStart(2, '0');
    const m = newTime.m.padStart(2, '0');
    const s = newTime.s.padStart(2, '0');
    let timeStr = `${m}:${s}`;
    if (parseInt(h) > 0) timeStr = `${h}:${m}:${s}`;
    setProfile(prev => ({ ...prev, raceTime: timeStr }));
  };

  const handleDistanceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setProfile(prev => ({ ...prev, raceDistance: parseInt(e.target.value) }));
  };

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setProfile(prev => ({ ...prev, [name]: parseFloat(value) || 0 }));
  };

  const handleDayTypeChange = (day: string, type: DayType) => {
      setProfile(prev => ({ ...prev, schedule: { ...prev.schedule, [day]: type } }));
  };

  const handleGeneratePlan = () => {
    const newPlan = generatePlan(profile);
    setPlan(newPlan);
    setSyncedWorkouts(new Set());
    setActiveTab('plan');
    if (isAuthenticated) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    }
  };

  const updateSessionInPlan = (index: number, updatedSession: WorkoutSession) => {
    if (!plan) return;
    const newDays = [...plan.days];
    newDays[index] = { ...newDays[index], session: updatedSession };
    setPlan({ ...plan, days: newDays });
    setSyncedWorkouts(prev => {
        const next = new Set(prev);
        next.delete(updatedSession.id);
        return next;
    });
  };

  const moveSession = (index: number, direction: 'up' | 'down') => {
    if (!plan) return;
    const newDays = [...plan.days];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newDays.length) return;

    const tempType = newDays[index].type;
    const tempSession = newDays[index].session;
    
    newDays[index].type = newDays[targetIndex].type;
    newDays[index].session = newDays[targetIndex].session;
    
    newDays[targetIndex].type = tempType;
    newDays[targetIndex].session = tempSession;

    setPlan({ ...plan, days: newDays });
  };

  const handleGarminSyncAll = (startDate: string) => {
    if (!plan) return;
    const allIds = plan.days.filter(d => d.session).map(d => d.session!.id);
    setSyncedWorkouts(new Set(allIds));
    setIsGarminConnected(true);
    setShowGarminModal(false);
  };

  const handleIntervalsConnect = (config: IntervalsIcuConfig) => {
    setIntervalsConfig(config);
    setShowIntervalsModal(false);
  };

  const currentThreshold = calculateThresholdPace(profile.raceDistance, profile.raceTime);

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-slate-900 font-sans pb-20">
      <header className="bg-white border-b border-slate-100 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-6 bg-slate-800 rounded flex items-center justify-center relative shadow-sm">
               <div className="absolute left-0 top-0 bottom-0 w-1/3 bg-norway-red rounded-l"></div>
            </div>
            <h1 className="font-bold text-2xl tracking-tight text-norway-blue hidden sm:block">Threshold Works</h1>
          </div>
          
          <div className="flex items-center gap-2 sm:gap-4">
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
             ) : (
               <div id="google-login-btn" className="min-w-[200px] flex items-center justify-end"></div>
             )}

             <div className="h-6 w-px bg-slate-100 mx-1 hidden sm:block"></div>

             <div className="flex items-center gap-2">
               <button 
                 onClick={() => setShowGarminModal(true)} 
                 className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all border ${isGarminConnected ? 'bg-green-50 text-green-600 border-green-200' : 'bg-white text-slate-400 border-slate-100 hover:border-slate-300 shadow-sm'}`}
                 title="Garmin Connect"
               >
                 {isGarminConnected ? <Check size={20} /> : <Calendar size={20} />}
               </button>
               <button 
                 onClick={() => setShowIntervalsModal(true)} 
                 className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all border ${intervalsConfig.connected ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-white text-slate-400 border-slate-100 hover:border-slate-300 shadow-sm'}`}
                 title="Intervals.icu"
               >
                 {intervalsConfig.connected ? <Check size={20} /> : <Globe size={20} />}
               </button>
             </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10">
        <section className="mb-12">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6 mb-10">
                <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Distance</p>
                    <p className="text-2xl sm:text-3xl font-bold text-slate-900">{RACE_DISTANCES.find(d => d.value === profile.raceDistance)?.label || '5K'}</p>
                </div>
                <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Benchmark</p>
                    <p className="text-2xl sm:text-3xl font-bold text-slate-900">{profile.raceTime}</p>
                </div>
                <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">SubT Pace</p>
                    <p className="text-2xl sm:text-3xl font-bold text-slate-900">{secondsToTime(currentThreshold)}</p>
                </div>
                <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Week Target</p>
                    <p className="text-2xl sm:text-3xl font-bold text-slate-900">{profile.weeklyVolume}km</p>
                </div>
            </div>
            
            <div className="flex items-center justify-between mb-8">
              <nav className="flex gap-2 bg-slate-100 p-1 rounded-xl">
                 <button onClick={() => setActiveTab('plan')} className={`px-5 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'plan' ? 'bg-white shadow-sm text-norway-blue' : 'text-slate-500 hover:text-slate-700'}`}>Weekly Plan</button>
                 <button onClick={() => setActiveTab('pacing')} className={`px-5 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'pacing' ? 'bg-white shadow-sm text-norway-blue' : 'text-slate-500 hover:text-slate-700'}`}>Pacing Table</button>
              </nav>
              <button onClick={() => setActiveTab('settings')} className="p-3 bg-white border border-slate-200 rounded-xl text-slate-500 hover:text-norway-blue hover:border-norway-blue transition-all shadow-sm">
                <MoreHorizontal size={20}/>
              </button>
            </div>

            {activeTab === 'pacing' ? (
              <div className="animate-in fade-in slide-in-from-bottom-4"><PacingTable profile={profile} /></div>
            ) : activeTab === 'plan' && plan ? (
              <div className="animate-in fade-in slide-in-from-bottom-2">
                <div className="mb-8 flex justify-between items-center bg-slate-900 text-white p-6 rounded-2xl shadow-xl">
                    <div>
                      <h2 className="text-xl font-bold tracking-tight">Active Plan</h2>
                      <p className="text-slate-400 text-xs mt-1">Total volume of {plan.totalDistance}km generated for this week.</p>
                    </div>
                    <div className="flex gap-2">
                        <button 
                          onClick={() => setShowGarminModal(true)}
                          className="bg-norway-red hover:bg-red-800 text-white px-5 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center gap-2 shadow-lg active:scale-95"
                        >
                          <Layers size={14} /> Schedule Week
                        </button>
                    </div>
                </div>
                <div className="space-y-1">
                    {plan.days.map((day, idx) => (
                        <div key={day.day} className="relative group">
                            <div className="flex items-center justify-between mb-2 pt-8">
                                <div className="flex items-center gap-4">
                                    <h3 className="text-lg font-bold text-slate-900 tracking-tight">{day.day}</h3>
                                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${day.type === DayType.THRESHOLD ? 'bg-orange-100 text-orange-700' : day.type === DayType.LONG_RUN ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-400'}`}>
                                        {day.type}
                                    </span>
                                </div>
                                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={() => moveSession(idx, 'up')} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 transition-colors"><ChevronUp size={16}/></button>
                                    <button onClick={() => moveSession(idx, 'down')} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 transition-colors"><ChevronDown size={16}/></button>
                                </div>
                            </div>
                            {!day.session ? (
                                <div className="p-8 bg-white border border-slate-100 rounded-2xl mb-6 flex items-center justify-center">
                                    <p className="text-slate-300 font-medium text-sm italic">Rest or recovery walk</p>
                                </div>
                            ) : (
                                <WorkoutCard 
                                    session={{...day.session}} 
                                    isSynced={syncedWorkouts.has(day.session.id)}
                                    onSync={(id) => setSyncedWorkouts(new Set(syncedWorkouts).add(id))} 
                                    profile={profile}
                                    onUpdateSession={(updated) => updateSessionInPlan(idx, updated)}
                                />
                            )}
                        </div>
                    ))}
                </div>
              </div>
            ) : null}
        </section>

        {activeTab === 'settings' && (
             <div className="fixed inset-0 bg-white/95 backdrop-blur-md z-50 overflow-y-auto p-6 sm:p-10 animate-in fade-in slide-in-from-bottom-8 duration-300">
                <div className="max-w-2xl mx-auto space-y-10">
                    <div className="flex justify-between items-center sticky top-0 bg-white/10 py-4 z-10">
                        <h2 className="text-3xl font-bold text-norway-blue tracking-tight">Configuration</h2>
                        <button onClick={() => setActiveTab('plan')} className="w-10 h-10 rounded-full hover:bg-slate-100 flex items-center justify-center transition-colors border border-slate-100"><MoreHorizontal size={24}/></button>
                    </div>

                    {!isAuthenticated && (
                      <div className="bg-norway-blue text-white p-6 rounded-3xl flex items-center justify-between shadow-2xl">
                        <div>
                          <h3 className="font-bold text-lg">Save your progress</h3>
                          <p className="text-white/60 text-xs">Login with Google to persist your benchmarks and weekly structure across devices.</p>
                        </div>
                        <div id="google-settings-btn"></div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                        <div className="space-y-6">
                            <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 ml-1">Benchmark Distance</label>
                                <select value={profile.raceDistance} onChange={handleDistanceChange} className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-slate-800 focus:ring-4 focus:ring-norway-blue/5 outline-none transition-all">
                                    {RACE_DISTANCES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 ml-1">Finish Time (H:M:S)</label>
                                <div className="flex gap-2">
                                    <input type="text" placeholder="H" value={timeInput.h} onChange={(e) => handleTimeChange('h', e.target.value)} className="w-1/3 p-4 bg-slate-50 border border-slate-100 rounded-2xl text-center font-bold focus:ring-4 focus:ring-norway-blue/5 outline-none" />
                                    <input type="text" placeholder="M" value={timeInput.m} onChange={(e) => handleTimeChange('m', e.target.value)} className="w-1/3 p-4 bg-slate-50 border border-slate-100 rounded-2xl text-center font-bold focus:ring-4 focus:ring-norway-blue/5 outline-none" />
                                    <input type="text" placeholder="S" value={timeInput.s} onChange={(e) => handleTimeChange('s', e.target.value)} className="w-1/3 p-4 bg-slate-50 border border-slate-100 rounded-2xl text-center font-bold focus:ring-4 focus:ring-norway-blue/5 outline-none" />
                                </div>
                            </div>
                        </div>
                        <div className="space-y-6">
                            <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 ml-1">Target Volume (km)</label>
                                <input type="number" name="weeklyVolume" value={profile.weeklyVolume} onChange={handleNumberChange} className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold outline-none focus:ring-4 focus:ring-norway-blue/5"/>
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 ml-1">Workout Buffer (km)</label>
                                <div className="flex gap-2">
                                    <div className="relative w-1/2">
                                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-300">WU</span>
                                      <input type="number" name="warmupDist" value={profile.warmupDist} onChange={handleNumberChange} className="w-full pl-10 p-4 bg-slate-50 border border-slate-100 rounded-2xl text-center font-bold outline-none" />
                                    </div>
                                    <div className="relative w-1/2">
                                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-300">CD</span>
                                      <input type="number" name="cooldownDist" value={profile.cooldownDist} onChange={handleNumberChange} className="w-full pl-10 p-4 bg-slate-50 border border-slate-100 rounded-2xl text-center font-bold outline-none" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-6 ml-1">Training Frequency</label>
                        <div className="space-y-3">
                            {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => (
                                <div key={day} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100/50">
                                    <span className="font-bold text-slate-700 text-sm">{day}</span>
                                    <div className="flex gap-1">
                                        {[DayType.REST, DayType.EASY, DayType.THRESHOLD, DayType.LONG_RUN].map(type => (
                                            <button key={type} onClick={() => handleDayTypeChange(day, type)} className={`px-3 py-2 rounded-xl text-[10px] font-bold uppercase transition-all ${profile.schedule[day] === type ? 'bg-norway-blue text-white shadow-lg' : 'bg-white text-slate-400 hover:text-slate-600 border border-slate-100'}`}>
                                                {type.split(' ')[0]}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="pt-10 flex flex-col items-center gap-4">
                        <button onClick={handleGeneratePlan} className="bg-norway-red text-white px-12 py-5 rounded-3xl font-bold text-xl hover:bg-slate-900 transition-all shadow-2xl flex items-center gap-4 active:scale-95 group">
                            <PlayCircle size={28} className="group-hover:rotate-12 transition-transform" /> Generate New Plan
                        </button>
                        <p className="text-[10px] text-slate-400 italic">This will rebuild your current training week with updated benchmarks.</p>
                    </div>
                </div>
             </div>
        )}
      </main>

      <GarminModal 
        isOpen={showGarminModal} 
        onClose={() => setShowGarminModal(false)} 
        onConnect={handleGarminSyncAll} 
        title="Garmin Sync"
      />

      <IntervalsModal
        isOpen={showIntervalsModal}
        onClose={() => setShowIntervalsModal(false)}
        onConnect={handleIntervalsConnect}
      />
    </div>
  );
};

export default App;
