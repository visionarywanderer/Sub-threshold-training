import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { UserProfile, DistanceUnit, WeeklyPlan, DayType, UserSchedule, IntervalsIcuConfig, WorkoutSession, WorkoutType } from './types';
import { applyPaceCorrection, calculateVDOTFromRace, generatePlan, calculateThresholdPace, getWeatherPaceDeltaSeconds, secondsToTime } from './utils/calculations';
import { deleteWorkoutFromIcu, syncWorkoutToIcu, syncWorkoutsBulkToIcu } from './services/intervalsService';
import PacingTable from './components/PacingTable';
import IntervalsModal from './components/IntervalsModal';
import ScheduleWeekModal from './components/ScheduleWeekModal';
import SortableDayItem from './components/SortableDayItem';
import { Settings, X, PlayCircle, LogOut, Check, Globe, RefreshCw, CloudSun, Moon, Sun } from 'lucide-react';
import { DndContext, DragEndEvent, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';

declare global {
  interface Window {
    google: any;
  }
}

const RUN_STORAGE_KEY_PREFIX = 'norskflow_run_profile';
const ICU_CONFIG_KEY_PREFIX = 'norskflow_icu_config';
const THEME_STORAGE_KEY = 'norskflow_theme';
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const FIVE_K_DISTANCE = 5000;
const WEEKDAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const formatLocalDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseLocalDate = (isoDate: string): Date => {
  const [year, month, day] = isoDate.split('-').map((v) => Number(v));
  if (!year || !month || !day) return new Date(isoDate);
  return new Date(year, month - 1, day);
};

const EMPTY_RUN_SCHEDULE: UserSchedule = {
  'Monday': DayType.REST, 'Tuesday': DayType.REST, 'Wednesday': DayType.REST,
  'Thursday': DayType.REST, 'Friday': DayType.REST, 'Saturday': DayType.REST, 'Sunday': DayType.REST
};

const EMPTY_RUN_PROFILE: UserProfile = {
  name: '', raceDistance: FIVE_K_DISTANCE, raceTime: '', maxHR: 0, weeklyVolume: 0,
  unit: DistanceUnit.KM, schedule: EMPTY_RUN_SCHEDULE, warmupDist: 0, cooldownDist: 0
};

const normalizeTo5kProfile = (profile: UserProfile): UserProfile => ({
  ...profile,
  raceDistance: FIVE_K_DISTANCE,
});

const getProfileStorageKey = (uid: string): string => `${RUN_STORAGE_KEY_PREFIX}_${uid}`;
const getIcuStorageKey = (uid: string): string => `${ICU_CONFIG_KEY_PREFIX}_${uid}`;

interface WeatherSnapshot {
  temperatureC: number;
  dewPointC: number;
  humidityPct: number;
  windKmh: number;
}

type ThemeMode = 'light' | 'dark';

const App: React.FC = () => {
  const googleInitializedRef = useRef(false);
  const googleButtonRenderedRef = useRef(false);
  const [profile, setProfile] = useState<UserProfile>(EMPTY_RUN_PROFILE);
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [activeTab, setActiveTab] = useState<'plan' | 'pacing' | 'settings'>('plan'); 
  const [showIntervalsModal, setShowIntervalsModal] = useState(false);
  const [showScheduleWeekModal, setShowScheduleWeekModal] = useState(false);
  const [intervalsConfig, setIntervalsConfig] = useState<IntervalsIcuConfig>({ athleteId: '', apiKey: '', connected: false });
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'error' | 'success'>('idle');
  const [syncMessage, setSyncMessage] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [weatherStatus, setWeatherStatus] = useState<'idle' | 'loading' | 'ready' | 'error' | 'blocked'>('idle');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + (1 - d.getDay() + 7) % 7); // Next Monday
    return formatLocalDate(d);
  });
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return saved === 'dark' ? 'dark' : 'light';
  });

  // Logged-out default: empty profile and no connected integrations.
  useEffect(() => {
    setProfile(EMPTY_RUN_PROFILE);
    setPlan(generatePlan(EMPTY_RUN_PROFILE, 0));
    setIntervalsConfig({ athleteId: '', apiKey: '', connected: false });
    setIsAuthenticated(false);
  }, []);

  const fetchWeather = useCallback(() => {
    if (!navigator.geolocation) {
      setWeatherStatus('blocked');
      return;
    }

    setWeatherStatus('loading');
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const lat = position.coords.latitude;
          const lon = position.coords.longitude;
          const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,dew_point_2m,relative_humidity_2m,wind_speed_10m&timezone=auto&forecast_days=1`;
          const res = await fetch(url);
          if (!res.ok) throw new Error('weather_fetch_failed');
          const data = await res.json();
          const current = data?.current;
          const temperatureC = Number(current?.temperature_2m);
          const dewPointC = Number(current?.dew_point_2m);
          const humidityPct = Number(current?.relative_humidity_2m);
          const windKmh = Number(current?.wind_speed_10m);

          if (![temperatureC, dewPointC, humidityPct, windKmh].every(v => isFinite(v))) throw new Error('weather_parse_failed');

          setWeather({ temperatureC, dewPointC, humidityPct, windKmh });
          setWeatherStatus('ready');
        } catch (e) {
          setWeatherStatus('error');
        }
      },
      () => setWeatherStatus('blocked'),
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 15 * 60 * 1000 }
    );
  }, []);

  useEffect(() => {
    fetchWeather();
  }, [fetchWeather]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const handleCredentialResponse = useCallback((response: any) => {
    const userData = JSON.parse(atob(response.credential.split('.')[1]));
    if (userData) {
      const uid = String(userData.sub || '');
      const profileKey = getProfileStorageKey(uid);
      const icuKey = getIcuStorageKey(uid);
      const savedProfile = localStorage.getItem(profileKey);
      const savedIcu = localStorage.getItem(icuKey);

      const userProfile = savedProfile
        ? normalizeTo5kProfile(JSON.parse(savedProfile))
        : normalizeTo5kProfile({
            ...EMPTY_RUN_PROFILE,
            uid,
            email: userData.email,
            name: userData.name || ''
          });

      const nextProfile = {
        ...userProfile,
        uid,
        email: userData.email,
        name: userData.name || userProfile.name
      };

      setProfile(nextProfile);
      setPlan(generatePlan(nextProfile, 0));
      setIntervalsConfig(savedIcu ? JSON.parse(savedIcu) : { athleteId: '', apiKey: '', connected: false });
      setIsAuthenticated(true);
      googleButtonRenderedRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || isAuthenticated) return;

    const tryInitAndRender = (): boolean => {
      if (typeof window.google === 'undefined' || !window.google.accounts?.id) return false;

      if (!googleInitializedRef.current) {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleCredentialResponse,
          auto_select: false,
          cancel_on_tap_outside: true,
          use_fedcm_for_prompt: false,
        });
        googleInitializedRef.current = true;
      }

      const btnContainer = document.getElementById('google-login-btn');
      if (!btnContainer) return false;

      if (!googleButtonRenderedRef.current || btnContainer.childElementCount === 0) {
        btnContainer.innerHTML = '';
        window.google.accounts.id.renderButton(btnContainer, {
          theme: 'outline',
          size: 'large',
          shape: 'pill',
          width: 200,
        });
        googleButtonRenderedRef.current = true;
      }

      return true;
    };

    if (tryInitAndRender()) return;

    let attempts = 0;
    const interval = setInterval(() => {
      attempts += 1;
      if (tryInitAndRender() || attempts >= 80) {
        clearInterval(interval);
      }
    }, 250);

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
    setIsAuthenticated(false);
    setProfile(EMPTY_RUN_PROFILE);
    setPlan(generatePlan(EMPTY_RUN_PROFILE, weatherPaceDeltaSec));
    setIntervalsConfig({ athleteId: '', apiKey: '', connected: false });
    googleButtonRenderedRef.current = false;
    if (window.google) window.google.accounts.id.disableAutoSelect();
  };

  const currentThreshold = calculateThresholdPace(profile.raceDistance, profile.raceTime, profile);
  const vdot = calculateVDOTFromRace(profile.raceDistance, profile.raceTime);
  const weatherPaceDeltaSec = weather
    ? getWeatherPaceDeltaSeconds(currentThreshold, weather.temperatureC, weather.humidityPct, weather.windKmh)
    : 0;
  const correctedThreshold = applyPaceCorrection(currentThreshold, weatherPaceDeltaSec);
  const subThresholdIntervalKm = useMemo(() => {
    if (!plan) return 0;
    return plan.days.reduce((sum, day) => {
      const session = day.session;
      if (!session || !session.intervals?.length) return sum;

      const isThresholdDay = session.type === WorkoutType.THRESHOLD;
      const isFiveKmLongRunVariant = session.type === WorkoutType.LONG_RUN && (
        session.id.includes('-blocks') || session.title.toLowerCase().includes('5km')
      );

      if (!isThresholdDay && !isFiveKmLongRunVariant) return sum;

      const sessionIntervalKm = session.intervals.reduce((acc, int) => {
        const reps = Math.max(1, Number(int.count) || 1);
        const distanceM = Math.max(0, Number(int.distance) || 0);
        return acc + ((distanceM * reps) / 1000);
      }, 0);

      return sum + sessionIntervalKm;
    }, 0);
  }, [plan]);
  const subThresholdPct = useMemo(() => {
    const totalKm = plan?.totalDistance || 0;
    if (totalKm <= 0) return 0;
    return (subThresholdIntervalKm / totalKm) * 100;
  }, [plan, subThresholdIntervalKm]);

  const handleGeneratePlan = () => {
    const normalized = normalizeTo5kProfile(profile);
    const newPlan = generatePlan(normalized, weatherPaceDeltaSec);
    setProfile(normalized);
    setPlan(newPlan);
    setActiveTab('plan');
    if (isAuthenticated && normalized.uid) {
      localStorage.setItem(getProfileStorageKey(normalized.uid), JSON.stringify(normalized));
    }
  };

  const handleSyncEntireWeekToIcu = async (weekStartDate: string) => {
    if (!plan || !intervalsConfig.connected || !isAuthenticated) return;
    setSyncStatus('syncing');
    setSyncMessage('');
    const workoutDayCount = plan.days.filter((d) => !!d.session).length;
    
    try {
      const newDays = [...plan.days];
      const failedDays: string[] = [];
      const workoutItems: Array<{ index: number; dayLabel: string; externalId: string; dateStr: string }> = [];

      for (let i = 0; i < newDays.length; i++) {
        const day = newDays[i];
        const targetDate = parseLocalDate(weekStartDate);
        targetDate.setDate(targetDate.getDate() + i);
        const dateStr = formatLocalDate(targetDate);
        const dayLabel = WEEKDAY_ORDER[i] || day.day;

        // User preference: do not write rest days to Intervals/Garmin.
        if (!day.session) {
          if (day.icuEventId) {
            await deleteWorkoutFromIcu(intervalsConfig, day.icuEventId);
          }
          newDays[i] = { ...day, icuEventId: undefined };
          continue;
        }

        const externalId = `norskflow:${profile.uid || 'anon'}:${dateStr}:${i}`;
        workoutItems.push({ index: i, dayLabel, externalId, dateStr });
      }

      const bulkResult = await syncWorkoutsBulkToIcu(
        intervalsConfig,
        workoutItems.map((w) => ({
          externalId: w.externalId,
          date: w.dateStr,
          session: newDays[w.index].session!,
        }))
      );

      if (!bulkResult.ok) {
        setSyncStatus('error');
        setSyncMessage(bulkResult.error || 'Failed to bulk sync workouts.');
        return;
      }

      let syncedCount = 0;
      for (const w of workoutItems) {
        const eventId = bulkResult.eventIdsByExternalId[w.externalId];
        if (eventId) {
          const day = newDays[w.index];
          if (day.session) {
            newDays[w.index] = { ...day, session: { ...day.session, icuEventId: eventId }, icuEventId: undefined };
            syncedCount += 1;
          }
        } else {
          failedDays.push(`${w.dayLabel}: missing event id from bulk response`);
        }
      }

      setPlan({ ...plan, days: newDays });
      setStartDate(weekStartDate);

      if (failedDays.length === 0) {
        setSyncStatus('success');
        setSyncMessage(`Scheduled ${syncedCount}/${workoutDayCount} workouts to Intervals.icu.`);
        setShowScheduleWeekModal(false);
      } else {
        setSyncStatus('error');
        setSyncMessage(`Scheduled ${syncedCount}/${workoutDayCount} workouts. Failed: ${failedDays.join(' | ')}`);
      }

      setTimeout(() => {
        setSyncStatus('idle');
        setSyncMessage('');
      }, 7000);
    } catch (e) {
      setSyncStatus('error');
      setSyncMessage(e instanceof Error ? e.message : 'Unexpected error while scheduling week.');
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    if (!plan) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = plan.days.findIndex((d) => `day-${d.day}` === active.id);
    const newIndex = plan.days.findIndex((d) => `day-${d.day}` === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(plan.days, oldIndex, newIndex);
    setPlan({ ...plan, days: reordered });

    const movedSynced = reordered[oldIndex]?.session?.icuEventId || reordered[newIndex]?.session?.icuEventId;
    if (intervalsConfig.connected && movedSynced) {
      handleSyncEntireWeekToIcu(startDate);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans">
        <main className="max-w-5xl mx-auto px-6 py-16 md:py-24">
          <section className="relative overflow-hidden rounded-3xl border border-slate-200/80 dark:border-slate-700 bg-white/90 dark:bg-slate-900/90 shadow-sm p-8 md:p-12">
            <div className="pointer-events-none absolute -top-20 -right-14 w-56 h-56 bg-norway-blue/10 dark:bg-norway-blue/20 rounded-full blur-2xl" />
            <div className="pointer-events-none absolute -bottom-24 -left-16 w-64 h-64 bg-slate-300/30 dark:bg-slate-500/20 rounded-full blur-2xl" />

            <div className="relative">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800/80 text-xs font-semibold text-slate-600 dark:text-slate-300">
                NorskFlow Run
              </div>
              <h1 className="mt-5 text-3xl md:text-5xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                Norwegian Method Planner
              </h1>
              <p className="mt-4 text-base md:text-lg text-slate-600 dark:text-slate-300 max-w-3xl">
                Build and manage your week with threshold pacing, weather-adjusted guidance, editable workout steps, and Intervals.icu sync ready for Garmin.
              </p>

              <div className="mt-8 grid sm:grid-cols-2 gap-3 text-sm">
                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-800/80 px-4 py-3">Dynamic paces from your 5K benchmark + VDOT</div>
                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-800/80 px-4 py-3">Weather-aware threshold adjustments with delta</div>
                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-800/80 px-4 py-3">Drag and drop weekly plan with editable sessions</div>
                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-800/80 px-4 py-3">Intervals.icu calendar sync with explicit workout steps</div>
              </div>

              <div className="mt-10 flex flex-col sm:flex-row sm:items-center gap-4">
                {GOOGLE_CLIENT_ID ? (
                  <div id="google-login-btn"></div>
                ) : (
                  <p className="text-sm text-red-600 dark:text-red-300">
                    Google login is not configured. Set <code className="font-mono">VITE_GOOGLE_CLIENT_ID</code>.
                  </p>
                )}
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Sign in with Google to access your dashboard and saved training data.
                </p>
              </div>
            </div>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans pb-20 transition-colors">
      <header className="bg-white/90 dark:bg-slate-900/90 border-b border-slate-100 dark:border-slate-800 sticky top-0 z-40 backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-6 bg-slate-800 rounded flex items-center justify-center relative shadow-sm">
               <div className="absolute left-0 top-0 bottom-0 w-1/3 bg-norway-red rounded-l"></div>
            </div>
            <h1 className="font-bold text-xl tracking-tight text-norway-blue dark:text-sky-300">Threshold Works</h1>
          </div>
          
          <div className="flex items-center gap-4">
             <button
               onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
               className="w-9 h-9 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-300 hover:text-slate-800 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex items-center justify-center"
               aria-label="Toggle theme"
             >
               {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
             </button>
             {isAuthenticated ? (
               <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-800 p-1 pl-4 rounded-full border border-slate-100 dark:border-slate-700">
                  <div className="hidden md:block">
                    <p className="text-[10px] font-bold text-slate-900 dark:text-slate-100 uppercase leading-none">{profile.name}</p>
                    <p className="text-[9px] text-slate-400 dark:text-slate-400 leading-none">{profile.email}</p>
                  </div>
                  <button onClick={handleLogout} className="w-8 h-8 rounded-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-400 hover:text-norway-red transition-colors shadow-sm">
                    <LogOut size={14} />
                  </button>
               </div>
             ) : GOOGLE_CLIENT_ID ? (
               <div id="google-login-btn"></div>
             ) : null}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10">
        <section className="mb-12">
            <section className="relative overflow-hidden rounded-3xl border border-slate-200/80 dark:border-slate-700 bg-white/90 dark:bg-slate-900/90 shadow-sm px-6 py-6 md:px-8 md:py-7 mb-10">
              <div className="pointer-events-none absolute -top-16 -right-10 w-48 h-48 bg-norway-blue/8 dark:bg-norway-blue/15 rounded-full blur-2xl" />
              <div className="pointer-events-none absolute -bottom-20 -left-12 w-52 h-52 bg-slate-300/30 dark:bg-slate-500/20 rounded-full blur-2xl" />

              <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                <div className="min-w-0">
                  <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Threshold Works</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">Week target {profile.weeklyVolume}km. Plan volume {plan?.totalDistance || 0}km.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="inline-flex items-center px-3 py-1.5 rounded-full border border-slate-200/80 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-800/80 text-xs font-medium text-slate-600 dark:text-slate-300">
                      VDOT {vdot > 0 ? vdot.toFixed(1) : '--'}
                    </span>
                    <span className="inline-flex items-center px-3 py-1.5 rounded-full border border-slate-200/80 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-800/80 text-xs font-medium text-slate-600 dark:text-slate-300">
                      Sub-T {subThresholdIntervalKm.toFixed(1)}km
                    </span>
                    <span className="inline-flex items-center px-3 py-1.5 rounded-full border border-slate-200/80 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-800/80 text-xs font-medium text-slate-600 dark:text-slate-300">
                      Sub-T {subThresholdPct.toFixed(1)}%
                    </span>
                  </div>
                </div>

                <div className="lg:text-center rounded-2xl border border-norway-blue/15 dark:border-sky-500/30 bg-norway-blue/[0.04] dark:bg-sky-500/[0.12] px-5 py-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Threshold Pace</p>
                  <p className="text-4xl md:text-5xl leading-none font-bold text-norway-blue dark:text-sky-300 mt-1">{secondsToTime(correctedThreshold)}<span className="text-xl md:text-2xl text-slate-500 dark:text-slate-300 font-medium">/km</span></p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                    Base {secondsToTime(currentThreshold)}. Delta {weatherPaceDeltaSec >= 0 ? '+' : ''}{weatherPaceDeltaSec}s/km
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/95 dark:bg-slate-800/90 px-5 py-3 min-w-[250px]">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Weather</p>
                      {weather ? (
                        <>
                          <p className="text-3xl font-semibold text-slate-900 dark:text-slate-100 mt-0.5">{Math.round(weather.temperatureC)}C</p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Humidity {Math.round(weather.humidityPct)}% · Dew {Math.round(weather.dewPointC)}C · Wind {Math.round(weather.windKmh)} km/h</p>
                        </>
                      ) : (
                        <p className="text-xs text-slate-400 mt-1">{weatherStatus === 'loading' ? 'Loading...' : weatherStatus === 'blocked' ? 'Location blocked' : weatherStatus === 'error' ? 'Weather unavailable' : 'No weather data'}</p>
                      )}
                    </div>
                    <button onClick={fetchWeather} className="p-2 rounded-full border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-300 hover:text-slate-700 dark:hover:text-white hover:bg-white dark:hover:bg-slate-700">
                      <CloudSun size={14} />
                    </button>
                  </div>
                </div>
              </div>
            </section>
            
            <div className="flex items-center justify-between mb-8">
              <nav className="flex gap-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                 <button onClick={() => setActiveTab('plan')} className={`px-5 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'plan' ? 'bg-white dark:bg-slate-700 shadow-sm text-norway-blue' : 'text-slate-500 dark:text-slate-300 hover:text-slate-700 dark:hover:text-white'}`}>Weekly Plan</button>
                 <button onClick={() => setActiveTab('pacing')} className={`px-5 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'pacing' ? 'bg-white dark:bg-slate-700 shadow-sm text-norway-blue' : 'text-slate-500 dark:text-slate-300 hover:text-slate-700 dark:hover:text-white'}`}>Pacing Table</button>
              </nav>
              <div className="flex gap-2">
                 {isAuthenticated && intervalsConfig.connected && (
                   <div className="flex items-center gap-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-4 py-1.5 rounded-xl shadow-sm">
                      <button 
                        onClick={() => setShowScheduleWeekModal(true)}
                        disabled={syncStatus === 'syncing'}
                        className={`flex items-center gap-2 text-xs font-bold transition-all ${syncStatus === 'syncing' ? 'text-slate-300' : 'text-norway-red hover:text-red-700'}`}
                      >
                        {syncStatus === 'syncing' ? <RefreshCw className="animate-spin" size={14} /> : syncStatus === 'success' ? <Check size={14} /> : <Globe size={14} />}
                        {syncStatus === 'syncing' ? 'Scheduling...' : syncStatus === 'success' ? 'Scheduled!' : 'Schedule Week'}
                      </button>
                   </div>
                 )}
                 <button onClick={() => setActiveTab('settings')} className="p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-500 dark:text-slate-300 hover:text-norway-blue hover:border-norway-blue transition-all shadow-sm">
                   <Settings size={20}/>
                 </button>
              </div>
            </div>

            {!!syncMessage && (
              <div className={`mb-6 px-4 py-3 rounded-xl border text-sm ${syncStatus === 'error' ? 'bg-red-50 border-red-200 text-red-700 dark:bg-red-950/30 dark:border-red-900 dark:text-red-300' : 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950/30 dark:border-emerald-900 dark:text-emerald-300'}`}>
                {syncMessage}
              </div>
            )}

            {activeTab === 'plan' && plan && (
              <div className="animate-in fade-in slide-in-from-bottom-2 space-y-4">
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={plan.days.map((d) => `day-${d.day}`)} strategy={verticalListSortingStrategy}>
                    {plan.days.map((day, idx) => (
                      <SortableDayItem
                        key={day.day}
                        itemId={`day-${day.day}`}
                        dayLabel={WEEKDAY_ORDER[idx] || day.day}
                        day={day}
                        profile={profile}
                        paceCorrectionSec={weatherPaceDeltaSec}
                        isSynced={!!day.session?.icuEventId}
                        onSyncSession={async () => {
                          if (!day.session) return;
                          if (!intervalsConfig.connected) {
                            if (!isAuthenticated) return;
                            setShowIntervalsModal(true);
                            return;
                          }
                          const targetDate = parseLocalDate(startDate);
                          targetDate.setDate(targetDate.getDate() + idx);
                          const result = await syncWorkoutToIcu(intervalsConfig, day.session, formatLocalDate(targetDate));
                          if (result.ok && result.eventId) {
                            const newDays = [...plan.days];
                            newDays[idx].session = { ...day.session, icuEventId: result.eventId };
                            setPlan({ ...plan, days: newDays });
                            setSyncStatus('success');
                            setSyncMessage(`${WEEKDAY_ORDER[idx] || day.day} synced to Intervals.icu.`);
                            setTimeout(() => {
                              setSyncStatus('idle');
                              setSyncMessage('');
                            }, 4000);
                          } else {
                            setSyncStatus('error');
                            setSyncMessage(`Failed to sync ${WEEKDAY_ORDER[idx] || day.day}: ${result.error || 'unknown error'}`);
                          }
                        }}
                        onUpdateSession={(updated: WorkoutSession) => {
                          const newDays = [...plan.days];
                          const existingEventId = day.session?.icuEventId;
                          newDays[idx].session = existingEventId
                            ? { ...updated, icuEventId: existingEventId }
                            : updated;
                          setPlan({ ...plan, days: newDays });
                        }}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
              </div>
            )}

            {activeTab === 'pacing' && (
               <div className="animate-in fade-in slide-in-from-bottom-2">
                 <PacingTable profile={profile} paceCorrectionSec={weatherPaceDeltaSec} />
               </div>
            )}

            {activeTab === 'settings' && (
              <div className="fixed inset-0 bg-white/98 dark:bg-slate-950/98 backdrop-blur-md z-50 overflow-y-auto p-6 sm:p-10 animate-in fade-in duration-300">
                 <div className="max-w-2xl mx-auto space-y-10">
                    <div className="flex justify-between items-center sticky top-0 bg-white/10 dark:bg-slate-950/10 py-4 z-10">
                        <h2 className="text-3xl font-bold text-norway-blue dark:text-sky-300 tracking-tight">Plan Config</h2>
                        <button onClick={() => setActiveTab('plan')} className="w-10 h-10 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center border border-slate-100 dark:border-slate-700"><X size={20}/></button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                        <div className="space-y-6">
                            <h4 className="text-xs font-bold text-slate-400 dark:text-slate-400 uppercase tracking-widest border-b border-slate-200 dark:border-slate-700 pb-2">Running Benchmark</h4>
                            <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-2 ml-1">Benchmark Distance</label>
                                <div className="w-full p-4 bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl font-bold text-slate-800 dark:text-slate-100">
                                  5K
                                </div>
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-2 ml-1">5K Time (M:S)</label>
                                <input type="text" value={profile.raceTime} onChange={(e) => setProfile(p => ({...p, raceTime: e.target.value}))} className="w-full p-4 bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl font-bold text-slate-900 dark:text-slate-100" />
                            </div>
                        </div>

                        <div className="space-y-6">
                            <h4 className="text-xs font-bold text-slate-400 dark:text-slate-400 uppercase tracking-widest border-b border-slate-200 dark:border-slate-700 pb-2">Volume Settings</h4>
                            <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-2 ml-1">Weekly Target (km)</label>
                                <input type="number" name="weeklyVolume" value={profile.weeklyVolume} onChange={handleNumberChange} className="w-full p-4 bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl font-bold text-slate-900 dark:text-slate-100" />
                            </div>
                            <div className="flex gap-2">
                                <div className="w-1/2">
                                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-2 ml-1">Warmup (km)</label>
                                  <input type="number" name="warmupDist" value={profile.warmupDist} onChange={handleNumberChange} className="w-full p-4 bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl font-bold text-center text-slate-900 dark:text-slate-100" />
                                </div>
                                <div className="w-1/2">
                                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-2 ml-1">Cooldown (km)</label>
                                  <input type="number" name="cooldownDist" value={profile.cooldownDist} onChange={handleNumberChange} className="w-full p-4 bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl font-bold text-center text-slate-900 dark:text-slate-100" />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-6 ml-1">Training Frequency</label>
                        <div className="grid grid-cols-1 gap-2">
                            {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => (
                                <div key={day} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700">
                                    <span className="font-bold text-slate-700 dark:text-slate-200 text-xs w-20">{day}</span>
                                    <div className="flex gap-1 overflow-x-auto scrollbar-hide">
                                        {[DayType.REST, DayType.EASY, DayType.THRESHOLD, DayType.LONG_RUN].map(type => (
                                            <button 
                                              key={type} 
                                              onClick={() => setProfile(p => ({ ...p, schedule: { ...p.schedule, [day]: type } }))}
                                              className={`px-3 py-1.5 rounded-lg text-[9px] font-bold uppercase whitespace-nowrap border transition-all ${profile.schedule[day] === type ? 'bg-norway-blue dark:bg-sky-500 text-white' : 'bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-300 border-slate-100 dark:border-slate-700'}`}
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
                                onClick={() => {
                                  if (!isAuthenticated) return;
                                  setShowIntervalsModal(true);
                                }}
                                disabled={!isAuthenticated}
                                className={`flex items-center gap-3 px-8 py-4 rounded-2xl font-bold text-sm shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed ${intervalsConfig.connected ? 'bg-green-600 text-white' : 'bg-slate-800 text-white hover:bg-black'}`}
                            >
                                {intervalsConfig.connected ? <Check size={18} /> : <Globe size={18} />}
                                {!isAuthenticated ? 'Login to connect Intervals.icu' : intervalsConfig.connected ? 'Intervals.icu Connected' : 'Connect Intervals.icu'}
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
            if (!isAuthenticated || !profile.uid) return;
            setIntervalsConfig(c);
            localStorage.setItem(getIcuStorageKey(profile.uid), JSON.stringify(c));
        }} 
      />
      <ScheduleWeekModal
        isOpen={showScheduleWeekModal}
        initialDate={startDate}
        isScheduling={syncStatus === 'syncing'}
        onClose={() => setShowScheduleWeekModal(false)}
        onConfirm={handleSyncEntireWeekToIcu}
      />
    </div>
  );
};

export default App;
