import * as ss from 'simple-statistics';
import type {
  CleaningActionLog,
  ColumnMapping,
  DataQualityReport,
  DimProduct,
  DimStore,
  FactSale,
  RejectedRow,
} from '../../types/sales';

export interface RawTableSheet {
  sheetName: string;
  fileName: string;
  headers: string[];
  rows: Array<Record<string, unknown>>;
}

export interface DetectedTables {
  transactions: Array<{ row: Record<string, unknown>; fileName: string; rowIndex: number }>;
  stores: Array<Record<string, unknown>>;
  products: Array<Record<string, unknown>>;
  detectedMapping: Partial<ColumnMapping>;
  unmappedTransactionHeaders: string[];
  rawTransactionHeaders: string[];
  hasAmbiguousDates: boolean;
  ambiguousDateSamples: string[];
}

export const CANADIAN_PROVINCES: Record<string, string> = {
  on: 'Ontario',
  ontario: 'Ontario',
  qc: 'Quebec',
  quebec: 'Quebec',
  québec: 'Quebec',
  bc: 'British Columbia',
  'british columbia': 'British Columbia',
  ab: 'Alberta',
  alberta: 'Alberta',
  mb: 'Manitoba',
  manitoba: 'Manitoba',
  sk: 'Saskatchewan',
  saskatchewan: 'Saskatchewan',
  ns: 'Nova Scotia',
  'nova scotia': 'Nova Scotia',
  nb: 'New Brunswick',
  'new brunswick': 'New Brunswick',
  nl: 'Newfoundland and Labrador',
  'newfoundland and labrador': 'Newfoundland and Labrador',
  newfoundland: 'Newfoundland and Labrador',
  pe: 'Prince Edward Island',
  pei: 'Prince Edward Island',
  'prince edward island': 'Prince Edward Island',
  nt: 'Northwest Territories',
  'northwest territories': 'Northwest Territories',
  yt: 'Yukon',
  yukon: 'Yukon',
  nu: 'Nunavut',
  nunavut: 'Nunavut',
};

function normHeader(h: string): string {
  return String(h ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[_\-]+/g, ' ');
}

const TRANSACTION_HEADER_ALIASES: Record<keyof ColumnMapping, string[]> = {
  transactionId: ['transaction id', 'txn id', 'trans id', 'id', 'transaction_id'],
  date: ['date', 'transaction date', 'order date', 'sale date', 'invoice date'],
  product: ['product', 'product name', 'item', 'sku name'],
  category: ['category', 'product category', 'dept', 'department'],
  quantity: ['quantity', 'qty', 'units', 'unit count'],
  unitPrice: ['unit price (cad)', 'unit price', 'price', 'price (cad)', 'unit_price'],
  discountRate: ['discount rate', 'discount %', 'discount pct', 'discount_rate', 'disc rate'],
  grossSales: ['gross sales', 'gross amount', 'gross revenue', 'gross sales (cad)'],
  discountAmount: ['discount amount', 'discount (cad)', 'discount $', 'discount value'],
  salesAmount: ['sales amount', 'net sales', 'sales', 'revenue', 'total sales', 'sales amount (cad)'],
  store: ['store', 'store name', 'branch', 'location'],
  province: ['province', 'region', 'state', 'province/region'],
  salesChannel: ['sales channel', 'channel'],
  paymentMethod: ['payment method', 'payment', 'payment type'],
  salesperson: ['salesperson', 'sales rep', 'rep', 'associate', 'seller'],
  orderId: ['order id', 'order number', 'order #', 'invoice id', 'basket id'],
};

export function matchHeader(headers: string[], aliases: string[]): string {
  const normalized = headers.map((h) => ({ raw: h, norm: normHeader(h) }));
  for (const alias of aliases) {
    const exact = normalized.find((item) => item.norm === alias);
    if (exact) return exact.raw;
  }
  for (const alias of aliases) {
    const partial = normalized.find((item) => item.norm.includes(alias));
    if (partial) return partial.raw;
  }
  return '';
}

export function autoDetectTables(sheets: RawTableSheet[]): DetectedTables {
  const transactions: Array<{ row: Record<string, unknown>; fileName: string; rowIndex: number }> = [];
  const stores: Array<Record<string, unknown>> = [];
  const products: Array<Record<string, unknown>> = [];
  let rawTransactionHeaders: string[] = [];
  let detectedMapping: Partial<ColumnMapping> = {};

  for (const sheet of sheets) {
    const normHeaders = sheet.headers.map(normHeader);
    const hasTxnId = normHeaders.some((h) => TRANSACTION_HEADER_ALIASES.transactionId.includes(h));
    const hasSales = normHeaders.some(
      (h) =>
        TRANSACTION_HEADER_ALIASES.salesAmount.includes(h) ||
        TRANSACTION_HEADER_ALIASES.quantity.includes(h)
    );
    const hasRefPrice = normHeaders.some(
      (h) => h.includes('reference unit price') || h === 'reference price'
    );
    const hasStoreCols =
      normHeaders.includes('store') &&
      normHeaders.includes('province') &&
      normHeaders.includes('country') &&
      normHeaders.length <= 5;
    const hasProductCols =
      normHeaders.includes('product') &&
      normHeaders.includes('category') &&
      (hasRefPrice || normHeaders.length <= 4) &&
      !hasTxnId;

    if (hasProductCols && !hasSales) {
      products.push(...sheet.rows);
    } else if (hasStoreCols && !hasSales && !hasTxnId) {
      stores.push(...sheet.rows);
    } else {
      // Treat as transactions table
      if (rawTransactionHeaders.length === 0) {
        rawTransactionHeaders = sheet.headers;
        const map: Partial<ColumnMapping> = {};
        (Object.keys(TRANSACTION_HEADER_ALIASES) as Array<keyof ColumnMapping>).forEach((key) => {
          map[key] = matchHeader(sheet.headers, TRANSACTION_HEADER_ALIASES[key]);
        });
        detectedMapping = map;
      }
      sheet.rows.forEach((row, idx) => {
        transactions.push({ row, fileName: sheet.fileName, rowIndex: idx + 2 });
      });
    }
  }

  const mappedValues = new Set(Object.values(detectedMapping).filter(Boolean));
  const unmappedTransactionHeaders = rawTransactionHeaders.filter((h) => !mappedValues.has(h));

  // Scan first 300 date samples for ambiguous DD/MM/YYYY vs MM/DD/YYYY
  const ambiguousDateSamples: string[] = [];
  const dateCol = detectedMapping.date;
  if (dateCol) {
    let seenDayOver12 = false;
    let seenMonthOver12 = false;
    for (let i = 0; i < Math.min(transactions.length, 400); i++) {
      const val = transactions[i].row[dateCol];
      if (typeof val === 'string') {
        const trimmed = val.trim();
        const m = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
        if (m) {
          const p1 = Number(m[1]);
          const p2 = Number(m[2]);
          if (p1 > 12) seenDayOver12 = true;
          if (p2 > 12) seenMonthOver12 = true;
          if (p1 <= 12 && p2 <= 12 && ambiguousDateSamples.length < 5) {
            ambiguousDateSamples.push(trimmed);
          }
        }
      }
    }
    if (seenDayOver12 || seenMonthOver12) {
      // Format is determinable from data
      ambiguousDateSamples.length = 0;
    }
  }

  return {
    transactions,
    stores,
    products,
    detectedMapping,
    unmappedTransactionHeaders,
    rawTransactionHeaders,
    hasAmbiguousDates: ambiguousDateSamples.length > 0,
    ambiguousDateSamples,
  };
}

function titleCaseClean(val: string): string {
  const trimmed = val.trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';
  // Preserve known uppercase acronyms like CAD, POS, VIP, B2B, TV, USB, SSD, HD, PRO
  const acronyms = new Set(['POS', 'VIP', 'B2B', 'TV', 'USB', 'SSD', 'HD', 'LED', 'AI', 'CAD', 'E-COMMERCE']);
  return trimmed
    .split(' ')
    .map((word) => {
      if (acronyms.has(word.toUpperCase())) return word.toUpperCase();
      if (word.includes('-')) {
        return word
          .split('-')
          .map((part) => (part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : ''))
          .join('-');
      }
      return word[0].toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

function buildCanonicalMap(
  values: string[],
  fieldName: string,
  merges: Array<{ field: string; from: string; to: string; count: number }>
): Map<string, string> {
  const freq = new Map<string, number>();
  for (const raw of values) {
    if (!raw) continue;
    freq.set(raw, (freq.get(raw) ?? 0) + 1);
  }
  const sorted = Array.from(freq.entries()).sort((a, b) => b[1] - a[1]);
  const canonicals: Array<{ label: string; norm: string }> = [];
  const mapping = new Map<string, string>();

  for (const [label, count] of sorted) {
    const cleaned = titleCaseClean(label);
    const norm = cleaned.toLowerCase().replace(/[^a-z0-9]/g, '');

    let matchedCanonical: string | null = null;
    for (const c of canonicals) {
      if (c.norm === norm) {
        matchedCanonical = c.label;
        break;
      }
      if (norm.length >= 6 && c.norm.length >= 6 && Math.abs(norm.length - c.norm.length) <= 1) {
        if (levenshtein(norm, c.norm) === 1) {
          matchedCanonical = c.label;
          break;
        }
      }
    }

    if (matchedCanonical) {
      mapping.set(label, matchedCanonical);
      if (label !== matchedCanonical) {
        merges.push({ field: fieldName, from: label, to: matchedCanonical, count });
      }
    } else {
      canonicals.push({ label: cleaned, norm });
      mapping.set(label, cleaned);
      if (label !== cleaned) {
        merges.push({ field: fieldName, from: label, to: cleaned, count });
      }
    }
  }
  return mapping;
}

export function parseCurrencyNumber(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  const str = String(val)
    .trim()
    .replace(/^(CA\$|CAD|\$)/i, '')
    .replace(/[,$\s]/g, '');
  if (!str) return null;
  const num = Number(str);
  return Number.isFinite(num) ? num : null;
}

export function parseDiscountRate(val: unknown): { rate: number | null; wasConverted: boolean } {
  if (val === null || val === undefined || String(val).trim() === '') {
    return { rate: null, wasConverted: false };
  }
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return { rate: null, wasConverted: false };
    if (val > 1 && val <= 100) return { rate: val / 100, wasConverted: true };
    return { rate: val, wasConverted: false };
  }
  const str = String(val).trim();
  const hasPct = str.endsWith('%');
  const num = Number(str.replace(/%/g, '').replace(/,/g, '').trim());
  if (!Number.isFinite(num)) return { rate: null, wasConverted: false };
  if (hasPct || (num > 1 && num <= 100)) {
    return { rate: num / 100, wasConverted: true };
  }
  return { rate: num, wasConverted: false };
}

export function parseDateRobust(
  val: unknown,
  preference: 'auto' | 'DMY' | 'MDY',
  inferredOrder: 'DMY' | 'MDY'
): { iso: string | null; ambiguous: boolean } {
  if (val === null || val === undefined || val === '') return { iso: null, ambiguous: false };

  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    const y = val.getUTCFullYear();
    const m = val.getUTCMonth() + 1;
    const d = val.getUTCDate();
    if (y >= 1990 && y <= 2100) {
      return {
        iso: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
        ambiguous: false,
      };
    }
    return { iso: null, ambiguous: false };
  }

  // Excel serial number
  if (typeof val === 'number' && val > 20000 && val < 90000) {
    const utcDays = Math.floor(val - 25569);
    const dt = new Date(utcDays * 86400 * 1000);
    if (!Number.isNaN(dt.getTime())) {
      return {
        iso: `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
          dt.getUTCDate()
        ).padStart(2, '0')}`,
        ambiguous: false,
      };
    }
  }

  const str = String(val).trim();
  if (!str) return { iso: null, ambiguous: false };

  // Pure numeric Excel serial as string
  if (/^\d{5}(\.\d+)?$/.test(str)) {
    const serial = Number(str);
    if (serial > 20000 && serial < 90000) {
      const dt = new Date(Math.floor(serial - 25569) * 86400 * 1000);
      return {
        iso: `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
          dt.getUTCDate()
        ).padStart(2, '0')}`,
        ambiguous: false,
      };
    }
  }

  // ISO YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = str.match(/^(\d{4})[\-\/](\d{1,2})[\-\/](\d{1,2})(?:[T\s].*)?$/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return {
        iso: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
        ambiguous: false,
      };
    }
  }

  // Slash or dash DD/MM/YYYY or MM/DD/YYYY
  const slashMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:\s.*)?$/);
  if (slashMatch) {
    const p1 = Number(slashMatch[1]);
    const p2 = Number(slashMatch[2]);
    let y = Number(slashMatch[3]);
    if (y < 100) y += y >= 70 ? 1900 : 2000;

    let month: number;
    let day: number;
    let ambiguous = false;

    if (p1 > 12 && p2 <= 12) {
      day = p1;
      month = p2;
    } else if (p2 > 12 && p1 <= 12) {
      month = p1;
      day = p2;
    } else if (p1 <= 12 && p2 <= 12) {
      ambiguous = preference === 'auto';
      const order = preference === 'auto' ? inferredOrder : preference;
      if (order === 'DMY') {
        day = p1;
        month = p2;
      } else {
        month = p1;
        day = p2;
      }
    } else {
      return { iso: null, ambiguous: false };
    }

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return {
        iso: `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        ambiguous,
      };
    }
  }

  // Fallback natural Date.parse (e.g., "Jan 15, 2025")
  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime()) && parsed.getFullYear() >= 1990 && parsed.getFullYear() <= 2100) {
    return {
      iso: `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(
        parsed.getDate()
      ).padStart(2, '0')}`,
      ambiguous: false,
    };
  }

  return { iso: null, ambiguous: false };
}

export interface CleaningOptions {
  batchId: string;
  fileNames: string[];
  mapping: Partial<ColumnMapping>;
  dateFormatPreference: 'auto' | 'DMY' | 'MDY';
  onProgress?: (pct: number, stage: string) => void;
}

export interface CleaningOutput {
  facts: FactSale[];
  dimProducts: DimProduct[];
  dimStores: DimStore[];
  report: DataQualityReport;
}

export function runCleaningPipeline(
  detected: DetectedTables,
  options: CleaningOptions
): CleaningOutput {
  const { batchId, fileNames, mapping, dateFormatPreference, onProgress } = options;
  const actions: CleaningActionLog[] = [];
  const rejectedRows: RejectedRow[] = [];
  const merges: Array<{ field: string; from: string; to: string; count: number }> = [];

  onProgress?.(10, 'Building dimension reference lookups');

  // 1. Parse Dim_Store from Sheet 2
  const storeLookup = new Map<string, DimStore>();
  for (const row of detected.stores) {
    const keys = Object.keys(row);
    const storeCol = matchHeader(keys, ['store', 'store name', 'branch']);
    const provCol = matchHeader(keys, ['province', 'region', 'state']);
    const countryCol = matchHeader(keys, ['country']);
    const rawStore = String(row[storeCol] ?? '').trim();
    if (!rawStore) continue;
    const cleanStore = titleCaseClean(rawStore);
    const rawProv = String(row[provCol] ?? '').trim();
    const provNorm = CANADIAN_PROVINCES[rawProv.toLowerCase()] ?? titleCaseClean(rawProv || 'Unknown');
    const country = titleCaseClean(String(row[countryCol] ?? 'Canada').trim() || 'Canada');
    storeLookup.set(cleanStore.toLowerCase(), {
      store: cleanStore,
      province: provNorm,
      country,
      source: 'sheet',
    });
  }

  // 2. Parse Dim_Product from Sheet 3
  const productLookup = new Map<string, DimProduct>();
  for (const row of detected.products) {
    const keys = Object.keys(row);
    const prodCol = matchHeader(keys, ['product', 'product name', 'item']);
    const catCol = matchHeader(keys, ['category', 'product category']);
    const refCol = matchHeader(keys, ['reference unit price (cad)', 'reference unit price', 'reference price', 'unit price']);
    const rawProd = String(row[prodCol] ?? '').trim();
    if (!rawProd) continue;
    const cleanProd = titleCaseClean(rawProd);
    const cleanCat = titleCaseClean(String(row[catCol] ?? 'Uncategorized').trim() || 'Uncategorized');
    const refPrice = parseCurrencyNumber(row[refCol]) ?? 0;
    productLookup.set(cleanProd.toLowerCase(), {
      product: cleanProd,
      category: cleanCat,
      referenceUnitPrice: refPrice,
      source: 'sheet',
    });
  }

  onProgress?.(22, 'Normalizing categorical labels and merging near-duplicates');

  const col = (key: keyof ColumnMapping) => mapping[key] || '';
  const rawTxns = detected.transactions;

  // Infer DMY vs MDY across dataset if preference is auto
  let dmyVotes = 0;
  let mdyVotes = 0;
  const dateKey = col('date');
  for (let i = 0; i < Math.min(rawTxns.length, 2000); i++) {
    const v = rawTxns[i].row[dateKey];
    if (typeof v === 'string') {
      const m = v.trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
      if (m) {
        if (Number(m[1]) > 12) dmyVotes++;
        if (Number(m[2]) > 12) mdyVotes++;
      }
    }
  }
  const inferredOrder: 'DMY' | 'MDY' = dmyVotes > mdyVotes ? 'DMY' : 'MDY';

  // Collect categorical values for near-duplicate merging
  const collectField = (k: keyof ColumnMapping) => {
    const header = col(k);
    if (!header) return [] as string[];
    return rawTxns.map((t) => String(t.row[header] ?? '').trim()).filter(Boolean);
  };

  const storeMap = buildCanonicalMap(collectField('store'), 'Store', merges);
  const productMap = buildCanonicalMap(collectField('product'), 'Product', merges);
  const categoryMap = buildCanonicalMap(collectField('category'), 'Category', merges);
  const channelMap = buildCanonicalMap(collectField('salesChannel'), 'Sales Channel', merges);
  const paymentMap = buildCanonicalMap(collectField('paymentMethod'), 'Payment Method', merges);
  const repMap = buildCanonicalMap(collectField('salesperson'), 'Salesperson', merges);

  if (merges.length > 0) {
    actions.push({
      step: 'Categorical Normalization',
      detail: `Trimmed whitespace, standardized casing, and merged ${merges.length} label variants across Store, Product, Category, Channel, Payment Method, and Salesperson.`,
      affectedCount: merges.reduce((acc, m) => acc + m.count, 0),
      severity: 'fixed',
    });
  }

  onProgress?.(45, 'Parsing dates, currencies, imputations, and financial reconciliations');

  const seenExact = new Set<string>();
  const byTxnId = new Map<string, FactSale>();
  let duplicatesRemoved = 0;
  let imputedCount = 0;
  let returnsFlagged = 0;
  let reconciliationDiffs = 0;
  let priceAnomalies = 0;
  let categoryMismatches = 0;
  let ambiguousDatesFound = 0;
  let pctConversions = 0;

  // Compute observed median prices per product for fallback imputation
  const observedPricesByProd = new Map<string, number[]>();
  for (const t of rawTxns) {
    const rawP = String(t.row[col('product')] ?? '').trim();
    const p = productMap.get(rawP) ?? titleCaseClean(rawP);
    const up = parseCurrencyNumber(t.row[col('unitPrice')]);
    if (p && up !== null && up > 0) {
      const arr = observedPricesByProd.get(p) ?? [];
      arr.push(up);
      observedPricesByProd.set(p, arr);
    }
  }
  const medianPriceByProd = new Map<string, number>();
  for (const [p, arr] of observedPricesByProd.entries()) {
    medianPriceByProd.set(p, ss.median(arr));
  }

  for (let idx = 0; idx < rawTxns.length; idx++) {
    const { row, fileName, rowIndex } = rawTxns[idx];
    const exactSig = JSON.stringify(row);
    if (seenExact.has(exactSig)) {
      duplicatesRemoved++;
      continue;
    }
    seenExact.add(exactSig);

    const txnId = String(row[col('transactionId')] ?? '').trim();
    const rawDate = row[col('date')];
    const rawProduct = String(row[col('product')] ?? '').trim();
    const rawStore = String(row[col('store')] ?? '').trim();
    const qtyNum = parseCurrencyNumber(row[col('quantity')]);

    const missingRequired: string[] = [];
    if (!txnId) missingRequired.push('Transaction ID');
    if (rawDate === null || rawDate === undefined || String(rawDate).trim() === '') missingRequired.push('Date');
    if (!rawProduct) missingRequired.push('Product');
    if (!rawStore) missingRequired.push('Store');
    if (qtyNum === null || qtyNum === 0) missingRequired.push('Quantity');

    if (missingRequired.length > 0) {
      rejectedRows.push({
        rowIndex,
        sourceFile: fileName,
        reason: `Missing required field(s): ${missingRequired.join(', ')}`,
        rawData: row,
      });
      continue;
    }

    const parsedDate = parseDateRobust(rawDate, dateFormatPreference, inferredOrder);
    if (!parsedDate.iso) {
      rejectedRows.push({
        rowIndex,
        sourceFile: fileName,
        reason: `Unparseable Date value: "${String(rawDate)}"`,
        rawData: row,
      });
      continue;
    }
    if (parsedDate.ambiguous) ambiguousDatesFound++;

    const product = productMap.get(rawProduct) ?? titleCaseClean(rawProduct);
    const store = storeMap.get(rawStore) ?? titleCaseClean(rawStore);
    const dimProd = productLookup.get(product.toLowerCase());
    const dimStore = storeLookup.get(store.toLowerCase());

    const rawCat = String(row[col('category')] ?? '').trim();
    let category = rawCat ? categoryMap.get(rawCat) ?? titleCaseClean(rawCat) : dimProd?.category ?? 'Uncategorized';
    let isCategoryMismatch = false;
    if (dimProd && rawCat && dimProd.category.toLowerCase() !== category.toLowerCase()) {
      isCategoryMismatch = true;
      categoryMismatches++;
    }
    const imputedFields: string[] = [];
    if (!rawCat && dimProd) {
      imputedFields.push('Category');
      imputedCount++;
    }

    const rawProv = String(row[col('province')] ?? '').trim();
    const mappedProv =
      CANADIAN_PROVINCES[rawProv.toLowerCase()] ??
      dimStore?.province ??
      titleCaseClean(rawProv || 'Unknown');
    const country = dimStore?.country ?? 'Canada';

    // Unit price with Dim_Product / median imputation
    let unitPrice = parseCurrencyNumber(row[col('unitPrice')]);
    if (unitPrice === null || unitPrice <= 0) {
      const refFallback = dimProd?.referenceUnitPrice || medianPriceByProd.get(product) || 0;
      if (refFallback > 0) {
        unitPrice = refFallback;
        imputedFields.push('Unit Price');
        imputedCount++;
      } else {
        rejectedRows.push({
          rowIndex,
          sourceFile: fileName,
          reason: 'Missing or non-positive Unit Price and no reference price available in Dim_Product',
          rawData: row,
        });
        continue;
      }
    }

    // Discount rate 0..1 with 0 imputation
    const discParsed = parseDiscountRate(row[col('discountRate')]);
    if (discParsed.wasConverted) pctConversions++;
    let discountRate = discParsed.rate;
    if (discountRate === null) {
      discountRate = 0;
      imputedFields.push('Discount Rate');
      imputedCount++;
    }
    if (discountRate < 0 || discountRate > 1) {
      rejectedRows.push({
        rowIndex,
        sourceFile: fileName,
        reason: `Discount Rate out of valid [0, 1] range: ${discountRate}`,
        rawData: row,
      });
      continue;
    }

    const quantity = qtyNum!;
    const isReturn = quantity < 0;
    if (isReturn) returnsFlagged++;

    // Recompute financials
    const recomputedGross = Number((quantity * unitPrice).toFixed(2));
    const recomputedDiscount = Number((recomputedGross * discountRate).toFixed(2));
    const recomputedSales = Number((recomputedGross - recomputedDiscount).toFixed(2));

    const origGross = parseCurrencyNumber(row[col('grossSales')]);
    const origDisc = parseCurrencyNumber(row[col('discountAmount')]);
    const origSales = parseCurrencyNumber(row[col('salesAmount')]);

    const hasReconciliationDiff =
      (origGross !== null && Math.abs(origGross - recomputedGross) > 0.01) ||
      (origDisc !== null && Math.abs(origDisc - recomputedDiscount) > 0.01) ||
      (origSales !== null && Math.abs(origSales - recomputedSales) > 0.01);

    if (hasReconciliationDiff) reconciliationDiffs++;

    // Price deviation against Reference Unit Price
    const refPrice = dimProd?.referenceUnitPrice || medianPriceByProd.get(product) || unitPrice;
    const priceDeviationPct = refPrice > 0 ? ((unitPrice - refPrice) / refPrice) * 100 : 0;
    const isPriceAnomaly = Math.abs(priceDeviationPct) > 25;
    if (isPriceAnomaly) priceAnomalies++;

    const rawChannel = String(row[col('salesChannel')] ?? '').trim();
    const salesChannel = rawChannel ? channelMap.get(rawChannel) ?? titleCaseClean(rawChannel) : 'In-Store';

    const rawPay = String(row[col('paymentMethod')] ?? '').trim();
    const paymentMethod = rawPay ? paymentMap.get(rawPay) ?? titleCaseClean(rawPay) : 'Credit Card';

    const rawRep = String(row[col('salesperson')] ?? '').trim();
    const salesperson = rawRep ? repMap.get(rawRep) ?? titleCaseClean(rawRep) : 'Unassigned';

    const rawOrder = String(row[col('orderId')] ?? '').trim();
    const orderId = rawOrder || `ORD-${txnId}`;

    const [yStr, mStr] = parsedDate.iso.split('-');
    const year = Number(yStr);
    const month = Number(mStr);

    if (byTxnId.has(txnId)) {
      duplicatesRemoved++;
    }
    // Keep latest duplicate Transaction ID
    byTxnId.set(txnId, {
      transactionId: txnId,
      date: parsedDate.iso,
      yearMonth: `${yStr}-${mStr}`,
      year,
      quarter: Math.ceil(month / 3),
      month,
      product,
      category,
      quantity,
      unitPrice,
      discountRate,
      grossSales: recomputedGross,
      discountAmount: recomputedDiscount,
      salesAmount: recomputedSales,
      originalGrossSales: origGross ?? recomputedGross,
      originalDiscountAmount: origDisc ?? recomputedDiscount,
      originalSalesAmount: origSales ?? recomputedSales,
      store,
      province: mappedProv,
      country,
      salesChannel,
      paymentMethod,
      salesperson,
      orderId,
      isReturn,
      isOutlier: false,
      outlierReasons: [],
      isPriceAnomaly,
      priceDeviationPct: Number(priceDeviationPct.toFixed(1)),
      isCategoryMismatch,
      hasReconciliationDiff,
      imputedFields,
      uploadBatchId: batchId,
    });
  }

  onProgress?.(75, 'Running IQR and Z-score outlier detection');

  const facts = Array.from(byTxnId.values());

  // Outlier detection (IQR + Z-score) on Quantity, Unit Price, Sales Amount
  let outliersFlagged = 0;
  if (facts.length >= 10) {
    const calcBounds = (values: number[]) => {
      const sorted = [...values].sort((a, b) => a - b);
      const q1 = ss.quantileSorted(sorted, 0.25);
      const q3 = ss.quantileSorted(sorted, 0.75);
      const iqr = q3 - q1;
      const mean = ss.mean(sorted);
      const sd = ss.standardDeviation(sorted) || 1;
      return { low: q1 - 1.5 * iqr, high: q3 + 1.5 * iqr, mean, sd };
    };

    const qtyBounds = calcBounds(facts.map((f) => f.quantity));
    const priceBounds = calcBounds(facts.map((f) => f.unitPrice));
    const salesBounds = calcBounds(facts.map((f) => f.salesAmount));

    for (const f of facts) {
      const reasons: string[] = [];
      const zQty = Math.abs((f.quantity - qtyBounds.mean) / qtyBounds.sd);
      if (f.quantity > qtyBounds.high || f.quantity < qtyBounds.low || zQty > 3.2) {
        reasons.push(`Quantity (${f.quantity})`);
      }
      const zPrice = Math.abs((f.unitPrice - priceBounds.mean) / priceBounds.sd);
      if (f.unitPrice > priceBounds.high || f.unitPrice < priceBounds.low || zPrice > 3.2) {
        reasons.push(`Unit Price (CA$${f.unitPrice.toFixed(2)})`);
      }
      const zSales = Math.abs((f.salesAmount - salesBounds.mean) / salesBounds.sd);
      if (f.salesAmount > salesBounds.high || f.salesAmount < salesBounds.low || zSales > 3.2) {
        reasons.push(`Sales Amount (CA$${f.salesAmount.toFixed(2)})`);
      }
      if (reasons.length > 0) {
        f.isOutlier = true;
        f.outlierReasons = reasons;
        outliersFlagged++;
      }
    }
  }

  onProgress?.(90, 'Completing star schema dimensions and quality score');

  // Complete Dim_Product with fallback median prices from Fact_Sales
  const finalProductMap = new Map<string, DimProduct>(productLookup);
  for (const f of facts) {
    const key = f.product.toLowerCase();
    if (!finalProductMap.has(key)) {
      finalProductMap.set(key, {
        product: f.product,
        category: f.category,
        referenceUnitPrice: Number((medianPriceByProd.get(f.product) ?? f.unitPrice).toFixed(2)),
        source: 'derived',
      });
    }
  }

  // Complete Dim_Store with fallback from Fact_Sales
  const finalStoreMap = new Map<string, DimStore>(storeLookup);
  for (const f of facts) {
    const key = f.store.toLowerCase();
    if (!finalStoreMap.has(key)) {
      finalStoreMap.set(key, {
        store: f.store,
        province: f.province,
        country: f.country || 'Canada',
        source: 'derived',
      });
    }
  }

  // Build quality action logs
  if (pctConversions > 0) {
    actions.push({
      step: 'Percentage Normalization',
      detail: `Converted ${pctConversions.toLocaleString()} Discount Rate values from percentage format (e.g., 15% or 15) to 0–1 decimals.`,
      affectedCount: pctConversions,
      severity: 'fixed',
    });
  }
  if (duplicatesRemoved > 0) {
    actions.push({
      step: 'Deduplication',
      detail: `Removed ${duplicatesRemoved.toLocaleString()} exact duplicates and duplicate Transaction IDs (retained latest occurrence).`,
      affectedCount: duplicatesRemoved,
      severity: 'fixed',
    });
  }
  if (imputedCount > 0) {
    actions.push({
      step: 'Missing Value Imputation',
      detail: `Imputed ${imputedCount.toLocaleString()} blank Unit Price, Category, or Discount Rate fields using Dim_Product or 0 default.`,
      affectedCount: imputedCount,
      severity: 'warning',
    });
  }
  if (reconciliationDiffs > 0) {
    actions.push({
      step: 'Financial Reconciliation',
      detail: `Flagged ${reconciliationDiffs.toLocaleString()} rows where supplied Gross/Discount/Sales differed from recomputed values by > CA$0.01.`,
      affectedCount: reconciliationDiffs,
      severity: 'warning',
    });
  }
  if (outliersFlagged > 0) {
    actions.push({
      step: 'Outlier Flagging (IQR & Z-Score)',
      detail: `Flagged ${outliersFlagged.toLocaleString()} statistical outliers on Quantity, Unit Price, or Sales Amount (preserved; toggleable in filters).`,
      affectedCount: outliersFlagged,
      severity: 'info',
    });
  }
  if (returnsFlagged > 0) {
    actions.push({
      step: 'Negative Quantities (Returns)',
      detail: `Flagged ${returnsFlagged.toLocaleString()} transactions with negative Quantity as product returns.`,
      affectedCount: returnsFlagged,
      severity: 'info',
    });
  }
  if (priceAnomalies > 0) {
    actions.push({
      step: 'Reference Price Validation',
      detail: `Flagged ${priceAnomalies.toLocaleString()} transactions with Unit Price deviating > ±25% from Reference Unit Price.`,
      affectedCount: priceAnomalies,
      severity: 'warning',
    });
  }
  if (categoryMismatches > 0) {
    actions.push({
      step: 'Product-Category Consistency',
      detail: `Flagged ${categoryMismatches.toLocaleString()} rows whose Category differed from the Products dimension sheet.`,
      affectedCount: categoryMismatches,
      severity: 'warning',
    });
  }
  if (ambiguousDatesFound > 0) {
    actions.push({
      step: 'Date Parsing & Ambiguity Check',
      detail: `Parsed ${ambiguousDatesFound.toLocaleString()} ambiguous slash dates using ${
        dateFormatPreference === 'auto' ? `inferred ${inferredOrder}` : dateFormatPreference
      } order.`,
      affectedCount: ambiguousDatesFound,
      severity: 'info',
    });
  }

  // Quality score out of 100
  const totalRead = Math.max(rawTxns.length, 1);
  const rejectPenalty = Math.min(40, (rejectedRows.length / totalRead) * 120);
  const dupPenalty = Math.min(15, (duplicatesRemoved / totalRead) * 60);
  const reconPenalty = Math.min(15, (reconciliationDiffs / totalRead) * 50);
  const imputePenalty = Math.min(10, (imputedCount / totalRead) * 40);
  const anomalyPenalty = Math.min(15, ((priceAnomalies + categoryMismatches) / totalRead) * 45);
  const qualityScore = Math.max(
    0,
    Math.round(100 - rejectPenalty - dupPenalty - reconPenalty - imputePenalty - anomalyPenalty)
  );

  onProgress?.(100, 'Cleaning complete');

  return {
    facts,
    dimProducts: Array.from(finalProductMap.values()),
    dimStores: Array.from(finalStoreMap.values()),
    report: {
      id: `dq-${batchId}`,
      timestamp: new Date().toISOString(),
      filesProcessed: fileNames,
      rowsRead: rawTxns.length,
      rowsCleaned: facts.length,
      rowsRejected: rejectedRows.length,
      duplicatesRemoved,
      imputedCount,
      outliersFlagged,
      returnsFlagged,
      reconciliationDiffs,
      priceAnomalies,
      categoryMismatches,
      ambiguousDatesFound,
      qualityScore,
      actions,
      rejectedRows: rejectedRows.slice(0, 2000),
      merges,
    },
  };
}
