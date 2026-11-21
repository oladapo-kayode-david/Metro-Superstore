import Dexie, { type Table } from 'dexie';
import type {
  AppSettings,
  ChatMessage,
  DataQualityReport,
  DimDate,
  DimProduct,
  DimSalesperson,
  DimStore,
  FactSale,
  GlobalFilters,
  PinnedInsight,
  RecommendationsBundle,
  UploadHistoryEntry,
} from '../../types/sales';

export interface RollbackSnapshot {
  id: 'last_backup';
  batchId: string;
  factSales: FactSale[];
  dimProduct: DimProduct[];
  dimStore: DimStore[];
}

export const DEFAULT_FILTERS: GlobalFilters = {
  datePreset: 'ALL',
  dateFrom: '',
  dateTo: '',
  years: [],
  months: [],
  stores: [],
  categories: [],
  products: [],
  provinces: [],
  salespeople: [],
  channels: [],
  paymentMethods: [],
  searchQuery: '',
  excludeOutliers: false,
  useRecomputedFinancials: true,
};

export const DEFAULT_ENTITY_COLORS = {
  categories: {},
  stores: {},
  provinces: {},
  salespeople: {},
};

export const DEFAULT_SETTINGS: AppSettings = {
  id: 'singleton',
  theme: 'dark',
  aiEnabled: true,
  dateFormatPreference: 'auto',
  excludeOutliers: false,
  useRecomputedFinancials: true,
  onboardingCompleted: false,
  filters: DEFAULT_FILTERS,
  entityColors: DEFAULT_ENTITY_COLORS,
  linkedGoogleSheet: null,
};

class SalesIntelligenceDB extends Dexie {
  factSales!: Table<FactSale, string>;
  dimDate!: Table<DimDate, string>;
  dimProduct!: Table<DimProduct, string>;
  dimStore!: Table<DimStore, string>;
  dimSalesperson!: Table<DimSalesperson, string>;
  uploadHistory!: Table<UploadHistoryEntry, string>;
  qualityReports!: Table<DataQualityReport, string>;
  chatMessages!: Table<ChatMessage, string>;
  pinnedInsights!: Table<PinnedInsight, string>;
  recommendations!: Table<RecommendationsBundle, string>;
  settings!: Table<AppSettings, string>;
  rollbackSnapshots!: Table<RollbackSnapshot, string>;

  constructor() {
    super('SalesIntelligencePlatformDB');
    this.version(1).stores({
      factSales:
        'transactionId, date, yearMonth, year, product, category, store, province, salesperson, salesChannel, paymentMethod, orderId, uploadBatchId',
      dimDate: 'date, year, yearMonth, quarter',
      dimProduct: 'product, category',
      dimStore: 'store, province, country',
      dimSalesperson: 'salesperson, primaryStore, primaryProvince',
      uploadHistory: 'id, timestamp',
      qualityReports: 'id, timestamp',
      chatMessages: 'id, timestamp',
      pinnedInsights: 'id, createdAt',
      recommendations: 'id',
      settings: 'id',
      rollbackSnapshots: 'id',
    });
  }
}

export const db = new SalesIntelligenceDB();

export async function loadSettings(): Promise<AppSettings> {
  const existing = await db.settings.get('singleton');
  if (!existing) {
    await db.settings.put(DEFAULT_SETTINGS);
    return DEFAULT_SETTINGS;
  }
  return {
    ...DEFAULT_SETTINGS,
    ...existing,
    filters: {
      ...DEFAULT_FILTERS,
      ...(existing.filters ?? {}),
    },
    entityColors: {
      categories: { ...(existing.entityColors?.categories ?? {}) },
      stores: { ...(existing.entityColors?.stores ?? {}) },
      provinces: { ...(existing.entityColors?.provinces ?? {}) },
      salespeople: { ...(existing.entityColors?.salespeople ?? {}) },
    },
    linkedGoogleSheet: existing.linkedGoogleSheet ?? null,
  };
}

export async function saveSettings(partial: Partial<AppSettings>): Promise<AppSettings> {
  const current = await loadSettings();
  const next: AppSettings = {
    ...current,
    ...partial,
    id: 'singleton',
    filters: {
      ...current.filters,
      ...(partial.filters ?? {}),
    },
    entityColors: {
      categories: { ...(current.entityColors?.categories ?? {}), ...(partial.entityColors?.categories ?? {}) },
      stores: { ...(current.entityColors?.stores ?? {}), ...(partial.entityColors?.stores ?? {}) },
      provinces: { ...(current.entityColors?.provinces ?? {}), ...(partial.entityColors?.provinces ?? {}) },
      salespeople: { ...(current.entityColors?.salespeople ?? {}), ...(partial.entityColors?.salespeople ?? {}) },
    },
    linkedGoogleSheet:
      partial.linkedGoogleSheet !== undefined
        ? partial.linkedGoogleSheet
        : current.linkedGoogleSheet,
  };
  await db.settings.put(next);
  return next;
}

export function buildDimDateRange(facts: FactSale[]): DimDate[] {
  if (facts.length === 0) return [];
  let minStr = facts[0].date;
  let maxStr = facts[0].date;
  for (const f of facts) {
    if (f.date < minStr) minStr = f.date;
    if (f.date > maxStr) maxStr = f.date;
  }

  const start = new Date(`${minStr}T00:00:00Z`);
  const end = new Date(`${maxStr}T00:00:00Z`);
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const result: DimDate[] = [];

  for (let cur = new Date(start); cur <= end; cur.setUTCDate(cur.getUTCDate() + 1)) {
    const y = cur.getUTCFullYear();
    const m = cur.getUTCMonth() + 1;
    const d = cur.getUTCDate();
    const dow = cur.getUTCDay();
    const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const yearMonth = `${y}-${String(m).padStart(2, '0')}`;
    const startOfYear = new Date(Date.UTC(y, 0, 1));
    const dayOfYear = Math.floor((cur.getTime() - startOfYear.getTime()) / 86400000) + 1;
    const week = Math.ceil((dayOfYear + startOfYear.getUTCDay()) / 7);
    const holidayName = getCanadianStatutoryHoliday(y, m, d, dow);

    result.push({
      date: dateStr,
      year: y,
      quarter: Math.ceil(m / 3),
      monthNumber: m,
      monthName: months[m - 1],
      week,
      dayOfWeek: dow,
      dayName: days[dow],
      isWeekend: dow === 0 || dow === 6,
      isCanadianHoliday: Boolean(holidayName),
      holidayName,
      yearMonth,
    });
  }
  return result;
}

export function getCanadianStatutoryHoliday(
  year: number,
  month: number,
  day: number,
  dow: number
): string | undefined {
  if (month === 1 && day === 1) return "New Year's Day";
  if (month === 2 && dow === 1 && day >= 15 && day <= 21) return 'Family Day';
  if (month === 5 && dow === 1 && day >= 18 && day <= 24) return 'Victoria Day';
  if (month === 7 && day === 1) return 'Canada Day';
  if (month === 8 && dow === 1 && day <= 7) return 'Civic Holiday';
  if (month === 9 && dow === 1 && day <= 7) return 'Labour Day';
  if (month === 9 && day === 30) return 'National Day for Truth and Reconciliation';
  if (month === 10 && dow === 1 && day >= 8 && day <= 14) return 'Thanksgiving Day';
  if (month === 11 && day === 11) return 'Remembrance Day';
  if (month === 12 && day === 25) return 'Christmas Day';
  if (month === 12 && day === 26) return 'Boxing Day';
  // Good Friday approximation (anonymous Gregorian algorithm for Easter Sunday minus 2 days)
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const easterMonth = Math.floor((h + l - 7 * m + 114) / 31);
  const easterDay = ((h + l - 7 * m + 114) % 31) + 1;
  const goodFriday = new Date(Date.UTC(year, easterMonth - 1, easterDay - 2));
  if (goodFriday.getUTCMonth() + 1 === month && goodFriday.getUTCDate() === day) {
    return 'Good Friday';
  }
  return undefined;
}

export function deriveDimSalesperson(facts: FactSale[]): DimSalesperson[] {
  const counts = new Map<string, Map<string, { count: number; province: string }>>();
  for (const f of facts) {
    const rep = f.salesperson || 'Unassigned';
    if (!counts.has(rep)) counts.set(rep, new Map());
    const storeMap = counts.get(rep)!;
    const prev = storeMap.get(f.store) ?? { count: 0, province: f.province };
    prev.count += 1;
    storeMap.set(f.store, prev);
  }
  const result: DimSalesperson[] = [];
  for (const [salesperson, storeMap] of counts.entries()) {
    let primaryStore = 'Unknown';
    let primaryProvince = 'Unknown';
    let maxCount = -1;
    for (const [store, info] of storeMap.entries()) {
      if (info.count > maxCount) {
        maxCount = info.count;
        primaryStore = store;
        primaryProvince = info.province;
      }
    }
    result.push({ salesperson, primaryStore, primaryProvince });
  }
  return result.sort((a, b) => a.salesperson.localeCompare(b.salesperson));
}

export async function commitIngestionToDB(params: {
  mode: 'append' | 'merge' | 'replace';
  batchId: string;
  fileNames: string[];
  newFacts: FactSale[];
  dimProducts: DimProduct[];
  dimStores: DimStore[];
  qualityReport: DataQualityReport;
}): Promise<{
  rowsAdded: number;
  rowsUpdated: number;
  totalRows: number;
}> {
  const { mode, batchId, fileNames, newFacts, dimProducts, dimStores, qualityReport } = params;

  const existingFacts = await db.factSales.toArray();
  const existingProducts = await db.dimProduct.toArray();
  const existingStores = await db.dimStore.toArray();

  // Save rollback snapshot of pre-upload state
  await db.rollbackSnapshots.put({
    id: 'last_backup',
    batchId,
    factSales: existingFacts,
    dimProduct: existingProducts,
    dimStore: existingStores,
  });

  // Mark previous uploads non-rollbackable
  const prevHistory = await db.uploadHistory.toArray();
  for (const h of prevHistory) {
    if (h.canRollback) {
      await db.uploadHistory.update(h.id, { canRollback: false });
    }
  }

  let rowsAdded = 0;
  let rowsUpdated = 0;
  let finalFacts: FactSale[] = [];

  if (mode === 'replace') {
    finalFacts = newFacts;
    rowsAdded = newFacts.length;
  } else {
    const existingMap = new Map(existingFacts.map((f) => [f.transactionId, f]));
    for (const f of newFacts) {
      if (existingMap.has(f.transactionId)) {
        if (mode === 'merge') {
          existingMap.set(f.transactionId, f);
          rowsUpdated += 1;
        }
        // In append mode, dedupe on Transaction ID (skip existing)
      } else {
        existingMap.set(f.transactionId, f);
        rowsAdded += 1;
      }
    }
    finalFacts = Array.from(existingMap.values());
  }

  // Reconcile dimensions
  const prodMap = new Map<string, DimProduct>(
    mode === 'replace' ? [] : existingProducts.map((p) => [p.product, p])
  );
  for (const p of dimProducts) {
    const prev = prodMap.get(p.product);
    if (!prev || p.source === 'sheet') {
      prodMap.set(p.product, p);
    }
  }

  const storeMap = new Map<string, DimStore>(
    mode === 'replace' ? [] : existingStores.map((s) => [s.store, s])
  );
  for (const s of dimStores) {
    const prev = storeMap.get(s.store);
    if (!prev || s.source === 'sheet') {
      storeMap.set(s.store, s);
    }
  }

  const finalDimProducts = Array.from(prodMap.values());
  const finalDimStores = Array.from(storeMap.values());
  const finalDimDate = buildDimDateRange(finalFacts);
  const finalDimSalesperson = deriveDimSalesperson(finalFacts);

  await db.transaction(
    'rw',
    [db.factSales, db.dimDate, db.dimProduct, db.dimStore, db.dimSalesperson, db.uploadHistory, db.qualityReports],
    async () => {
      await db.factSales.clear();
      // Chunked bulkPut for large datasets (100k+ rows)
      const CHUNK = 5000;
      for (let i = 0; i < finalFacts.length; i += CHUNK) {
        await db.factSales.bulkPut(finalFacts.slice(i, i + CHUNK));
      }
      await db.dimDate.clear();
      await db.dimDate.bulkPut(finalDimDate);
      await db.dimProduct.clear();
      await db.dimProduct.bulkPut(finalDimProducts);
      await db.dimStore.clear();
      await db.dimStore.bulkPut(finalDimStores);
      await db.dimSalesperson.clear();
      await db.dimSalesperson.bulkPut(finalDimSalesperson);

      await db.uploadHistory.put({
        id: batchId,
        timestamp: new Date().toISOString(),
        fileNames,
        mode,
        rowsAdded,
        rowsUpdated,
        rowsRejected: qualityReport.rowsRejected,
        qualityScore: qualityReport.qualityScore,
        canRollback: true,
      });

      await db.qualityReports.put(qualityReport);
    }
  );

  return { rowsAdded, rowsUpdated, totalRows: finalFacts.length };
}

export async function rollbackLastUpload(): Promise<boolean> {
  const snap = await db.rollbackSnapshots.get('last_backup');
  if (!snap) return false;

  const dimDate = buildDimDateRange(snap.factSales);
  const dimSalesperson = deriveDimSalesperson(snap.factSales);

  await db.transaction(
    'rw',
    [
      db.factSales,
      db.dimDate,
      db.dimProduct,
      db.dimStore,
      db.dimSalesperson,
      db.uploadHistory,
      db.rollbackSnapshots,
    ],
    async () => {
      await db.factSales.clear();
      const CHUNK = 5000;
      for (let i = 0; i < snap.factSales.length; i += CHUNK) {
        await db.factSales.bulkPut(snap.factSales.slice(i, i + CHUNK));
      }
      await db.dimDate.clear();
      await db.dimDate.bulkPut(dimDate);
      await db.dimProduct.clear();
      await db.dimProduct.bulkPut(snap.dimProduct);
      await db.dimStore.clear();
      await db.dimStore.bulkPut(snap.dimStore);
      await db.dimSalesperson.clear();
      await db.dimSalesperson.bulkPut(dimSalesperson);
      await db.uploadHistory.delete(snap.batchId);
      await db.rollbackSnapshots.delete('last_backup');
    }
  );
  return true;
}

export async function exportAllDatabaseJson(): Promise<string> {
  const [factSales, dimDate, dimProduct, dimStore, dimSalesperson, uploadHistory, qualityReports, recommendations, pinnedInsights] =
    await Promise.all([
      db.factSales.toArray(),
      db.dimDate.toArray(),
      db.dimProduct.toArray(),
      db.dimStore.toArray(),
      db.dimSalesperson.toArray(),
      db.uploadHistory.toArray(),
      db.qualityReports.toArray(),
      db.recommendations.toArray(),
      db.pinnedInsights.toArray(),
    ]);

  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      platform: 'Sales Intelligence Platform',
      tables: {
        Fact_Sales: factSales,
        Dim_Date: dimDate,
        Dim_Product: dimProduct,
        Dim_Store: dimStore,
        Dim_Salesperson: dimSalesperson,
      },
      uploadHistory,
      qualityReports,
      recommendations,
      pinnedInsights,
    },
    null,
    2
  );
}

export async function clearAllDatabaseData(): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.factSales,
      db.dimDate,
      db.dimProduct,
      db.dimStore,
      db.dimSalesperson,
      db.uploadHistory,
      db.qualityReports,
      db.chatMessages,
      db.pinnedInsights,
      db.recommendations,
      db.rollbackSnapshots,
    ],
    async () => {
      await Promise.all([
        db.factSales.clear(),
        db.dimDate.clear(),
        db.dimProduct.clear(),
        db.dimStore.clear(),
        db.dimSalesperson.clear(),
        db.uploadHistory.clear(),
        db.qualityReports.clear(),
        db.chatMessages.clear(),
        db.pinnedInsights.clear(),
        db.recommendations.clear(),
        db.rollbackSnapshots.clear(),
      ]);
    }
  );
}
