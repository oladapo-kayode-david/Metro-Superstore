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
import type { EntityColorRegistry, FactSale, GlobalFilters } from '../types/sales';
import {
  aggregateProvinces,
  aggregateStores,
  formatCAD,
  formatCADExact,
  formatNumber,
  formatPct,
} from '../lib/analytics/calculations';
import {
  getEntityColor,
  getEntityColorIndex,
  getPaletteColor,
  getPatternId,
  getSemanticColors,
} from '../lib/theme/chartTheme';
import { CanadaProvinceMap } from '../components/CanadaProvinceMap';
import { ChartCard, SeriesPatternDefs } from '../components/ChartCard';
import { VirtualTable, type VirtualColumn } from '../components/VirtualTable';

interface StoresRegionsViewProps {
  filteredFacts: FactSale[];
  filters: GlobalFilters;
  theme: 'dark' | 'light';
  entityColors: EntityColorRegistry;
  onCrossFilter: (field: 'stores' | 'provinces', value: string) => void;
}

export const StoresRegionsView: React.FC<StoresRegionsViewProps> = ({
  filteredFacts,
  filters,
  theme,
  entityColors,
  onCrossFilter,
}) => {
  const useRecomp = filters.useRecomputedFinancials;
  const semantic = getSemanticColors(theme);
  const secondaryPurple = getPaletteColor(1, theme);

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

  const useStorePatterns = stores.length > 6;
  const axisStyle = { fontSize: 11, fill: theme === 'dark' ? '#94A3B8' : '#475569' };

  const drilldownCols: Array<VirtualColumn<Record<string, unknown>>> = [
    {
      key: 'province',
      label: 'Province',
      render: (r) => {
        const prov = String(r.province);
        return (
          <span className="inline-flex items-center gap-1.5">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: getEntityColor(entityColors, 'provinces', prov, theme) }}
            />
            <span>{prov}</span>
          </span>
        );
      },
    },
    {
      key: 'store',
      label: 'Store',
      render: (r) => {
        const st = String(r.store);
        return (
          <span className="inline-flex items-center gap-1.5">
            <span
              className="h-2 w-2 shrink-0 rounded-sm"
              style={{ backgroundColor: getEntityColor(entityColors, 'stores', st, theme) }}
            />
            <span>{st}</span>
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
          <span style={{ color: g >= 0 ? semantic.positive : semantic.negative }}>
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
          subtitle={`Fixed store colours${useStorePatterns ? ' with SVG patterns (>6 series)' : ''} · Dashed line = network avg (${formatCAD(avgStoreSales, true)})`}
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
              {useStorePatterns && <SeriesPatternDefs prefix="stores-bar" theme={theme} />}
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
                stroke={secondaryPurple}
                strokeDasharray="5 4"
                strokeWidth={2}
                label={{
                  value: 'Avg',
                  position: 'top',
                  fill: secondaryPurple,
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
                  const st =
                    (entry as unknown as { store?: string; payload?: { store?: string } }).store ??
                    (entry as unknown as { payload?: { store?: string } }).payload?.store;
                  if (st) onCrossFilter('stores', st);
                }}
              >
                {stores.map((s) => {
                  const idx = getEntityColorIndex(entityColors, 'stores', s.store);
                  const fill = useStorePatterns
                    ? `url(#${getPatternId('stores-bar', idx)})`
                    : getEntityColor(entityColors, 'stores', s.store, theme);
                  return <Cell key={s.store} fill={fill} />;
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          className="lg:col-span-6"
          title="Canadian Regional Tracking"
          subtitle="Sequential scale (#16314D → #26E6D0 → #B740DE) · Click province to cross-filter"
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
            theme={theme}
            entityColors={entityColors}
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
