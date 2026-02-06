import React from 'react';
import { applyPaceCorrection, calculatePaceForDistance, secondsToTime } from '../utils/calculations';
import { UserProfile } from '../types';

interface PacingTableProps {
  profile: UserProfile;
  paceCorrectionSec?: number;
}

const PacingTable: React.FC<PacingTableProps> = ({ profile, paceCorrectionSec = 0 }) => {
  const races = [
    { label: '1 Mile', dist: 1609 },
    { label: '3K', dist: 3000 },
    { label: '5K', dist: 5000 },
    { label: '8K', dist: 8000 },
    { label: '10K', dist: 10000 },
    { label: '15K', dist: 15000 },
    { label: 'Half Marathon', dist: 21097 },
    { label: 'Marathon', dist: 42195 },
  ];

  return (
    <div className="space-y-8">
        <div>
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-6">Equivalent Race Times</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {races.map((race) => {
                    const basePace = calculatePaceForDistance(profile.raceDistance, profile.raceTime, race.dist);
                    const pSec = applyPaceCorrection(basePace, paceCorrectionSec);
                    const finishTime = pSec * (race.dist / 1000);
                    return (
                        <div key={race.label} className="bg-white border border-slate-100 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">{race.label}</p>
                            <p className="text-xl font-bold text-slate-900 mb-1">{secondsToTime(finishTime)}</p>
                            <p className="text-xs font-medium text-slate-400 font-mono">{secondsToTime(pSec)}/km</p>
                        </div>
                    );
                })}
            </div>
            <p className="text-[10px] text-slate-400 mt-6 italic text-right">Predictions based on Riegel's Formula (f=1.06) referenced to your benchmark.</p>
        </div>
    </div>
  );
};

export default PacingTable;
