import React, { useState } from 'react';
import { X, Calendar as CalendarIcon, Loader2 } from 'lucide-react';

interface GarminModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect: (startDate: string) => void;
  title?: string;
  description?: string;
}

const GarminModal: React.FC<GarminModalProps> = ({ isOpen, onClose, onConnect, title, description }) => {
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);

  if (!isOpen) return null;

  const handleAuth = () => {
    setLoading(true);
    // Simulate API delay
    setTimeout(() => {
      setLoading(false);
      onConnect(startDate);
    }, 1500);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl p-8 w-full max-w-md relative animate-in fade-in zoom-in duration-200">
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 p-2 rounded-full hover:bg-slate-100"
        >
          <X size={20} />
        </button>

        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-[#007cc3] rounded-2xl flex items-center justify-center mx-auto mb-6 rotate-3 shadow-lg">
             <CalendarIcon size={40} className="text-white" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900">{title || "Sync to Garmin"}</h2>
          <p className="text-slate-500 mt-2 text-sm">
            {description || "Choose the starting date for this training week and we'll push all sessions to your Connect calendar."}
          </p>
        </div>

        <div className="space-y-6">
            <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Starting Monday</label>
                <div className="relative">
                  <input 
                    type="date" 
                    value={startDate} 
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full p-4 bg-slate-50 border border-slate-100 rounded-xl font-bold text-slate-800 focus:ring-2 focus:ring-[#007cc3]/20 outline-none"
                  />
                </div>
            </div>

            <button
            onClick={handleAuth}
            disabled={loading}
            className="w-full bg-[#007cc3] hover:bg-[#0065a0] text-white font-bold py-4 px-4 rounded-xl flex items-center justify-center gap-3 transition-all disabled:opacity-70 disabled:cursor-not-allowed shadow-lg hover:shadow-xl active:scale-95"
            >
            {loading ? (
                <Loader2 size={20} className="animate-spin" />
            ) : (
                <>Schedule Entire Week</>
            )}
            </button>
            <p className="text-[10px] text-center text-slate-400">
                This will create {title?.includes("All") ? "7" : "individual"} calendar entries in your Garmin Connect account.
            </p>
        </div>
      </div>
    </div>
  );
};

export default GarminModal;