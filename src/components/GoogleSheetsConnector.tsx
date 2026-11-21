import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileSpreadsheet,
  FolderOpen,
  Link2,
  LogOut,
  RefreshCw,
  Search,
  Unlink,
} from 'lucide-react';
import type { LinkedGoogleSheet } from '../types/sales';
import type { GoogleAccountProfile } from '../lib/google/workspaceAuth';
import {
  extractSpreadsheetId,
  GoogleAuthExpiredError,
  listDriveSpreadsheets,
  type DriveSpreadsheetFile,
} from '../lib/google/sheetsService';

export interface DomainAuthDiagnostic {
  hostname: string;
  projectId: string;
  authorizedDomains: string[];
}

interface GoogleSheetsConnectorProps {
  googleUser: GoogleAccountProfile | null;
  hasGoogleToken: boolean;
  isSigningIn: boolean;
  syncing: boolean;
  syncProgress: { pct: number; stage: string } | null;
  linkedSheet: LinkedGoogleSheet | null;
  domainAuthError?: DomainAuthDiagnostic | null;
  onSignIn: () => Promise<string | null>;
  onSignOut: () => Promise<void>;
  onLinkSpreadsheet: (spreadsheetId: string) => Promise<boolean>;
  onRefreshLinkedSheet: () => Promise<void>;
  onUnlinkSpreadsheet: () => Promise<void>;
  onUpdateLiveSyncSettings: (patch: {
    autoSyncEnabled?: boolean;
    pollIntervalSeconds?: number;
  }) => void;
  onTokenExpired: () => void;
  onNotify: (msg: string, tone?: 'success' | 'error' | 'info') => void;
  getToken: () => string | null;
  compact?: boolean;
  inModal?: boolean;
  onConnected?: () => void;
}

export const GoogleSignInButton: React.FC<{
  onClick: () => void;
  disabled?: boolean;
  label?: string;
}> = ({ onClick, disabled, label = 'Sign in with Google' }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="inline-flex items-center gap-3 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-[#1F1F1F] shadow-sm transition-all hover:bg-slate-50 active:scale-[0.99] disabled:opacity-50 dark:border-white/20 dark:bg-white dark:text-[#1F1F1F] dark:hover:bg-slate-100"
  >
    <span className="h-4 w-4 shrink-0" aria-hidden="true">
      <svg
        version="1.1"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 48 48"
        style={{ display: 'block', width: '100%', height: '100%' }}
      >
        <path
          fill="#EA4335"
          d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
        />
        <path
          fill="#4285F4"
          d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
        />
        <path
          fill="#FBBC05"
          d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
        />
        <path
          fill="#34A853"
          d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
        />
        <path fill="none" d="M0 0h48v48H0z" />
      </svg>
    </span>
    <span>{label}</span>
  </button>
);

export const GoogleSheetsConnector: React.FC<GoogleSheetsConnectorProps> = ({
  googleUser,
  hasGoogleToken,
  isSigningIn,
  syncing,
  syncProgress,
  linkedSheet,
  domainAuthError,
  onSignIn,
  onSignOut,
  onLinkSpreadsheet,
  onRefreshLinkedSheet,
  onUnlinkSpreadsheet,
  onUpdateLiveSyncSettings,
  onTokenExpired,
  onNotify,
  getToken,
  compact = false,
  inModal = false,
  onConnected,
}) => {
  const [showBrowser, setShowBrowser] = useState(!linkedSheet || inModal);
  const [driveFiles, setDriveFiles] = useState<DriveSpreadsheetFile[]>([]);
  const [loadingDrive, setLoadingDrive] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [directInput, setDirectInput] = useState('');
  const [driveError, setDriveError] = useState<string | null>(null);
  const [copiedDomain, setCopiedDomain] = useState(false);

  const loadDriveFiles = useCallback(
    async (query = '') => {
      const token = getToken();
      if (!token) return;
      setLoadingDrive(true);
      setDriveError(null);
      try {
        const files = await listDriveSpreadsheets(token, query);
        setDriveFiles(files);
      } catch (err) {
        if (err instanceof GoogleAuthExpiredError) {
          onTokenExpired();
          onNotify(err.message, 'info');
        } else {
          setDriveError(
            err instanceof Error ? err.message : 'Unable to list Google Drive spreadsheets.'
          );
        }
      } finally {
        setLoadingDrive(false);
      }
    },
    [getToken, onTokenExpired, onNotify]
  );

  useEffect(() => {
    if (hasGoogleToken && (showBrowser || !linkedSheet)) {
      void loadDriveFiles('');
    }
  }, [hasGoogleToken, showBrowser, linkedSheet, loadDriveFiles]);

  const handleLinkByUrlOrId = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = extractSpreadsheetId(directInput);
    if (!id) {
      onNotify('Enter a valid Google Sheets URL or Spreadsheet ID.', 'error');
      return;
    }
    const ok = await onLinkSpreadsheet(id);
    if (ok) {
      setDirectInput('');
      setShowBrowser(false);
      onConnected?.();
    }
  };

  const handlePickFile = async (fileId: string) => {
    const ok = await onLinkSpreadsheet(fileId);
    if (ok) {
      setShowBrowser(false);
      onConnected?.();
    }
  };

  const handleCopyHostname = async (hostname: string) => {
    try {
      await navigator.clipboard.writeText(hostname);
      setCopiedDomain(true);
      setTimeout(() => setCopiedDomain(false), 2000);
    } catch {
      onNotify(`Copy this domain: ${hostname}`, 'info');
    }
  };

  const wrapperClass = inModal
    ? 'space-y-5'
    : 'rounded-[16px] border border-slate-200/90 bg-white p-5 dark:border-white/10 dark:bg-[#16314D]';

  return (
    <section className={wrapperClass}>
      {!inModal && (
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200/80 pb-4 dark:border-white/10">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl brand-gradient text-[#0F2238]">
              <FileSpreadsheet className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h3 className="font-display text-base font-semibold text-[#0F2238] dark:text-white">
                Live Google Sheet Connection
              </h3>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Pick a 3-worksheet spreadsheet (Transactions, Stores, Products) from Google Drive or paste its Google Sheets link. Updates reflect live on the dashboard.
              </p>
            </div>
          </div>

          <a
            href="https://drive.google.com/drive/search?q=type:spreadsheet"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white/10"
          >
            <FolderOpen className="h-3.5 w-3.5 text-[#0FB8A5] dark:text-[#26E6D0]" aria-hidden="true" />
            Open Google Drive
            <ExternalLink className="h-3 w-3 opacity-70" aria-hidden="true" />
          </a>
        </div>
      )}

      {/* Linked Workbook Active Status Card */}
      {linkedSheet && (
        <div className="mt-4 rounded-xl border border-[#26E6D0]/40 bg-slate-50/80 p-4 dark:bg-[#0F2238]/75">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <CheckCircle2
                  className="h-4 w-4 shrink-0 text-[#0FB8A5] dark:text-[#26E6D0]"
                  aria-hidden="true"
                />
                <span className="truncate font-display text-sm font-semibold text-[#0F2238] dark:text-white">
                  {linkedSheet.name}
                </span>
                {linkedSheet.webViewLink && (
                  <a
                    href={linkedSheet.webViewLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-[#0FB8A5] hover:underline dark:text-[#26E6D0]"
                  >
                    Open in Google Sheets
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                )}
              </div>

              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600 dark:text-slate-300">
                <span>
                  Worksheets ({linkedSheet.sheetNames.length}):{' '}
                  <strong className="font-medium text-[#0F2238] dark:text-slate-100">
                    {linkedSheet.sheetNames.join(' · ')}
                  </strong>
                </span>
                {linkedSheet.rowCounts && (
                  <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    {linkedSheet.rowCounts.transactions.toLocaleString()} txns ·{' '}
                    {linkedSheet.rowCounts.stores.toLocaleString()} stores ·{' '}
                    {linkedSheet.rowCounts.products.toLocaleString()} products
                  </span>
                )}
                <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  Last synced: {linkedSheet.lastSyncedAt.slice(0, 19).replace('T', ' ')}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={syncing}
                onClick={() => void onRefreshLinkedSheet()}
                className="inline-flex items-center gap-1.5 rounded-lg brand-gradient px-3.5 py-2 text-xs font-semibold text-[#0F2238] transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                {syncing ? 'Refreshing…' : 'Refresh Now'}
              </button>
              {!inModal && (
                <button
                  type="button"
                  onClick={() => setShowBrowser((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white/10"
                >
                  <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                  {showBrowser ? 'Hide Switcher' : 'Switch Sheet'}
                </button>
              )}
              <button
                type="button"
                disabled={syncing}
                onClick={() => void onUnlinkSpreadsheet()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/35 px-3 py-2 text-xs font-medium text-rose-600 hover:bg-rose-500/10 disabled:opacity-50 dark:text-rose-400"
              >
                <Unlink className="h-3.5 w-3.5" aria-hidden="true" />
                Unlink
              </button>
            </div>
          </div>

          {/* Live Auto-Sync Controls */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/80 pt-3 text-xs dark:border-white/10">
            <label className="inline-flex cursor-pointer items-center gap-2 text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={linkedSheet.autoSyncEnabled}
                onChange={(e) =>
                  onUpdateLiveSyncSettings({ autoSyncEnabled: e.target.checked })
                }
                className="rounded accent-[#26E6D0]"
              />
              <span>
                Live Auto-Sync (automatically pulls spreadsheet updates &amp; refreshes on tab focus)
              </span>
            </label>

            <div className="flex items-center gap-2">
              <span className="text-slate-500 dark:text-slate-400">Check interval:</span>
              <select
                aria-label="Live sync check interval"
                value={linkedSheet.pollIntervalSeconds}
                disabled={!linkedSheet.autoSyncEnabled}
                onChange={(e) =>
                  onUpdateLiveSyncSettings({ pollIntervalSeconds: Number(e.target.value) })
                }
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-[#0F2238] disabled:opacity-50 dark:border-white/15 dark:bg-[#16314D] dark:text-white"
              >
                <option value={15}>Every 15 sec</option>
                <option value={30}>Every 30 sec</option>
                <option value={60}>Every 60 sec</option>
                <option value={120}>Every 2 min</option>
              </select>
            </div>
          </div>

          {!hasGoogleToken && linkedSheet.authMode !== 'public_link' && (
            <div className="mt-3 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
              Cached dashboard data is loaded locally. Click <strong>Refresh Now</strong> or sign in
              with Google below to pull new live edits from your private Google Sheet.
            </div>
          )}
        </div>
      )}

      {/* Sync Progress Bar */}
      {syncProgress && (
        <div className="mt-4">
          <div className="flex justify-between text-xs text-slate-600 dark:text-slate-300">
            <span>{syncProgress.stage}</span>
            <span className="font-mono tabular-nums">{syncProgress.pct}%</span>
          </div>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
            <div
              className="h-full rounded-full brand-gradient transition-all duration-200"
              style={{ width: `${syncProgress.pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Connection Panels: Always allow pasting a link AND picking from Google Drive */}
      {(showBrowser || !linkedSheet || inModal) && (
        <div className="mt-4 space-y-4">
          {/* Option 1: Direct Google Spreadsheet Link / ID (Works immediately for shared links & private sheets when signed in) */}
          <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 dark:border-white/10 dark:bg-[#0F2238]/60">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-[#0F2238] dark:text-white">
                Option 1 · Add Google Spreadsheet Link
              </div>
              <a
                href="https://drive.google.com/drive/search?q=type:spreadsheet"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-medium text-[#0FB8A5] hover:underline dark:text-[#26E6D0]"
              >
                Find spreadsheet in Google Drive
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            </div>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              Paste your 3-worksheet Google Sheets URL or Spreadsheet ID. Works with private Drive
              sheets when signed in, or immediately with any sheet shared as &ldquo;Anyone with the
              link (Viewer)&rdquo;.
            </p>
            <form onSubmit={handleLinkByUrlOrId} className="mt-3 flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Link2
                  className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={directInput}
                  onChange={(e) => setDirectInput(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/…/edit"
                  className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-xs text-[#0F2238] placeholder:text-slate-400 focus:border-[#26E6D0] dark:border-white/15 dark:bg-[#16314D] dark:text-white"
                />
              </div>
              <button
                type="submit"
                disabled={syncing || !directInput.trim()}
                className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg brand-gradient px-4 py-2 text-xs font-semibold text-[#0F2238] transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                {syncing ? 'Connecting…' : 'Connect Live'}
              </button>
            </form>
          </div>

          {/* Option 2: Browse & Pick Directly from Google Drive */}
          <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 dark:border-white/10 dark:bg-[#0F2238]/60">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-[#0F2238] dark:text-white">
                  Option 2 · Pick Directly from Your Google Drive
                </div>
                <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  Sign in with Google to browse your private &amp; shared Drive spreadsheets and
                  connect with one click.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {hasGoogleToken && googleUser ? (
                  <>
                    <div className="text-right text-xs">
                      <div className="font-medium text-[#0F2238] dark:text-white">
                        {googleUser.displayName || 'Google Account'}
                      </div>
                      {googleUser.email && (
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {googleUser.email}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => void onSignOut()}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-white/15 dark:text-slate-300 dark:hover:bg-white/10"
                    >
                      <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                      Sign out
                    </button>
                  </>
                ) : (
                  <GoogleSignInButton
                    onClick={() => void onSignIn()}
                    disabled={isSigningIn}
                    label={
                      isSigningIn
                        ? 'Connecting to Google…'
                        : linkedSheet
                        ? 'Reconnect Google Drive'
                        : 'Sign in with Google'
                    }
                  />
                )}
              </div>
            </div>

            {domainAuthError && !hasGoogleToken && (
              <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-100">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="font-semibold">
                      Google Sign-In popup is restricted on this preview host
                    </div>
                    <p className="text-[11px] leading-relaxed opacity-90">
                      Current domain:{' '}
                      <code className="rounded bg-black/15 px-1.5 py-0.5 font-mono">
                        {domainAuthError.hostname}
                      </code>
                      . You can immediately connect your live workbook using{' '}
                      <strong>Option 1 (Add Google Spreadsheet Link)</strong> above (share your
                      Google Sheet as &ldquo;Anyone with the link · Viewer&rdquo;), or open the app
                      from an authorized domain.
                    </p>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => void handleCopyHostname(domainAuthError.hostname)}
                        className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 px-2.5 py-1 text-[11px] font-medium hover:bg-amber-500/15"
                      >
                        <Copy className="h-3 w-3" aria-hidden="true" />
                        {copiedDomain ? 'Copied domain' : 'Copy domain'}
                      </button>
                      <a
                        href={`https://console.firebase.google.com/project/${domainAuthError.projectId}/authentication/settings`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] font-medium underline hover:opacity-80"
                      >
                        Firebase Authorized Domains
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {hasGoogleToken && (
              <div className="mt-3 space-y-3">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void loadDriveFiles(searchQuery);
                  }}
                  className="flex items-center gap-2"
                >
                  <div className="relative flex-1">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                      aria-hidden="true"
                    />
                    <input
                      type="search"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search Google Spreadsheets in your Drive…"
                      className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-xs text-[#0F2238] placeholder:text-slate-400 focus:border-[#26E6D0] dark:border-white/15 dark:bg-[#16314D] dark:text-white"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loadingDrive}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white/10"
                  >
                    {loadingDrive ? 'Searching…' : 'Search Drive'}
                  </button>
                </form>

                {driveError && (
                  <div className="rounded-lg border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-200">
                    {driveError}
                  </div>
                )}

                <div
                  className={`overflow-auto rounded-xl border border-slate-200/80 bg-white dark:border-white/10 dark:bg-[#16314D] ${
                    compact || inModal ? 'max-h-52' : 'max-h-68'
                  }`}
                >
                  {loadingDrive ? (
                    <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                      Loading Google Spreadsheets from your Drive…
                    </div>
                  ) : driveFiles.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                      No Google Spreadsheets found matching your query. Make sure your workbook is
                      saved as a Google Spreadsheet in Google Drive, or paste its link in Option 1
                      above.
                    </div>
                  ) : (
                    <table className="w-full border-collapse text-left text-xs">
                      <thead className="sticky top-0 bg-slate-100 text-slate-600 dark:bg-[#0F2238] dark:text-slate-300">
                        <tr>
                          <th className="px-3 py-2 font-medium">Spreadsheet Name</th>
                          <th className="hidden px-3 py-2 font-medium sm:table-cell">Owner</th>
                          <th className="px-3 py-2 font-medium">Last Modified</th>
                          <th className="px-3 py-2 text-right font-medium">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                        {driveFiles.map((file) => {
                          const isLinked = linkedSheet?.spreadsheetId === file.id;
                          return (
                            <tr
                              key={file.id}
                              className="hover:bg-slate-50 dark:hover:bg-white/5"
                            >
                              <td className="px-3 py-2.5 font-medium text-[#0F2238] dark:text-white">
                                <div className="flex items-center gap-2">
                                  <FileSpreadsheet
                                    className="h-4 w-4 shrink-0 text-[#0FB8A5] dark:text-[#26E6D0]"
                                    aria-hidden="true"
                                  />
                                  <span className="truncate">{file.name}</span>
                                </div>
                              </td>
                              <td className="hidden px-3 py-2.5 text-slate-500 dark:text-slate-400 sm:table-cell">
                                {file.ownerName || '—'}
                              </td>
                              <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                                {file.modifiedTime.slice(0, 16).replace('T', ' ')}
                              </td>
                              <td className="px-3 py-2.5 text-right">
                                <button
                                  type="button"
                                  disabled={syncing}
                                  onClick={() => void handlePickFile(file.id)}
                                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                                    isLinked
                                      ? 'border border-[#26E6D0] bg-[#26E6D0]/15 text-[#0FB8A5] dark:text-[#26E6D0]'
                                      : 'brand-gradient text-[#0F2238] hover:opacity-90'
                                  }`}
                                >
                                  {isLinked ? 'Sync Again' : 'Connect Live'}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
