import React, { useMemo } from 'react';
import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { FactSale, GlobalFilters } from '../types/sales';
import {
  aggregateProvinces,
  aggregateStores,
  formatCAD,
  formatCADExact,
  formatNumber,
  formatPct,
} from '../lib/analytics/calculations';
import { CanadaProvinceMap } from '../components/CanadaProvinceMap';
import { ChartCard } from '../components/ChartCard';
import { VirtualTable, type VirtualColumn } from '../components/VirtualTable';

interface StoresRegionsViewProps {
  filteredFacts: FactSale[];
  filters: GlobalFilters;
  onCrossFilter: (field: 'stores' | 'provinces', value: string) => void;
}

export const StoresRegionsView: React.FC<StoresRegionsViewProps> = ({
  filteredFacts,
  filters,
  onCrossFilter,
}) => {
  const useRecomp = filters.useRecomputedFinancials;

  const stores = useMemo(
    () => aggregateStores(filteredFacts, useRecomp),
    [filteredFacts, useRecomp]
  );

  const provinces = useMemo(
    () => aggregateProvinces(filteredFacts, useRecomp),
    [filteredFacts, useRecomp]
  );

  const avgStoreSales = useMemo(() => {
    if (stores.length === 0) return 0;
    return stores.reduce((a, s) => a + s.sales, 0) / stores.length;
  }, [stores]);

  const axisStyle = { fontSize: 11, fill: '#94A3B8' };

  const drilldownCols: Array<VirtualColumn<Record<string, unknown>>> = [
    { key: 'province', label: 'Province' },
    { key: 'store', label: 'Store' },
    {
      key: 'sales',
      label: 'Sales (CAD)',
      align: 'right',
      render: (r) => formatCAD(Number(r.sales)),
    },
    {
      key: 'quantity',
      label: 'Quantity',
      align: 'right',
      render: (r) => formatNumber(Number(r.quantity)),
    },
    { key: 'orders', label: 'Orders', align: 'right' },
    {
      key: 'aov',
      label: 'AOV (CAD)',
      align: 'right',
      render: (r) => formatCADExact(Number(r.aov)),
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
    {
      key: 'growthPct',
      label: 'Half-over-Half Growth',
      align: 'right',
      render: (r) => {
        const g = r.growthPct as number | null;
        if (g === null || g === undefined) return '—';
        return (
          <span className={g >= 0 ? 'text-emerald-600 dark:text-[#26E6D0]' : 'text-rose-500'}>
            {g >= 0 ? '+' : ''}
            {(g * 100).toFixed(1)}%
          </span>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <ChartCard
          className="lg:col-span-6"
          title="Sales by Store vs Network Average"
          subtitle={`Dashed reference line indicates network store average (${formatCAD(avgStoreSales, true)}) · Click to filter`}
          exportName="sales_by_store"
          isEmpty={stores.length === 0}
          minHeight={330}
          tableData={stores.map((s) => ({
            Store: s.store,
            Province: s.province,
            'Sales (CAD)': s.sales,
            Orders: s.orders,
            'AOV (CAD)': Number(s.aov.toFixed(2)),
            'Discount %': `${(s.discountPct * 100).toFixed(1)}%`,
          }))}
        >
          <ResponsiveContainer width="100%" height={330}>
            <BarChart
              layout="vertical"
              data={stores}
              margin={{ top: 10, right: 20, left: 16, bottom: 8 }}
            >
              <XAxis
                type="number"
                tick={axisStyle}
                axisLine={{ stroke: 'rgba(148,163,184,0.28)' }}
                tickLine={false}
                tickFormatter={(v) => formatCAD(Number(v), true)}
              />
              <YAxis
                type="category"
                dataKey="store"
                width={145}
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
                formatter={(v: unknown) => [formatCAD(Number(v)), 'Net Sales']}
              />
              <ReferenceLine
                x={avgStoreSales}
                stroke="#B740DE"
                strokeDasharray="5 4"
                strokeWidth={2}
                label={{
                  value: 'Avg',
                  position: 'top',
                  fill: '#B740DE',
                  fontSize: 11,
                }}
              />
              <Bar
                dataKey="sales"
                name="Net Sales (CAD)"
                radius={[0, 6, 6, 0]}
                barSize={20}
                animationDuration={320}
                className="cursor-pointer"
                onClick={(entry) => {
                  const st = (entry as unknown as { store?: string; payload?: { store?: string } }).store ??
                    (entry as unknown as { payload?: { store?: string } }).payload?.store;
                  if (st) onCrossFilter('stores', st);
                }}
              >
                {stores.map((s) => (
                  <Cell
                    key={s.store}
                    fill={s.sales >= avgStoreSales ? '#26E6D0' : '#4E8FA8'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          className="lg:col-span-6"
          title="Canadian Regional Tracking"
          subtitle="Hover provinces for Sales, Units, Growth & Discount % · Click to cross-filter"
          exportName="canada_regional_map"
          isEmpty={provinces.length === 0}
          minHeight={330}
          tableData={provinces.map((p) => ({
            Province: p.province,
            Stores: p.storeCount,
            'Sales (CAD)': p.sales,
            Quantity: p.quantity,
            'Share %': `${(p.sharePct * 100).toFixed(1)}%`,
            'Discount %': `${(p.discountPct * 100).toFixed(1)}%`,
          }))}
        >
          <CanadaProvinceMap
            data={provinces}
            selectedProvinces={filters.provinces}
            onToggleProvince={(prov) => onCrossFilter('provinces', prov)}
          />
        </ChartCard>
      </div>

      {/* Province x Store Drilldown Table */}
      <section className="rounded-[16px] border border-slate-200/90 bg-white p-5 dark:border-white/10 dark:bg-[#16314D]">
        <div className="mb-3">
          <h3 className="font-display text-base font-semibold text-[#0F2238] dark:text-white">
            Province × Store Drilldown
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Click any store row to cross-filter across all analytics tabs
          </p>
        </div>
        <VirtualTable
          rows={stores as unknown as Array<Record<string, unknown>>}
          columns={drilldownCols}
          exportName="province_store_drilldown"
          onRowClick={(r) => onCrossFilter('stores', String(r.store))}
        />
      </section>
    </div>
  );
};
