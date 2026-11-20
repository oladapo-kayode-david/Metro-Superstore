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
import type { FactSale, GlobalFilters } from '../types/sales';
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
import { CHART_PALETTE, ChartCard } from '../components/ChartCard';
import { VirtualTable, type VirtualColumn } from '../components/VirtualTable';

interface ProductsViewProps {
  filteredFacts: FactSale[];
  filters: GlobalFilters;
  onCrossFilter: (field: 'products' | 'categories', value: string) => void;
}

export const ProductsView: React.FC<ProductsViewProps> = ({
  filteredFacts,
  filters,
  onCrossFilter,
}) => {
  const [rankMode, setRankMode] = useState<'top' | 'bottom'>('top');
  const [limitN, setLimitN] = useState<number>(10);
  const useRecomp = filters.useRecomputedFinancials;

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

  const catHeatmap = useMemo(
    () => aggregateCategoryByMonthHeatmap(filteredFacts, useRecomp),
    [filteredFacts, useRecomp]
  );

  const axisStyle = { fontSize: 11, fill: '#94A3B8' };

  const columns: Array<VirtualColumn<Record<string, unknown>>> = [
    { key: 'rank', label: '#', align: 'right', width: '50px' },
    { key: 'product', label: 'Product' },
    { key: 'category', label: 'Category' },
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
        subtitle="Horizontal ranked bars with cumulative share line · Click any bar to filter"
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
              fill="#26E6D0"
              radius={[0, 6, 6, 0]}
              barSize={18}
              animationDuration={320}
              className="cursor-pointer"
              onClick={(entry) => {
                const prod = (entry as unknown as { product?: string; payload?: { product?: string } }).product ??
                  (entry as unknown as { payload?: { product?: string } }).payload?.product;
                if (prod) onCrossFilter('products', prod);
              }}
            />
            <Line
              xAxisId="cum"
              type="monotone"
              dataKey="cumPctNum"
              name="Cumulative %"
              stroke="#B740DE"
              strokeWidth={2.2}
              dot={{ r: 3, fill: '#B740DE' }}
              animationDuration={320}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <ChartCard
          className="lg:col-span-5"
          title="Category Revenue Mix"
          subtitle="Donut breakdown · Click category to filter"
          exportName="category_donut"
          isEmpty={categories.length === 0}
        >
          <ResponsiveContainer width="100%" height={270}>
            <PieChart>
              <Pie
                data={categories}
                dataKey="sales"
                nameKey="category"
                cx="50%"
                cy="50%"
                innerRadius={58}
                outerRadius={96}
                paddingAngle={2}
                label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                labelLine={false}
                animationDuration={320}
                onClick={(entry) => {
                  const cat = (entry as unknown as { category?: string; payload?: { category?: string } }).category ??
                    (entry as unknown as { payload?: { category?: string } }).payload?.category;
                  if (cat) onCrossFilter('categories', cat);
                }}
                className="cursor-pointer text-[11px]"
              >
                {categories.map((c, idx) => (
                  <Cell key={c.category} fill={CHART_PALETTE[idx % CHART_PALETTE.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0F2238',
                  borderColor: 'rgba(255,255,255,0.14)',
                  borderRadius: 12,
                  fontSize: 12,
                  color: '#F1F5F9',
                }}
                formatter={(v: unknown) => [formatCAD(Number(v)), 'Net Sales']}
              />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          className="lg:col-span-7"
          title="Category × Month Revenue Heatmap"
          subtitle="Last 12 active months across product categories (CAD)"
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
                        className="hover:text-[#26E6D0] hover:underline"
                      >
                        {cat}
                      </button>
                    </td>
                    {catHeatmap.months.map((ym) => {
                      const val = catHeatmap.matrix[cat]?.[ym] ?? 0;
                      const ratio = catHeatmap.maxVal > 0 ? val / catHeatmap.maxVal : 0;
                      const bg =
                        ratio <= 0.02
                          ? 'rgba(148,163,184,0.12)'
                          : ratio < 0.55
                          ? `rgba(38, 230, 208, ${0.18 + ratio * 0.9})`
                          : `rgba(183, 64, 222, ${0.35 + (ratio - 0.5) * 1.1})`;
                      return (
                        <td
                          key={ym}
                          title={`${cat} (${ym}): ${formatCAD(val)}`}
                          style={{ backgroundColor: bg }}
                          className="h-9 rounded-md font-mono text-[10px] tabular-nums text-[#0F2238] dark:text-white"
                        >
                          {val > 0 ? formatCAD(val, true).replace('CA$', '') : '—'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
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
