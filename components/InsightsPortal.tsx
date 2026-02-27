import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Activity, HeartPulse, GaugeCircle, Timer } from 'lucide-react';
import { IntervalsIcuConfig } from '../types';
import { InsightsDataset, InsightsRangeKey, RunningEconomyPoint, RecoveryPoint, filterByRange, loadInsightsDataset } from '../services/intervalsInsightsService';
import { secondsToTime } from '../utils/calculations';

interface InsightsPortalProps {
  intervalsConfig: IntervalsIcuConfig;
  active: boolean;
}

type ChartSeries = {
  key: string;
  label: string;
  color: string;
  values: number[];
};

const RANGE_OPTIONS: Array<{ key: InsightsRangeKey; label: string }> = [
  { key: '1y', label: 'Year' },
  { key: '6m', label: '6M' },
  { key: '3m', label: '3M' },
  { key: '1m', label: '1M' },
  { key: '1w', label: 'Week' },
];

const RECOVERY_RANGE_OPTIONS: Array<{ key: InsightsRangeKey; label: string }> = [
  ...RANGE_OPTIONS,
  { key: '1d', label: 'Day' },
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const trendText = (values: number[], precision = 1): string => {
  if (values.length < 2) return 'Not enough history';
  const tail = values.slice(-Math.min(7, values.length));
  const head = values.slice(0, Math.min(7, values.length));
  const a = head.reduce((sum, value) => sum + value, 0) / head.length;
  const b = tail.reduce((sum, value) => sum + value, 0) / tail.length;
  const delta = b - a;
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta.toFixed(precision)} vs early period`;
};

const metricTone = (value: number, goodThreshold: number, neutralThreshold: number): string => {
  if (value >= goodThreshold) return 'text-emerald-600 dark:text-emerald-300';
  if (value >= neutralThreshold) return 'text-amber-600 dark:text-amber-300';
  return 'text-rose-600 dark:text-rose-300';
};

const buildPath = (values: number[], width: number, height: number, minY: number, maxY: number): string => {
  if (values.length === 0) return '';
  if (values.length === 1) {
    const y = height / 2;
    return `M 0 ${y} L ${width} ${y}`;
  }

  const range = maxY - minY || 1;
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const normalized = (value - minY) / range;
      const y = height - (normalized * height);
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${clamp(y, 0, height).toFixed(2)}`;
    })
    .join(' ');
};

const MiniLineChart: React.FC<{
  labels: string[];
  series: ChartSeries[];
  yLabel: string;
}> = ({ labels, series, yLabel }) => {
  const width = 1000;
  const height = 240;
  const allValues = series.flatMap((s) => s.values).filter((v) => Number.isFinite(v));
  const min = allValues.length ? Math.min(...allValues) : 0;
  const max = allValues.length ? Math.max(...allValues) : 1;
  const pad = Math.max(1, (max - min) * 0.15);
  const minY = min - pad;
  const maxY = max + pad;

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-56" role="img" aria-label={yLabel}>
        <rect x="0" y="0" width={width} height={height} fill="transparent" />
        {[0.2, 0.4, 0.6, 0.8].map((f) => (
          <line
            key={f}
            x1="0"
            y1={height * f}
            x2={width}
            y2={height * f}
            stroke="currentColor"
            className="text-slate-200 dark:text-slate-700"
            strokeWidth="1"
          />
        ))}
        {series.map((item) => (
          <path
            key={item.key}
            d={buildPath(item.values, width, height, minY, maxY)}
            fill="none"
            stroke={item.color}
            strokeWidth="3"
            strokeLinecap="round"
          />
        ))}
      </svg>
      <div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-slate-500 dark:text-slate-400">
        <span>{labels[0] || '-'}</span>
        <span>{labels[Math.floor(labels.length / 2)] || '-'}</span>
        <span>{labels[labels.length - 1] || '-'}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-xs">
        {series.map((item) => (
          <span key={item.key} className="inline-flex items-center gap-2 text-slate-600 dark:text-slate-300">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
};

const InsightsPortal: React.FC<InsightsPortalProps> = ({ intervalsConfig, active }) => {
  const [dataset, setDataset] = useState<InsightsDataset | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [economyRange, setEconomyRange] = useState<InsightsRangeKey>('3m');
  const [recoveryRange, setRecoveryRange] = useState<InsightsRangeKey>('1m');

  const loadData = async () => {
    if (!intervalsConfig.connected) return;
    setLoading(true);
    setError('');
    try {
      const next = await loadInsightsDataset(intervalsConfig);
      setDataset(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load insights');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!active || !intervalsConfig.connected) return;
    void loadData();
  }, [active, intervalsConfig.connected, intervalsConfig.apiKey, intervalsConfig.athleteId]);

  const economyRows = useMemo(() => {
    if (!dataset) return [] as RunningEconomyPoint[];
    return filterByRange(dataset.economy, economyRange);
  }, [dataset, economyRange]);

  const recoveryRows = useMemo(() => {
    if (!dataset) return [] as RecoveryPoint[];
    return filterByRange(dataset.recovery, recoveryRange);
  }, [dataset, recoveryRange]);

  const latestEconomy = economyRows.length ? economyRows[economyRows.length - 1] : null;
  const latestRecovery = recoveryRows.length ? recoveryRows[recoveryRows.length - 1] : null;

  if (!intervalsConfig.connected) {
    return (
      <section className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/90 p-6 text-sm text-slate-600 dark:text-slate-300">
        Connect Intervals.icu in Settings to unlock Recovery and Running Economy analytics.
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/90 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Performance Hub</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Simplified Coros-style view of recovery and running economy based on Intervals.icu data.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadData()}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-norway-blue"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh data
          </button>
        </div>

        {error ? (
          <p className="mt-4 text-sm text-rose-600 dark:text-rose-300">{error}</p>
        ) : null}

        {loading && !dataset ? (
          <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">Loading data from Intervals.icu…</p>
        ) : null}

        {dataset ? (
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Last updated: {new Date(dataset.fetchedAt).toLocaleString()}</p>
        ) : null}
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <article className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400"><GaugeCircle size={13} /> Economy</div>
          <p className={`mt-2 text-3xl font-bold ${metricTone(latestEconomy?.economyScore || 0, 2.1, 1.7)}`}>{latestEconomy ? latestEconomy.economyScore.toFixed(2) : '--'}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">meters/heartbeat proxy</p>
        </article>

        <article className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400"><Timer size={13} /> Pace @ Economy</div>
          <p className="mt-2 text-3xl font-bold text-slate-900 dark:text-slate-100">{latestEconomy ? secondsToTime(latestEconomy.paceSecPerKm) : '--'}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">min/km average on selected runs</p>
        </article>

        <article className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400"><HeartPulse size={13} /> Recovery Score</div>
          <p className={`mt-2 text-3xl font-bold ${metricTone(latestRecovery?.recoveryScore || 0, 75, 60)}`}>{latestRecovery ? Math.round(latestRecovery.recoveryScore) : '--'}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">HRV + Resting HR + load balance</p>
        </article>

        <article className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400"><Activity size={13} /> Load Ratio</div>
          <p className="mt-2 text-3xl font-bold text-slate-900 dark:text-slate-100">{latestRecovery?.loadRatio ? latestRecovery.loadRatio.toFixed(2) : '--'}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">7-day / 28-day</p>
        </article>
      </section>

      <section className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/90 p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Running Economy Over Time</h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Higher economy score means more speed produced per heartbeat.</p>
          </div>
          <div className="inline-flex items-center gap-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1">
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setEconomyRange(option.key)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold ${economyRange === option.key ? 'bg-norway-blue text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {economyRows.length ? (
          <>
            <MiniLineChart
              labels={economyRows.map((r) => r.date)}
              yLabel="Running economy"
              series={[
                { key: 'economy', label: 'Economy score', color: '#0f3b86', values: economyRows.map((r) => r.economyScore) },
                { key: 'hr', label: 'Avg HR', color: '#ef4444', values: economyRows.map((r) => r.avgHr / 60) },
              ]}
            />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-slate-600 dark:text-slate-300">
                <span className="font-semibold text-slate-800 dark:text-slate-100">Trend:</span> {trendText(economyRows.map((r) => r.economyScore), 2)}
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-slate-600 dark:text-slate-300">
                <span className="font-semibold text-slate-800 dark:text-slate-100">Cadence:</span> {latestEconomy?.cadence ? `${latestEconomy.cadence.toFixed(1)} spm` : 'Not available'}
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-slate-600 dark:text-slate-300">
                <span className="font-semibold text-slate-800 dark:text-slate-100">Dynamics:</span> {latestEconomy?.groundContactMs ? `${latestEconomy.groundContactMs.toFixed(0)} ms GCT` : 'No advanced dynamics in source data'}
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">No running economy data available in selected range.</p>
        )}
      </section>

      <section className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/90 p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Recovery Over Time</h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Single score designed for faster read: HRV, resting HR, and load ratio.</p>
          </div>
          <div className="inline-flex items-center gap-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1">
            {RECOVERY_RANGE_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setRecoveryRange(option.key)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold ${recoveryRange === option.key ? 'bg-norway-blue text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {recoveryRows.length ? (
          <>
            <MiniLineChart
              labels={recoveryRows.map((r) => r.date)}
              yLabel="Recovery score"
              series={[
                { key: 'recovery', label: 'Recovery score', color: '#16a34a', values: recoveryRows.map((r) => r.recoveryScore) },
                { key: 'load', label: 'Load ratio x100', color: '#f59e0b', values: recoveryRows.map((r) => (r.loadRatio || 1) * 45) },
              ]}
            />
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-slate-600 dark:text-slate-300">
                <span className="font-semibold text-slate-800 dark:text-slate-100">Trend:</span> {trendText(recoveryRows.map((r) => r.recoveryScore), 1)}
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-slate-600 dark:text-slate-300">
                <span className="font-semibold text-slate-800 dark:text-slate-100">HRV:</span> {latestRecovery?.hrv ? `${latestRecovery.hrv.toFixed(1)} ms` : 'Unavailable'}
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-slate-600 dark:text-slate-300">
                <span className="font-semibold text-slate-800 dark:text-slate-100">Resting HR:</span> {latestRecovery?.restingHr ? `${latestRecovery.restingHr.toFixed(0)} bpm` : 'Unavailable'}
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-slate-600 dark:text-slate-300">
                <span className="font-semibold text-slate-800 dark:text-slate-100">Acute/Chronic:</span> {latestRecovery?.loadRatio ? latestRecovery.loadRatio.toFixed(2) : '--'}
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">No recovery data available in selected range.</p>
        )}
      </section>
    </div>
  );
};

export default InsightsPortal;
