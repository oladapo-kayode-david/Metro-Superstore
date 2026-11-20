import React, { useMemo, useState } from 'react';
import {
  Bar,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { EntityColorRegistry, FactSale, GlobalFilters } from '../types/sales';
import {
  aggregateCategories,
  aggregateCategoryByMonthHeatmap,
  aggregateProductPareto,
  formatCAD,
  formatCADExact,
  formatMonthLabel,
  formatNumber,
  formatPct,
} from '../lib/analytics/calculations';
import {
  getEntityColor,
  getEntityColorIndex,
  getPaletteColor,
  getPatternId,
  getSequentialScaleColor,
  getSurfaceColor,
  groupTopSlicesWithOther,
  OTHER_SLICE_COLOR,
} from '../lib/theme/chartTheme';
import { ChartCard, SeriesPatternDefs } from '../components/ChartCard';
import { VirtualTable, type VirtualColumn } from '../components/VirtualTable';

interface ProductsViewProps {
  filteredFacts: FactSale[];
  filters: GlobalFilters;
  theme: 'dark' | 'light';
  entityColors: EntityColorRegistry;
  onCrossFilter: (field: 'products' | 'categories', value: string) => void;
}

export const ProductsView: React.FC<ProductsViewProps> = ({
  filteredFacts,
  filters,
  theme,
  entityColors,
  onCrossFilter,
}) => {
  const [rankMode, setRankMode] = useState<'top' | 'bottom'>('top');
  const [limitN, setLimitN] = useState<number>(10);
  const useRecomp = filters.useRecomputedFinancials;

  const surfaceColor = getSurfaceColor(theme);
  const primaryTeal = getPaletteColor(0, theme);
  const secondaryPurple = getPaletteColor(1, theme);

  const allProducts = useMemo(
    () => aggregateProductPareto(filteredFacts, useRecomp),
    [filteredFacts, useRecomp]
  );

  const displayedProducts = useMemo(() => {
    if (rankMode === 'top') return allProducts.slice(0, limitN);
    return [...allProducts].reverse().slice(0, limitN);
  }, [allProducts, rankMode, limitN]);

  const categories = useMemo(
    () => aggregateCategories(filteredFacts, useRecomp),
    [filteredFacts, useRecomp]
  );

  const categorySlices = useMemo(
    () => groupTopSlicesWithOther(categories, (c) => c.category, 8),
    [categories]
  );

  const totalCategorySales = useMemo(
    () => categories.reduce((acc, c) => acc + c.sales, 0),
    [categories]
  );

  const catHeatmap = useMemo(
    () => aggregateCategoryByMonthHeatmap(filteredFacts, useRecomp),
    [filteredFacts, useRecomp]
  );

  const distinctDisplayedCats = useMemo(
    () => new Set(displayedProducts.map((p) => p.category)).size,
    [displayedProducts]
  );
  const useParetoPatterns = distinctDisplayedCats > 6;
  const useDonutPatterns = categorySlices.length > 6;

  const axisStyle = { fontSize: 11, fill: theme === 'dark' ? '#94A3B8' : '#475569' };

  const columns: Array<VirtualColumn<Record<string, unknown>>> = [
    { key: 'rank', label: '#', align: 'right', width: '50px' },
    { key: 'product', label: 'Product' },
    {
      key: 'category',
      label: 'Category',
      render: (r) => {
        const cat = String(r.category);
        return (
          <span className="inline-flex items-center gap-1.5">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: getEntityColor(entityColors, 'categories', cat, theme) }}
            />
            <span>{cat}</span>
          </span>
        );
      },
    },
    {
      key: 'sales',
      label: 'Sales (CAD)',
      align: 'right',
      render: (r) => formatCAD(Number(r.sales)),
    },
    {
      key: 'quantity',
      label: 'Units',
      align: 'right',
      render: (r) => formatNumber(Number(r.quantity)),
    },
    { key: 'orders', label: 'Orders', align: 'right' },
    {
      key: 'avgPrice',
      label: 'Avg Price',
      align: 'right',
      render: (r) => formatCADExact(Number(r.avgPrice)),
    },
    {
      key: 'discountPct',
      label: 'Discount %',
      align: 'right',
      render: (r) => formatPct(Number(r.discountPct)),
    },
    {
      key: 'sharePct',
      label: 'Share %',
      align: 'right',
      render: (r) => formatPct(Number(r.sharePct)),
    },
  ];

  return (
    <div className="space-y-6">
      <ChartCard
        title={`${rankMode === 'top' ? 'Top' : 'Bottom'} ${limitN} Products by Net Sales (Pareto)`}
        subtitle="Bars coloured by fixed Category token with cumulative share line · Click any bar to filter"
        exportName="products_pareto"
        isEmpty={displayedProducts.length === 0}
        minHeight={340}
        tableData={displayedProducts.map((p) => ({
          Rank: p.rank,
          Product: p.product,
          Category: p.category,
          'Sales (CAD)': p.sales,
          Quantity: p.quantity,
          'Cumulative %': `${(p.cumulativePct * 100).toFixed(1)}%`,
        }))}
        headerRight={
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-lg border border-slate-300 p-0.5 dark:border-white/15">
              <button
                type="button"
                onClick={() => setRankMode('top')}
                className={`rounded-md px-2 py-1 text-xs font-medium ${
                  rankMode === 'top'
                    ? 'brand-gradient text-[#0F2238] font-semibold'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                Top N
              </button>
              <button
                type="button"
                onClick={() => setRankMode('bottom')}
                className={`rounded-md px-2 py-1 text-xs font-medium ${
                  rankMode === 'bottom'
                    ? 'brand-gradient text-[#0F2238] font-semibold'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                Bottom N
              </button>
            </div>
            <select
              aria-label="Number of products"
              value={limitN}
              onChange={(e) => setLimitN(Number(e.target.value))}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-[#0F2238] dark:border-white/15 dark:bg-[#0F2238] dark:text-white"
            >
              {[5, 8, 10, 15, 20].map((n) => (
                <option key={n} value={n}>
                  {n} items
                </option>
              ))}
            </select>
          </div>
        }
      >
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart
            layout="vertical"
            data={displayedProducts.map((p) => ({
              ...p,
              cumPctNum: Number((p.cumulativePct * 100).toFixed(1)),
            }))}
            margin={{ top: 8, right: 24, left: 20, bottom: 8 }}
          >
            {useParetoPatterns && <SeriesPatternDefs prefix="prod-pareto" theme={theme} />}
            <XAxis
              xAxisId="sales"
              type="number"
              tick={axisStyle}
              axisLine={{ stroke: 'rgba(148,163,184,0.28)' }}
              tickLine={false}
              tickFormatter={(v) => formatCAD(Number(v), true)}
            />
            <XAxis
              xAxisId="cum"
              type="number"
              orientation="top"
              domain={[0, 100]}
              tick={axisStyle}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `${v}%`}
            />
            <YAxis
              type="category"
              dataKey="product"
              width={165}
              tick={axisStyle}
              axisLine={{ stroke: 'rgba(148,163,184,0.28)' }}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#0F2238',
                borderColor: 'rgba(255,255,255,0.14)',
                borderRadius: 12,
                fontSize: 12,
                color: '#F1F5F9',
              }}
              formatter={(v: unknown, name?: string | number) => {
                const label = String(name ?? '');
                return label === 'Cumulative %' ? [`${v}%`, label] : [formatCAD(Number(v)), label];
              }}
            />
            <Bar
              xAxisId="sales"
              dataKey="sales"
              name="Net Sales (CAD)"
              fill={primaryTeal}
              radius={[0, 6, 6, 0]}
              barSize={18}
              animationDuration={320}
              className="cursor-pointer"
              onClick={(entry) => {
                const prod =
                  (entry as unknown as { product?: string; payload?: { product?: string } }).product ??
                  (entry as unknown as { payload?: { product?: string } }).payload?.product;
                if (prod) onCrossFilter('products', prod);
              }}
            >
              {displayedProducts.map((p) => {
                const catIdx = getEntityColorIndex(entityColors, 'categories', p.category);
                const fill = useParetoPatterns
                  ? `url(#${getPatternId('prod-pareto', catIdx)})`
                  : getEntityColor(entityColors, 'categories', p.category, theme);
                return <Cell key={p.product} fill={fill} />;
              })}
            </Bar>
            <Line
              xAxisId="cum"
              type="monotone"
              dataKey="cumPctNum"
              name="Cumulative %"
              stroke={secondaryPurple}
              strokeWidth={2.2}
              dot={{ r: 3, fill: secondaryPurple }}
              animationDuration={320}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <ChartCard
          className="lg:col-span-5"
          title="Category Revenue Mix"
          subtitle="Max 8 + Other · Fixed category colours · Click slice to filter"
          exportName="category_donut"
          isEmpty={categories.length === 0}
          tableData={categories.map((c) => ({
            Category: c.category,
            'Sales (CAD)': c.sales,
            'Share %': `${(c.sharePct * 100).toFixed(1)}%`,
          }))}
        >
          <div className="flex flex-col items-center gap-3">
            <div className="relative h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  {useDonutPatterns && <SeriesPatternDefs prefix="prod-cat" theme={theme} />}
                  <Pie
                    data={categorySlices}
                    dataKey="sales"
                    nameKey="label"
                    cx="50%"
                    cy="50%"
                    innerRadius={56}
                    outerRadius={92}
                    stroke={surfaceColor}
                    strokeWidth={2}
                    animationDuration={320}
                    onClick={(entry) => {
                      const slice = entry as unknown as {
                        label?: string;
                        isOther?: boolean;
                        payload?: { label?: string; isOther?: boolean };
                      };
                      const label = slice.label ?? slice.payload?.label;
                      const isOther = slice.isOther ?? slice.payload?.isOther;
                      if (label && !isOther) onCrossFilter('categories', label);
                    }}
                    className="cursor-pointer"
                  >
                    {categorySlices.map((slice) => {
                      const baseColor = slice.isOther
                        ? OTHER_SLICE_COLOR
                        : getEntityColor(entityColors, 'categories', slice.label, theme);
                      const patIdx = getEntityColorIndex(entityColors, 'categories', slice.label);
                      const fill =
                        useDonutPatterns && !slice.isOther
                          ? `url(#${getPatternId('prod-cat', patIdx)})`
                          : baseColor;
                      return <Cell key={slice.label} fill={fill} />;
                    })}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0F2238',
                      borderColor: 'rgba(255,255,255,0.14)',
                      borderRadius: 12,
                      fontSize: 12,
                      color: '#F1F5F9',
                    }}
                    formatter={(v: unknown, name?: string | number) => [
                      formatCAD(Number(v)),
                      String(name ?? 'Net Sales'),
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>
              {/* Centered Total */}
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Total
                </span>
                <span className="mt-0.5 font-mono text-sm font-bold text-[#0F2238] tabular-nums dark:text-white">
                  {formatCAD(totalCategorySales, true)}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap justify-center gap-x-3 gap-y-1.5 text-[11px]">
              {categorySlices.map((slice) => (
                <button
                  key={slice.label}
                  type="button"
                  disabled={slice.isOther}
                  onClick={() => !slice.isOther && onCrossFilter('categories', slice.label)}
                  className="inline-flex items-center gap-1.5 text-slate-600 hover:text-[#0F2238] dark:text-slate-300 dark:hover:text-white"
                >
                  <span
                    className="h-2.5 w-2.5 rounded-sm"
                    style={{
                      backgroundColor: slice.isOther
                        ? OTHER_SLICE_COLOR
                        : getEntityColor(entityColors, 'categories', slice.label, theme),
                    }}
                  />
                  <span>
                    {slice.isOther ? `Other (${slice.count})` : slice.label}{' '}
                    <span className="font-mono tabular-nums opacity-75">
                      {Math.round(slice.sharePct * 100)}%
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </ChartCard>

        <ChartCard
          className="lg:col-span-7"
          title="Category × Month Revenue Heatmap"
          subtitle="Sequential scale (#16314D → #26E6D0 → #B740DE) across last 12 active months (CAD)"
          exportName="category_month_heatmap"
          isEmpty={catHeatmap.categories.length === 0}
        >
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-1 text-center text-[11px]">
              <thead>
                <tr>
                  <th className="px-2 py-1 text-left font-medium text-slate-500 dark:text-slate-400">
                    Category
                  </th>
                  {catHeatmap.months.map((ym) => (
                    <th key={ym} className="px-1 py-1 font-medium text-slate-500 dark:text-slate-400">
                      {formatMonthLabel(ym).split(' ')[0]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {catHeatmap.categories.map((cat) => (
                  <tr key={cat}>
                    <td className="whitespace-nowrap pr-2 text-left font-medium text-[#0F2238] dark:text-slate-200">
                      <button
                        type="button"
                        onClick={() => onCrossFilter('categories', cat)}
                        className="inline-flex items-center gap-1.5 hover:underline"
                      >
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{
                            backgroundColor: getEntityColor(entityColors, 'categories', cat, theme),
                          }}
                        />
                        <span>{cat}</span>
                      </button>
                    </td>
                    {catHeatmap.months.map((ym) => {
                      const val = catHeatmap.matrix[cat]?.[ym] ?? 0;
                      const ratio = catHeatmap.maxVal > 0 ? val / catHeatmap.maxVal : 0;
                      const cellColors = getSequentialScaleColor(ratio, theme);
                      return (
                        <td
                          key={ym}
                          title={`${cat} (${ym}): ${formatCAD(val)}`}
                          style={{
                            backgroundColor: cellColors.fill,
                            color: cellColors.text,
                          }}
                          className="h-9 rounded-md font-mono text-[10px] font-medium tabular-nums"
                        >
                          {val > 0 ? formatCAD(val, true).replace('CA$', '') : '—'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 flex items-center justify-end gap-2 text-[10px] text-slate-500 dark:text-slate-400">
              <span>Low</span>
              <span
                className="h-2 w-28 rounded-full"
                style={{
                  background:
                    theme === 'dark'
                      ? 'linear-gradient(90deg, #16314D 0%, #26E6D0 50%, #B740DE 100%)'
                      : 'linear-gradient(90deg, #DCE7F3 0%, #0FB8A5 50%, #9928BF 100%)',
                }}
              />
              <span>High</span>
            </div>
          </div>
        </ChartCard>
      </div>

      <section className="rounded-[16px] border border-slate-200/90 bg-white p-5 dark:border-white/10 dark:bg-[#16314D]">
        <div className="mb-3">
          <h3 className="font-display text-base font-semibold text-[#0F2238] dark:text-white">
            Full Product Catalog Performance
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Click any product row to cross-filter the dashboard
          </p>
        </div>
        <VirtualTable
          rows={allProducts as unknown as Array<Record<string, unknown>>}
          columns={columns}
          exportName="product_catalog_performance"
          onRowClick={(r) => onCrossFilter('products', String(r.product))}
        />
      </section>
    </div>
  );
};
