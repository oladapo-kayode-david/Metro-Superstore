import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { CleaningOptions, CleaningOutput, DetectedTables, RawTableSheet } from './cleaningPipeline';
import { runCleaningPipeline } from './cleaningPipeline';

export async function parseUploadedFiles(
  files: File[],
  onProgress?: (pct: number, stage: string) => void
): Promise<RawTableSheet[]> {
  const allSheets: RawTableSheet[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const basePct = Math.round((i / files.length) * 60);
    onProgress?.(basePct + 5, `Reading ${file.name}`);

    if (['xlsx', 'xls', 'xlsm'].includes(ext)) {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
      for (const sheetName of workbook.SheetNames) {
        const ws = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
          defval: '',
          raw: true,
        });
        if (rows.length > 0) {
          allSheets.push({
            sheetName,
            fileName: file.name,
            headers: Object.keys(rows[0]),
            rows,
          });
        }
      }
    } else if (['csv', 'tsv', 'txt'].includes(ext)) {
      const parsed = await new Promise<Papa.ParseResult<Record<string, unknown>>>((resolve, reject) => {
        Papa.parse<Record<string, unknown>>(file, {
          header: true,
          skipEmptyLines: true,
          dynamicTyping: false,
          worker: file.size > 2_000_000,
          complete: (results) => resolve(results),
          error: (error) => reject(error),
        });
      });
      if (parsed.data.length > 0) {
        allSheets.push({
          sheetName: file.name.replace(/\.[^.]+$/, ''),
          fileName: file.name,
          headers: parsed.meta.fields ?? Object.keys(parsed.data[0]),
          rows: parsed.data,
        });
      }
    } else if (ext === 'json') {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
        allSheets.push({
          sheetName: 'Transactions',
          fileName: file.name,
          headers: Object.keys(parsed[0]),
          rows: parsed,
        });
      } else if (parsed && typeof parsed === 'object') {
        // Nested object containing named tables (e.g., { Transactions: [...], Stores: [...], Products: [...] })
        const container = parsed.tables && typeof parsed.tables === 'object' ? parsed.tables : parsed;
        for (const [key, val] of Object.entries(container)) {
          if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'object') {
            allSheets.push({
              sheetName: key,
              fileName: file.name,
              headers: Object.keys(val[0] as Record<string, unknown>),
              rows: val as Array<Record<string, unknown>>,
            });
          }
        }
      }
    } else {
      throw new Error(
        `Unsupported file format ".${ext}" for ${file.name}. Supported formats: .xlsx, .xls, .xlsm, .csv, .tsv, .txt, .json.`
      );
    }
  }

  onProgress?.(65, 'Auto-detecting star-schema sheets and headers');
  return allSheets;
}

export async function runCleaningInWorker(
  detected: DetectedTables,
  options: CleaningOptions
): Promise<CleaningOutput> {
  // Use Web Worker for larger datasets (> 4,000 rows) to keep UI responsive
  if (detected.transactions.length > 4000 && typeof Worker !== 'undefined') {
    return new Promise<CleaningOutput>((resolve, reject) => {
      try {
        const worker = new Worker(new URL('./etlWorker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (e) => {
          const data = e.data;
          if (data.type === 'progress') {
            options.onProgress?.(data.pct, data.stage);
          } else if (data.type === 'done') {
            worker.terminate();
            resolve(data.output);
          } else if (data.type === 'error') {
            worker.terminate();
            reject(new Error(data.error));
          }
        };
        worker.onerror = () => {
          worker.terminate();
          // Fallback to synchronous execution
          resolve(runCleaningPipeline(detected, options));
        };
        const { onProgress: _ignored, ...serializableOpts } = options;
        worker.postMessage({ detected, options: serializableOpts });
      } catch {
        resolve(runCleaningPipeline(detected, options));
      }
    });
  }
  return runCleaningPipeline(detected, options);
}

export function downloadExcelTemplate(): void {
  const wb = XLSX.utils.book_new();

  const transactions = [
    {
      'Transaction ID': 'TXN-10001',
      Date: '2025-01-15',
      Product: 'Nordic Smart Thermostat',
      Category: 'Smart Home',
      Quantity: 2,
      'Unit Price (CAD)': 249.99,
      'Discount Rate': 0.1,
      'Gross Sales': 499.98,
      'Discount Amount': 50.0,
      'Sales Amount': 449.98,
      Store: 'Toronto Flagship',
      Province: 'Ontario',
      'Sales Channel': 'In-Store',
      'Payment Method': 'Credit Card',
      Salesperson: 'Claire Tremblay',
      'Order ID': 'ORD-5001',
    },
    {
      'Transaction ID': 'TXN-10002',
      Date: '2025-01-15',
      Product: 'AeroMesh Wi-Fi 7 Router',
      Category: 'Networking',
      Quantity: 1,
      'Unit Price (CAD)': 379.0,
      'Discount Rate': 0.05,
      'Gross Sales': 379.0,
      'Discount Amount': 18.95,
      'Sales Amount': 360.05,
      Store: 'Toronto Flagship',
      Province: 'Ontario',
      'Sales Channel': 'In-Store',
      'Payment Method': 'Credit Card',
      Salesperson: 'Claire Tremblay',
      'Order ID': 'ORD-5001',
    },
  ];

  const stores = [
    { Store: 'Toronto Flagship', Province: 'Ontario', Country: 'Canada' },
    { Store: 'Vancouver Pacific', Province: 'British Columbia', Country: 'Canada' },
    { Store: 'Montreal Sainte-Catherine', Province: 'Quebec', Country: 'Canada' },
    { Store: 'Calgary North', Province: 'Alberta', Country: 'Canada' },
  ];

  const products = [
    { Product: 'Nordic Smart Thermostat', Category: 'Smart Home', 'Reference Unit Price (CAD)': 249.99 },
    { Product: 'AeroMesh Wi-Fi 7 Router', Category: 'Networking', 'Reference Unit Price (CAD)': 379.0 },
    { Product: 'Pulse ANC Studio Headphones', Category: 'Audio', 'Reference Unit Price (CAD)': 329.0 },
  ];

  const wsTxn = XLSX.utils.json_to_sheet(transactions);
  const wsStores = XLSX.utils.json_to_sheet(stores);
  const wsProducts = XLSX.utils.json_to_sheet(products);

  XLSX.utils.book_append_sheet(wb, wsTxn, 'Transactions');
  XLSX.utils.book_append_sheet(wb, wsStores, 'Stores');
  XLSX.utils.book_append_sheet(wb, wsProducts, 'Products');

  XLSX.writeFile(wb, 'Sales_Intelligence_Template.xlsx');
}

/**
 * Generates a realistic 24-month Canadian retail dataset with 3 sheets (Transactions, Stores, Products)
 * designed to showcase seasonality, regional variation, basket co-occurrences, discount elasticity,
 * store/rep performance tiers, and subtle data anomalies.
 */
export function generateSampleRawSheets(): RawTableSheet[] {
  const stores = [
    { Store: 'Toronto Flagship', Province: 'Ontario', Country: 'Canada', weight: 1.45, trend: 0.012 },
    { Store: 'Ottawa Rideau', Province: 'Ontario', Country: 'Canada', weight: 0.92, trend: 0.008 },
    { Store: 'Vancouver Pacific', Province: 'British Columbia', Country: 'Canada', weight: 1.32, trend: 0.015 },
    { Store: 'Montreal Sainte-Catherine', Province: 'Quebec', Country: 'Canada', weight: 1.18, trend: 0.006 },
    { Store: 'Calgary North', Province: 'Alberta', Country: 'Canada', weight: 0.96, trend: -0.014 },
    { Store: 'Edmonton Gateway', Province: 'Alberta', Country: 'Canada', weight: 0.84, trend: 0.004 },
    { Store: 'Halifax Waterfront', Province: 'Nova Scotia', Country: 'Canada', weight: 0.68, trend: 0.011 },
    { Store: 'Winnipeg Forks', Province: 'Manitoba', Country: 'Canada', weight: 0.62, trend: -0.009 },
  ];

  const products = [
    { Product: 'Nordic Smart Thermostat', Category: 'Smart Home', 'Reference Unit Price (CAD)': 249.0 },
    { Product: 'Sentinel 4K Security Cam', Category: 'Smart Home', 'Reference Unit Price (CAD)': 199.0 },
    { Product: 'Lumen Smart Light Strip', Category: 'Smart Home', 'Reference Unit Price (CAD)': 79.0 },
    { Product: 'AeroMesh Wi-Fi 7 Router', Category: 'Networking', 'Reference Unit Price (CAD)': 379.0 },
    { Product: 'AeroMesh Satellite Node', Category: 'Networking', 'Reference Unit Price (CAD)': 189.0 },
    { Product: 'FiberLink 10G Switch', Category: 'Networking', 'Reference Unit Price (CAD)': 229.0 },
    { Product: 'Pulse ANC Studio Headphones', Category: 'Audio', 'Reference Unit Price (CAD)': 329.0 },
    { Product: 'Timber Portable Speaker', Category: 'Audio', 'Reference Unit Price (CAD)': 159.0 },
    { Product: 'Clarity USB-C Studio Mic', Category: 'Audio', 'Reference Unit Price (CAD)': 145.0 },
    { Product: 'Apex 15 Ultrabook Pro', Category: 'Computing', 'Reference Unit Price (CAD)': 1499.0 },
    { Product: 'Vector 27 4K Monitor', Category: 'Computing', 'Reference Unit Price (CAD)': 549.0 },
    { Product: 'Tactile Mechanical Keyboard', Category: 'Accessories', 'Reference Unit Price (CAD)': 169.0 },
    { Product: 'Precision Ergonomic Mouse', Category: 'Accessories', 'Reference Unit Price (CAD)': 99.0 },
    { Product: 'ThunderBolt 4 Pro Dock', Category: 'Accessories', 'Reference Unit Price (CAD)': 269.0 },
    { Product: 'Armor Laptop Sleeve 15', Category: 'Accessories', 'Reference Unit Price (CAD)': 59.0 },
    { Product: 'GaN 140W Travel Charger', Category: 'Accessories', 'Reference Unit Price (CAD)': 89.0 },
  ];

  const reps = [
    { name: 'Claire Tremblay', store: 'Montreal Sainte-Catherine', skill: 1.28, discBias: -0.02 },
    { name: 'Liam MacLeod', store: 'Toronto Flagship', skill: 1.35, discBias: -0.015 },
    { name: 'Priya Patel', store: 'Toronto Flagship', skill: 1.22, discBias: 0.0 },
    { name: 'Noah Chen', store: 'Vancouver Pacific', skill: 1.31, discBias: -0.01 },
    { name: 'Maya Deschamps', store: 'Vancouver Pacific', skill: 1.05, discBias: 0.01 },
    { name: 'Owen Gallagher', store: 'Calgary North', skill: 0.78, discBias: 0.045 },
    { name: 'Sofia Rossi', store: 'Calgary North', skill: 0.85, discBias: 0.03 },
    { name: 'Ethan Bouchard', store: 'Ottawa Rideau', skill: 1.12, discBias: 0.005 },
    { name: 'Hannah Kowalski', store: 'Edmonton Gateway', skill: 0.98, discBias: 0.015 },
    { name: 'Lucas Nguyen', store: 'Halifax Waterfront', skill: 1.15, discBias: -0.005 },
    { name: 'Chloe Singh', store: 'Winnipeg Forks', skill: 0.74, discBias: 0.04 },
    { name: 'Marcus Reid', store: 'Montreal Sainte-Catherine', skill: 0.94, discBias: 0.02 },
  ];

  // Strong co-purchase pairs for Basket Affinity
  const bundlePairs: Array<[number, number, number]> = [
    [9, 13, 0.55], // Ultrabook -> TB4 Dock
    [9, 14, 0.48], // Ultrabook -> Laptop Sleeve
    [10, 11, 0.44], // 4K Monitor -> Mechanical Keyboard
    [11, 12, 0.52], // Keyboard -> Ergonomic Mouse
    [3, 4, 0.62], // Wi-Fi 7 Router -> Satellite Node
    [0, 2, 0.42], // Thermostat -> Light Strip
    [6, 15, 0.35], // ANC Headphones -> GaN Charger
  ];

  const channels = ['In-Store', 'Online', 'B2B Direct', 'Mobile App'];
  const paymentMethods = ['Credit Card', 'Debit', 'Apple Pay', 'Corporate Invoice'];

  // Deterministic PRNG for reproducible demo data
  let seed = 42026;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  const transactions: Array<Record<string, unknown>> = [];
  let txnCounter = 100001;
  let orderCounter = 50001;

  // 24 months: Nov 2024 to Oct 2026
  const startYear = 2024;
  const startMonth = 11;

  for (let mOffset = 0; mOffset < 24; mOffset++) {
    const totalMonth = startMonth - 1 + mOffset;
    const year = startYear + Math.floor(totalMonth / 12);
    const month = (totalMonth % 12) + 1;
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

    // Retail seasonality curve (Nov/Dec peak, Jan/Feb dip, Aug back-to-school lift)
    const seasonalFactors = [0.78, 0.82, 0.93, 0.97, 1.04, 1.08, 1.02, 1.12, 1.06, 1.01, 1.28, 1.44];
    const seasonal = seasonalFactors[month - 1];
    const macroGrowth = 1 + mOffset * 0.0085;
    const ordersThisMonth = Math.round(92 * seasonal * macroGrowth);

    for (let o = 0; o < ordersThisMonth; o++) {
      // Pick day with slight weekend bump
      const day = Math.min(daysInMonth, Math.max(1, Math.floor(rand() * daysInMonth) + 1));
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      // Pick store weighted by store weight & trend
      const weights = stores.map((s) => Math.max(0.2, s.weight * (1 + s.trend * mOffset)));
      const totalW = weights.reduce((a, b) => a + b, 0);
      let pick = rand() * totalW;
      let storeIdx = 0;
      for (let s = 0; s < weights.length; s++) {
        pick -= weights[s];
        if (pick <= 0) {
          storeIdx = s;
          break;
        }
      }
      const storeObj = stores[storeIdx];
      const storeReps = reps.filter((r) => r.store === storeObj.Store);
      const rep = storeReps[Math.floor(rand() * storeReps.length)] ?? reps[0];

      const chRoll = rand();
      const channel =
        chRoll < 0.46 ? channels[0] : chRoll < 0.78 ? channels[1] : chRoll < 0.91 ? channels[2] : channels[3];
      const payRoll = rand();
      const payment =
        channel === 'B2B Direct'
          ? paymentMethods[3]
          : payRoll < 0.56
          ? paymentMethods[0]
          : payRoll < 0.82
          ? paymentMethods[1]
          : paymentMethods[2];

      const orderId = `ORD-${orderCounter++}`;
      const primaryProdIdx = Math.floor(rand() * products.length);
      const orderItems: number[] = [primaryProdIdx];

      // Add bundle companion items for realistic basket affinity
      for (const [a, b, prob] of bundlePairs) {
        if (primaryProdIdx === a && rand() < prob) {
          orderItems.push(b);
        }
      }
      if (orderItems.length === 1 && rand() < 0.24) {
        const extra = Math.floor(rand() * products.length);
        if (!orderItems.includes(extra)) orderItems.push(extra);
      }

      for (const pIdx of orderItems) {
        const prod = products[pIdx];
        const basePrice = prod['Reference Unit Price (CAD)'];

        // Discount rate depends on month (Black Friday/Boxing Day), store/rep bias, and slight drift in Calgary North
        let disc = 0;
        const dRoll = rand();
        if (month === 11 || month === 12) {
          disc = dRoll < 0.25 ? 0 : dRoll < 0.6 ? 0.1 : dRoll < 0.88 ? 0.15 : 0.22;
        } else {
          disc = dRoll < 0.48 ? 0 : dRoll < 0.78 ? 0.05 : dRoll < 0.93 ? 0.12 : 0.18;
        }
        // Calgary North and Winnipeg rising discount reliance in recent months
        if ((storeObj.Store === 'Calgary North' || storeObj.Store === 'Winnipeg Forks') && mOffset >= 15) {
          disc = Math.min(0.32, disc + 0.06);
        }
        disc = Math.max(0, Math.min(0.38, Number((disc + rep.discBias).toFixed(2))));

        // Quantity responds elastically to discount (optimal around 10-15%)
        let qty = 1;
        const qRoll = rand();
        const elasticityBoost = disc * 3.8;
        if (channel === 'B2B Direct') {
          qty = Math.max(1, Math.round(2 + rand() * 5 + elasticityBoost));
        } else {
          qty = qRoll < 0.58 - disc ? 1 : qRoll < 0.85 ? 2 : 3 + Math.floor(rand() * 2);
        }

        // Price variation
        let unitPrice = Number((basePrice * (0.97 + rand() * 0.06)).toFixed(2));

        // Inject a few realistic anomalies (~0.6%) for Anomaly Detection & Data Quality testing
        const anomalyRoll = rand();
        if (anomalyRoll < 0.0025) {
          unitPrice = Number((basePrice * 1.42).toFixed(2)); // Price anomaly > 25%
        } else if (anomalyRoll < 0.0045) {
          qty = -1; // Product return
        } else if (anomalyRoll < 0.006) {
          qty = 14; // Bulk outlier order
        }

        // Inject rare messy casing (~0.8%) to showcase ETL normalization
        const storeLabel = rand() < 0.008 ? ` ${storeObj.Store.toLowerCase()} ` : storeObj.Store;

        const gross = Number((qty * unitPrice).toFixed(2));
        const discAmt = Number((gross * disc).toFixed(2));
        const netSales = Number((gross - discAmt).toFixed(2));

        transactions.push({
          'Transaction ID': `TXN-${txnCounter++}`,
          Date: dateStr,
          Product: prod.Product,
          Category: prod.Category,
          Quantity: qty,
          'Unit Price (CAD)': unitPrice,
          'Discount Rate': disc,
          'Gross Sales': gross,
          'Discount Amount': discAmt,
          'Sales Amount': netSales,
          Store: storeLabel,
          Province: storeObj.Province,
          'Sales Channel': channel,
          'Payment Method': payment,
          Salesperson: rep.name,
          'Order ID': orderId,
        });
      }
    }
  }

  return [
    {
      sheetName: 'Transactions',
      fileName: 'Canadian_Retail_Sample_24M.xlsx',
      headers: Object.keys(transactions[0]),
      rows: transactions,
    },
    {
      sheetName: 'Stores',
      fileName: 'Canadian_Retail_Sample_24M.xlsx',
      headers: ['Store', 'Province', 'Country'],
      rows: stores.map(({ Store, Province, Country }) => ({ Store, Province, Country })),
    },
    {
      sheetName: 'Products',
      fileName: 'Canadian_Retail_Sample_24M.xlsx',
      headers: ['Product', 'Category', 'Reference Unit Price (CAD)'],
      rows: products,
    },
  ];
}
