import React from 'react';
import { CSS } from '@dnd-kit/utilities';
import { useSortable } from '@dnd-kit/sortable';
import { DailyPlan, UserProfile, WorkoutSession } from '../types';
import WorkoutCard from './WorkoutCard';
import { GripVertical } from 'lucide-react';

interface SortableDayItemProps {
  itemId: string;
  day: DailyPlan;
  dayLabel: string;
  profile: UserProfile;
  paceCorrectionSec: number;
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
  isSynced,
  onSyncSession,
  onUpdateSession,
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({ id: itemId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
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
      className={`bg-amber-50/60 dark:bg-amber-900/20 border border-amber-200/70 dark:border-amber-800 rounded-2xl shadow-sm px-5 py-4 flex items-center justify-between gap-4 ${isDragging ? 'opacity-60' : ''} ${isOver ? 'ring-2 ring-norway-blue/20' : ''}`}
    >
      <div>
        <div className="flex items-center gap-2">
          <h3 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">{dayLabel}</h3>
          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200">{day.type}</span>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">Rest or recovery day</p>
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
