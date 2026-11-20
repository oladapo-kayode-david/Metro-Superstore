import React, { useState } from 'react';
import type { EntityColorRegistry } from '../types/sales';
import type { ProvinceMetricRow } from '../lib/analytics/calculations';
import { formatCAD, formatNumber, formatPct } from '../lib/analytics/calculations';
import {
  getEntityColor,
  getSemanticColors,
  getSequentialScaleColor,
} from '../lib/theme/chartTheme';

interface CanadaProvinceMapProps {
  data: ProvinceMetricRow[];
  selectedProvinces: string[];
  onToggleProvince: (province: string) => void;
  theme: 'dark' | 'light';
  entityColors: EntityColorRegistry;
}

interface ProvinceTile {
  code: string;
  name: string;
  path: string;
  labelX: number;
  labelY: number;
}

const CANADA_PROVINCES_GEO: ProvinceTile[] = [
  { code: 'YT', name: 'Yukon', path: 'M 40 35 L 105 22 L 122 108 L 48 112 Z', labelX: 80, labelY: 74 },
  { code: 'NT', name: 'Northwest Territories', path: 'M 105 22 L 210 26 L 215 112 L 122 108 Z', labelX: 162, labelY: 74 },
  { code: 'NU', name: 'Nunavut', path: 'M 210 26 L 348 34 L 330 132 L 215 112 Z', labelX: 274, labelY: 82 },
  { code: 'BC', name: 'British Columbia', path: 'M 48 112 L 130 108 L 125 225 L 44 212 Z', labelX: 86, labelY: 168 },
  { code: 'AB', name: 'Alberta', path: 'M 130 108 L 195 111 L 192 232 L 125 225 Z', labelX: 160, labelY: 174 },
  { code: 'SK', name: 'Saskatchewan', path: 'M 195 111 L 258 114 L 256 236 L 192 232 Z', labelX: 225, labelY: 176 },
  { code: 'MB', name: 'Manitoba', path: 'M 258 114 L 325 128 L 318 242 L 256 236 Z', labelX: 288, labelY: 184 },
  { code: 'ON', name: 'Ontario', path: 'M 325 128 L 430 156 L 440 272 L 382 282 L 318 242 Z', labelX: 382, labelY: 218 },
  { code: 'QC', name: 'Quebec', path: 'M 430 156 L 542 126 L 560 232 L 440 272 Z', labelX: 492, labelY: 204 },
  { code: 'NL', name: 'Newfoundland and Labrador', path: 'M 542 126 L 622 106 L 636 184 L 560 194 Z', labelX: 590, labelY: 155 },
  { code: 'NB', name: 'New Brunswick', path: 'M 526 244 L 575 234 L 580 275 L 530 282 Z', labelX: 554, labelY: 262 },
  { code: 'PE', name: 'Prince Edward Island', path: 'M 582 225 L 626 220 L 628 246 L 584 249 Z', labelX: 605, labelY: 237 },
  { code: 'NS', name: 'Nova Scotia', path: 'M 580 256 L 638 248 L 632 292 L 582 294 Z', labelX: 608, labelY: 274 },
];

export const CanadaProvinceMap: React.FC<CanadaProvinceMapProps> = ({
  data,
  selectedProvinces,
  onToggleProvince,
  theme,
  entityColors,
}) => {
  const [hovered, setHovered] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'map' | 'tiles'>('map');

  const metricByProv = new Map(data.map((d) => [d.province, d]));
  const maxSales = Math.max(...data.map((d) => d.sales), 1);
  const hoveredMetric = hovered ? metricByProv.get(hovered) : null;
  const semantic = getSemanticColors(theme);

  const gradCss =
    theme === 'dark'
      ? 'linear-gradient(90deg, #16314D 0%, #26E6D0 50%, #B740DE 100%)'
      : 'linear-gradient(90deg, #DCE7F3 0%, #0FB8A5 50%, #9928BF 100%)';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
          <span>Low</span>
          <div className="h-2.5 w-28 rounded-full" style={{ background: gradCss }} />
          <span>High</span>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 p-0.5 dark:border-white/10">
          <button
            type="button"
            onClick={() => setViewMode('map')}
            className={`rounded-md px-2.5 py-1 text-xs font-medium ${
              viewMode === 'map'
                ? 'brand-gradient text-[#0F2238] font-semibold'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            Choropleth Map
          </button>
          <button
            type="button"
            onClick={() => setViewMode('tiles')}
            className={`rounded-md px-2.5 py-1 text-xs font-medium ${
              viewMode === 'tiles'
                ? 'brand-gradient text-[#0F2238] font-semibold'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            Ranked Tiles
          </button>
        </div>
      </div>

      {viewMode === 'map' ? (
        <div className="relative">
          <svg
            viewBox="0 0 680 315"
            className="h-auto w-full select-none"
            role="img"
            aria-label="Canadian provinces sales choropleth map"
          >
            {CANADA_PROVINCES_GEO.map((geo) => {
              const m = metricByProv.get(geo.name);
              const ratio = m ? Math.max(0.08, m.sales / maxSales) : 0;
              const { fill, text } = m
                ? getSequentialScaleColor(ratio, theme)
                : {
                    fill: theme === 'dark' ? '#122840' : '#E2E8F0',
                    text: (theme === 'dark' ? '#FFFFFF' : '#0F2238') as '#0F2238' | '#FFFFFF',
                  };
              const isSelected = selectedProvinces.includes(geo.name);
              const isHovered = hovered === geo.name;
              return (
                <g
                  key={geo.code}
                  onMouseEnter={() => setHovered(geo.name)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => m && onToggleProvince(geo.name)}
                  className={m ? 'cursor-pointer transition-opacity' : 'opacity-60'}
                >
                  <path
                    d={geo.path}
                    fill={fill}
                    stroke={
                      isSelected
                        ? theme === 'dark'
                          ? '#FFFFFF'
                          : '#0F2238'
                        : isHovered
                        ? '#26E6D0'
                        : theme === 'dark'
                        ? '#0F2238'
                        : '#FFFFFF'
                    }
                    strokeWidth={isSelected ? 2.5 : isHovered ? 2 : 1.4}
                    style={{ transition: 'fill 200ms ease, stroke-width 150ms ease' }}
                  />
                  <text
                    x={geo.labelX}
                    y={geo.labelY}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={text}
                    className="pointer-events-none text-[11px] font-bold"
                  >
                    {geo.code}
                  </text>
                  {m && (
                    <text
                      x={geo.labelX}
                      y={geo.labelY + 14}
                      textAnchor="middle"
                      fill={text}
                      fillOpacity={0.92}
                      className="pointer-events-none font-mono text-[9px] font-semibold"
                    >
                      {formatCAD(m.sales, true)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {hovered && (
            <div className="pointer-events-none absolute right-2 top-2 w-56 rounded-xl border border-slate-200 bg-white/95 p-3 text-xs shadow-lg backdrop-blur dark:border-white/15 dark:bg-[#0F2238]/95">
              <div className="font-display font-semibold text-[#0F2238] dark:text-white">
                {hovered}
              </div>
              {hoveredMetric ? (
                <div className="mt-1.5 space-y-1 font-mono tabular-nums text-slate-600 dark:text-slate-300">
                  <div className="flex justify-between">
                    <span className="font-sans">Sales</span>
                    <span className="font-semibold text-[#0F2238] dark:text-[#26E6D0]">
                      {formatCAD(hoveredMetric.sales)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-sans">Quantity</span>
                    <span>{formatNumber(hoveredMetric.quantity)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-sans">Growth</span>
                    <span
                      style={{
                        color:
                          hoveredMetric.growthPct === null
                            ? semantic.neutral
                            : hoveredMetric.growthPct >= 0
                            ? semantic.positive
                            : semantic.negative,
                      }}
                    >
                      {hoveredMetric.growthPct !== null
                        ? `${hoveredMetric.growthPct >= 0 ? '+' : ''}${(hoveredMetric.growthPct * 100).toFixed(1)}%`
                        : 'N/A'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-sans">Discount %</span>
                    <span>{formatPct(hoveredMetric.discountPct)}</span>
                  </div>
                </div>
              ) : (
                <p className="mt-1 text-slate-400">No recorded sales in active filter.</p>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {data.map((prov) => {
            const ratio = prov.sales / maxSales;
            const active = selectedProvinces.includes(prov.province);
            const provColor = getEntityColor(entityColors, 'provinces', prov.province, theme);
            return (
              <button
                key={prov.province}
                type="button"
                onClick={() => onToggleProvince(prov.province)}
                className={`rounded-xl border p-3 text-left transition-all ${
                  active
                    ? 'border-[#26E6D0] bg-[#26E6D0]/15'
                    : 'border-slate-200 bg-slate-50/80 hover:border-[#26E6D0]/50 dark:border-white/10 dark:bg-[#0F2238]/60'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: provColor }}
                    />
                    <span className="truncate text-xs font-semibold text-[#0F2238] dark:text-white">
                      {prov.province}
                    </span>
                  </div>
                  <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                    {formatPct(prov.sharePct)}
                  </span>
                </div>
                <div className="mt-1.5 font-mono text-base font-bold text-[#0F2238] tabular-nums dark:text-white">
                  {formatCAD(prov.sales, true)}
                </div>
                <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                  <span>{formatNumber(prov.quantity)} units</span>
                  <span
                    style={{
                      color:
                        prov.growthPct === null
                          ? semantic.neutral
                          : prov.growthPct >= 0
                          ? semantic.positive
                          : semantic.negative,
                    }}
                    className="font-mono font-medium"
                  >
                    {prov.growthPct !== null
                      ? `${prov.growthPct >= 0 ? '+' : ''}${(prov.growthPct * 100).toFixed(1)}%`
                      : '—'}
                  </span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(6, Math.round(ratio * 100))}%`,
                      backgroundColor: provColor,
                    }}
                  />
                </div>
              </button>
            );
          })}
        </div>
      )}
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        Click any province to cross-filter the entire dashboard.
      </p>
    </div>
  );
};
