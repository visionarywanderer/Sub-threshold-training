import React, { useState } from 'react';
import { X, CalendarDays, Loader2 } from 'lucide-react';

interface ScheduleWeekModalProps {
  isOpen: boolean;
  initialDate: string;
  isScheduling: boolean;
  onClose: () => void;
  onConfirm: (startDate: string) => Promise<void>;
}

const ScheduleWeekModal: React.FC<ScheduleWeekModalProps> = ({
  isOpen,
  initialDate,
  isScheduling,
  onClose,
  onConfirm,
}) => {
  const [selectedDate, setSelectedDate] = useState(initialDate);

  React.useEffect(() => {
    if (isOpen) setSelectedDate(initialDate);
  }, [isOpen, initialDate]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center backdrop-blur-md p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl p-8 w-full max-w-md relative animate-in fade-in zoom-in duration-200 border border-slate-100 dark:border-slate-700">
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800">
          <X size={20} />
        </button>

        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg">
            <CalendarDays size={30} className="text-white" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Schedule Week on Intervals.icu</h2>
          <p className="text-slate-500 dark:text-slate-400 mt-2 text-sm px-4">
            Pick the first day of this training week. All sessions and rest days will be scheduled automatically.
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 ml-1">First Day of Week</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-full px-4 py-4 bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-xl font-mono text-sm text-slate-900 dark:text-slate-100 outline-none focus:ring-2 focus:ring-norway-red/20"
            />
          </div>

          <button
            onClick={() => onConfirm(selectedDate)}
            disabled={isScheduling || !selectedDate}
            className="w-full bg-slate-900 hover:bg-black text-white font-bold py-4 px-4 rounded-xl flex items-center justify-center gap-3 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg mt-4"
          >
            {isScheduling ? <Loader2 size={20} className="animate-spin" /> : 'Schedule Full Week'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ScheduleWeekModal;
