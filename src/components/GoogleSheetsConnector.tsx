import React, { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  CheckCircle2,
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
import {
  extractSpreadsheetId,
  GoogleAuthExpiredError,
  listDriveSpreadsheets,
  type DriveSpreadsheetFile,
} from '../lib/google/sheetsService';

interface GoogleSheetsConnectorProps {
  googleUser: User | null;
  hasGoogleToken: boolean;
  isSigningIn: boolean;
  syncing: boolean;
  syncProgress: { pct: number; stage: string } | null;
  linkedSheet: LinkedGoogleSheet | null;
  onSignIn: () => Promise<string | null>;
  onSignOut: () => Promise<void>;
  onLinkSpreadsheet: (spreadsheetId: string) => Promise<void>;
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
}) => {
  const [showBrowser, setShowBrowser] = useState(!linkedSheet);
  const [driveFiles, setDriveFiles] = useState<DriveSpreadsheetFile[]>([]);
  const [loadingDrive, setLoadingDrive] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [directInput, setDirectInput] = useState('');
  const [driveError, setDriveError] = useState<string | null>(null);

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
      loadDriveFiles('');
    }
  }, [hasGoogleToken, showBrowser, linkedSheet, loadDriveFiles]);

  const handleLinkByUrlOrId = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = extractSpreadsheetId(directInput);
    if (!id) {
      onNotify('Enter a valid Google Sheets URL or Spreadsheet ID.', 'error');
      return;
    }
    await onLinkSpreadsheet(id);
    setDirectInput('');
    setShowBrowser(false);
  };

  const handlePickFile = async (fileId: string) => {
    await onLinkSpreadsheet(fileId);
    setShowBrowser(false);
  };

  return (
    <section className="rounded-[16px] border border-slate-200/90 bg-white p-5 dark:border-white/10 dark:bg-[#16314D]">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200/80 pb-4 dark:border-white/10">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl brand-gradient text-[#0F2238]">
            <FileSpreadsheet className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h3 className="font-display text-base font-semibold text-[#0F2238] dark:text-white">
              Google Drive Live Spreadsheet Connection
            </h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Connect a 3-worksheet Google Spreadsheet (Transactions, Stores, Products) directly from Google Drive. Updates in your spreadsheet reflect live on the dashboard.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {hasGoogleToken && googleUser ? (
            <>
              <div className="text-right text-xs">
                <div className="font-medium text-[#0F2238] dark:text-white">
                  {googleUser.displayName || 'Google Account'}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  {googleUser.email}
                </div>
              </div>
              <button
                type="button"
                onClick={onSignOut}
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
                  ? 'Reconnect Google Account'
                  : 'Sign in with Google'
              }
            />
          )}
        </div>
      </div>

      {/* Linked Workbook Active Status Card */}
      {linkedSheet && (
        <div className="mt-4 rounded-xl border border-[#26E6D0]/40 bg-slate-50/80 p-4 dark:bg-[#0F2238]/75">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-[#0FB8A5] dark:text-[#26E6D0]" aria-hidden="true" />
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
                    Open Sheet
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
              <button
                type="button"
                onClick={() => setShowBrowser((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white/10"
              >
                <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                {showBrowser ? 'Hide Drive Browser' : 'Switch Sheet'}
              </button>
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
                Live Auto-Sync (automatically checks Google Drive for spreadsheet edits &amp; syncs on tab focus)
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

          {!hasGoogleToken && (
            <div className="mt-3 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
              Cached dashboard data is loaded locally. Click <strong>Refresh Now</strong> or{' '}
              <strong>Reconnect Google Account</strong> to pull new live edits from Google Sheets.
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

      {/* Drive Spreadsheet Browser */}
      {hasGoogleToken && (showBrowser || !linkedSheet) && (
        <div className="mt-5 space-y-4">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
            {/* Search Drive */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void loadDriveFiles(searchQuery);
              }}
              className="flex items-center gap-2 lg:col-span-6"
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
                  className="w-full rounded-lg border border-slate-300 bg-slate-50 py-2 pl-9 pr-3 text-xs text-[#0F2238] placeholder:text-slate-400 focus:border-[#26E6D0] dark:border-white/15 dark:bg-[#0F2238] dark:text-white"
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

            {/* Paste direct Google Sheets URL or ID */}
            <form onSubmit={handleLinkByUrlOrId} className="flex items-center gap-2 lg:col-span-6">
              <div className="relative flex-1">
                <Link2
                  className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={directInput}
                  onChange={(e) => setDirectInput(e.target.value)}
                  placeholder="Or paste Google Sheets URL / Spreadsheet ID…"
                  className="w-full rounded-lg border border-slate-300 bg-slate-50 py-2 pl-9 pr-3 text-xs text-[#0F2238] placeholder:text-slate-400 focus:border-[#26E6D0] dark:border-white/15 dark:bg-[#0F2238] dark:text-white"
                />
              </div>
              <button
                type="submit"
                disabled={syncing || !directInput.trim()}
                className="whitespace-nowrap rounded-lg brand-gradient px-3.5 py-2 text-xs font-semibold text-[#0F2238] disabled:opacity-50"
              >
                Link URL
              </button>
            </form>
          </div>

          {driveError && (
            <div className="rounded-lg border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-200">
              {driveError}
            </div>
          )}

          {/* Spreadsheet List */}
          <div
            className={`overflow-auto rounded-xl border border-slate-200/80 dark:border-white/10 ${
              compact ? 'max-h-56' : 'max-h-72'
            }`}
          >
            {loadingDrive ? (
              <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                Loading Google Spreadsheets from your Drive…
              </div>
            ) : driveFiles.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                No Google Spreadsheets found matching your query. Make sure your workbook is saved as a Google Spreadsheet in Google Drive, or paste its URL above.
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
                            {isLinked ? 'Sync Again' : 'Link & Sync'}
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

      {!hasGoogleToken && !linkedSheet && (
        <div className="mt-4 rounded-xl border border-dashed border-slate-300/80 bg-slate-50/60 p-5 text-center text-xs text-slate-600 dark:border-white/15 dark:bg-[#0F2238]/40 dark:text-slate-300">
          Sign in with Google above to browse your Google Drive and link your Metro Superstore 3-worksheet spreadsheet (Transactions, Stores, Products).
        </div>
      )}
    </section>
  );
};
