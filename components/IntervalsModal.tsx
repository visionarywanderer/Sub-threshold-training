import React, { useState } from 'react';
import { X, Activity, Loader2, Key, User } from 'lucide-react';
import { IntervalsIcuConfig } from '../types';

interface IntervalsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect: (config: IntervalsIcuConfig) => void;
}

const IntervalsModal: React.FC<IntervalsModalProps> = ({ isOpen, onClose, onConnect }) => {
  const [loading, setLoading] = useState(false);
  const [athleteId, setAthleteId] = useState('');
  const [apiKey, setApiKey] = useState('');

  if (!isOpen) return null;

  const handleConnect = () => {
    if (!athleteId || !apiKey) return;
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      onConnect({ athleteId, apiKey, connected: true });
    }, 1200);
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center backdrop-blur-md p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl p-8 w-full max-w-md relative animate-in fade-in zoom-in duration-200 border border-slate-100 dark:border-slate-700">
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800">
          <X size={20} />
        </button>

        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg">
             <Activity size={32} className="text-norway-red" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Connect Intervals.icu</h2>
          <p className="text-slate-500 dark:text-slate-400 mt-2 text-sm px-4">
            Import your workouts directly into Intervals.icu for advanced training analysis.
          </p>
        </div>

        <div className="space-y-4">
            <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 ml-1">Athlete ID</label>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" size={18} />
                  <input 
                    type="text" 
                    placeholder="e.g. i12345"
                    value={athleteId} 
                    onChange={(e) => setAthleteId(e.target.value)}
                    className="w-full pl-12 pr-4 py-4 bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-xl font-mono text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-norway-red/20 outline-none transition-all"
                  />
                </div>
            </div>

            <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 ml-1">API Key</label>
                <div className="relative">
                  <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" size={18} />
                  <input 
                    type="password" 
                    placeholder="Enter API key"
                    value={apiKey} 
                    onChange={(e) => setApiKey(e.target.value)}
                    className="w-full pl-12 pr-4 py-4 bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-xl font-mono text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-norway-red/20 outline-none transition-all"
                  />
                </div>
            </div>

            <button
              onClick={handleConnect}
              disabled={loading || !athleteId || !apiKey}
              className="w-full bg-slate-900 hover:bg-black text-white font-bold py-4 px-4 rounded-xl flex items-center justify-center gap-3 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg mt-4"
            >
              {loading ? <Loader2 size={20} className="animate-spin" /> : "Authorize Intervals.icu"}
            </button>
            <p className="text-[10px] text-center text-slate-400 dark:text-slate-500 px-6 mt-4">
                You can find your API key in the Intervals.icu Settings page under "API Access".
            </p>
        </div>
      </div>
    </div>
  );
};

export default IntervalsModal;
