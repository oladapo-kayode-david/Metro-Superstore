import type { DimDate, FactSale, GlobalFilters, KpiMetric } from '../../types/sales';

export const cadFormatter = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD',
  maximumFractionDigits: 0,
});

export const cadExactFormatter = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCAD(value: number, compact = false): string {
  if (!Number.isFinite(value)) return 'CA$0';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (compact) {
    if (abs >= 1_000_000) return `${sign}CA$${(abs / 1_000_000).toFixed(2)}M`;
    if (abs >= 10_000) return `${sign}CA$${(abs / 1_000).toFixed(1)}K`;
  }
  return `${sign}CA$${Math.round(abs).toLocaleString('en-CA')}`;
}

export function formatCADExact(value: number): string {
  if (!Number.isFinite(value)) return 'CA$0.00';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  return `${sign}CA$${abs.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return Math.round(value).toLocaleString('en-CA');
}

export function formatPct(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) return '0.0%';
  return `${(value * 100).toFixed(decimals)}%`;
}

export function formatMonthLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  if (!y || !m) return yearMonth;
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[m - 1]} ${y}`;
}

export function getRowSales(row: FactSale, useRecomputed: boolean): number {
  return useRecomputed ? row.salesAmount : (row.originalSalesAmount ?? row.salesAmount);
}

export function getRowGross(row: FactSale, useRecomputed: boolean): number {
  return useRecomputed ? row.grossSales : (row.originalGrossSales ?? row.grossSales);
}

export function getRowDiscount(row: FactSale, useRecomputed: boolean): number {
  return useRecomputed ? row.discountAmount : (row.originalDiscountAmount ?? row.discountAmount);
}

export function getDataDateBounds(facts: FactSale[]): { min: string; max: string } {
  if (facts.length === 0) return { min: '', max: '' };
  let min = facts[0].date;
  let max = facts[0].date;
  for (const f of facts) {
    if (f.date < min) min = f.date;
    if (f.date > max) max = f.date;
  }
  return { min, max };
}

export function resolveDateWindow(
  filters: GlobalFilters,
  bounds: { min: string; max: string }
): { from: string; to: string } {
  if (!bounds.max) return { from: '', to: '' };
  const anchor = new Date(`${bounds.max}T00:00:00Z`);
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
      d.getUTCDate()
    ).padStart(2, '0')}`;

  switch (filters.datePreset) {
    case 'ALL':
      return { from: bounds.min, to: bounds.max };
    case 'MTD': {
      const start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
      return { from: fmt(start), to: bounds.max };
    }
    case 'QTD': {
      const qMonth = Math.floor(anchor.getUTCMonth() / 3) * 3;
      const start = new Date(Date.UTC(anchor.getUTCFullYear(), qMonth, 1));
      return { from: fmt(start), to: bounds.max };
    }
    case 'YTD': {
      const start = new Date(Date.UTC(anchor.getUTCFullYear(), 0, 1));
      return { from: fmt(start), to: bounds.max };
    }
    case '30D': {
      const start = new Date(anchor.getTime() - 29 * 86400000);
      return { from: fmt(start), to: bounds.max };
    }
    case '90D': {
      const start = new Date(anchor.getTime() - 89 * 86400000);
      return { from: fmt(start), to: bounds.max };
    }
    case '365D': {
      const start = new Date(anchor.getTime() - 364 * 86400000);
      return { from: fmt(start), to: bounds.max };
    }
    case 'CUSTOM':
      return {
        from: filters.dateFrom || bounds.min,
        to: filters.dateTo || bounds.max,
      };
  }
}

export function applyGlobalFilters(
  facts: FactSale[],
  filters: GlobalFilters,
  overrideDateWindow?: { from: string; to: string }
): FactSale[] {
  const bounds = getDataDateBounds(facts);
  const window = overrideDateWindow ?? resolveDateWindow(filters, bounds);
  const q = filters.searchQuery.trim().toLowerCase();

  const yearSet = filters.years.length > 0 ? new Set(filters.years) : null;
  const monthSet = filters.months.length > 0 ? new Set(filters.months) : null;
  const storeSet = filters.stores.length > 0 ? new Set(filters.stores) : null;
  const catSet = filters.categories.length > 0 ? new Set(filters.categories) : null;
  const prodSet = filters.products.length > 0 ? new Set(filters.products) : null;
  const provSet = filters.provinces.length > 0 ? new Set(filters.provinces) : null;
  const repSet = filters.salespeople.length > 0 ? new Set(filters.salespeople) : null;
  const chanSet = filters.channels.length > 0 ? new Set(filters.channels) : null;
  const paySet = filters.paymentMethods.length > 0 ? new Set(filters.paymentMethods) : null;

  return facts.filter((f) => {
    if (filters.excludeOutliers && f.isOutlier) return false;
    if (window.from && f.date < window.from) return false;
    if (window.to && f.date > window.to) return false;
    if (yearSet && !yearSet.has(f.year)) return false;
    if (monthSet && !monthSet.has(f.month)) return false;
    if (storeSet && !storeSet.has(f.store)) return false;
    if (catSet && !catSet.has(f.category)) return false;
    if (prodSet && !prodSet.has(f.product)) return false;
    if (provSet && !provSet.has(f.province)) return false;
    if (repSet && !repSet.has(f.salesperson)) return false;
    if (chanSet && !chanSet.has(f.salesChannel)) return false;
    if (paySet && !paySet.has(f.paymentMethod)) return false;
    if (q) {
      const hay = `${f.transactionId} ${f.product} ${f.category} ${f.store} ${f.province} ${f.salesperson} ${f.orderId} ${f.salesChannel}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export interface CoreTotals {
  sales: number;
  grossSales: number;
  discountAmount: number;
  discountPct: number;
  quantity: number;
  orders: number;
  aov: number;
  avgUnitsPerOrder: number;
  transactions: number;
}

export function computeCoreTotals(rows: FactSale[], useRecomputed = true): CoreTotals {
  let sales = 0;
  let grossSales = 0;
  let discountAmount = 0;
  let quantity = 0;
  const orderIds = new Set<string>();

  for (const r of rows) {
    sales += getRowSales(r, useRecomputed);
    grossSales += getRowGross(r, useRecomputed);
    discountAmount += getRowDiscount(r, useRecomputed);
    quantity += r.quantity;
    orderIds.add(r.orderId);
  }

  const orders = orderIds.size;
  const aov = orders > 0 ? sales / orders : 0;
  const avgUnitsPerOrder = orders > 0 ? quantity / orders : 0;
  const discountPct = grossSales > 0 ? discountAmount / grossSales : 0;

  return {
    sales,
    grossSales,
    discountAmount,
    discountPct,
    quantity,
    orders,
    aov,
    avgUnitsPerOrder,
    transactions: rows.length,
  };
}

export function safeGrowthPct(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || Math.abs(previous) < 1e-6) return null;
  return (current - previous) / Math.abs(previous);
}

export function computeExecutiveKpis(
  allFacts: FactSale[],
  filteredFacts: FactSale[],
  filters: GlobalFilters
): KpiMetric[] {
  const useRecomp = filters.useRecomputedFinancials;
  const bounds = getDataDateBounds(allFacts);
  const currentWindow = resolveDateWindow(filters, bounds);
  const currentTotals = computeCoreTotals(filteredFacts, useRecomp);

  // Previous equivalent period & Same period last year
  let prevTotals: CoreTotals | null = null;
  let yoyTotals: CoreTotals | null = null;

  if (currentWindow.from && currentWindow.to) {
    const startMs = new Date(`${currentWindow.from}T00:00:00Z`).getTime();
    const endMs = new Date(`${currentWindow.to}T00:00:00Z`).getTime();
    const spanMs = Math.max(86400000, endMs - startMs + 86400000);
    const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);

    const prevTo = fmt(startMs - 86400000);
    const prevFrom = fmt(startMs - spanMs);
    const nonDateFilters: GlobalFilters = { ...filters, years: [], months: [] };
    const prevRows = applyGlobalFilters(allFacts, nonDateFilters, { from: prevFrom, to: prevTo });
    if (prevRows.length > 0) prevTotals = computeCoreTotals(prevRows, useRecomp);

    const yoyFromDate = new Date(`${currentWindow.from}T00:00:00Z`);
    const yoyToDate = new Date(`${currentWindow.to}T00:00:00Z`);
    yoyFromDate.setUTCFullYear(yoyFromDate.getUTCFullYear() - 1);
    yoyToDate.setUTCFullYear(yoyToDate.getUTCFullYear() - 1);
    const yoyRows = applyGlobalFilters(allFacts, nonDateFilters, {
      from: yoyFromDate.toISOString().slice(0, 10),
      to: yoyToDate.toISOString().slice(0, 10),
    });
    if (yoyRows.length > 0) yoyTotals = computeCoreTotals(yoyRows, useRecomp);
  }

  // Monthly sparkline arrays
  const monthly = aggregateMonthlyTrend(filteredFacts, useRecomp);
  const salesSpark = monthly.map((m) => m.sales);
  const qtySpark = monthly.map((m) => m.quantity);
  const ordersSpark = monthly.map((m) => m.orders);
  const aovSpark = monthly.map((m) => m.aov);
  const discSpark = monthly.map((m) => m.discountPct * 100);

  // Top Store, Product, Salesperson
  const topEntity = (getter: (f: FactSale) => string) => {
    const map = new Map<string, number>();
    for (const f of filteredFacts) {
      const k = getter(f);
      map.set(k, (map.get(k) ?? 0) + getRowSales(f, useRecomp));
    }
    let bestName = '—';
    let bestVal = -Infinity;
    for (const [k, v] of map.entries()) {
      if (v > bestVal) {
        bestVal = v;
        bestName = k;
      }
    }
    return { name: bestName, sales: bestVal > -Infinity ? bestVal : 0 };
  };

  const topStore = topEntity((f) => f.store);
  const topProduct = topEntity((f) => f.product);
  const topRep = topEntity((f) => f.salesperson);

  return [
    {
      id: 'total_sales',
      label: 'Total Sales (CAD)',
      value: currentTotals.sales,
      formatted: formatCAD(currentTotals.sales, true),
      previousValue: prevTotals?.sales,
      yoyValue: yoyTotals?.sales,
      deltaPct: prevTotals ? safeGrowthPct(currentTotals.sales, prevTotals.sales) : null,
      yoyDeltaPct: yoyTotals ? safeGrowthPct(currentTotals.sales, yoyTotals.sales) : null,
      sparkline: salesSpark,
      formula: 'SUM(Sales Amount) = SUM(Gross Sales − Discount Amount) across filtered Fact_Sales rows.',
    },
    {
      id: 'total_quantity',
      label: 'Total Quantity',
      value: currentTotals.quantity,
      formatted: formatNumber(currentTotals.quantity),
      previousValue: prevTotals?.quantity,
      yoyValue: yoyTotals?.quantity,
      deltaPct: prevTotals ? safeGrowthPct(currentTotals.quantity, prevTotals.quantity) : null,
      yoyDeltaPct: yoyTotals ? safeGrowthPct(currentTotals.quantity, yoyTotals.quantity) : null,
      sparkline: qtySpark,
      formula: 'SUM(Quantity) across filtered transactions (includes negative return quantities).',
    },
    {
      id: 'aov',
      label: 'Average Order Value',
      value: currentTotals.aov,
      formatted: formatCADExact(currentTotals.aov),
      previousValue: prevTotals?.aov,
      yoyValue: yoyTotals?.aov,
      deltaPct: prevTotals ? safeGrowthPct(currentTotals.aov, prevTotals.aov) : null,
      yoyDeltaPct: yoyTotals ? safeGrowthPct(currentTotals.aov, yoyTotals.aov) : null,
      sparkline: aovSpark,
      formula: 'Total Sales Amount ÷ COUNT(DISTINCT Order ID).',
    },
    {
      id: 'orders',
      label: 'Total Orders',
      value: currentTotals.orders,
      formatted: formatNumber(currentTotals.orders),
      previousValue: prevTotals?.orders,
      yoyValue: yoyTotals?.orders,
      deltaPct: prevTotals ? safeGrowthPct(currentTotals.orders, prevTotals.orders) : null,
      yoyDeltaPct: yoyTotals ? safeGrowthPct(currentTotals.orders, yoyTotals.orders) : null,
      sparkline: ordersSpark,
      formula: 'COUNT(DISTINCT Order ID) across filtered transactions.',
    },
    {
      id: 'gross_sales',
      label: 'Gross Sales',
      value: currentTotals.grossSales,
      formatted: formatCAD(currentTotals.grossSales, true),
      previousValue: prevTotals?.grossSales,
      yoyValue: yoyTotals?.grossSales,
      deltaPct: prevTotals ? safeGrowthPct(currentTotals.grossSales, prevTotals.grossSales) : null,
      yoyDeltaPct: yoyTotals ? safeGrowthPct(currentTotals.grossSales, yoyTotals.grossSales) : null,
      formula: 'SUM(Quantity × Unit Price) before discounts.',
    },
    {
      id: 'total_discounts',
      label: 'Total Discounts & Rate',
      value: currentTotals.discountAmount,
      formatted: formatCAD(currentTotals.discountAmount, true),
      subtext: `${formatPct(currentTotals.discountPct)} of Gross`,
      deltaPct: prevTotals ? safeGrowthPct(currentTotals.discountAmount, prevTotals.discountAmount) : null,
      yoyDeltaPct: yoyTotals ? safeGrowthPct(currentTotals.discountAmount, yoyTotals.discountAmount) : null,
      sparkline: discSpark,
      formula: 'SUM(Discount Amount) and Effective Discount % = Total Discounts ÷ Gross Sales.',
    },
    {
      id: 'avg_units_order',
      label: 'Avg Units / Order',
      value: currentTotals.avgUnitsPerOrder,
      formatted: currentTotals.avgUnitsPerOrder.toFixed(2),
      deltaPct: prevTotals
        ? safeGrowthPct(currentTotals.avgUnitsPerOrder, prevTotals.avgUnitsPerOrder)
        : null,
      yoyDeltaPct: yoyTotals
        ? safeGrowthPct(currentTotals.avgUnitsPerOrder, yoyTotals.avgUnitsPerOrder)
        : null,
      formula: 'SUM(Quantity) ÷ COUNT(DISTINCT Order ID).',
    },
    {
      id: 'top_store',
      label: 'Top Store',
      value: topStore.name,
      formatted: topStore.name,
      subtext: formatCAD(topStore.sales, true),
      formula: 'Store with the highest SUM(Sales Amount) in the active filter context.',
    },
    {
      id: 'top_product',
      label: 'Top Product',
      value: topProduct.name,
      formatted: topProduct.name,
      subtext: formatCAD(topProduct.sales, true),
      formula: 'Product with the highest SUM(Sales Amount) in the active filter context.',
    },
    {
      id: 'top_salesperson',
      label: 'Top Salesperson',
      value: topRep.name,
      formatted: topRep.name,
      subtext: formatCAD(topRep.sales, true),
      formula: 'Salesperson with the highest SUM(Sales Amount) in the active filter context.',
    },
  ];
}

export interface MonthlyTrendRow {
  yearMonth: string;
  label: string;
  sales: number;
  grossSales: number;
  discountAmount: number;
  discountPct: number;
  quantity: number;
  orders: number;
  aov: number;
  momPct: number | null;
  yoyPct: number | null;
  yoySales: number | null;
  rolling3m: number | null;
}

export function aggregateMonthlyTrend(rows: FactSale[], useRecomputed = true): MonthlyTrendRow[] {
  const byMonth = new Map<
    string,
    { sales: number; gross: number; disc: number; qty: number; orders: Set<string> }
  >();
  for (const r of rows) {
    let bucket = byMonth.get(r.yearMonth);
    if (!bucket) {
      bucket = { sales: 0, gross: 0, disc: 0, qty: 0, orders: new Set() };
      byMonth.set(r.yearMonth, bucket);
    }
    bucket.sales += getRowSales(r, useRecomputed);
    bucket.gross += getRowGross(r, useRecomputed);
    bucket.disc += getRowDiscount(r, useRecomputed);
    bucket.qty += r.quantity;
    bucket.orders.add(r.orderId);
  }

  const keys = Array.from(byMonth.keys()).sort();
  const result: MonthlyTrendRow[] = [];

  for (let i = 0; i < keys.length; i++) {
    const ym = keys[i];
    const b = byMonth.get(ym)!;
    const prev = i > 0 ? byMonth.get(keys[i - 1]) : undefined;
    const [y, m] = ym.split('-').map(Number);
    const yoyKey = `${y - 1}-${String(m).padStart(2, '0')}`;
    const yoy = byMonth.get(yoyKey);
    const orders = b.orders.size;

    const rolling3m =
      i >= 2
        ? (byMonth.get(keys[i - 2])!.sales + byMonth.get(keys[i - 1])!.sales + b.sales) / 3
        : null;

    result.push({
      yearMonth: ym,
      label: formatMonthLabel(ym),
      sales: Number(b.sales.toFixed(2)),
      grossSales: Number(b.gross.toFixed(2)),
      discountAmount: Number(b.disc.toFixed(2)),
      discountPct: b.gross > 0 ? b.disc / b.gross : 0,
      quantity: b.qty,
      orders,
      aov: orders > 0 ? b.sales / orders : 0,
      momPct: prev ? safeGrowthPct(b.sales, prev.sales) : null,
      yoyPct: yoy ? safeGrowthPct(b.sales, yoy.sales) : null,
      yoySales: yoy ? Number(yoy.sales.toFixed(2)) : null,
      rolling3m: rolling3m !== null ? Number(rolling3m.toFixed(2)) : null,
    });
  }
  return result;
}

export interface ProductPerformanceRow {
  product: string;
  category: string;
  sales: number;
  grossSales: number;
  quantity: number;
  orders: number;
  avgPrice: number;
  discountPct: number;
  sharePct: number;
  cumulativePct: number;
  rank: number;
}

export function aggregateProductPareto(rows: FactSale[], useRecomputed = true): ProductPerformanceRow[] {
  const map = new Map<
    string,
    { category: string; sales: number; gross: number; disc: number; qty: number; orders: Set<string>; priceSum: number; count: number }
  >();
  let totalSales = 0;
  for (const r of rows) {
    const s = getRowSales(r, useRecomputed);
    totalSales += s;
    let b = map.get(r.product);
    if (!b) {
      b = { category: r.category, sales: 0, gross: 0, disc: 0, qty: 0, orders: new Set(), priceSum: 0, count: 0 };
      map.set(r.product, b);
    }
    b.sales += s;
    b.gross += getRowGross(r, useRecomputed);
    b.disc += getRowDiscount(r, useRecomputed);
    b.qty += r.quantity;
    b.orders.add(r.orderId);
    b.priceSum += r.unitPrice;
    b.count += 1;
  }

  const sorted = Array.from(map.entries()).sort((a, b) => b[1].sales - a[1].sales);
  let cum = 0;
  return sorted.map(([product, b], idx) => {
    const share = totalSales > 0 ? b.sales / totalSales : 0;
    cum += share;
    return {
      product,
      category: b.category,
      sales: Number(b.sales.toFixed(2)),
      grossSales: Number(b.gross.toFixed(2)),
      quantity: b.qty,
      orders: b.orders.size,
      avgPrice: b.count > 0 ? b.priceSum / b.count : 0,
      discountPct: b.gross > 0 ? b.disc / b.gross : 0,
      sharePct: share,
      cumulativePct: Math.min(1, cum),
      rank: idx + 1,
    };
  });
}

export interface CategorySummaryRow {
  category: string;
  sales: number;
  quantity: number;
  orders: number;
  sharePct: number;
  discountPct: number;
}

export function aggregateCategories(rows: FactSale[], useRecomputed = true): CategorySummaryRow[] {
  const map = new Map<string, { sales: number; gross: number; disc: number; qty: number; orders: Set<string> }>();
  let total = 0;
  for (const r of rows) {
    const s = getRowSales(r, useRecomputed);
    total += s;
    let b = map.get(r.category);
    if (!b) {
      b = { sales: 0, gross: 0, disc: 0, qty: 0, orders: new Set() };
      map.set(r.category, b);
    }
    b.sales += s;
    b.gross += getRowGross(r, useRecomputed);
    b.disc += getRowDiscount(r, useRecomputed);
    b.qty += r.quantity;
    b.orders.add(r.orderId);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[1].sales - a[1].sales)
    .map(([category, b]) => ({
      category,
      sales: Number(b.sales.toFixed(2)),
      quantity: b.qty,
      orders: b.orders.size,
      sharePct: total > 0 ? b.sales / total : 0,
      discountPct: b.gross > 0 ? b.disc / b.gross : 0,
    }));
}

export function aggregateCategoryByMonthHeatmap(rows: FactSale[], useRecomputed = true): {
  categories: string[];
  months: string[];
  matrix: Record<string, Record<string, number>>;
  maxVal: number;
} {
  const cats = new Set<string>();
  const months = new Set<string>();
  const matrix: Record<string, Record<string, number>> = {};
  let maxVal = 0;

  for (const r of rows) {
    cats.add(r.category);
    months.add(r.yearMonth);
    if (!matrix[r.category]) matrix[r.category] = {};
    matrix[r.category][r.yearMonth] = (matrix[r.category][r.yearMonth] ?? 0) + getRowSales(r, useRecomputed);
    if (matrix[r.category][r.yearMonth] > maxVal) maxVal = matrix[r.category][r.yearMonth];
  }

  const sortedMonths = Array.from(months).sort().slice(-12);
  return {
    categories: Array.from(cats).sort(),
    months: sortedMonths,
    matrix,
    maxVal,
  };
}

export interface StorePerformanceRow {
  store: string;
  province: string;
  country: string;
  sales: number;
  quantity: number;
  orders: number;
  aov: number;
  discountPct: number;
  sharePct: number;
  growthPct: number | null;
}

export function aggregateStores(rows: FactSale[], useRecomputed = true): StorePerformanceRow[] {
  const months = Array.from(new Set(rows.map((r) => r.yearMonth))).sort();
  const mid = Math.floor(months.length / 2);
  const firstHalfMonths = new Set(months.slice(0, mid));
  const secondHalfMonths = new Set(months.slice(mid));

  const map = new Map<
    string,
    {
      province: string;
      country: string;
      sales: number;
      gross: number;
      disc: number;
      qty: number;
      orders: Set<string>;
      firstHalf: number;
      secondHalf: number;
    }
  >();
  let total = 0;
  for (const r of rows) {
    const s = getRowSales(r, useRecomputed);
    total += s;
    let b = map.get(r.store);
    if (!b) {
      b = {
        province: r.province,
        country: r.country,
        sales: 0,
        gross: 0,
        disc: 0,
        qty: 0,
        orders: new Set(),
        firstHalf: 0,
        secondHalf: 0,
      };
      map.set(r.store, b);
    }
    b.sales += s;
    b.gross += getRowGross(r, useRecomputed);
    b.disc += getRowDiscount(r, useRecomputed);
    b.qty += r.quantity;
    b.orders.add(r.orderId);
    if (firstHalfMonths.has(r.yearMonth)) b.firstHalf += s;
    if (secondHalfMonths.has(r.yearMonth)) b.secondHalf += s;
  }

  return Array.from(map.entries())
    .sort((a, b) => b[1].sales - a[1].sales)
    .map(([store, b]) => ({
      store,
      province: b.province,
      country: b.country,
      sales: Number(b.sales.toFixed(2)),
      quantity: b.qty,
      orders: b.orders.size,
      aov: b.orders.size > 0 ? b.sales / b.orders.size : 0,
      discountPct: b.gross > 0 ? b.disc / b.gross : 0,
      sharePct: total > 0 ? b.sales / total : 0,
      growthPct: mid > 0 ? safeGrowthPct(b.secondHalf, b.firstHalf) : null,
    }));
}

export interface ProvinceMetricRow {
  province: string;
  sales: number;
  quantity: number;
  orders: number;
  storeCount: number;
  discountPct: number;
  sharePct: number;
  growthPct: number | null;
}

export function aggregateProvinces(rows: FactSale[], useRecomputed = true): ProvinceMetricRow[] {
  const months = Array.from(new Set(rows.map((r) => r.yearMonth))).sort();
  const mid = Math.floor(months.length / 2);
  const firstHalfMonths = new Set(months.slice(0, mid));
  const secondHalfMonths = new Set(months.slice(mid));

  const map = new Map<
    string,
    {
      sales: number;
      gross: number;
      disc: number;
      qty: number;
      orders: Set<string>;
      stores: Set<string>;
      firstHalf: number;
      secondHalf: number;
    }
  >();
  let total = 0;

  for (const r of rows) {
    const s = getRowSales(r, useRecomputed);
    total += s;
    let b = map.get(r.province);
    if (!b) {
      b = {
        sales: 0,
        gross: 0,
        disc: 0,
        qty: 0,
        orders: new Set(),
        stores: new Set(),
        firstHalf: 0,
        secondHalf: 0,
      };
      map.set(r.province, b);
    }
    b.sales += s;
    b.gross += getRowGross(r, useRecomputed);
    b.disc += getRowDiscount(r, useRecomputed);
    b.qty += r.quantity;
    b.orders.add(r.orderId);
    b.stores.add(r.store);
    if (firstHalfMonths.has(r.yearMonth)) b.firstHalf += s;
    if (secondHalfMonths.has(r.yearMonth)) b.secondHalf += s;
  }

  return Array.from(map.entries())
    .sort((a, b) => b[1].sales - a[1].sales)
    .map(([province, b]) => ({
      province,
      sales: Number(b.sales.toFixed(2)),
      quantity: b.qty,
      orders: b.orders.size,
      storeCount: b.stores.size,
      discountPct: b.gross > 0 ? b.disc / b.gross : 0,
      sharePct: total > 0 ? b.sales / total : 0,
      growthPct: mid > 0 ? safeGrowthPct(b.secondHalf, b.firstHalf) : null,
    }));
}

export interface SalespersonRow {
  salesperson: string;
  primaryStore: string;
  province: string;
  sales: number;
  quantity: number;
  orders: number;
  aov: number;
  discountPct: number;
  growthPct: number | null;
  rank: number;
  rankChange: number; // positive = moved up
  quartile: 'Q1 (Top)' | 'Q2' | 'Q3' | 'Q4 (Bottom)';
}

export function aggregateSalespeople(rows: FactSale[], useRecomputed = true): SalespersonRow[] {
  const months = Array.from(new Set(rows.map((r) => r.yearMonth))).sort();
  const mid = Math.floor(months.length / 2);
  const firstHalfMonths = new Set(months.slice(0, mid));
  const secondHalfMonths = new Set(months.slice(mid));

  const map = new Map<
    string,
    {
      stores: Map<string, { count: number; province: string }>;
      sales: number;
      gross: number;
      disc: number;
      qty: number;
      orders: Set<string>;
      firstHalf: number;
      secondHalf: number;
    }
  >();

  for (const r of rows) {
    const s = getRowSales(r, useRecomputed);
    let b = map.get(r.salesperson);
    if (!b) {
      b = {
        stores: new Map(),
        sales: 0,
        gross: 0,
        disc: 0,
        qty: 0,
        orders: new Set(),
        firstHalf: 0,
        secondHalf: 0,
      };
      map.set(r.salesperson, b);
    }
    b.sales += s;
    b.gross += getRowGross(r, useRecomputed);
    b.disc += getRowDiscount(r, useRecomputed);
    b.qty += r.quantity;
    b.orders.add(r.orderId);
    if (firstHalfMonths.has(r.yearMonth)) b.firstHalf += s;
    if (secondHalfMonths.has(r.yearMonth)) b.secondHalf += s;
    const st = b.stores.get(r.store) ?? { count: 0, province: r.province };
    st.count += 1;
    b.stores.set(r.store, st);
  }

  const prevRanking = new Map<string, number>();
  Array.from(map.entries())
    .sort((a, b) => b[1].firstHalf - a[1].firstHalf)
    .forEach(([rep], i) => prevRanking.set(rep, i + 1));

  const sorted = Array.from(map.entries()).sort((a, b) => b[1].sales - a[1].sales);
  const n = sorted.length;

  return sorted.map(([salesperson, b], idx) => {
    let primaryStore = '—';
    let province = '—';
    let maxSt = -1;
    for (const [st, info] of b.stores.entries()) {
      if (info.count > maxSt) {
        maxSt = info.count;
        primaryStore = st;
        province = info.province;
      }
    }
    const rank = idx + 1;
    const prevRank = prevRanking.get(salesperson) ?? rank;
    const pctPos = n > 0 ? idx / n : 0;
    const quartile: SalespersonRow['quartile'] =
      pctPos < 0.25 ? 'Q1 (Top)' : pctPos < 0.5 ? 'Q2' : pctPos < 0.75 ? 'Q3' : 'Q4 (Bottom)';

    return {
      salesperson,
      primaryStore,
      province,
      sales: Number(b.sales.toFixed(2)),
      quantity: b.qty,
      orders: b.orders.size,
      aov: b.orders.size > 0 ? b.sales / b.orders.size : 0,
      discountPct: b.gross > 0 ? b.disc / b.gross : 0,
      growthPct: mid > 0 ? safeGrowthPct(b.secondHalf, b.firstHalf) : null,
      rank,
      rankChange: mid > 0 ? prevRank - rank : 0,
      quartile,
    };
  });
}

export function aggregateChannelAndPaymentMix(rows: FactSale[], useRecomputed = true): {
  channels: Array<{ name: string; sales: number; pct: number; orders: number }>;
  payments: Array<{ name: string; sales: number; pct: number; orders: number }>;
  stackedChannelByQuarter: Array<Record<string, string | number>>;
  channelNames: string[];
} {
  const chMap = new Map<string, { sales: number; orders: Set<string> }>();
  const payMap = new Map<string, { sales: number; orders: Set<string> }>();
  const qtrCh = new Map<string, Map<string, number>>();
  let total = 0;

  for (const r of rows) {
    const s = getRowSales(r, useRecomputed);
    total += s;

    const c = chMap.get(r.salesChannel) ?? { sales: 0, orders: new Set() };
    c.sales += s;
    c.orders.add(r.orderId);
    chMap.set(r.salesChannel, c);

    const p = payMap.get(r.paymentMethod) ?? { sales: 0, orders: new Set() };
    p.sales += s;
    p.orders.add(r.orderId);
    payMap.set(r.paymentMethod, p);

    const qKey = `${r.year} Q${r.quarter}`;
    if (!qtrCh.has(qKey)) qtrCh.set(qKey, new Map());
    const qm = qtrCh.get(qKey)!;
    qm.set(r.salesChannel, (qm.get(r.salesChannel) ?? 0) + s);
  }

  const channelNames = Array.from(chMap.keys()).sort();
  const stackedChannelByQuarter = Array.from(qtrCh.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([quarter, m]) => {
      const qTotal = Array.from(m.values()).reduce((a, b) => a + b, 0) || 1;
      const obj: Record<string, string | number> = { quarter };
      for (const ch of channelNames) {
        obj[ch] = Number((((m.get(ch) ?? 0) / qTotal) * 100).toFixed(1));
      }
      return obj;
    });

  return {
    channels: Array.from(chMap.entries())
      .sort((a, b) => b[1].sales - a[1].sales)
      .map(([name, v]) => ({ name, sales: v.sales, pct: total > 0 ? v.sales / total : 0, orders: v.orders.size })),
    payments: Array.from(payMap.entries())
      .sort((a, b) => b[1].sales - a[1].sales)
      .map(([name, v]) => ({ name, sales: v.sales, pct: total > 0 ? v.sales / total : 0, orders: v.orders.size })),
    stackedChannelByQuarter,
    channelNames,
  };
}

export function aggregateDiscountBands(rows: FactSale[], useRecomputed = true) {
  const bands = [
    { label: '0% (Full Price)', min: -0.001, max: 0.0001 },
    { label: '1–5%', min: 0.0001, max: 0.05 },
    { label: '6–10%', min: 0.05, max: 0.1 },
    { label: '11–15%', min: 0.1, max: 0.15 },
    { label: '16–25%', min: 0.15, max: 0.25 },
    { label: '25%+', min: 0.25, max: 1.01 },
  ];

  return bands.map((b) => {
    const matched = rows.filter((r) => r.discountRate > b.min && r.discountRate <= b.max);
    const sales = matched.reduce((acc, r) => acc + getRowSales(r, useRecomputed), 0);
    const units = matched.reduce((acc, r) => acc + r.quantity, 0);
    const gross = matched.reduce((acc, r) => acc + getRowGross(r, useRecomputed), 0);
    return {
      band: b.label,
      transactions: matched.length,
      units,
      avgUnits: matched.length > 0 ? Number((units / matched.length).toFixed(2)) : 0,
      netRevenue: Number(sales.toFixed(2)),
      avgRevenuePerTxn: matched.length > 0 ? Number((sales / matched.length).toFixed(2)) : 0,
      discountCost: Number((gross - sales).toFixed(2)),
    };
  });
}

export function aggregateDayOfWeekByMonthHeatmap(rows: FactSale[], useRecomputed = true) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const matrix: Record<string, Record<string, number>> = {};
  for (const d of days) {
    matrix[d] = {};
    for (const m of monthNames) matrix[d][m] = 0;
  }
  let maxVal = 0;
  for (const r of rows) {
    const dt = new Date(`${r.date}T00:00:00Z`);
    const dLabel = days[dt.getUTCDay()];
    const mLabel = monthNames[r.month - 1];
    matrix[dLabel][mLabel] += getRowSales(r, useRecomputed);
    if (matrix[dLabel][mLabel] > maxVal) maxVal = matrix[dLabel][mLabel];
  }
  return { days, monthNames, matrix, maxVal };
}

export interface EngineeredFeatureDoc {
  name: string;
  category: 'Calendar' | 'Time-Series' | 'Pricing & Discount' | 'Basket & Share';
  formula: string;
  sampleValue: string;
}

export function computeEngineeredFeaturesSummary(
  rows: FactSale[],
  dimDates: DimDate[],
  useRecomputed = true
): EngineeredFeatureDoc[] {
  const monthly = aggregateMonthlyTrend(rows, useRecomputed);
  const latestMonth = monthly[monthly.length - 1];
  const holidayDates = new Set(dimDates.filter((d) => d.isCanadianHoliday).map((d) => d.date));
  const holidaySales = rows.filter((r) => holidayDates.has(r.date)).reduce((a, r) => a + getRowSales(r, useRecomputed), 0);
  const weekendDates = new Set(dimDates.filter((d) => d.isWeekend).map((d) => d.date));
  const weekendSales = rows.filter((r) => weekendDates.has(r.date)).reduce((a, r) => a + getRowSales(r, useRecomputed), 0);
  const totalSales = rows.reduce((a, r) => a + getRowSales(r, useRecomputed), 0) || 1;
  const totals = computeCoreTotals(rows, useRecomputed);
  const stores = aggregateStores(rows, useRecomputed);
  const topStore = stores[0];
  const avgPriceRatio =
    rows.length > 0
      ? rows.reduce((a, r) => a + (1 + r.priceDeviationPct / 100), 0) / rows.length
      : 1;

  return [
    {
      name: 'Calendar Hierarchy (Year / Quarter / Month / Week / Day-of-Week)',
      category: 'Calendar',
      formula: 'Derived from Dim_Date covering min to max transaction date',
      sampleValue: `${dimDates.length.toLocaleString()} calendar days`,
    },
    {
      name: 'Weekend Sales Flag',
      category: 'Calendar',
      formula: 'dayOfWeek IN (Saturday, Sunday)',
      sampleValue: `${formatPct(weekendSales / totalSales)} of revenue`,
    },
    {
      name: 'Canadian Statutory Holiday Flag',
      category: 'Calendar',
      formula: 'Matches New Year, Family Day, Good Friday, Victoria, Canada, Civic, Labour, Truth & Reconciliation, Thanksgiving, Remembrance, Christmas, Boxing Day',
      sampleValue: `${formatPct(holidaySales / totalSales)} of revenue`,
    },
    {
      name: 'MoM & YoY Growth Rates',
      category: 'Time-Series',
      formula: '(Sales_t − Sales_{t−1}) / Sales_{t−1} and (Sales_t − Sales_{t−12}) / Sales_{t−12}',
      sampleValue: latestMonth?.momPct !== null && latestMonth?.momPct !== undefined
        ? `Latest MoM ${latestMonth.momPct >= 0 ? '+' : ''}${(latestMonth.momPct * 100).toFixed(1)}%`
        : 'N/A',
    },
    {
      name: '3-Period & 12-Period Rolling Means',
      category: 'Time-Series',
      formula: 'SMA_3(Sales_t), SMA_12(Sales_t) and Lag-1 / Lag-12 features',
      sampleValue: latestMonth?.rolling3m ? formatCAD(latestMonth.rolling3m, true) : 'N/A',
    },
    {
      name: 'Discount Depth Buckets',
      category: 'Pricing & Discount',
      formula: '0%, 1–5%, 6–10%, 11–15%, 16–25%, 25%+',
      sampleValue: `Avg ${formatPct(totals.discountPct)}`,
    },
    {
      name: 'Price-vs-Reference Ratio',
      category: 'Pricing & Discount',
      formula: 'Observed Unit Price ÷ Dim_Product Reference Unit Price',
      sampleValue: `${avgPriceRatio.toFixed(3)}x`,
    },
    {
      name: 'Order Size & Items per Order',
      category: 'Basket & Share',
      formula: 'Sales ÷ Distinct Orders (AOV) & Quantity ÷ Distinct Orders',
      sampleValue: `${formatCADExact(totals.aov)} · ${totals.avgUnitsPerOrder.toFixed(2)} units`,
    },
    {
      name: 'Store Share, Rep Share, Product Rank & Category Mix %',
      category: 'Basket & Share',
      formula: 'Entity Sales ÷ Total (or Store) Sales; ordinal revenue rank',
      sampleValue: topStore ? `${topStore.store}: ${formatPct(topStore.sharePct)}` : 'N/A',
    },
  ];
}

export interface UnitTestResult {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
}

export function runCalculationUnitTests(): UnitTestResult[] {
  const mockFacts: FactSale[] = [
    {
      transactionId: 'T1',
      date: '2025-01-10',
      yearMonth: '2025-01',
      year: 2025,
      quarter: 1,
      month: 1,
      product: 'Prod A',
      category: 'Cat 1',
      quantity: 2,
      unitPrice: 100,
      discountRate: 0.1,
      grossSales: 200,
      discountAmount: 20,
      salesAmount: 180,
      store: 'Toronto',
      province: 'Ontario',
      country: 'Canada',
      salesChannel: 'Online',
      paymentMethod: 'Credit Card',
      salesperson: 'Alice',
      orderId: 'O1',
      isReturn: false,
      isOutlier: false,
      outlierReasons: [],
      isPriceAnomaly: false,
      priceDeviationPct: 0,
      isCategoryMismatch: false,
      hasReconciliationDiff: false,
      imputedFields: [],
      uploadBatchId: 'test',
    },
    {
      transactionId: 'T2',
      date: '2025-01-10',
      yearMonth: '2025-01',
      year: 2025,
      quarter: 1,
      month: 1,
      product: 'Prod B',
      category: 'Cat 2',
      quantity: 1,
      unitPrice: 120,
      discountRate: 0,
      grossSales: 120,
      discountAmount: 0,
      salesAmount: 120,
      store: 'Toronto',
      province: 'Ontario',
      country: 'Canada',
      salesChannel: 'Online',
      paymentMethod: 'Credit Card',
      salesperson: 'Alice',
      orderId: 'O1', // Same order O1
      isReturn: false,
      isOutlier: false,
      outlierReasons: [],
      isPriceAnomaly: false,
      priceDeviationPct: 0,
      isCategoryMismatch: false,
      hasReconciliationDiff: false,
      imputedFields: [],
      uploadBatchId: 'test',
    },
    {
      transactionId: 'T3',
      date: '2025-02-10',
      yearMonth: '2025-02',
      year: 2025,
      quarter: 1,
      month: 2,
      product: 'Prod A',
      category: 'Cat 1',
      quantity: 4,
      unitPrice: 100,
      discountRate: 0.25,
      grossSales: 400,
      discountAmount: 100,
      salesAmount: 300,
      store: 'Vancouver',
      province: 'British Columbia',
      country: 'Canada',
      salesChannel: 'In-Store',
      paymentMethod: 'Debit',
      salesperson: 'Bob',
      orderId: 'O2',
      isReturn: false,
      isOutlier: false,
      outlierReasons: [],
      isPriceAnomaly: false,
      priceDeviationPct: 0,
      isCategoryMismatch: false,
      hasReconciliationDiff: false,
      imputedFields: [],
      uploadBatchId: 'test',
    },
  ];

  const totals = computeCoreTotals(mockFacts);
  const stores = aggregateStores(mockFacts);
  const growth = safeGrowthPct(450, 300);
  const trend = aggregateMonthlyTrend(mockFacts);

  // Forecast metric check (MAE/RMSE)
  const actuals = [100, 200, 300];
  const preds = [110, 190, 330];
  const mae = actuals.reduce((a, y, i) => a + Math.abs(y - preds[i]), 0) / actuals.length;
  const rmse = Math.sqrt(actuals.reduce((a, y, i) => a + (y - preds[i]) ** 2, 0) / actuals.length);

  return [
    {
      name: 'AOV uses distinct Order ID (CA$600 ÷ 2 orders)',
      passed: Math.abs(totals.aov - 300) < 0.001,
      expected: 'CA$300.00',
      actual: formatCADExact(totals.aov),
    },
    {
      name: 'Effective Discount % = Total Discounts ÷ Gross Sales',
      passed: Math.abs(totals.discountPct - 120 / 720) < 0.0001,
      expected: '16.7%',
      actual: formatPct(totals.discountPct),
    },
    {
      name: 'Growth % calculation ((450 − 300) ÷ 300)',
      passed: growth !== null && Math.abs(growth - 0.5) < 0.0001,
      expected: '50.0%',
      actual: growth !== null ? formatPct(growth) : 'null',
    },
    {
      name: 'Store Share % sums to 100%',
      passed: Math.abs(stores.reduce((a, s) => a + s.sharePct, 0) - 1) < 0.0001,
      expected: '100.0%',
      actual: formatPct(stores.reduce((a, s) => a + s.sharePct, 0)),
    },
    {
      name: 'Monthly MoM growth calculation (Feb vs Jan)',
      passed: trend.length === 2 && trend[1].momPct !== null && Math.abs(trend[1].momPct - 0) < 0.0001,
      expected: '0.0%',
      actual: trend[1]?.momPct !== null ? formatPct(trend[1].momPct) : 'null',
    },
    {
      name: 'Forecast MAE & RMSE formulas',
      passed: Math.abs(mae - 16.6667) < 0.01 && Math.abs(rmse - 19.1485) < 0.01,
      expected: 'MAE=16.67, RMSE=19.15',
      actual: `MAE=${mae.toFixed(2)}, RMSE=${rmse.toFixed(2)}`,
    },
  ];
}
