import React, { useState } from 'react';
import { ArrowDownRight, ArrowUpRight, HelpCircle } from 'lucide-react';
import { Line, LineChart, ResponsiveContainer } from 'recharts';
import type { KpiMetric } from '../types/sales';

interface KpiCardProps {
  metric: KpiMetric;
  invertDeltaColor?: boolean;
}

export const KpiCard: React.FC<KpiCardProps> = ({ metric, invertDeltaColor = false }) => {
  const [showFormula, setShowFormula] = useState(false);

  const delta = metric.deltaPct;
  const yoy = metric.yoyDeltaPct;
  const isPositive = delta !== null && delta !== undefined ? delta >= 0 : null;
  const isGood = isPositive === null ? null : invertDeltaColor ? !isPositive : isPositive;

  const sparkData = (metric.sparkline ?? []).map((v, i) => ({ i, v }));

  return (
    <div className="relative flex flex-col justify-between rounded-[16px] border border-slate-200/90 bg-white p-4 transition-colors dark:border-white/10 dark:bg-[#16314D]">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
          {metric.label}
        </span>
        <button
          type="button"
          onClick={() => setShowFormula((v) => !v)}
          onMouseEnter={() => setShowFormula(true)}
          onMouseLeave={() => setShowFormula(false)}
          aria-label={`How is ${metric.label} calculated?`}
          className="rounded p-0.5 text-slate-400 transition-colors hover:text-[#0FA696] dark:hover:text-[#26E6D0]"
        >
          <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      {showFormula && (
        <div
          role="tooltip"
          className="absolute right-3 top-10 z-30 w-64 rounded-xl border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-700 shadow-lg dark:border-white/15 dark:bg-[#0F2238] dark:text-slate-200"
        >
          <div className="font-semibold text-[#0F2238] dark:text-white">Calculation Formula</div>
          <p className="mt-1">{metric.formula}</p>
        </div>
      )}

      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div
            className="truncate font-mono text-xl font-semibold tracking-tight text-[#0F2238] tabular-nums dark:text-white"
            title={metric.formatted}
          >
            {metric.formatted}
          </div>
          {metric.subtext && (
            <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
              {metric.subtext}
            </div>
          )}
        </div>

        {sparkData.length >= 2 && (
          <div className="h-9 w-20 shrink-0" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparkData}>
                <Line
                  type="monotone"
                  dataKey="v"
                  stroke="#26E6D0"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {(delta !== null && delta !== undefined) || (yoy !== null && yoy !== undefined) ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 pt-2.5 text-xs dark:border-white/10">
          {delta !== null && delta !== undefined && (
            <span
              className={`inline-flex items-center gap-0.5 font-mono font-medium tabular-nums ${
                isGood
                  ? 'text-emerald-600 dark:text-[#26E6D0]'
                  : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {delta >= 0 ? (
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <ArrowDownRight className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {delta >= 0 ? '+' : ''}
              {(delta * 100).toFixed(1)}% <span className="font-sans font-normal text-slate-500 dark:text-slate-400">prev</span>
            </span>
          )}
          {yoy !== null && yoy !== undefined && (
            <span className="font-mono text-slate-600 tabular-nums dark:text-slate-300">
              {yoy >= 0 ? '+' : ''}
              {(yoy * 100).toFixed(1)}% <span className="font-sans text-slate-500 dark:text-slate-400">YoY</span>
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
};
