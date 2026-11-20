import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  Bot,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Database,
  FileSpreadsheet,
  FileText,
  Filter,
  LayoutDashboard,
  Lightbulb,
  MapPin,
  Menu,
  MessageSquare,
  Moon,
  Package,
  Search,
  Sun,
  TrendingUp,
  Upload,
  Users,
  X,
} from 'lucide-react';
import type {
  AllModelResults,
  AppSettings,
  ChatMessage,
  DataQualityReport,
  DimDate,
  DimProduct,
  DimSalesperson,
  DimStore,
  FactSale,
  GlobalFilters,
  NavTabId,
  PinnedInsight,
  RecommendationsBundle,
  UploadHistoryEntry,
} from './types/sales';
import {
  commitIngestionToDB,
  db,
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
} from './lib/db/database';
import {
  applyGlobalFilters,
  getDataDateBounds,
} from './lib/analytics/calculations';
import { autoDetectTables } from './lib/etl/cleaningPipeline';
import {
  downloadExcelTemplate,
  generateSampleRawSheets,
  runCleaningInWorker,
} from './lib/etl/fileParser';
import { ErrorBoundary } from './components/ErrorBoundary';
import { GlobalFilterBar } from './components/GlobalFilterBar';
import { ExecutiveOverview } from './features/ExecutiveOverview';
import { TrendsView } from './features/TrendsView';
import { ProductsView } from './features/ProductsView';
import { StoresRegionsView } from './features/StoresRegionsView';
import { SalespersonView } from './features/SalespersonView';
import { ModelLabView } from './features/ModelLabView';
import { RecommendationsView } from './features/RecommendationsView';
import { AiAnalystView } from './features/AiAnalystView';
import { DataManagerView } from './features/DataManagerView';
import { ReportsView } from './features/ReportsView';
import { AboutHelpView } from './features/AboutHelpView';

interface ToastItem {
  id: number;
  message: string;
  tone: 'success' | 'error' | 'info';
}

const NAV_ITEMS: Array<{ id: NavTabId; label: string; shortLabel: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'overview', label: 'Executive Overview', shortLabel: 'Overview', icon: LayoutDashboard },
  { id: 'trends', label: 'Trends', shortLabel: 'Trends', icon: TrendingUp },
  { id: 'products', label: 'Products & Categories', shortLabel: 'Products', icon: Package },
  { id: 'stores', label: 'Stores & Regions', shortLabel: 'Stores', icon: MapPin },
  { id: 'salespeople', label: 'Salesperson Performance', shortLabel: 'Reps', icon: Users },
  { id: 'models', label: 'Model Lab', shortLabel: 'Models', icon: Cpu },
  { id: 'recommendations', label: 'Retention Recommendations', shortLabel: 'Actions', icon: Lightbulb },
  { id: 'analyst', label: 'AI Analyst (Chat)', shortLabel: 'Analyst', icon: Bot },
  { id: 'data', label: 'Data Manager', shortLabel: 'Data', icon: Database },
  { id: 'reports', label: 'Reports', shortLabel: 'Reports', icon: FileText },
  { id: 'help', label: 'About / Help', shortLabel: 'Help', icon: BookOpen },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTabId>('overview');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);
  const [floatingChatOpen, setFloatingChatOpen] = useState(false);
  const [tourStep, setTourStep] = useState<number | null>(null);

  const [booting, setBooting] = useState(true);
  const [loadingSample, setLoadingSample] = useState(false);

  // Persisted state from IndexedDB
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [allFacts, setAllFacts] = useState<FactSale[]>([]);
  const [dimDate, setDimDate] = useState<DimDate[]>([]);
  const [dimProduct, setDimProduct] = useState<DimProduct[]>([]);
  const [dimStore, setDimStore] = useState<DimStore[]>([]);
  const [dimSalesperson, setDimSalesperson] = useState<DimSalesperson[]>([]);
  const [uploadHistory, setUploadHistory] = useState<UploadHistoryEntry[]>([]);
  const [latestQualityReport, setLatestQualityReport] = useState<DataQualityReport | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [pinnedInsights, setPinnedInsights] = useState<PinnedInsight[]>([]);
  const [recommendations, setRecommendations] = useState<RecommendationsBundle | null>(null);

  // Trained ML models in memory for current session
  const [models, setModels] = useState<AllModelResults>({});
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const notify = useCallback((message: string, tone: 'success' | 'error' | 'info' = 'info') => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const hydrateFromDB = useCallback(async () => {
    const [
      loadedSettings,
      facts,
      dates,
      prods,
      stores,
      reps,
      history,
      qReports,
      chats,
      pins,
      recBundle,
    ] = await Promise.all([
      loadSettings(),
      db.factSales.toArray(),
      db.dimDate.toArray(),
      db.dimProduct.toArray(),
      db.dimStore.toArray(),
      db.dimSalesperson.toArray(),
      db.uploadHistory.toArray(),
      db.qualityReports.toArray(),
      db.chatMessages.toArray(),
      db.pinnedInsights.toArray(),
      db.recommendations.get('singleton'),
    ]);

    setSettings(loadedSettings);
    setAllFacts(facts);
    setDimDate(dates);
    setDimProduct(prods);
    setDimStore(stores);
    setDimSalesperson(reps);
    setUploadHistory(history.sort((a, b) => a.timestamp.localeCompare(b.timestamp)));
    setLatestQualityReport(
      qReports.sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0] ?? null
    );
    setChatMessages(chats.sort((a, b) => a.timestamp.localeCompare(b.timestamp)));
    setPinnedInsights(pins.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    setRecommendations(recBundle ?? null);
  }, []);

  useEffect(() => {
    hydrateFromDB().finally(() => setBooting(false));
  }, [hydrateFromDB]);

  // Sync Tailwind dark class with persisted theme setting
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [settings.theme]);

  const updateFilters = useCallback(
    (nextFilters: GlobalFilters) => {
      setSettings((prev) => {
        const updated = { ...prev, filters: nextFilters };
        saveSettings({ filters: nextFilters });
        return updated;
      });
    },
    []
  );

  const toggleTheme = useCallback(() => {
    const nextTheme = settings.theme === 'dark' ? 'light' : 'dark';
    setSettings((prev) => ({ ...prev, theme: nextTheme }));
    saveSettings({ theme: nextTheme });
  }, [settings.theme]);

  const toggleAiEnabled = useCallback((enabled: boolean) => {
    setSettings((prev) => ({ ...prev, aiEnabled: enabled }));
    saveSettings({ aiEnabled: enabled });
    notify(
      enabled
        ? 'AI Analyst and Recommendations enabled.'
        : 'AI features opted out. All local analytics remain active.',
      'info'
    );
  }, [notify]);

  const handleCrossFilter = useCallback(
    (
      field: 'stores' | 'provinces' | 'categories' | 'products' | 'salespeople' | 'channels',
      value: string
    ) => {
      const cur = settings.filters[field];
      const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
      updateFilters({ ...settings.filters, [field]: next });
    },
    [settings.filters, updateFilters]
  );

  const handleQuickLoadSample = async () => {
    setLoadingSample(true);
    try {
      const sheets = generateSampleRawSheets();
      const detected = autoDetectTables(sheets);
      const batchId = `sample-${Date.now()}`;
      const cleaned = await runCleaningInWorker(detected, {
        batchId,
        fileNames: ['Canadian_Retail_Sample_24M.xlsx'],
        mapping: detected.detectedMapping,
        dateFormatPreference: 'auto',
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
      await saveSettings({ onboardingCompleted: true });
      await hydrateFromDB();
      notify(
        `Sample dataset ready (${cleaned.facts.length.toLocaleString()} cleaned Canadian transactions).`,
        'success'
      );
    } finally {
      setLoadingSample(false);
    }
  };

  // Memoized filtered Fact_Sales (<200ms selector)
  const filteredFacts = useMemo(
    () => applyGlobalFilters(allFacts, settings.filters),
    [allFacts, settings.filters]
  );

  const coverageBounds = useMemo(() => getDataDateBounds(allFacts), [allFacts]);
  const lastUpdatedStr = useMemo(() => {
    const latest = uploadHistory[uploadHistory.length - 1];
    return latest ? latest.timestamp.slice(0, 16).replace('T', ' ') : null;
  }, [uploadHistory]);

  const handleAddChatMessage = async (msg: ChatMessage) => {
    await db.chatMessages.put(msg);
    setChatMessages((prev) => [...prev, msg]);
  };

  const handleClearChat = async () => {
    await db.chatMessages.clear();
    setChatMessages([]);
    notify('AI Analyst conversation history cleared.', 'info');
  };

  const handlePinInsight = async (msg: ChatMessage, inReport: boolean) => {
    const pin: PinnedInsight = {
      id: `pin-${Date.now()}`,
      title: msg.viz?.title || 'AI Analyst Insight',
      summary: msg.text.slice(0, 500),
      filtersUsed: msg.filtersUsed || 'Active dashboard filters',
      createdAt: new Date().toISOString(),
      viz: msg.viz,
      inReport,
    };
    await db.pinnedInsights.put(pin);
    setPinnedInsights((prev) => [pin, ...prev]);
    notify(inReport ? 'Insight added to Executive Report.' : 'Insight pinned to Executive Overview.', 'success');
  };

  const handleRemovePin = async (id: string) => {
    await db.pinnedInsights.delete(id);
    setPinnedInsights((prev) => prev.filter((p) => p.id !== id));
  };

  const handleSaveRecommendations = async (bundle: RecommendationsBundle) => {
    await db.recommendations.put(bundle);
    setRecommendations(bundle);
  };

  const activeNavObj = NAV_ITEMS.find((n) => n.id === activeTab) ?? NAV_ITEMS[0];

  const showOnboardingEmpty = !booting && allFacts.length === 0 && activeTab !== 'data' && activeTab !== 'help';

  const TOUR_STEPS = [
    {
      title: '1. Local-First Star Schema & ETL',
      body: 'Upload Excel (.xlsx), CSV, or JSON in Data Manager. The app normalizes labels, reconciles Gross/Discount/Sales, flags outliers, and stores everything permanently in IndexedDB.',
    },
    {
      title: '2. Cross-Filtered Executive Dashboards',
      body: 'Use the sticky top slicers or click any bar, category slice, store row, or Canadian province to cross-filter all KPIs and charts instantaneously.',
    },
    {
      title: '3. Browser ML & Tool-Grounded AI',
      body: 'Train all 5 ML models in Model Lab (including Holt-Winters + TF.js LSTM), ask natural-language questions in AI Analyst, and build 90-day playbooks in Retention Recommendations.',
    },
  ];

  return (
    <div className="flex min-h-screen bg-[#F4F7FA] text-[#0F2238] dark:bg-[#0F2238] dark:text-[#F1F5F9]">
      {/* Desktop Collapsible Left Sidebar */}
      <aside
        aria-label="Primary navigation"
        className={`no-print hidden shrink-0 flex-col border-r border-slate-200/80 bg-white transition-all duration-200 dark:border-white/10 dark:bg-[#0B1A2B] lg:flex ${
          sidebarCollapsed ? 'w-[72px]' : 'w-[252px]'
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b border-slate-200/80 px-4 dark:border-white/10">
          {!sidebarCollapsed && (
            <div className="flex items-center gap-2.5 overflow-hidden">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg brand-gradient text-[#0F2238]">
                <BarChart3 className="h-4 w-4" aria-hidden="true" />
              </div>
              <span className="truncate font-display text-sm font-bold tracking-tight text-[#0F2238] dark:text-white">
                Sales Intelligence
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={() => setSidebarCollapsed((c) => !c)}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-[#0F2238] dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white"
          >
            {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                title={sidebarCollapsed ? item.label : undefined}
                aria-current={active ? 'page' : undefined}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-medium transition-colors ${
                  active
                    ? 'brand-gradient font-semibold text-[#0F2238]'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-[#0F2238] dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white'
                } ${sidebarCollapsed ? 'justify-center px-2' : ''}`}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
          className="fixed inset-0 z-50 flex bg-[#0F2238]/70 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        >
          <div
            className="flex h-full w-72 flex-col bg-white p-4 dark:bg-[#0B1A2B]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between border-b border-slate-200 pb-3 dark:border-white/10">
              <span className="font-display text-sm font-bold text-[#0F2238] dark:text-white">
                Sales Intelligence
              </span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close navigation"
                className="rounded-lg p-1 text-slate-500 dark:text-slate-300"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 overflow-y-auto">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-medium ${
                      active
                        ? 'brand-gradient font-semibold text-[#0F2238]'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </div>
      )}

      {/* Main Content Shell */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Sticky Top Header */}
        <header className="no-print sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur-md dark:border-white/10 dark:bg-[#0F2238]/95">
          <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                aria-label="Open navigation menu"
                className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10 lg:hidden"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="min-w-0">
                <h1 className="truncate font-display text-base font-bold text-[#0F2238] dark:text-white sm:text-lg">
                  {activeNavObj.label}
                </h1>
                {allFacts.length > 0 && (
                  <div className="hidden items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 sm:flex">
                    <span>
                      Data coverage: <strong className="font-mono font-medium text-[#0F2238] dark:text-slate-200">{coverageBounds.min}</strong> to{' '}
                      <strong className="font-mono font-medium text-[#0F2238] dark:text-slate-200">{coverageBounds.max}</strong>
                    </span>
                    {lastUpdatedStr && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>Last updated {lastUpdatedStr}</span>
                      </>
                    )}
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {filteredFacts.length.toLocaleString()}/{allFacts.length.toLocaleString()} rows
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              {/* Global Search */}
              <div className="relative hidden md:block">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  aria-label="Search transactions, stores, products, or reps"
                  placeholder="Search stores, products, reps…"
                  value={settings.filters.searchQuery}
                  onChange={(e) =>
                    updateFilters({ ...settings.filters, searchQuery: e.target.value })
                  }
                  className="w-56 rounded-lg border border-slate-300 bg-slate-50 py-1.5 pl-8 pr-3 text-xs text-[#0F2238] placeholder:text-slate-400 focus:border-[#26E6D0] dark:border-white/15 dark:bg-[#16314D] dark:text-white"
                />
              </div>

              {/* Mobile Filter Drawer Trigger */}
              {allFacts.length > 0 && (
                <button
                  type="button"
                  onClick={() => setMobileFilterOpen(true)}
                  aria-label="Open filters"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:border-white/15 dark:text-slate-200 lg:hidden"
                >
                  <Filter className="h-3.5 w-3.5" />
                  Filters
                </button>
              )}

              {/* Theme Toggle */}
              <button
                type="button"
                onClick={toggleTheme}
                aria-label={settings.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                className="rounded-lg border border-slate-300 p-2 text-slate-600 transition-colors hover:bg-slate-100 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white/10"
              >
                {settings.theme === 'dark' ? (
                  <Sun className="h-4 w-4 text-[#26E6D0]" aria-hidden="true" />
                ) : (
                  <Moon className="h-4 w-4 text-[#0F2238]" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          {/* Global Slicers Strip (applies to every dashboard view) */}
          {allFacts.length > 0 && activeTab !== 'help' && (
            <GlobalFilterBar
              allFacts={allFacts}
              filters={settings.filters}
              onChange={updateFilters}
              mobileDrawerOpen={mobileFilterOpen}
              onCloseMobileDrawer={() => setMobileFilterOpen(false)}
            />
          )}
        </header>

        {/* Main Viewport */}
        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 pb-24 sm:px-6 lg:pb-10">
          <ErrorBoundary>
            {booting ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[1, 2, 3, 4].map((n) => (
                  <div
                    key={n}
                    className="h-32 animate-pulse rounded-[16px] border border-slate-200/80 bg-white dark:border-white/10 dark:bg-[#16314D]"
                  />
                ))}
              </div>
            ) : showOnboardingEmpty ? (
              /* First-Run Onboarding Screen */
              <section className="mx-auto max-w-4xl rounded-[16px] border border-slate-200/90 bg-white p-8 dark:border-white/10 dark:bg-[#16314D]">
                <div className="max-w-2xl">
                  <div className="text-xs font-semibold text-[#0FA696] dark:text-[#26E6D0]">
                    Local-First Sales Analytics &amp; Machine Learning
                  </div>
                  <h2 className="mt-2 font-display text-2xl font-bold tracking-tight text-[#0F2238] dark:text-white sm:text-3xl">
                    Welcome to Sales Intelligence Platform
                  </h2>
                  <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                    Upload your multi-sheet sales workbook (Transactions, Stores, Products) in Excel, CSV, or
                    JSON. Every cleaning step, star-schema table, ML model, and report runs locally in your
                    browser and persists automatically in IndexedDB.
                  </p>
                </div>

                <div className="mt-6 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => setActiveTab('data')}
                    className="inline-flex items-center gap-2 rounded-xl brand-gradient px-5 py-3 text-xs font-semibold text-[#0F2238] transition-opacity hover:opacity-90"
                  >
                    <Upload className="h-4 w-4" aria-hidden="true" />
                    Upload Your Sales Data
                  </button>
                  <button
                    type="button"
                    disabled={loadingSample}
                    onClick={handleQuickLoadSample}
                    className="inline-flex items-center gap-2 rounded-xl border border-[#26E6D0]/50 bg-[#26E6D0]/10 px-5 py-3 text-xs font-semibold text-[#0F2238] transition-colors hover:bg-[#26E6D0]/20 disabled:opacity-50 dark:text-[#26E6D0]"
                  >
                    <Database className="h-4 w-4" aria-hidden="true" />
                    {loadingSample ? 'Building Sample Warehouse…' : 'Load 24-Month Canadian Sample Dataset'}
                  </button>
                  <button
                    type="button"
                    onClick={downloadExcelTemplate}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-3 text-xs font-medium text-[#0F2238] hover:bg-slate-100 dark:border-white/15 dark:text-white dark:hover:bg-white/10"
                  >
                    <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
                    Download 3-Sheet Excel Template
                  </button>
                  <button
                    type="button"
                    onClick={() => setTourStep(0)}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-3 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-white/15 dark:text-slate-300 dark:hover:bg-white/10"
                  >
                    Quick Guided Tour
                  </button>
                </div>

                {tourStep !== null && (
                  <div className="mt-6 rounded-xl border border-[#26E6D0]/40 bg-slate-50 p-5 dark:bg-[#0F2238]">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="font-display text-sm font-semibold text-[#0F2238] dark:text-[#26E6D0]">
                          {TOUR_STEPS[tourStep].title}
                        </div>
                        <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                          {TOUR_STEPS[tourStep].body}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setTourStep(null)}
                        aria-label="Close tour"
                        className="text-slate-400 hover:text-slate-600 dark:hover:text-white"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-4 flex items-center justify-between text-xs">
                      <span className="font-mono text-slate-500">
                        Step {tourStep + 1} / {TOUR_STEPS.length}
                      </span>
                      <div className="flex gap-2">
                        {tourStep > 0 && (
                          <button
                            type="button"
                            onClick={() => setTourStep(tourStep - 1)}
                            className="rounded-md border border-slate-300 px-3 py-1 dark:border-white/15"
                          >
                            Back
                          </button>
                        )}
                        {tourStep < TOUR_STEPS.length - 1 ? (
                          <button
                            type="button"
                            onClick={() => setTourStep(tourStep + 1)}
                            className="rounded-md brand-gradient px-3 py-1 font-semibold text-[#0F2238]"
                          >
                            Next
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setTourStep(null)}
                            className="rounded-md brand-gradient px-3 py-1 font-semibold text-[#0F2238]"
                          >
                            Done
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </section>
            ) : (
              <>
                {activeTab === 'overview' && (
                  <ExecutiveOverview
                    allFacts={allFacts}
                    filteredFacts={filteredFacts}
                    filters={settings.filters}
                    models={models}
                    pinnedInsights={pinnedInsights}
                    onUnpinInsight={handleRemovePin}
                    onCrossFilter={handleCrossFilter}
                  />
                )}
                {activeTab === 'trends' && (
                  <TrendsView
                    filteredFacts={filteredFacts}
                    filters={settings.filters}
                    models={models}
                  />
                )}
                {activeTab === 'products' && (
                  <ProductsView
                    filteredFacts={filteredFacts}
                    filters={settings.filters}
                    onCrossFilter={handleCrossFilter}
                  />
                )}
                {activeTab === 'stores' && (
                  <StoresRegionsView
                    filteredFacts={filteredFacts}
                    filters={settings.filters}
                    onCrossFilter={handleCrossFilter}
                  />
                )}
                {activeTab === 'salespeople' && (
                  <SalespersonView
                    filteredFacts={filteredFacts}
                    filters={settings.filters}
                    onCrossFilter={handleCrossFilter}
                  />
                )}
                {activeTab === 'models' && (
                  <ModelLabView
                    filteredFacts={filteredFacts}
                    dimDates={dimDate}
                    filters={settings.filters}
                    models={models}
                    onUpdateModels={setModels}
                    onNotify={notify}
                  />
                )}
                {activeTab === 'recommendations' && (
                  <RecommendationsView
                    filteredFacts={filteredFacts}
                    filters={settings.filters}
                    models={models}
                    aiEnabled={settings.aiEnabled}
                    bundle={recommendations}
                    onSaveBundle={handleSaveRecommendations}
                    onNotify={notify}
                  />
                )}
                {activeTab === 'analyst' && (
                  <AiAnalystView
                    filteredFacts={filteredFacts}
                    filters={settings.filters}
                    models={models}
                    messages={chatMessages}
                    aiEnabled={settings.aiEnabled}
                    onToggleAi={toggleAiEnabled}
                    onAddMessage={handleAddChatMessage}
                    onClearHistory={handleClearChat}
                    onPinToDashboard={(m) => handlePinInsight(m, false)}
                    onAddToReport={(m) => handlePinInsight(m, true)}
                  />
                )}
                {activeTab === 'data' && (
                  <DataManagerView
                    allFacts={allFacts}
                    dimDate={dimDate}
                    dimProduct={dimProduct}
                    dimStore={dimStore}
                    dimSalesperson={dimSalesperson}
                    uploadHistory={uploadHistory}
                    latestQualityReport={latestQualityReport}
                    filters={settings.filters}
                    dateFormatPreference={settings.dateFormatPreference}
                    onUpdatePreferences={(patch) => {
                      const nextFilters: GlobalFilters = {
                        ...settings.filters,
                        ...(patch.excludeOutliers !== undefined
                          ? { excludeOutliers: patch.excludeOutliers }
                          : {}),
                        ...(patch.useRecomputedFinancials !== undefined
                          ? { useRecomputedFinancials: patch.useRecomputedFinancials }
                          : {}),
                      };
                      const nextSettings: AppSettings = {
                        ...settings,
                        ...(patch.dateFormatPreference
                          ? { dateFormatPreference: patch.dateFormatPreference }
                          : {}),
                        filters: nextFilters,
                      };
                      setSettings(nextSettings);
                      saveSettings(nextSettings);
                    }}
                    onDataMutated={hydrateFromDB}
                    onNotify={notify}
                  />
                )}
                {activeTab === 'reports' && (
                  <ReportsView
                    filteredFacts={filteredFacts}
                    filters={settings.filters}
                    models={models}
                    recommendations={recommendations}
                    latestQualityReport={latestQualityReport}
                    pinnedInsights={pinnedInsights}
                    onRemovePin={handleRemovePin}
                    onNotify={notify}
                  />
                )}
                {activeTab === 'help' && <AboutHelpView />}
              </>
            )}
          </ErrorBoundary>
        </main>
      </div>

      {/* Floating AI Analyst Button & Slide-Over Drawer (hidden when already on AI Analyst tab) */}
      {allFacts.length > 0 && activeTab !== 'analyst' && (
        <>
          <button
            type="button"
            onClick={() => setFloatingChatOpen((v) => !v)}
            aria-label="Open AI Analyst chat"
            className="no-print fixed bottom-20 right-5 z-40 inline-flex items-center gap-2 rounded-full brand-gradient px-4 py-3 text-xs font-semibold text-[#0F2238] shadow-lg transition-transform hover:scale-105 lg:bottom-6"
          >
            <MessageSquare className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">AI Analyst</span>
          </button>

          {floatingChatOpen && (
            <div
              role="dialog"
              aria-modal="true"
              aria-label="AI Analyst Drawer"
              className="no-print fixed inset-0 z-50 flex justify-end bg-[#0F2238]/60 backdrop-blur-sm"
              onClick={() => setFloatingChatOpen(false)}
            >
              <div
                className="flex h-full w-full max-w-xl flex-col bg-[#F4F7FA] p-4 dark:bg-[#0F2238]"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-3 flex items-center justify-between">
                  <div className="font-display text-sm font-bold text-[#0F2238] dark:text-white">
                    AI Analyst
                  </div>
                  <button
                    type="button"
                    onClick={() => setFloatingChatOpen(false)}
                    aria-label="Close AI Analyst"
                    className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-white/10"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="min-h-0 flex-1">
                  <AiAnalystView
                    compact
                    filteredFacts={filteredFacts}
                    filters={settings.filters}
                    models={models}
                    messages={chatMessages}
                    aiEnabled={settings.aiEnabled}
                    onToggleAi={toggleAiEnabled}
                    onAddMessage={handleAddChatMessage}
                    onClearHistory={handleClearChat}
                    onPinToDashboard={(m) => handlePinInsight(m, false)}
                    onAddToReport={(m) => handlePinInsight(m, true)}
                  />
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Compact Mobile Bottom Nav */}
      <nav
        aria-label="Mobile navigation"
        className="no-print fixed inset-x-0 bottom-0 z-30 flex h-14 items-center justify-around border-t border-slate-200 bg-white/95 backdrop-blur dark:border-white/10 dark:bg-[#0B1A2B]/95 lg:hidden"
      >
        {(['overview', 'stores', 'models', 'analyst', 'data'] as NavTabId[]).map((tabId) => {
          const item = NAV_ITEMS.find((n) => n.id === tabId)!;
          const Icon = item.icon;
          const active = activeTab === tabId;
          return (
            <button
              key={tabId}
              type="button"
              onClick={() => setActiveTab(tabId)}
              className={`flex flex-col items-center justify-center gap-0.5 px-2 py-1 text-[10px] font-medium ${
                active ? 'text-[#0FA696] dark:text-[#26E6D0]' : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              <span>{item.shortLabel}</span>
            </button>
          );
        })}
      </nav>

      {/* Toast Notifications */}
      <div
        aria-live="polite"
        className="no-print pointer-events-none fixed right-4 top-20 z-50 flex flex-col gap-2"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto max-w-sm rounded-xl border px-4 py-3 text-xs font-medium shadow-lg ${
              t.tone === 'error'
                ? 'border-rose-500/40 bg-rose-950/95 text-rose-100'
                : t.tone === 'success'
                ? 'border-[#26E6D0]/50 bg-[#0F2238]/95 text-[#26E6D0]'
                : 'border-white/15 bg-[#16314D]/95 text-slate-100'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}
