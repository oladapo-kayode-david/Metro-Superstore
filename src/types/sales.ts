export interface FactSale {
  transactionId: string;
  date: string; // YYYY-MM-DD
  yearMonth: string; // YYYY-MM
  year: number;
  quarter: number;
  month: number;
  product: string;
  category: string;
  quantity: number;
  unitPrice: number;
  discountRate: number; // 0 to 1
  grossSales: number;
  discountAmount: number;
  salesAmount: number;
  originalGrossSales?: number;
  originalDiscountAmount?: number;
  originalSalesAmount?: number;
  store: string;
  province: string;
  country: string;
  salesChannel: string;
  paymentMethod: string;
  salesperson: string;
  orderId: string;
  // Data quality flags
  isReturn: boolean;
  isOutlier: boolean;
  outlierReasons: string[];
  isPriceAnomaly: boolean;
  priceDeviationPct: number;
  isCategoryMismatch: boolean;
  hasReconciliationDiff: boolean;
  imputedFields: string[];
  uploadBatchId: string;
}

export interface DimDate {
  date: string; // YYYY-MM-DD (PK)
  year: number;
  quarter: number;
  monthNumber: number;
  monthName: string;
  week: number;
  dayOfWeek: number; // 0=Sun..6=Sat
  dayName: string;
  isWeekend: boolean;
  isCanadianHoliday: boolean;
  holidayName?: string;
  yearMonth: string;
}

export interface DimProduct {
  product: string; // PK
  category: string;
  referenceUnitPrice: number;
  source: 'sheet' | 'derived';
}

export interface DimStore {
  store: string; // PK
  province: string;
  country: string;
  source: 'sheet' | 'derived';
}

export interface DimSalesperson {
  salesperson: string; // PK
  primaryStore: string;
  primaryProvince: string;
}

export interface RejectedRow {
  rowIndex: number;
  sourceFile: string;
  reason: string;
  rawData: Record<string, unknown>;
}

export interface CleaningActionLog {
  step: string;
  detail: string;
  affectedCount: number;
  severity: 'info' | 'warning' | 'fixed';
}

export interface DataQualityReport {
  id: string;
  timestamp: string;
  filesProcessed: string[];
  rowsRead: number;
  rowsCleaned: number;
  rowsRejected: number;
  duplicatesRemoved: number;
  imputedCount: number;
  outliersFlagged: number;
  returnsFlagged: number;
  reconciliationDiffs: number;
  priceAnomalies: number;
  categoryMismatches: number;
  ambiguousDatesFound: number;
  qualityScore: number; // 0-100
  actions: CleaningActionLog[];
  rejectedRows: RejectedRow[];
  merges: Array<{ field: string; from: string; to: string; count: number }>;
}

export interface UploadHistoryEntry {
  id: string;
  timestamp: string;
  fileNames: string[];
  mode: 'append' | 'merge' | 'replace';
  rowsAdded: number;
  rowsUpdated: number;
  rowsRejected: number;
  qualityScore: number;
  canRollback: boolean;
}

export type DatePreset = 'ALL' | 'MTD' | 'QTD' | 'YTD' | '30D' | '90D' | '365D' | 'CUSTOM';

export interface GlobalFilters {
  datePreset: DatePreset;
  dateFrom: string;
  dateTo: string;
  years: number[];
  months: number[];
  stores: string[];
  categories: string[];
  products: string[];
  provinces: string[];
  salespeople: string[];
  channels: string[];
  paymentMethods: string[];
  searchQuery: string;
  excludeOutliers: boolean;
  useRecomputedFinancials: boolean;
}

export interface EntityColorRegistry {
  categories: Record<string, number>;
  stores: Record<string, number>;
  provinces: Record<string, number>;
  salespeople: Record<string, number>;
}

export interface LinkedGoogleSheet {
  spreadsheetId: string;
  name: string;
  webViewLink?: string;
  sheetNames: string[];
  lastSyncedAt: string;
  lastModifiedTime?: string;
  lastContentHash?: string;
  authMode?: 'oauth' | 'public_link';
  autoSyncEnabled: boolean;
  pollIntervalSeconds: number;
  rowCounts?: {
    transactions: number;
    stores: number;
    products: number;
  };
}

export interface AppSettings {
  id: 'singleton';
  theme: 'dark' | 'light';
  aiEnabled: boolean;
  dateFormatPreference: 'auto' | 'DMY' | 'MDY';
  excludeOutliers: boolean;
  useRecomputedFinancials: boolean;
  onboardingCompleted: boolean;
  filters: GlobalFilters;
  entityColors: EntityColorRegistry;
  linkedGoogleSheet: LinkedGoogleSheet | null;
}

export interface KpiMetric {
  id: string;
  label: string;
  value: number | string;
  formatted: string;
  previousValue?: number;
  yoyValue?: number;
  deltaPct?: number | null;
  yoyDeltaPct?: number | null;
  sparkline?: number[];
  formula: string;
  subtext?: string;
}

export interface ForecastPoint {
  yearMonth: string;
  actual?: number;
  predicted?: number;
  naive?: number;
  lower80?: number;
  upper80?: number;
  lower95?: number;
  upper95?: number;
  isForecast: boolean;
  quantityActual?: number;
  quantityPredicted?: number;
}

export interface ForecastModelResult {
  trainedAt: string;
  rowCount: number;
  method: string;
  scope: string;
  horizonMonths: number;
  sufficientData: boolean;
  insufficientReason?: string;
  metrics: {
    mae: number;
    rmse: number;
    mape: number;
    r2: number;
  };
  naiveBaseline: {
    label: string;
    mae: number;
    rmse: number;
    mape: number;
    beatsBaseline: boolean;
  };
  points: ForecastPoint[];
  featureImportance: Array<{ feature: string; importance: number }>;
  assumptions: string[];
  limitations: string[];
  plainEnglish: string;
}

export interface AnomalyItem {
  id: string;
  type: 'daily_sales' | 'discount' | 'price' | 'salesperson';
  date: string;
  entity: string;
  metric: string;
  observed: number;
  expected: number;
  score: number; // anomaly score 0-1 or robust z
  severity: 'High' | 'Medium';
  explanation: string;
}

export interface AnomalyModelResult {
  trainedAt: string;
  rowCount: number;
  sufficientData: boolean;
  insufficientReason?: string;
  flaggedCount: number;
  precisionProxy: number;
  naiveBaseline: {
    label: string;
    flaggedCount: number;
    beatsBaseline: boolean;
    note: string;
  };
  anomalies: AnomalyItem[];
  featureImportance: Array<{ feature: string; importance: number }>;
  assumptions: string[];
  limitations: string[];
  plainEnglish: string;
}

export interface DiscountImpactResult {
  trainedAt: string;
  rowCount: number;
  sufficientData: boolean;
  insufficientReason?: string;
  quantityElasticity: number;
  revenueElasticity: number;
  r2: number;
  optimalDiscountBand: string;
  naiveBaseline: {
    label: string;
    r2: number;
    beatsBaseline: boolean;
  };
  bands: Array<{
    band: string;
    avgDiscountPct: number;
    transactions: number;
    avgUnits: number;
    totalUnits: number;
    netRevenue: number;
    predictedRevenue: number;
    marginProxyPct: number;
  }>;
  featureImportance: Array<{ feature: string; importance: number }>;
  assumptions: string[];
  limitations: string[];
  plainEnglish: string;
}

export interface SegmentEntity {
  name: string;
  tier: 'Star' | 'Core' | 'Developing' | 'At-Risk';
  clusterId: number;
  sales: number;
  growthPct: number;
  consistency: number;
  aov: number;
  discountRate: number;
  categoryMix: number;
}

export interface SegmentationModelResult {
  trainedAt: string;
  rowCount: number;
  entityType: 'store' | 'salesperson';
  sufficientData: boolean;
  insufficientReason?: string;
  optimalK: number;
  silhouetteScore: number;
  naiveBaseline: {
    label: string;
    silhouetteScore: number;
    beatsBaseline: boolean;
  };
  entities: SegmentEntity[];
  clusterProfiles: Array<{
    tier: 'Star' | 'Core' | 'Developing' | 'At-Risk';
    count: number;
    growthScore: number;
    consistencyScore: number;
    aovScore: number;
    discountDiscipline: number;
    mixDiversity: number;
    avgSales: number;
  }>;
  featureImportance: Array<{ feature: string; importance: number }>;
  assumptions: string[];
  limitations: string[];
  plainEnglish: string;
}

export interface BasketRule {
  id: string;
  antecedent: string;
  consequent: string;
  support: number;
  confidence: number;
  lift: number;
  coOccurrences: number;
}

export interface BasketModelResult {
  trainedAt: string;
  rowCount: number;
  distinctOrders: number;
  multiItemOrders: number;
  sufficientData: boolean;
  insufficientReason?: string;
  rules: BasketRule[];
  naiveBaseline: {
    label: string;
    avgLift: number;
    beatsBaseline: boolean;
  };
  featureImportance: Array<{ feature: string; importance: number }>;
  assumptions: string[];
  limitations: string[];
  plainEnglish: string;
}

export interface AllModelResults {
  forecast?: ForecastModelResult;
  anomalies?: AnomalyModelResult;
  discountImpact?: DiscountImpactResult;
  storeSegmentation?: SegmentationModelResult;
  repSegmentation?: SegmentationModelResult;
  basketAffinity?: BasketModelResult;
}

export interface ChatMiniViz {
  type: 'bar' | 'line' | 'table';
  title: string;
  columns: string[];
  rows: Array<Record<string, string | number>>;
  xKey?: string;
  yKey?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  filtersUsed?: string;
  toolsCalled?: string[];
  viz?: ChatMiniViz;
  followUps?: string[];
  pinned?: boolean;
  inReport?: boolean;
  error?: boolean;
}

export interface PinnedInsight {
  id: string;
  title: string;
  summary: string;
  filtersUsed: string;
  createdAt: string;
  viz?: ChatMiniViz;
  inReport: boolean;
}

export interface RecommendationCard {
  id: string;
  title: string;
  targetType: string;
  targetName: string;
  priority: 'Critical' | 'High' | 'Medium' | 'Low';
  impactScore: number;
  confidenceScore: number;
  effortScore: number;
  priorityScore: number;
  evidence: string[];
  sourceModel: string;
  rootCauseHypothesis: string;
  confidenceLevel: 'High' | 'Medium' | 'Low';
  implementationPlan: Array<{
    stepNumber: number;
    action: string;
    ownerRole: string;
    timelineDays: number;
    resources: string;
  }>;
  expectedImpact: {
    lowCad: number;
    baseCad: number;
    highCad: number;
    assumptions: string;
  };
  kpis: Array<{
    metric: string;
    baseline: string;
    target: string;
    frequency: string;
    reviewDate: string;
  }>;
  risks: Array<{
    risk: string;
    mitigation: string;
  }>;
  status: 'Not started' | 'In progress' | 'Done';
}

export interface RecommendationsBundle {
  id: 'singleton';
  generatedAt: string;
  executiveSummary: string;
  totalRevenueAtRisk: number;
  totalOpportunityValue: number;
  recommendations: RecommendationCard[];
}

export type NavTabId =
  | 'overview'
  | 'trends'
  | 'products'
  | 'stores'
  | 'salespeople'
  | 'models'
  | 'recommendations'
  | 'analyst'
  | 'data'
  | 'reports'
  | 'help';

export interface ColumnMapping {
  transactionId: string;
  date: string;
  product: string;
  category: string;
  quantity: string;
  unitPrice: string;
  discountRate: string;
  grossSales: string;
  discountAmount: string;
  salesAmount: string;
  store: string;
  province: string;
  salesChannel: string;
  paymentMethod: string;
  salesperson: string;
  orderId: string;
}
