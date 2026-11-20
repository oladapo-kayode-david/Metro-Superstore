import React, { useState } from 'react';
import { ChevronDown, Filter, RotateCcw, X } from 'lucide-react';
import type { DatePreset, FactSale, GlobalFilters } from '../types/sales';
import { DEFAULT_FILTERS } from '../lib/db/database';

interface MultiSelectDropdownProps {
  label: string;
  options: Array<{ value: string; label: string }>;
  selected: string[];
  onChange: (next: string[]) => void;
}

const MultiSelectDropdown: React.FC<MultiSelectDropdownProps> = ({
  label,
  options,
  selected,
  onChange,
}) => {
  const [open, setOpen] = useState(false);

  const toggle = (val: string) => {
    if (selected.includes(val)) {
      onChange(selected.filter((s) => s !== val));
    } else {
      onChange([...selected, val]);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
          selected.length > 0
            ? 'border-[#26E6D0] bg-[#26E6D0]/15 text-[#0F2238] dark:text-[#26E6D0]'
            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-white/15 dark:bg-[#16314D] dark:text-slate-200 dark:hover:bg-[#1C3D5E]'
        }`}
      >
        <span>{label}</span>
        {selected.length > 0 && (
          <span className="font-mono text-[11px] tabular-nums">({selected.length})</span>
        )}
        <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-40 mt-1.5 max-h-64 w-56 overflow-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-white/15 dark:bg-[#0F2238]">
            {selected.length > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="mb-1 w-full rounded-md px-2 py-1 text-left text-xs font-medium text-[#0FA696] hover:bg-slate-100 dark:text-[#26E6D0] dark:hover:bg-white/10"
              >
                Clear {label}
              </button>
            )}
            {options.map((opt) => {
              const checked = selected.includes(opt.value);
              return (
                <label
                  key={opt.value}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-[#0F2238] hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/10"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(opt.value)}
                    className="h-3.5 w-3.5 rounded accent-[#26E6D0]"
                  />
                  <span className="truncate">{opt.label}</span>
                </label>
              );
            })}
            {options.length === 0 && (
              <div className="px-2 py-3 text-center text-xs text-slate-400">No options</div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

interface GlobalFilterBarProps {
  allFacts: FactSale[];
  filters: GlobalFilters;
  onChange: (next: GlobalFilters) => void;
  mobileDrawerOpen: boolean;
  onCloseMobileDrawer: () => void;
}

const DATE_PRESETS: Array<{ id: DatePreset; label: string }> = [
  { id: 'ALL', label: 'All' },
  { id: 'MTD', label: 'MTD' },
  { id: 'QTD', label: 'QTD' },
  { id: 'YTD', label: 'YTD' },
  { id: '30D', label: '30D' },
  { id: '90D', label: '90D' },
  { id: '365D', label: '365D' },
  { id: 'CUSTOM', label: 'Custom' },
];

const MONTH_OPTIONS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
].map((m, i) => ({ value: String(i + 1), label: m }));

export const GlobalFilterBar: React.FC<GlobalFilterBarProps> = ({
  allFacts,
  filters,
  onChange,
  mobileDrawerOpen,
  onCloseMobileDrawer,
}) => {
  const unique = (getter: (f: FactSale) => string) =>
    Array.from(new Set(allFacts.map(getter).filter(Boolean)))
      .sort()
      .map((v) => ({ value: v, label: v }));

  const yearOpts = Array.from(new Set(allFacts.map((f) => f.year)))
    .sort((a, b) => b - a)
    .map((y) => ({ value: String(y), label: String(y) }));
  const storeOpts = unique((f) => f.store);
  const catOpts = unique((f) => f.category);
  const prodOpts = unique((f) => f.product);
  const provOpts = unique((f) => f.province);
  const repOpts = unique((f) => f.salesperson);
  const chanOpts = unique((f) => f.salesChannel);
  const payOpts = unique((f) => f.paymentMethod);

  const activeChips: Array<{ key: string; label: string; remove: () => void }> = [];
  if (filters.datePreset !== 'ALL') {
    activeChips.push({
      key: 'date',
      label:
        filters.datePreset === 'CUSTOM'
          ? `Dates: ${filters.dateFrom || '…'} → ${filters.dateTo || '…'}`
          : `Range: ${filters.datePreset}`,
      remove: () => onChange({ ...filters, datePreset: 'ALL', dateFrom: '', dateTo: '' }),
    });
  }
  filters.years.forEach((y) =>
    activeChips.push({
      key: `yr-${y}`,
      label: `Year: ${y}`,
      remove: () => onChange({ ...filters, years: filters.years.filter((v) => v !== y) }),
    })
  );
  filters.months.forEach((m) =>
    activeChips.push({
      key: `mo-${m}`,
      label: `Month: ${MONTH_OPTIONS[m - 1]?.label ?? m}`,
      remove: () => onChange({ ...filters, months: filters.months.filter((v) => v !== m) }),
    })
  );
  const pushListChips = (field: keyof GlobalFilters, prefix: string, list: string[]) => {
    list.forEach((val) =>
      activeChips.push({
        key: `${prefix}-${val}`,
        label: `${prefix}: ${val}`,
        remove: () => onChange({ ...filters, [field]: list.filter((x) => x !== val) }),
      })
    );
  };
  pushListChips('provinces', 'Province', filters.provinces);
  pushListChips('stores', 'Store', filters.stores);
  pushListChips('categories', 'Category', filters.categories);
  pushListChips('products', 'Product', filters.products);
  pushListChips('salespeople', 'Rep', filters.salespeople);
  pushListChips('channels', 'Channel', filters.channels);
  pushListChips('paymentMethods', 'Payment', filters.paymentMethods);
  if (filters.excludeOutliers) {
    activeChips.push({
      key: 'outliers',
      label: 'Outliers excluded',
      remove: () => onChange({ ...filters, excludeOutliers: false }),
    });
  }
  if (filters.searchQuery.trim()) {
    activeChips.push({
      key: 'search',
      label: `Search: "${filters.searchQuery.trim()}"`,
      remove: () => onChange({ ...filters, searchQuery: '' }),
    });
  }

  const clearAll = () =>
    onChange({
      ...DEFAULT_FILTERS,
      excludeOutliers: filters.excludeOutliers,
      useRecomputedFinancials: filters.useRecomputedFinancials,
    });

  const slicerControls = (
    <div className="flex flex-wrap items-center gap-2">
      {/* Date Preset segmented buttons */}
      <div className="flex items-center rounded-lg border border-slate-300 bg-slate-100/80 p-0.5 dark:border-white/15 dark:bg-[#0F2238]">
        {DATE_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onChange({ ...filters, datePreset: p.id })}
            className={`whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium transition-colors ${
              filters.datePreset === p.id
                ? 'brand-gradient text-[#0F2238] font-semibold'
                : 'text-slate-600 hover:text-[#0F2238] dark:text-slate-300 dark:hover:text-white'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {filters.datePreset === 'CUSTOM' && (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            aria-label="Start date"
            value={filters.dateFrom}
            onChange={(e) => onChange({ ...filters, dateFrom: e.target.value })}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-[#0F2238] dark:border-white/15 dark:bg-[#16314D] dark:text-white"
          />
          <span className="text-xs text-slate-400">to</span>
          <input
            type="date"
            aria-label="End date"
            value={filters.dateTo}
            onChange={(e) => onChange({ ...filters, dateTo: e.target.value })}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-[#0F2238] dark:border-white/15 dark:bg-[#16314D] dark:text-white"
          />
        </div>
      )}

      <MultiSelectDropdown
        label="Year"
        options={yearOpts}
        selected={filters.years.map(String)}
        onChange={(vals) => onChange({ ...filters, years: vals.map(Number) })}
      />
      <MultiSelectDropdown
        label="Month"
        options={MONTH_OPTIONS}
        selected={filters.months.map(String)}
        onChange={(vals) => onChange({ ...filters, months: vals.map(Number) })}
      />
      <MultiSelectDropdown
        label="Province"
        options={provOpts}
        selected={filters.provinces}
        onChange={(provinces) => onChange({ ...filters, provinces })}
      />
      <MultiSelectDropdown
        label="Store"
        options={storeOpts}
        selected={filters.stores}
        onChange={(stores) => onChange({ ...filters, stores })}
      />
      <MultiSelectDropdown
        label="Category"
        options={catOpts}
        selected={filters.categories}
        onChange={(categories) => onChange({ ...filters, categories })}
      />
      <MultiSelectDropdown
        label="Product"
        options={prodOpts}
        selected={filters.products}
        onChange={(products) => onChange({ ...filters, products })}
      />
      <MultiSelectDropdown
        label="Salesperson"
        options={repOpts}
        selected={filters.salespeople}
        onChange={(salespeople) => onChange({ ...filters, salespeople })}
      />
      <MultiSelectDropdown
        label="Channel"
        options={chanOpts}
        selected={filters.channels}
        onChange={(channels) => onChange({ ...filters, channels })}
      />
      <MultiSelectDropdown
        label="Payment"
        options={payOpts}
        selected={filters.paymentMethods}
        onChange={(paymentMethods) => onChange({ ...filters, paymentMethods })}
      />

      {activeChips.length > 0 && (
        <button
          type="button"
          onClick={clearAll}
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          Clear all filters
        </button>
      )}
    </div>
  );

  return (
    <>
      {/* Desktop slicer strip */}
      <div className="no-print hidden border-b border-slate-200/80 bg-white/80 px-5 py-2.5 backdrop-blur-md dark:border-white/10 dark:bg-[#0F2238]/90 lg:block">
        {slicerControls}
        {activeChips.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2 dark:border-white/10">
            <span className="mr-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Active filters:
            </span>
            {activeChips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={chip.remove}
                className="inline-flex items-center gap-1 rounded-md border border-[#26E6D0]/40 bg-[#26E6D0]/10 px-2 py-0.5 text-[11px] font-medium text-[#0F2238] hover:bg-[#26E6D0]/20 dark:text-[#26E6D0]"
              >
                <span>{chip.label}</span>
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Mobile slide-over filter drawer */}
      {mobileDrawerOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Global Filters"
          className="fixed inset-0 z-50 flex justify-end bg-[#0F2238]/70 backdrop-blur-sm lg:hidden"
          onClick={onCloseMobileDrawer}
        >
          <div
            className="flex h-full w-full max-w-sm flex-col bg-white p-5 dark:bg-[#16314D]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between border-b border-slate-200 pb-3 dark:border-white/10">
              <div className="flex items-center gap-2 font-display text-base font-semibold text-[#0F2238] dark:text-white">
                <Filter className="h-4 w-4 text-[#26E6D0]" aria-hidden="true" />
                Global Slicers
              </div>
              <button
                type="button"
                onClick={onCloseMobileDrawer}
                aria-label="Close filters"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="flex-1 overflow-auto">{slicerControls}</div>
            <div className="mt-4 flex gap-2 border-t border-slate-200 pt-3 dark:border-white/10">
              <button
                type="button"
                onClick={clearAll}
                className="flex-1 rounded-lg border border-slate-300 py-2 text-xs font-medium text-slate-700 dark:border-white/15 dark:text-slate-200"
              >
                Clear All
              </button>
              <button
                type="button"
                onClick={onCloseMobileDrawer}
                className="flex-1 rounded-lg brand-gradient py-2 text-xs font-semibold text-[#0F2238]"
              >
                Apply Filters
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
