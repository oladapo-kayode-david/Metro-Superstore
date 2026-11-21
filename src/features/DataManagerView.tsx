import React, { useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Database,
  Download,
  FileSpreadsheet,
  GitBranch,
  History,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  ColumnMapping,
  DataQualityReport,
  DimDate,
  DimProduct,
  DimSalesperson,
  DimStore,
  FactSale,
  GlobalFilters,
  LinkedGoogleSheet,
  UploadHistoryEntry,
} from '../types/sales';
import {
  autoDetectTables,
  type DetectedTables,
} from '../lib/etl/cleaningPipeline';
import {
  downloadExcelTemplate,
  generateSampleRawSheets,
  parseUploadedFiles,
  runCleaningInWorker,
} from '../lib/etl/fileParser';
import {
  clearAllDatabaseData,
  commitIngestionToDB,
  exportAllDatabaseJson,
  rollbackLastUpload,
} from '../lib/db/database';
import {
  downloadDataQualityReport,
  downloadRejectedRowsCsv,
} from '../lib/reports/exporters';
import { GoogleSheetsConnector } from '../components/GoogleSheetsConnector';

interface DataManagerViewProps {
  allFacts: FactSale[];
  dimDate: DimDate[];
  dimProduct: DimProduct[];
  dimStore: DimStore[];
  dimSalesperson: DimSalesperson[];
  uploadHistory: UploadHistoryEntry[];
  latestQualityReport: DataQualityReport | null;
  filters: GlobalFilters;
  dateFormatPreference: 'auto' | 'DMY' | 'MDY';
  googleUser: User | null;
  hasGoogleToken: boolean;
  isSigningInGoogle: boolean;
  syncingSheet: boolean;
  syncProgress: { pct: number; stage: string } | null;
  linkedGoogleSheet: LinkedGoogleSheet | null;
  onGoogleSignIn: () => Promise<string | null>;
  onGoogleSignOut: () => Promise<void>;
  onLinkSpreadsheet: (spreadsheetId: string) => Promise<void>;
  onRefreshLinkedSheet: () => Promise<void>;
  onUnlinkSpreadsheet: () => Promise<void>;
  onUpdateLiveSyncSettings: (patch: {
    autoSyncEnabled?: boolean;
    pollIntervalSeconds?: number;
  }) => void;
  onGoogleTokenExpired: () => void;
  getGoogleToken: () => string | null;
  onUpdatePreferences: (patch: {
    dateFormatPreference?: 'auto' | 'DMY' | 'MDY';
    excludeOutliers?: boolean;
    useRecomputedFinancials?: boolean;
  }) => void;
  onDataMutated: () => Promise<void>;
  onNotify: (msg: string, tone?: 'success' | 'error' | 'info') => void;
}

const REQUIRED_MAPPING_FIELDS: Array<{ key: keyof ColumnMapping; label: string; required?: boolean }> = [
  { key: 'transactionId', label: 'Transaction ID', required: true },
  { key: 'date', label: 'Date', required: true },
  { key: 'product', label: 'Product', required: true },
  { key: 'category', label: 'Category' },
  { key: 'quantity', label: 'Quantity', required: true },
  { key: 'unitPrice', label: 'Unit Price (CAD)' },
  { key: 'discountRate', label: 'Discount Rate' },
  { key: 'grossSales', label: 'Gross Sales' },
  { key: 'discountAmount', label: 'Discount Amount' },
  { key: 'salesAmount', label: 'Sales Amount' },
  { key: 'store', label: 'Store', required: true },
  { key: 'province', label: 'Province' },
  { key: 'salesChannel', label: 'Sales Channel' },
  { key: 'paymentMethod', label: 'Payment Method' },
  { key: 'salesperson', label: 'Salesperson' },
  { key: 'orderId', label: 'Order ID' },
];

export const DataManagerView: React.FC<DataManagerViewProps> = ({
  allFacts,
  dimDate,
  dimProduct,
  dimStore,
  dimSalesperson,
  uploadHistory,
  latestQualityReport,
  filters,
  dateFormatPreference,
  googleUser,
  hasGoogleToken,
  isSigningInGoogle,
  syncingSheet,
  syncProgress,
  linkedGoogleSheet,
  onGoogleSignIn,
  onGoogleSignOut,
  onLinkSpreadsheet,
  onRefreshLinkedSheet,
  onUnlinkSpreadsheet,
  onUpdateLiveSyncSettings,
  onGoogleTokenExpired,
  getGoogleToken,
  onUpdatePreferences,
  onDataMutated,
  onNotify,
}) => {
  const [subTab, setSubTab] = useState<'ingest' | 'model' | 'quality' | 'history'>('ingest');
  const [showManualUpload, setShowManualUpload] = useState(false);
  const [uploadMode, setUploadMode] = useState<'append' | 'merge' | 'replace'>('append');
  const [replaceConfirm, setReplaceConfirm] = useState('');
  const [clearConfirm, setClearConfirm] = useState('');
  const [showClearModal, setShowClearModal] = useState(false);

  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ pct: number; stage: string } | null>(null);

  // Staged detection for manual mapping / ambiguous date confirmation
  const [staged, setStaged] = useState<{
    detected: DetectedTables;
    fileNames: string[];
    mapping: Partial<ColumnMapping>;
    dateOrder: 'auto' | 'DMY' | 'MDY';
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Referential integrity checks for Star Schema Data Model tab
  const integrityStats = useMemo(() => {
    const dateSet = new Set(dimDate.map((d) => d.date));
    const prodSet = new Set(dimProduct.map((p) => p.product));
    const storeSet = new Set(dimStore.map((s) => s.store));
    const repSet = new Set(dimSalesperson.map((r) => r.salesperson));

    let missingDates = 0;
    let missingProducts = 0;
    let missingStores = 0;
    let missingReps = 0;
    for (const f of allFacts) {
      if (!dateSet.has(f.date)) missingDates++;
      if (!prodSet.has(f.product)) missingProducts++;
      if (!storeSet.has(f.store)) missingStores++;
      if (!repSet.has(f.salesperson)) missingReps++;
    }
    const totalOrphans = missingDates + missingProducts + missingStores + missingReps;
    return {
      ok: totalOrphans === 0 && allFacts.length > 0,
      missingDates,
      missingProducts,
      missingStores,
      missingReps,
    };
  }, [allFacts, dimDate, dimProduct, dimStore, dimSalesperson]);

  const handleFilesSelected = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    setBusy(true);
    setProgress({ pct: 5, stage: 'Parsing uploaded files' });
    try {
      const sheets = await parseUploadedFiles(files, (pct, stage) => setProgress({ pct, stage }));
      const detected = autoDetectTables(sheets);

      if (detected.transactions.length === 0) {
        throw new Error(
          'No transaction rows could be detected in the uploaded file(s). Please check the column headers or download the template.'
        );
      }

      const missingRequired = (['transactionId', 'date', 'product', 'store', 'quantity'] as const).some(
        (k) => !detected.detectedMapping[k]
      );

      // Always pause for staging if required mappings are missing OR ambiguous dates exist OR Replace All needs confirmation
      if (missingRequired || detected.hasAmbiguousDates || uploadMode === 'replace') {
        setStaged({
          detected,
          fileNames: files.map((f) => f.name),
          mapping: detected.detectedMapping,
          dateOrder: dateFormatPreference,
        });
        setProgress(null);
        setBusy(false);
        onNotify('Review column mappings and ingestion options before committing.', 'info');
        return;
      }

      await finalizeIngestion(
        detected,
        files.map((f) => f.name),
        detected.detectedMapping,
        dateFormatPreference
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'File upload failed', 'error');
      setProgress(null);
      setBusy(false);
    }
  };

  const finalizeIngestion = async (
    detected: DetectedTables,
    fileNames: string[],
    mapping: Partial<ColumnMapping>,
    dateOrder: 'auto' | 'DMY' | 'MDY'
  ) => {
    if (uploadMode === 'replace' && allFacts.length > 0 && replaceConfirm.trim().toUpperCase() !== 'REPLACE') {
      onNotify('Type REPLACE to confirm overwriting all existing data.', 'error');
      return;
    }
    setBusy(true);
    try {
      const batchId = `batch-${Date.now()}`;
      const cleaned = await runCleaningInWorker(detected, {
        batchId,
        fileNames,
        mapping,
        dateFormatPreference: dateOrder,
        onProgress: (pct, stage) => setProgress({ pct, stage }),
      });

      setProgress({ pct: 95, stage: 'Persisting star schema to IndexedDB' });
      const res = await commitIngestionToDB({
        mode: uploadMode,
        batchId,
        fileNames,
        newFacts: cleaned.facts,
        dimProducts: cleaned.dimProducts,
        dimStores: cleaned.dimStores,
        qualityReport: cleaned.report,
      });

      setStaged(null);
      setReplaceConfirm('');
      await onDataMutated();
      onNotify(
        `Ingested ${res.rowsAdded.toLocaleString()} added, ${res.rowsUpdated.toLocaleString()} updated (Quality Score: ${cleaned.report.qualityScore}/100).`,
        'success'
      );
      setSubTab('quality');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Cleaning pipeline error', 'error');
    } finally {
      setProgress(null);
      setBusy(false);
    }
  };

  const handleLoadSampleDataset = async () => {
    setBusy(true);
    setProgress({ pct: 20, stage: 'Generating 24-month Canadian retail workbook' });
    try {
      const sheets = generateSampleRawSheets();
      const detected = autoDetectTables(sheets);
      const batchId = `sample-${Date.now()}`;
      const cleaned = await runCleaningInWorker(detected, {
        batchId,
        fileNames: ['Canadian_Retail_Sample_24M.xlsx'],
        mapping: detected.detectedMapping,
        dateFormatPreference: 'auto',
        onProgress: (pct, stage) => setProgress({ pct, stage }),
      });
      await commitIngestionToDB({
        mode: 'replace',
        batchId,
        fileNames: ['Canadian_Retail_Sample_24M.xlsx'],
        newFacts: cleaned.facts,
        dimProducts: cleaned.dimProducts,
        dimStores: cleaned.dimStores,
        qualityReport: cleaned.report,
      });
      await onDataMutated();
      onNotify(
        `Loaded sample dataset (${cleaned.facts.length.toLocaleString()} cleaned transactions, score ${cleaned.report.qualityScore}/100).`,
        'success'
      );
    } finally {
      setProgress(null);
      setBusy(false);
    }
  };

  const handleRollback = async () => {
    const ok = await rollbackLastUpload();
    if (ok) {
      await onDataMutated();
      onNotify('Rolled back the most recent upload successfully.', 'success');
    } else {
      onNotify('No rollback snapshot available.', 'info');
    }
  };

  const handleExportAll = async () => {
    const json = await exportAllDatabaseJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Sales_Intelligence_Full_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    onNotify('Exported complete IndexedDB archive (JSON).', 'success');
  };

  const handleClearAll = async () => {
    if (clearConfirm.trim().toUpperCase() !== 'DELETE ALL') return;
    await clearAllDatabaseData();
    setClearConfirm('');
    setShowClearModal(false);
    await onDataMutated();
    onNotify('All local data cleared from IndexedDB.', 'info');
  };

  const flaggedReconCount = useMemo(
    () => allFacts.filter((f) => f.hasReconciliationDiff).length,
    [allFacts]
  );
  const flaggedOutlierCount = useMemo(
    () => allFacts.filter((f) => f.isOutlier).length,
    [allFacts]
  );

  return (
    <div className="space-y-6">
      {/* Sub-navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-slate-200/90 bg-white p-3.5 dark:border-white/10 dark:bg-[#16314D]">
        <div className="flex flex-wrap items-center gap-1.5">
          {([
            { id: 'ingest', label: 'Google Sheets & Sync' },
            { id: 'model', label: 'Data Model (Star Schema)' },
            { id: 'quality', label: 'Data Quality Report' },
            { id: 'history', label: `Sync History (${uploadHistory.length})` },
          ] as const).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubTab(t.id)}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                subTab === t.id
                  ? 'brand-gradient text-[#0F2238] font-semibold'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={downloadExcelTemplate}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white/10"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />
            3-Sheet Template
          </button>
          <button
            type="button"
            onClick={handleExportAll}
            disabled={allFacts.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white/10"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Export All Data
          </button>
          <button
            type="button"
            onClick={() => setShowClearModal(true)}
            disabled={allFacts.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-500/10 disabled:opacity-40 dark:text-rose-400"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Clear All Data
          </button>
        </div>
      </div>

      {/* TAB 1: GOOGLE SHEETS LIVE SYNC & CLEANING */}
      {subTab === 'ingest' && (
        <div className="space-y-5">
          {/* Primary Data Source: Live Google Drive / Google Sheets Workbook */}
          <GoogleSheetsConnector
            googleUser={googleUser}
            hasGoogleToken={hasGoogleToken}
            isSigningIn={isSigningInGoogle}
            syncing={syncingSheet}
            syncProgress={syncProgress}
            linkedSheet={linkedGoogleSheet}
            onSignIn={onGoogleSignIn}
            onSignOut={onGoogleSignOut}
            onLinkSpreadsheet={onLinkSpreadsheet}
            onRefreshLinkedSheet={onRefreshLinkedSheet}
            onUnlinkSpreadsheet={onUnlinkSpreadsheet}
            onUpdateLiveSyncSettings={onUpdateLiveSyncSettings}
            onTokenExpired={onGoogleTokenExpired}
            onNotify={onNotify}
            getToken={getGoogleToken}
          />

          {/* Reconciliation & Cleaning Policies */}
          <div className="rounded-[16px] border border-slate-200/90 bg-white p-5 dark:border-white/10 dark:bg-[#16314D]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-sm font-semibold text-[#0F2238] dark:text-white">
                  Reconciliation &amp; Cleaning Policies
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Applied automatically every time your linked 3-worksheet Google Spreadsheet refreshes
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={handleLoadSampleDataset}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-[#0F2238] hover:bg-slate-100 disabled:opacity-50 dark:border-white/15 dark:text-white dark:hover:bg-white/10"
              >
                Load 24-Month Canadian Sample Dataset
              </button>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 text-xs text-slate-600 dark:text-slate-300 md:grid-cols-3">
              <label className="flex cursor-pointer items-center justify-between gap-2 rounded-xl border border-slate-200/80 px-3 py-2.5 dark:border-white/10">
                <span>Exclude Statistical Outliers ({flaggedOutlierCount} flagged)</span>
                <input
                  type="checkbox"
                  checked={filters.excludeOutliers}
                  onChange={(e) => onUpdatePreferences({ excludeOutliers: e.target.checked })}
                  className="rounded accent-[#26E6D0]"
                />
              </label>
              <label className="flex cursor-pointer items-center justify-between gap-2 rounded-xl border border-slate-200/80 px-3 py-2.5 dark:border-white/10">
                <span>Recomputed Financials ({flaggedReconCount} diffs &gt; CA$0.01)</span>
                <input
                  type="checkbox"
                  checked={filters.useRecomputedFinancials}
                  onChange={(e) => onUpdatePreferences({ useRecomputedFinancials: e.target.checked })}
                  className="rounded accent-[#26E6D0]"
                />
              </label>
              <label className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/80 px-3 py-2.5 dark:border-white/10">
                <span>Slash Date Preference</span>
                <select
                  value={dateFormatPreference}
                  onChange={(e) =>
                    onUpdatePreferences({
                      dateFormatPreference: e.target.value as 'auto' | 'DMY' | 'MDY',
                    })
                  }
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-[#0F2238] dark:border-white/15 dark:bg-[#0F2238] dark:text-white"
                >
                  <option value="auto">Auto-Detect</option>
                  <option value="DMY">DD/MM/YYYY</option>
                  <option value="MDY">MM/DD/YYYY</option>
                </select>
              </label>
            </div>
          </div>

          {/* Optional Secondary Local File Upload Fallback */}
          <div className="rounded-[16px] border border-slate-200/90 bg-white dark:border-white/10 dark:bg-[#16314D]">
            <button
              type="button"
              onClick={() => setShowManualUpload((v) => !v)}
              className="flex w-full items-center justify-between px-5 py-3.5 text-left text-xs font-medium text-slate-600 hover:text-[#0F2238] dark:text-slate-300 dark:hover:text-white"
            >
              <span className="inline-flex items-center gap-2">
                <Upload className="h-4 w-4 text-slate-400" aria-hidden="true" />
                Optional: Manual Local File Import (.xlsx, .csv, .json)
              </span>
              {showManualUpload ? (
                <ChevronUp className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              )}
            </button>

            {showManualUpload && (
              <div className="space-y-4 border-t border-slate-200/80 p-5 dark:border-white/10">
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                  {([
                    { id: 'append', title: 'Append (Default)', desc: 'Adds new rows; skips duplicate Transaction IDs.' },
                    { id: 'merge', title: 'Merge / Update', desc: 'Overwrites matching Transaction IDs & adds new.' },
                    { id: 'replace', title: 'Replace All', desc: 'Replaces entire local warehouse (requires confirm).' },
                  ] as const).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setUploadMode(m.id)}
                      className={`rounded-xl border p-3 text-left transition-colors ${
                        uploadMode === m.id
                          ? 'border-[#26E6D0] bg-[#26E6D0]/10'
                          : 'border-slate-200 hover:border-slate-300 dark:border-white/10 dark:hover:border-white/20'
                      }`}
                    >
                      <div className="text-xs font-semibold text-[#0F2238] dark:text-white">{m.title}</div>
                      <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{m.desc}</p>
                    </button>
                  ))}
                </div>

                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    handleFilesSelected(e.dataTransfer.files);
                  }}
                  className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
                    dragging
                      ? 'border-[#26E6D0] bg-[#26E6D0]/10'
                      : 'border-slate-300 dark:border-white/15'
                  }`}
                >
                  <Upload className="h-7 w-7 text-[#26E6D0]" aria-hidden="true" />
                  <p className="mt-2 text-xs font-medium text-[#0F2238] dark:text-white">
                    Drop Excel, CSV, TSV, JSON, or Delimited Text Files Here
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".xlsx,.xls,.xlsm,.csv,.tsv,.json,.txt"
                    onChange={(e) => {
                      if (e.target.files) handleFilesSelected(e.target.files);
                      e.target.value = '';
                    }}
                    className="hidden"
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => fileInputRef.current?.click()}
                    className="mt-4 rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-[#0F2238] hover:bg-slate-100 disabled:opacity-50 dark:border-white/15 dark:text-white dark:hover:bg-white/10"
                  >
                    Choose Local Files
                  </button>

                  {progress && (
                    <div className="mt-5 w-full max-w-md">
                      <div className="flex justify-between text-xs text-slate-600 dark:text-slate-300">
                        <span>{progress.stage}</span>
                        <span className="font-mono">{progress.pct}%</span>
                      </div>
                      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
                        <div
                          className="h-full rounded-full brand-gradient transition-all duration-200"
                          style={{ width: `${progress.pct}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Staging Panel for Manual Column Mapping / Ambiguous Dates / Replace Confirm */}
          {staged && (
            <section className="rounded-[16px] border border-[#26E6D0]/50 bg-white p-5 dark:bg-[#16314D]">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-white/10">
                <div>
                  <h3 className="font-display text-base font-semibold text-[#0F2238] dark:text-white">
                    Confirm Column Mapping &amp; Cleaning Options
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Files: {staged.fileNames.join(', ')} · {staged.detected.transactions.length.toLocaleString()} raw rows detected
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setStaged(null)}
                  className="text-xs text-slate-500 hover:text-rose-500"
                >
                  Cancel
                </button>
              </div>

              {staged.detected.hasAmbiguousDates && (
                <div className="mt-4 rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
                  <strong>Ambiguous slash dates detected</strong> (e.g.{' '}
                  {staged.detected.ambiguousDateSamples.join(', ')}). Confirm format:
                  <select
                    value={staged.dateOrder}
                    onChange={(e) =>
                      setStaged({
                        ...staged,
                        dateOrder: e.target.value as 'auto' | 'DMY' | 'MDY',
                      })
                    }
                    className="ml-3 rounded-md border border-amber-500/40 bg-white px-2 py-1 text-xs text-[#0F2238] dark:bg-[#0F2238] dark:text-white"
                  >
                    <option value="DMY">DD/MM/YYYY (Day first)</option>
                    <option value="MDY">MM/DD/YYYY (Month first)</option>
                  </select>
                </div>
              )}

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {REQUIRED_MAPPING_FIELDS.map((field) => (
                  <label key={field.key} className="block text-xs">
                    <span className="font-medium text-slate-700 dark:text-slate-200">
                      {field.label} {field.required && <span className="text-rose-500">*</span>}
                    </span>
                    <select
                      value={staged.mapping[field.key] ?? ''}
                      onChange={(e) =>
                        setStaged({
                          ...staged,
                          mapping: { ...staged.mapping, [field.key]: e.target.value },
                        })
                      }
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-[#0F2238] dark:border-white/15 dark:bg-[#0F2238] dark:text-white"
                    >
                      <option value="">— Not mapped —</option>
                      {staged.detected.rawTransactionHeaders.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>

              {uploadMode === 'replace' && allFacts.length > 0 && (
                <div className="mt-4 rounded-xl border border-rose-500/35 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-200">
                  <span>
                    Replace All will overwrite {allFacts.length.toLocaleString()} existing rows. Type{' '}
                    <strong>REPLACE</strong> to proceed:
                  </span>
                  <input
                    type="text"
                    value={replaceConfirm}
                    onChange={(e) => setReplaceConfirm(e.target.value)}
                    placeholder="Type REPLACE"
                    className="ml-3 rounded-md border border-rose-400 bg-white px-2.5 py-1 text-xs text-[#0F2238] dark:bg-[#0F2238] dark:text-white"
                  />
                </div>
              )}

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() =>
                    finalizeIngestion(staged.detected, staged.fileNames, staged.mapping, staged.dateOrder)
                  }
                  disabled={busy}
                  className="rounded-lg brand-gradient px-5 py-2 text-xs font-semibold text-[#0F2238]"
                >
                  Run Cleaning Pipeline &amp; Save
                </button>
              </div>
            </section>
          )}
        </div>
      )}

      {/* TAB 2: STAR SCHEMA DATA MODEL DIAGRAM */}
      {subTab === 'model' && (
        <section className="rounded-[16px] border border-slate-200/90 bg-white p-6 dark:border-white/10 dark:bg-[#16314D]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4 dark:border-white/10">
            <div className="flex items-center gap-2.5">
              <GitBranch className="h-5 w-5 text-[#26E6D0]" aria-hidden="true" />
              <div>
                <h3 className="font-display text-base font-semibold text-[#0F2238] dark:text-white">
                  Star Schema Data Model
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Live IndexedDB table row counts and foreign-key referential integrity verification
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs font-semibold">
              {integrityStats.ok ? (
                <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-[#26E6D0]">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  100% Referential Integrity Validated
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-amber-500">
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                  {allFacts.length === 0 ? 'Awaiting data upload' : 'Orphan keys detected'}
                </span>
              )}
            </div>
          </div>

          {/* Interactive Star Diagram Layout */}
          <div className="mt-6 grid grid-cols-1 items-center gap-5 lg:grid-cols-3">
            {/* Left Dimensions */}
            <div className="space-y-4">
              <div className="rounded-xl border border-[#26E6D0]/40 bg-slate-50/70 p-4 dark:bg-[#0F2238]/70">
                <div className="flex items-center justify-between">
                  <span className="font-display text-sm font-semibold text-[#0F2238] dark:text-[#26E6D0]">
                    Dim_Date
                  </span>
                  <span className="font-mono text-xs font-semibold tabular-nums text-[#0F2238] dark:text-white">
                    {dimDate.length.toLocaleString()} rows
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  PK: Date · Year, Quarter, Month, Week, Day of Week, Is Weekend, Canadian Statutory Holiday, Year-Month
                </p>
                <div className="mt-2 text-[11px] text-emerald-600 dark:text-[#26E6D0]">
                  FK orphans: {integrityStats.missingDates}
                </div>
              </div>

              <div className="rounded-xl border border-[#26E6D0]/40 bg-slate-50/70 p-4 dark:bg-[#0F2238]/70">
                <div className="flex items-center justify-between">
                  <span className="font-display text-sm font-semibold text-[#0F2238] dark:text-[#26E6D0]">
                    Dim_Product
                  </span>
                  <span className="font-mono text-xs font-semibold tabular-nums text-[#0F2238] dark:text-white">
                    {dimProduct.length.toLocaleString()} rows
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  PK: Product · Category, Reference Unit Price (CAD) (Sheet 3 with median fallback)
                </p>
                <div className="mt-2 text-[11px] text-emerald-600 dark:text-[#26E6D0]">
                  FK orphans: {integrityStats.missingProducts}
                </div>
              </div>
            </div>

            {/* Central Fact Table */}
            <div className="rounded-2xl border-2 border-[#B740DE]/60 bg-slate-50 p-5 dark:bg-[#0F2238]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-[#B740DE]" aria-hidden="true" />
                  <span className="font-display text-base font-bold text-[#0F2238] dark:text-white">
                    Fact_Sales
                  </span>
                </div>
                <span className="font-mono text-sm font-bold tabular-nums text-[#B740DE]">
                  {allFacts.length.toLocaleString()} rows
                </span>
              </div>
              <div className="mt-3 space-y-2 border-t border-slate-200 pt-3 text-xs dark:border-white/10">
                <div>
                  <span className="font-semibold text-[#0F2238] dark:text-white">Keys (1:N):</span>{' '}
                  <span className="text-slate-600 dark:text-slate-300">
                    Transaction ID (PK), Date (FK), Product (FK), Store (FK), Salesperson (FK)
                  </span>
                </div>
                <div>
                  <span className="font-semibold text-[#0F2238] dark:text-white">Measures:</span>{' '}
                  <span className="text-slate-600 dark:text-slate-300">
                    Quantity, Unit Price, Discount Rate, Gross Sales, Discount Amount, Sales Amount
                  </span>
                </div>
                <div>
                  <span className="font-semibold text-[#0F2238] dark:text-white">Attributes:</span>{' '}
                  <span className="text-slate-600 dark:text-slate-300">
                    Sales Channel, Payment Method, Order ID
                  </span>
                </div>
              </div>
            </div>

            {/* Right Dimensions */}
            <div className="space-y-4">
              <div className="rounded-xl border border-[#26E6D0]/40 bg-slate-50/70 p-4 dark:bg-[#0F2238]/70">
                <div className="flex items-center justify-between">
                  <span className="font-display text-sm font-semibold text-[#0F2238] dark:text-[#26E6D0]">
                    Dim_Store
                  </span>
                  <span className="font-mono text-xs font-semibold tabular-nums text-[#0F2238] dark:text-white">
                    {dimStore.length.toLocaleString()} rows
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  PK: Store · Province, Country (Sheet 2 with Fact fallback)
                </p>
                <div className="mt-2 text-[11px] text-emerald-600 dark:text-[#26E6D0]">
                  FK orphans: {integrityStats.missingStores}
                </div>
              </div>

              <div className="rounded-xl border border-[#26E6D0]/40 bg-slate-50/70 p-4 dark:bg-[#0F2238]/70">
                <div className="flex items-center justify-between">
                  <span className="font-display text-sm font-semibold text-[#0F2238] dark:text-[#26E6D0]">
                    Dim_Salesperson
                  </span>
                  <span className="font-mono text-xs font-semibold tabular-nums text-[#0F2238] dark:text-white">
                    {dimSalesperson.length.toLocaleString()} rows
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  PK: Salesperson · Derived Primary Store &amp; Primary Province
                </p>
                <div className="mt-2 text-[11px] text-emerald-600 dark:text-[#26E6D0]">
                  FK orphans: {integrityStats.missingReps}
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* TAB 3: DATA QUALITY REPORT */}
      {subTab === 'quality' && (
        <section className="space-y-5">
          {latestQualityReport ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-slate-200/90 bg-white p-5 dark:border-white/10 dark:bg-[#16314D]">
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Latest Cleaning Audit · {latestQualityReport.filesProcessed.join(', ')}
                  </div>
                  <div className="mt-1 flex items-baseline gap-3">
                    <span className="font-mono text-3xl font-bold text-[#0FA696] tabular-nums dark:text-[#26E6D0]">
                      {latestQualityReport.qualityScore} / 100
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">Data Quality Score</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => downloadDataQualityReport(latestQualityReport)}
                    className="inline-flex items-center gap-1.5 rounded-lg brand-gradient px-3.5 py-2 text-xs font-semibold text-[#0F2238]"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    Download Quality Report (XLSX)
                  </button>
                  {latestQualityReport.rejectedRows.length > 0 && (
                    <button
                      type="button"
                      onClick={() => downloadRejectedRowsCsv(latestQualityReport)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 px-3.5 py-2 text-xs font-medium text-rose-600 dark:text-rose-400"
                    >
                      Download Rejected Rows CSV ({latestQualityReport.rowsRejected})
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4 lg:grid-cols-6">
                {[
                  { label: 'Rows Read', val: latestQualityReport.rowsRead },
                  { label: 'Rows Cleaned', val: latestQualityReport.rowsCleaned },
                  { label: 'Rows Rejected', val: latestQualityReport.rowsRejected },
                  { label: 'Duplicates Removed', val: latestQualityReport.duplicatesRemoved },
                  { label: 'Outliers Flagged', val: latestQualityReport.outliersFlagged },
                  { label: 'Price Anomalies', val: latestQualityReport.priceAnomalies },
                ].map((s) => (
                  <div
                    key={s.label}
                    className="rounded-[16px] border border-slate-200/90 bg-white p-3.5 dark:border-white/10 dark:bg-[#16314D]"
                  >
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">{s.label}</div>
                    <div className="mt-1 font-mono text-lg font-bold text-[#0F2238] tabular-nums dark:text-white">
                      {s.val.toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-[16px] border border-slate-200/90 bg-white p-5 dark:border-white/10 dark:bg-[#16314D]">
                <h4 className="font-display text-sm font-semibold text-[#0F2238] dark:text-white">
                  Automated Cleaning Action Log
                </h4>
                <div className="mt-3 divide-y divide-slate-100 text-xs dark:divide-white/10">
                  {latestQualityReport.actions.map((act, i) => (
                    <div key={i} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                      <div>
                        <span className="font-semibold text-[#0F2238] dark:text-white">{act.step}: </span>
                        <span className="text-slate-600 dark:text-slate-300">{act.detail}</span>
                      </div>
                      <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                        {act.affectedCount.toLocaleString()} affected
                      </span>
                    </div>
                  ))}
                  {latestQualityReport.actions.length === 0 && (
                    <p className="py-3 text-slate-500">Clean ingestion with zero anomalies or corrections needed.</p>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-[16px] border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-white/15 dark:text-slate-400">
              Upload a dataset or load the sample workbook to generate a Data Quality Report.
            </div>
          )}
        </section>
      )}

      {/* TAB 4: UPLOAD HISTORY & ROLLBACK */}
      {subTab === 'history' && (
        <section className="rounded-[16px] border border-slate-200/90 bg-white p-5 dark:border-white/10 dark:bg-[#16314D]">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-[#26E6D0]" aria-hidden="true" />
              <h3 className="font-display text-base font-semibold text-[#0F2238] dark:text-white">
                Upload History &amp; Rollback Log
              </h3>
            </div>
            {uploadHistory.some((h) => h.canRollback) && (
              <button
                type="button"
                onClick={handleRollback}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs font-medium text-amber-600 hover:bg-amber-500/10 dark:text-amber-300"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Roll Back Last Upload
              </button>
            )}
          </div>
          {uploadHistory.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
              No uploads recorded yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 dark:border-white/10 dark:text-slate-400">
                    <th className="px-3 py-2">Timestamp</th>
                    <th className="px-3 py-2">File(s)</th>
                    <th className="px-3 py-2">Mode</th>
                    <th className="px-3 py-2 text-right">Added</th>
                    <th className="px-3 py-2 text-right">Updated</th>
                    <th className="px-3 py-2 text-right">Rejected</th>
                    <th className="px-3 py-2 text-right">Quality</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                  {[...uploadHistory].reverse().map((h) => (
                    <tr key={h.id}>
                      <td className="whitespace-nowrap px-3 py-2 font-mono">
                        {h.timestamp.slice(0, 19).replace('T', ' ')}
                      </td>
                      <td className="px-3 py-2 font-medium text-[#0F2238] dark:text-white">
                        {h.fileNames.join(', ')}
                      </td>
                      <td className="px-3 py-2 capitalize">{h.mode}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-emerald-600 dark:text-[#26E6D0]">
                        +{h.rowsAdded.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {h.rowsUpdated.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-rose-500">
                        {h.rowsRejected.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {h.qualityScore}/100
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Clear All Typed Confirmation Modal */}
      {showClearModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Clear all local data"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F2238]/75 p-4 backdrop-blur-sm"
          onClick={() => setShowClearModal(false)}
        >
          <div
            className="w-full max-w-md rounded-[16px] border border-slate-200 bg-white p-6 dark:border-white/15 dark:bg-[#16314D]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-display text-base font-semibold text-[#0F2238] dark:text-white">
              Clear All Local Data?
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              This permanently deletes all star-schema tables, upload history, chat logs, pinned insights,
              and recommendations stored in IndexedDB. Type <strong>DELETE ALL</strong> below to confirm.
            </p>
            <input
              type="text"
              value={clearConfirm}
              onChange={(e) => setClearConfirm(e.target.value)}
              placeholder="Type DELETE ALL"
              className="mt-4 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-[#0F2238] dark:border-white/15 dark:bg-[#0F2238] dark:text-white"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowClearModal(false)}
                className="rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-medium text-slate-700 dark:border-white/15 dark:text-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={clearConfirm.trim().toUpperCase() !== 'DELETE ALL'}
                onClick={handleClearAll}
                className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
              >
                Permanently Delete All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
