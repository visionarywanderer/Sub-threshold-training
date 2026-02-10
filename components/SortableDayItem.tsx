import React from 'react';
import { CSS } from '@dnd-kit/utilities';
import { useSortable } from '@dnd-kit/sortable';
import { DailyPlan, UserProfile, WorkoutSession } from '../types';
import WorkoutCard from './WorkoutCard';
import { GripVertical, Cloud, CloudRain, CloudSun, Snowflake, Sun } from 'lucide-react';

interface DailyForecast {
  date: string;
  temperatureC: number;
  humidityPct: number;
  windKmh: number;
  weatherCode: number;
}

interface SortableDayItemProps {
  itemId: string;
  day: DailyPlan;
  dayLabel: string;
  profile: UserProfile;
  paceCorrectionSec: number;
  forecast?: DailyForecast;
  isSynced?: boolean;
  onSyncSession: () => void;
  onUpdateSession: (updated: WorkoutSession) => void;
}

const SortableDayItem: React.FC<SortableDayItemProps> = ({
  itemId,
  day,
  dayLabel,
  profile,
  paceCorrectionSec,
  forecast,
  isSynced,
  onSyncSession,
  onUpdateSession,
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({ id: itemId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const getWeatherIcon = (weatherCode: number) => {
    if (weatherCode === 0) return Sun;
    if ([1, 2].includes(weatherCode)) return CloudSun;
    if ([3, 45, 48].includes(weatherCode)) return Cloud;
    if ((weatherCode >= 71 && weatherCode <= 77) || (weatherCode >= 85 && weatherCode <= 86)) return Snowflake;
    return CloudRain;
  };

  if (day.session) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className={`${isDragging ? 'opacity-60' : 'opacity-100'} ${isOver ? 'ring-2 ring-norway-blue/20 rounded-2xl' : ''}`}
      >
        <WorkoutCard
          session={{ ...day.session }}
          profile={profile}
          paceCorrectionSec={paceCorrectionSec}
          forecast={forecast}
          isSynced={isSynced}
          dayLabel={dayLabel}
          dayTypeLabel={day.type}
          onSync={onSyncSession}
          onUpdateSession={onUpdateSession}
          dragHandleAttributes={attributes}
          dragHandleListeners={listeners}
        />
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative overflow-hidden bg-white/95 dark:bg-slate-900/95 border border-slate-200/80 dark:border-slate-700/90 rounded-3xl shadow-[0_1px_0_0_rgba(15,23,42,0.05),0_10px_24px_-18px_rgba(15,23,42,0.35)] px-6 py-5 flex items-center justify-between gap-4 ${isDragging ? 'opacity-60' : ''} ${isOver ? 'ring-2 ring-norway-blue/20' : ''}`}
    >
      <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-slate-400/90 dark:bg-slate-500/90" />
      <div>
        <div className="flex items-center gap-2">
          <h3 className="text-[22px] leading-none font-semibold tracking-tight text-slate-900 dark:text-slate-100">{dayLabel}</h3>
          <span className="text-[10px] font-bold uppercase px-2.5 py-1 rounded-full border border-slate-300/70 dark:border-slate-600 bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">{day.type}</span>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-300 mt-2">Rest or recovery day</p>
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
        <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full border bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700">Not synced</span>
        <button
          type="button"
          className="p-2 rounded-full border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-300 hover:text-slate-700 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800 cursor-grab active:cursor-grabbing focus:outline-none focus:ring-2 focus:ring-slate-300"
          aria-label={`Drag to reorder ${dayLabel}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={16} />
        </button>
      </div>
    </div>
  );
};

export default SortableDayItem;
