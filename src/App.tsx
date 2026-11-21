import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
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
  Link2,
  MapPin,
  Menu,
  MessageSquare,
  Moon,
  Package,
  RefreshCw,
  Search,
  Sun,
  TrendingUp,
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
  LinkedGoogleSheet,
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
import {
  clearAccessToken,
  getAccessToken,
  googleSignIn,
  googleSignOut,
  initAuth,
} from './lib/google/workspaceAuth';
import {
  fetchGoogleSpreadsheetWorkbook,
  getSpreadsheetDriveMetadata,
  GoogleAuthExpiredError,
} from './lib/google/sheetsService';
import { reconcileEntityColors } from './lib/theme/chartTheme';
import { ErrorBoundary } from './components/ErrorBoundary';
import { GlobalFilterBar } from './components/GlobalFilterBar';
import { GoogleSheetsConnector } from './components/GoogleSheetsConnector';
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

  // Google Drive / Google Sheets live connection state (OAuth token remains strictly in memory)
  const [googleUser, setGoogleUser] = useState<User | null>(null);
  const [hasGoogleToken, setHasGoogleToken] = useState(false);
  const [isSigningInGoogle, setIsSigningInGoogle] = useState(false);
  const [syncingSheet, setSyncingSheet] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ pct: number; stage: string } | null>(null);
  const syncInFlightRef = useRef(false);
  const lastPollAtRef = useRef(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

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

    const reconciled = reconcileEntityColors(loadedSettings.entityColors, {
      categories: Array.from(new Set(facts.map((f) => f.category).filter(Boolean))),
      stores: Array.from(new Set(facts.map((f) => f.store).filter(Boolean))),
      provinces: Array.from(new Set(facts.map((f) => f.province).filter(Boolean))),
      salespeople: Array.from(new Set(facts.map((f) => f.salesperson).filter(Boolean))),
    });
    const effectiveSettings = reconciled.changed
      ? { ...loadedSettings, entityColors: reconciled.registry }
      : loadedSettings;
    if (reconciled.changed) {
      await saveSettings({ entityColors: reconciled.registry });
    }

    setSettings(effectiveSettings);
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

  // Listen to Firebase Google Auth state
  useEffect(() => {
    const unsubscribe = initAuth(
      (user) => {
        setGoogleUser(user);
        setHasGoogleToken(true);
      },
      (user) => {
        setGoogleUser(user);
        setHasGoogleToken(false);
      }
    );
    return unsubscribe;
  }, []);

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

  const handleGoogleSignIn = useCallback(async (): Promise<string | null> => {
    setIsSigningInGoogle(true);
    try {
      const { user, accessToken } = await googleSignIn();
      setGoogleUser(user);
      setHasGoogleToken(true);
      notify(
        `Connected Google Drive (${user.email || user.displayName || 'Google Account'}).`,
        'success'
      );
      return accessToken;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google sign-in failed.';
      if (msg.includes('popup-closed-by-user') || msg.includes('cancelled-popup-request')) {
        notify('Google sign-in window was closed before completing.', 'info');
      } else {
        notify(msg, 'error');
      }
      return null;
    } finally {
      setIsSigningInGoogle(false);
    }
  }, [notify]);

  const handleGoogleSignOut = useCallback(async () => {
    await googleSignOut();
    setGoogleUser(null);
    setHasGoogleToken(false);
    notify('Signed out of Google Drive.', 'info');
  }, [notify]);

  const handleGoogleTokenExpired = useCallback(() => {
    clearAccessToken();
    setHasGoogleToken(false);
  }, []);

  const syncSpreadsheetById = useCallback(
    async (
      spreadsheetId: string,
      options?: { silentIfUnchanged?: boolean; interactiveAuth?: boolean }
    ) => {
      if (syncInFlightRef.current) return;
      syncInFlightRef.current = true;
      const silentIfUnchanged = options?.silentIfUnchanged ?? false;

      try {
        let token = getAccessToken();
        if (!token) {
          if (options?.interactiveAuth) {
            token = await handleGoogleSignIn();
          }
          if (!token) return;
        }

        const currentSettings = settingsRef.current;

        // Lightweight modifiedTime probe during background live polling
        if (
          silentIfUnchanged &&
          currentSettings.linkedGoogleSheet?.spreadsheetId === spreadsheetId &&
          currentSettings.linkedGoogleSheet.lastModifiedTime
        ) {
          const driveMeta = await getSpreadsheetDriveMetadata(token, spreadsheetId);
          if (
            driveMeta.modifiedTime &&
            driveMeta.modifiedTime === currentSettings.linkedGoogleSheet.lastModifiedTime
          ) {
            return;
          }
        }

        setSyncingSheet(true);
        setSyncProgress({ pct: 5, stage: 'Connecting to Google Sheets' });

        const workbook = await fetchGoogleSpreadsheetWorkbook(
          token,
          spreadsheetId,
          (pct, stage) => setSyncProgress({ pct, stage })
        );

        const detected = autoDetectTables(workbook.rawSheets);
        if (detected.transactions.length === 0) {
          throw new Error(
            `No Transactions worksheet was detected in "${workbook.title}" (found tabs: ${workbook.sheetNames.join(
              ', '
            )}). Ensure your workbook includes the Transactions headers (Transaction ID, Date, Product, Quantity, Store, Sales Amount).`
          );
        }

        const batchId = `gsheet-${Date.now()}`;
        const sourceLabel = `${workbook.title} (Google Sheets)`;
        const cleaned = await runCleaningInWorker(detected, {
          batchId,
          fileNames: [sourceLabel],
          mapping: detected.detectedMapping,
          dateFormatPreference: currentSettings.dateFormatPreference,
          onProgress: (pct, stage) =>
            setSyncProgress({ pct: Math.round(60 + pct * 0.32), stage }),
        });

        setSyncProgress({
          pct: 95,
          stage: 'Updating Metro Superstore star schema in IndexedDB',
        });

        await commitIngestionToDB({
          mode: 'replace',
          batchId,
          fileNames: [sourceLabel],
          newFacts: cleaned.facts,
          dimProducts: cleaned.dimProducts,
          dimStores: cleaned.dimStores,
          qualityReport: cleaned.report,
        });

        const existingLink = currentSettings.linkedGoogleSheet;
        const nextLinkedSheet: LinkedGoogleSheet = {
          spreadsheetId: workbook.spreadsheetId,
          name: workbook.title,
          webViewLink: workbook.webViewLink,
          sheetNames: workbook.sheetNames,
          lastSyncedAt: new Date().toISOString(),
          lastModifiedTime: workbook.modifiedTime,
          autoSyncEnabled: existingLink?.autoSyncEnabled ?? true,
          pollIntervalSeconds: existingLink?.pollIntervalSeconds ?? 30,
          rowCounts: {
            transactions: cleaned.facts.length,
            stores: cleaned.dimStores.length,
            products: cleaned.dimProducts.length,
          },
        };

        await saveSettings({
          linkedGoogleSheet: nextLinkedSheet,
          onboardingCompleted: true,
        });
        await hydrateFromDB();

        notify(
          `Synced "${workbook.title}" (${workbook.sheetNames.length} worksheets · ${cleaned.facts.length.toLocaleString()} transactions).`,
          'success'
        );
      } catch (err) {
        if (err instanceof GoogleAuthExpiredError) {
          handleGoogleTokenExpired();
          if (!silentIfUnchanged) {
            notify(err.message, 'info');
          }
        } else if (!silentIfUnchanged) {
          notify(
            err instanceof Error ? err.message : 'Failed to sync Google Spreadsheet.',
            'error'
          );
        }
      } finally {
        syncInFlightRef.current = false;
        setSyncingSheet(false);
        setSyncProgress(null);
      }
    },
    [handleGoogleSignIn, handleGoogleTokenExpired, hydrateFromDB, notify]
  );

  const handleLinkSpreadsheet = useCallback(
    async (spreadsheetId: string) => {
      await syncSpreadsheetById(spreadsheetId, {
        silentIfUnchanged: false,
        interactiveAuth: true,
      });
    },
    [syncSpreadsheetById]
  );

  const handleRefreshLinkedSheet = useCallback(async () => {
    const linked = settingsRef.current.linkedGoogleSheet;
    if (!linked) {
      setActiveTab('data');
      notify('Connect a Google Spreadsheet in Data Manager to enable live refresh.', 'info');
      return;
    }
    await syncSpreadsheetById(linked.spreadsheetId, {
      silentIfUnchanged: false,
      interactiveAuth: true,
    });
  }, [notify, syncSpreadsheetById]);

  const handleUnlinkSpreadsheet = useCallback(async () => {
    setSettings((prev) => ({ ...prev, linkedGoogleSheet: null }));
    await saveSettings({ linkedGoogleSheet: null });
    notify('Google Spreadsheet unlinked. Cached local data remains available.', 'info');
  }, [notify]);

  const handleUpdateLiveSyncSettings = useCallback(
    (patch: { autoSyncEnabled?: boolean; pollIntervalSeconds?: number }) => {
      setSettings((prev) => {
        if (!prev.linkedGoogleSheet) return prev;
        const nextLink: LinkedGoogleSheet = {
          ...prev.linkedGoogleSheet,
          ...patch,
        };
        void saveSettings({ linkedGoogleSheet: nextLink });
        return { ...prev, linkedGoogleSheet: nextLink };
      });
    },
    []
  );

  // Live Auto-Sync polling & tab-focus sync when a Google Spreadsheet is linked
  const linkedSpreadsheetId = settings.linkedGoogleSheet?.spreadsheetId;
  const linkedAutoSync = settings.linkedGoogleSheet?.autoSyncEnabled ?? false;
  const linkedPollInterval = settings.linkedGoogleSheet?.pollIntervalSeconds ?? 30;

  useEffect(() => {
    if (!linkedSpreadsheetId || !linkedAutoSync || !hasGoogleToken) return;

    const triggerCheck = () => {
      const now = Date.now();
      if (now - lastPollAtRef.current < 8000) return;
      lastPollAtRef.current = now;
      void syncSpreadsheetById(linkedSpreadsheetId, {
        silentIfUnchanged: true,
        interactiveAuth: false,
      });
    };

    const intervalMs = Math.max(10, linkedPollInterval) * 1000;
    const timer = window.setInterval(triggerCheck, intervalMs);

    const handleFocus = () => triggerCheck();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        triggerCheck();
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [
    linkedSpreadsheetId,
    linkedAutoSync,
    linkedPollInterval,
    hasGoogleToken,
    syncSpreadsheetById,
  ]);

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
      title: '1. Live Google Drive & 3-Worksheet Star Schema',
      body: 'Connect your 3-worksheet Google Spreadsheet (Transactions, Stores, Products) directly from Google Drive. Edits sync automatically or on demand via the Refresh button, with full cleaning and local IndexedDB caching.',
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
              <div className="min-w-0 leading-tight">
                <div className="truncate font-display text-xs font-bold tracking-tight text-[#0F2238] dark:text-white">
                  Metro Superstore
                </div>
                <div className="truncate text-[11px] font-medium text-[#0FB8A5] dark:text-[#26E6D0]">
                  Sales Intelligence
                </div>
              </div>
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
                Metro Superstore Sales Intelligence
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
                <h1 className="truncate font-display text-base font-bold tracking-tight text-[#0F2238] dark:text-white sm:text-lg">
                  Metro Superstore Sales Intelligence
                </h1>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                  <span className="font-medium text-[#0FB8A5] dark:text-[#26E6D0]">
                    {activeNavObj.label}
                  </span>
                  {settings.linkedGoogleSheet && (
                    <>
                      <span className="hidden sm:inline" aria-hidden="true">·</span>
                      <span className="hidden max-w-[200px] truncate text-slate-600 dark:text-slate-300 sm:inline">
                        Live Sheet:{' '}
                        <strong className="font-medium text-[#0F2238] dark:text-slate-100">
                          {settings.linkedGoogleSheet.name}
                        </strong>
                      </span>
                    </>
                  )}
                  {allFacts.length > 0 && (
                    <>
                      <span className="hidden sm:inline" aria-hidden="true">·</span>
                      <span className="hidden sm:inline">
                        Data coverage: <strong className="font-mono font-medium text-[#0F2238] dark:text-slate-200">{coverageBounds.min}</strong> to{' '}
                        <strong className="font-mono font-medium text-[#0F2238] dark:text-slate-200">{coverageBounds.max}</strong>
                      </span>
                      {lastUpdatedStr && (
                        <>
                          <span className="hidden lg:inline" aria-hidden="true">·</span>
                          <span className="hidden lg:inline">Last updated {lastUpdatedStr}</span>
                        </>
                      )}
                      <span className="hidden sm:inline" aria-hidden="true">·</span>
                      <span className="hidden font-mono tabular-nums sm:inline">
                        {filteredFacts.length.toLocaleString()}/{allFacts.length.toLocaleString()} rows
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {/* Live Google Sheets Refresh or Connect Button */}
              {settings.linkedGoogleSheet ? (
                <button
                  type="button"
                  disabled={syncingSheet}
                  onClick={() => void handleRefreshLinkedSheet()}
                  title={`Refresh live data from "${settings.linkedGoogleSheet.name}" (Last synced: ${settings.linkedGoogleSheet.lastSyncedAt.slice(0, 19).replace('T', ' ')})`}
                  className="inline-flex items-center gap-1.5 rounded-lg brand-gradient px-3 py-1.5 text-xs font-semibold text-[#0F2238] transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${syncingSheet ? 'animate-spin' : ''}`}
                    aria-hidden="true"
                  />
                  <span>{syncingSheet ? 'Syncing…' : 'Refresh'}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setActiveTab('data')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#26E6D0]/60 bg-[#26E6D0]/10 px-3 py-1.5 text-xs font-semibold text-[#0F2238] transition-colors hover:bg-[#26E6D0]/20 dark:text-[#26E6D0]"
                >
                  <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Connect Google Sheet</span>
                  <span className="sm:hidden">Connect</span>
                </button>
              )}

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
                  className="w-48 rounded-lg border border-slate-300 bg-slate-50 py-1.5 pl-8 pr-3 text-xs text-[#0F2238] placeholder:text-slate-400 focus:border-[#26E6D0] dark:border-white/15 dark:bg-[#16314D] dark:text-white xl:w-56"
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

          {/* Live Google Sheets Sync Progress Bar */}
          {syncProgress && (
            <div className="border-t border-slate-200/80 bg-slate-50/95 px-4 py-1.5 dark:border-white/10 dark:bg-[#0B1A2B]/95 sm:px-6">
              <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300">
                <span className="truncate">{syncProgress.stage}</span>
                <span className="font-mono tabular-nums">{syncProgress.pct}%</span>
              </div>
              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
                <div
                  className="h-full rounded-full brand-gradient transition-all duration-200"
                  style={{ width: `${syncProgress.pct}%` }}
                />
              </div>
            </div>
          )}

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
              <div className="mx-auto max-w-4xl space-y-5">
                <section className="rounded-[16px] border border-slate-200/90 bg-white p-6 dark:border-white/10 dark:bg-[#16314D] sm:p-8">
                  <div className="max-w-2xl">
                    <div className="text-xs font-semibold text-[#0FA696] dark:text-[#26E6D0]">
                      Live Google Sheets &amp; Sales Analytics Platform
                    </div>
                    <h2 className="mt-2 font-display text-2xl font-bold tracking-tight text-[#0F2238] dark:text-white sm:text-3xl">
                      Welcome to Metro Superstore Sales Intelligence
                    </h2>
                    <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                      Link your 3-worksheet Google Spreadsheet (Transactions, Stores, Products) directly
                      from Google Drive. Any update you make in Google Sheets reflects live across every
                      KPI, chart, ML model, and report—with one-click Refresh and automatic change detection.
                    </p>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-3">
                    <button
                      type="button"
                      disabled={loadingSample}
                      onClick={handleQuickLoadSample}
                      className="inline-flex items-center gap-2 rounded-xl border border-[#26E6D0]/50 bg-[#26E6D0]/10 px-4 py-2.5 text-xs font-semibold text-[#0F2238] transition-colors hover:bg-[#26E6D0]/20 disabled:opacity-50 dark:text-[#26E6D0]"
                    >
                      <Database className="h-4 w-4" aria-hidden="true" />
                      {loadingSample ? 'Building Sample Warehouse…' : 'Load 24-Month Canadian Sample Dataset'}
                    </button>
                    <button
                      type="button"
                      onClick={downloadExcelTemplate}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-xs font-medium text-[#0F2238] hover:bg-slate-100 dark:border-white/15 dark:text-white dark:hover:bg-white/10"
                    >
                      <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
                      Download 3-Sheet Template
                    </button>
                    <button
                      type="button"
                      onClick={() => setTourStep(0)}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-white/15 dark:text-slate-300 dark:hover:bg-white/10"
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

                <GoogleSheetsConnector
                  compact
                  googleUser={googleUser}
                  hasGoogleToken={hasGoogleToken}
                  isSigningIn={isSigningInGoogle}
                  syncing={syncingSheet}
                  syncProgress={syncProgress}
                  linkedSheet={settings.linkedGoogleSheet}
                  onSignIn={handleGoogleSignIn}
                  onSignOut={handleGoogleSignOut}
                  onLinkSpreadsheet={handleLinkSpreadsheet}
                  onRefreshLinkedSheet={handleRefreshLinkedSheet}
                  onUnlinkSpreadsheet={handleUnlinkSpreadsheet}
                  onUpdateLiveSyncSettings={handleUpdateLiveSyncSettings}
                  onTokenExpired={handleGoogleTokenExpired}
                  onNotify={notify}
                  getToken={getAccessToken}
                />
              </div>
            ) : (
              <>
                {activeTab === 'overview' && (
                  <ExecutiveOverview
                    allFacts={allFacts}
                    filteredFacts={filteredFacts}
                    filters={settings.filters}
                    models={models}
                    pinnedInsights={pinnedInsights}
                    theme={settings.theme}
                    entityColors={settings.entityColors}
                    onUnpinInsight={handleRemovePin}
                    onCrossFilter={handleCrossFilter}
                  />
                )}
                {activeTab === 'trends' && (
                  <TrendsView
                    filteredFacts={filteredFacts}
                    filters={settings.filters}
                    models={models}
                    theme={settings.theme}
                  />
                )}
                {activeTab === 'products' && (
                  <ProductsView
                    filteredFacts={filteredFacts}
                    filters={settings.filters}
                    theme={settings.theme}
                    entityColors={settings.entityColors}
                    onCrossFilter={handleCrossFilter}
                  />
                )}
                {activeTab === 'stores' && (
                  <StoresRegionsView
                    filteredFacts={filteredFacts}
                    filters={settings.filters}
                    theme={settings.theme}
                    entityColors={settings.entityColors}
                    onCrossFilter={handleCrossFilter}
                  />
                )}
                {activeTab === 'salespeople' && (
                  <SalespersonView
                    filteredFacts={filteredFacts}
                    filters={settings.filters}
                    theme={settings.theme}
                    entityColors={settings.entityColors}
                    onCrossFilter={handleCrossFilter}
                  />
                )}
                {activeTab === 'models' && (
                  <ModelLabView
                    filteredFacts={filteredFacts}
                    dimDates={dimDate}
                    filters={settings.filters}
                    models={models}
                    theme={settings.theme}
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
                    theme={settings.theme}
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
                    googleUser={googleUser}
                    hasGoogleToken={hasGoogleToken}
                    isSigningInGoogle={isSigningInGoogle}
                    syncingSheet={syncingSheet}
                    syncProgress={syncProgress}
                    linkedGoogleSheet={settings.linkedGoogleSheet}
                    onGoogleSignIn={handleGoogleSignIn}
                    onGoogleSignOut={handleGoogleSignOut}
                    onLinkSpreadsheet={handleLinkSpreadsheet}
                    onRefreshLinkedSheet={handleRefreshLinkedSheet}
                    onUnlinkSpreadsheet={handleUnlinkSpreadsheet}
                    onUpdateLiveSyncSettings={handleUpdateLiveSyncSettings}
                    onGoogleTokenExpired={handleGoogleTokenExpired}
                    getGoogleToken={getAccessToken}
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
                    theme={settings.theme}
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
