import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Activity, HeartPulse, GaugeCircle, Timer, Zap } from 'lucide-react';
import { IntervalsIcuConfig } from '../types';
import { InsightsDataset, InsightsRangeKey, RunningEconomyPoint, RecoveryPoint, ThresholdProgressPoint, filterByRange, loadInsightsDataset, rangeToDays } from '../services/intervalsInsightsService';
import { secondsToTime } from '../utils/calculations';

interface InsightsPortalProps {
  intervalsConfig: IntervalsIcuConfig;
  active: boolean;
  targetSubthresholdPct?: number;
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
const smoothSeries = (values: number[], window = 5): number[] => {
  if (values.length <= 2 || window <= 1) return values;
  return values.map((_, index) => {
    const start = Math.max(0, index - window + 1);
    const slice = values.slice(start, index + 1);
    return slice.reduce((sum, value) => sum + value, 0) / slice.length;
  });
};

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

const InsightsPortal: React.FC<InsightsPortalProps> = ({ intervalsConfig, active, targetSubthresholdPct }) => {
  const [dataset, setDataset] = useState<InsightsDataset | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [economyRange, setEconomyRange] = useState<InsightsRangeKey>('3m');
  const [thresholdRange, setThresholdRange] = useState<InsightsRangeKey>('3m');
  const [recoveryRange, setRecoveryRange] = useState<InsightsRangeKey>('1m');
  const lookbackDays = useMemo(
    () => Math.max(rangeToDays(economyRange), rangeToDays(thresholdRange), rangeToDays(recoveryRange)) + 60,
    [economyRange, recoveryRange, thresholdRange]
  );

  const loadData = async () => {
    if (!intervalsConfig.connected) return;
    setLoading(true);
    setError('');
    try {
      const next = await loadInsightsDataset(intervalsConfig, lookbackDays);
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
  }, [active, intervalsConfig.connected, intervalsConfig.apiKey, intervalsConfig.athleteId, lookbackDays]);

  const economyRows = useMemo(() => {
    if (!dataset) return [] as RunningEconomyPoint[];
    return filterByRange(dataset.economy, economyRange);
  }, [dataset, economyRange]);

  const recoveryRows = useMemo(() => {
    if (!dataset) return [] as RecoveryPoint[];
    return filterByRange(dataset.recovery, recoveryRange);
  }, [dataset, recoveryRange]);
  const thresholdRows = useMemo(() => {
    if (!dataset) return [] as ThresholdProgressPoint[];
    return filterByRange(dataset.thresholdProgress, thresholdRange);
  }, [dataset, thresholdRange]);
  const methodTargetPct = useMemo(() => {
    const raw = Number(targetSubthresholdPct);
    if (!Number.isFinite(raw) || raw <= 0) return 40;
    return clamp(raw, 10, 80);
  }, [targetSubthresholdPct]);
  const scoredThresholdRows = useMemo(() => {
    return thresholdRows.map((row) => {
      const deviation = Math.abs(row.subthresholdSharePct - methodTargetPct);
      const score = clamp(100 - (deviation * 3), 0, 100);
      return { ...row, norwegianMethodScore: Number(score.toFixed(1)) };
    });
  }, [methodTargetPct, thresholdRows]);

  const latestEconomy = economyRows.length ? economyRows[economyRows.length - 1] : null;
  const latestRecovery = recoveryRows.length ? recoveryRows[recoveryRows.length - 1] : null;
  const latestThreshold = scoredThresholdRows.length ? scoredThresholdRows[scoredThresholdRows.length - 1] : null;
  const smoothedEconomy = useMemo(() => smoothSeries(economyRows.map((r) => r.economyScore), 7), [economyRows]);
  const smoothedThresholdSpeed = useMemo(() => smoothSeries(scoredThresholdRows.map((r) => r.thresholdSpeedKmh), 4), [scoredThresholdRows]);
  const smoothedMethodScore = useMemo(() => smoothSeries(scoredThresholdRows.map((r) => r.norwegianMethodScore), 4), [scoredThresholdRows]);
  const smoothedRecovery = useMemo(() => smoothSeries(recoveryRows.map((r) => r.recoveryScore), 5), [recoveryRows]);
  const smoothedLoadRatio = useMemo(() => smoothSeries(recoveryRows.map((r) => (r.loadRatio || 1) * 45), 5), [recoveryRows]);
  const metricCards = useMemo(() => {
    const cards: Array<{ key: string; title: string; value: string; subtitle: string; tone?: string; icon: React.ReactNode }> = [];
    if (latestEconomy) {
      cards.push({
        key: 'economy',
        title: 'Economy',
        value: latestEconomy.economyScore.toFixed(2),
        subtitle: 'index (min 60 · max 140)',
        tone: metricTone(latestEconomy.economyScore || 0, 105, 95),
        icon: <GaugeCircle size={13} />,
      });
      cards.push({
        key: 'pace',
        title: 'Pace @ Economy',
        value: secondsToTime(latestEconomy.paceSecPerKm),
        subtitle: 'min/km average on selected runs',
        icon: <Timer size={13} />,
      });
    }
    if (latestRecovery) {
      cards.push({
        key: 'recovery',
        title: 'Recovery Score',
        value: `${Math.round(latestRecovery.recoveryScore)}`,
        subtitle: 'score 0-100',
        tone: metricTone(latestRecovery.recoveryScore || 0, 75, 60),
        icon: <HeartPulse size={13} />,
      });
    }
    if (latestRecovery?.loadRatio) {
      cards.push({
        key: 'load',
        title: 'Load Ratio',
        value: latestRecovery.loadRatio.toFixed(2),
        subtitle: '7d/28d (target 0.8-1.2)',
        icon: <Activity size={13} />,
      });
    }
    if (latestThreshold) {
      cards.push({
        key: 'threshold-speed',
        title: 'SubT Speed',
        value: `${latestThreshold.thresholdSpeedKmh.toFixed(1)} km/h`,
        subtitle: 'weekly (typical 10-22 km/h)',
        icon: <Zap size={13} />,
      });
    }
    return cards;
  }, [latestEconomy, latestRecovery, latestThreshold]);

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
              Simplified view of recovery and running economy based on Intervals.icu data.
            </p>
            {dataset?.thresholdContext?.thresholdPaceSecPerKm ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Threshold context from Intervals: {secondsToTime(dataset.thresholdContext.thresholdPaceSecPerKm)}/km
                {dataset.thresholdContext.thresholdHrBpm ? ` · ${dataset.thresholdContext.thresholdHrBpm} bpm` : ''}
                {dataset.thresholdContext.subTPaceLowSecPerKm && dataset.thresholdContext.subTPaceHighSecPerKm
                  ? ` · SubT pace band ${secondsToTime(dataset.thresholdContext.subTPaceLowSecPerKm)}-${secondsToTime(dataset.thresholdContext.subTPaceHighSecPerKm)}/km`
                  : ''}
                {dataset.thresholdContext.subTHrLowBpm && dataset.thresholdContext.subTHrHighBpm
                  ? ` · SubT HR band ${dataset.thresholdContext.subTHrLowBpm}-${dataset.thresholdContext.subTHrHighBpm} bpm`
                  : ''}
              </p>
            ) : null}
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

      {metricCards.length > 0 && (
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {metricCards.map((card) => (
            <article key={card.key} className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
              <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400">{card.icon} {card.title}</div>
              <p className={`mt-2 text-3xl font-bold ${card.tone || 'text-slate-900 dark:text-slate-100'}`}>{card.value}</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{card.subtitle}</p>
            </article>
          ))}
        </section>
      )}

      {metricCards.length > 0 && (
        <section className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 p-4">
          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">How to read these values</h4>
          <div className="mt-3 grid md:grid-cols-2 xl:grid-cols-4 gap-2.5 text-xs">
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-800/80 px-3 py-2.5 text-slate-600 dark:text-slate-300">
              Economy index: min 60, max 140. 100 = your early baseline.
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-800/80 px-3 py-2.5 text-slate-600 dark:text-slate-300">
              Recovery score: 0-100. Higher means better readiness.
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-800/80 px-3 py-2.5 text-slate-600 dark:text-slate-300">
              Load ratio target: 0.8-1.2. Above 1.3 increases fatigue risk.
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-800/80 px-3 py-2.5 text-slate-600 dark:text-slate-300">
              Method score: 0-100, based on match vs your configured SubT % target.
            </div>
          </div>
        </section>
      )}

      {metricCards.length > 0 && (
        <section className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 p-4">
          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">How metrics are calculated</h4>
          <div className="mt-3 grid md:grid-cols-2 gap-2.5 text-xs">
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-800/80 px-3 py-2.5 text-slate-600 dark:text-slate-300">
              <p className="font-semibold text-slate-800 dark:text-slate-100">Running Economy (Index)</p>
              <p className="mt-1">For each run sample: HR-normalized speed = speed_m/s × (normalization_HR ÷ avg_HR). Daily economy is averaged, then indexed vs early baseline (100 = baseline).</p>
              <p className="mt-1">Range shown: 60-140.</p>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-800/80 px-3 py-2.5 text-slate-600 dark:text-slate-300">
              <p className="font-semibold text-slate-800 dark:text-slate-100">Recovery Score</p>
              <p className="mt-1">Weighted score = HRV component (45%) + Resting HR component (35%) + Load component (20%). HRV/RHR are compared to your personal median baselines.</p>
              <p className="mt-1">Range: 0-100.</p>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-800/80 px-3 py-2.5 text-slate-600 dark:text-slate-300">
              <p className="font-semibold text-slate-800 dark:text-slate-100">Load Ratio</p>
              <p className="mt-1">Acute-to-chronic ratio = 7-day rolling load ÷ 28-day rolling load.</p>
              <p className="mt-1">Target band: 0.8-1.2.</p>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-800/80 px-3 py-2.5 text-slate-600 dark:text-slate-300">
              <p className="font-semibold text-slate-800 dark:text-slate-100">SubT Speed</p>
              <p className="mt-1">Weekly average speed from sessions classified as subthreshold using Intervals threshold context (pace/HR bands) or explicit SubT workout tags.</p>
              <p className="mt-1">Displayed in km/h and pace/km.</p>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-800/80 px-3 py-2.5 text-slate-600 dark:text-slate-300 md:col-span-2">
              <p className="font-semibold text-slate-800 dark:text-slate-100">Norwegian Method Score</p>
              <p className="mt-1">Score reflects how close your weekly SubT share is to your configured plan target. Formula: 100 - (|actual_subT% - target_subT%| × 3), clipped to 0-100.</p>
              <p className="mt-1">Range: 0-100 (higher means your weekly intensity distribution matches your plan better).</p>
            </div>
          </div>
        </section>
      )}

      {economyRows.length > 0 && <section className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/90 p-6 space-y-4">
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

        <MiniLineChart
          labels={economyRows.map((r) => r.date)}
          yLabel="Running economy"
          series={[
            { key: 'economy', label: 'Economy score (smoothed)', color: '#0f3b86', values: smoothedEconomy },
            { key: 'hr', label: 'Avg HR', color: '#ef4444', values: economyRows.map((r) => r.avgHr / 60) },
          ]}
        />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-slate-600 dark:text-slate-300">
            <span className="font-semibold text-slate-800 dark:text-slate-100">Trend:</span> {trendText(economyRows.map((r) => r.economyScore), 2)}
          </div>
          {latestEconomy?.cadence ? (
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-slate-600 dark:text-slate-300">
              <span className="font-semibold text-slate-800 dark:text-slate-100">Cadence:</span> {latestEconomy.cadence.toFixed(1)} spm
            </div>
          ) : null}
          {latestEconomy?.groundContactMs ? (
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-slate-600 dark:text-slate-300">
              <span className="font-semibold text-slate-800 dark:text-slate-100">Dynamics:</span> {latestEconomy.groundContactMs.toFixed(0)} ms GCT
            </div>
          ) : null}
        </div>
      </section>}

      {scoredThresholdRows.length > 0 && <section className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/90 p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Subthreshold Performance Over Time</h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Tracks threshold speed and Norwegian-method distribution consistency.</p>
          </div>
          <div className="inline-flex items-center gap-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1">
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setThresholdRange(option.key)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold ${thresholdRange === option.key ? 'bg-norway-blue text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <MiniLineChart
          labels={scoredThresholdRows.map((r) => r.date)}
          yLabel="Subthreshold speed and method score"
          series={[
            { key: 'speed', label: 'SubT speed km/h (smoothed)', color: '#2563eb', values: smoothedThresholdSpeed },
            { key: 'method', label: 'Norwegian method score (smoothed)', color: '#7c3aed', values: smoothedMethodScore },
          ]}
        />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-slate-600 dark:text-slate-300">
            <span className="font-semibold text-slate-800 dark:text-slate-100">Speed trend:</span> {trendText(scoredThresholdRows.map((r) => r.thresholdSpeedKmh), 2)} km/h
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-slate-600 dark:text-slate-300">
            <span className="font-semibold text-slate-800 dark:text-slate-100">Latest pace:</span> {latestThreshold ? `${secondsToTime(latestThreshold.thresholdPaceSecPerKm)}/km` : '--'}
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-slate-600 dark:text-slate-300">
            <span className="font-semibold text-slate-800 dark:text-slate-100">SubT share:</span> {latestThreshold ? `${latestThreshold.subthresholdSharePct.toFixed(1)}%` : '--'}
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-slate-600 dark:text-slate-300">
            <span className="font-semibold text-slate-800 dark:text-slate-100">Method score:</span> {latestThreshold ? `${Math.round(latestThreshold.norwegianMethodScore)}/100` : '--'} (target {methodTargetPct.toFixed(1)}%)
          </div>
        </div>
      </section>}

      {recoveryRows.length > 0 && <section className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/90 p-6 space-y-4">
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

        <MiniLineChart
          labels={recoveryRows.map((r) => r.date)}
          yLabel="Recovery score"
          series={[
            { key: 'recovery', label: 'Recovery score (smoothed)', color: '#16a34a', values: smoothedRecovery },
            { key: 'load', label: 'Load ratio x100 (smoothed)', color: '#f59e0b', values: smoothedLoadRatio },
          ]}
        />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-slate-600 dark:text-slate-300">
            <span className="font-semibold text-slate-800 dark:text-slate-100">Trend:</span> {trendText(recoveryRows.map((r) => r.recoveryScore), 1)}
          </div>
          {latestRecovery?.hrv ? (
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-slate-600 dark:text-slate-300">
              <span className="font-semibold text-slate-800 dark:text-slate-100">HRV:</span> {latestRecovery.hrv.toFixed(1)} ms
            </div>
          ) : null}
          {latestRecovery?.restingHr ? (
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-slate-600 dark:text-slate-300">
              <span className="font-semibold text-slate-800 dark:text-slate-100">Resting HR:</span> {latestRecovery.restingHr.toFixed(0)} bpm
            </div>
          ) : null}
          {latestRecovery?.loadRatio ? (
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-slate-600 dark:text-slate-300">
              <span className="font-semibold text-slate-800 dark:text-slate-100">Acute/Chronic:</span> {latestRecovery.loadRatio.toFixed(2)}
            </div>
          ) : null}
        </div>
      </section>}
    </div>
  );
};

export default InsightsPortal;
