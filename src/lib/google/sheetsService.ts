import * as XLSX from 'xlsx';
import type { RawTableSheet } from '../etl/cleaningPipeline';

export interface DriveSpreadsheetFile {
  id: string;
  name: string;
  modifiedTime: string;
  webViewLink?: string;
  ownerName?: string;
}

export interface FetchedWorkbook {
  spreadsheetId: string;
  title: string;
  sheetNames: string[];
  modifiedTime?: string;
  contentHash?: string;
  webViewLink?: string;
  rawSheets: RawTableSheet[];
}

export class GoogleAuthExpiredError extends Error {
  constructor(message = 'Your Google session has expired. Please sign in again to refresh.') {
    super(message);
    this.name = 'GoogleAuthExpiredError';
  }
}

export class PublicSheetPrivateError extends Error {
  constructor(
    message = 'This Google Spreadsheet is private or not shared publicly. Sign in with Google below to access private Drive sheets, or in Google Sheets set Share → General access → "Anyone with the link (Viewer)".'
  ) {
    super(message);
    this.name = 'PublicSheetPrivateError';
  }
}

async function googleFetchJson<T>(url: string, accessToken: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (res.status === 401) {
    throw new GoogleAuthExpiredError();
  }

  if (!res.ok) {
    let detail = `Google API error (${res.status})`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body?.error?.message) {
        detail = body.error.message;
      }
    } catch {
      // ignore JSON parse failure
    }
    if (res.status === 403 && detail.toLowerCase().includes('insufficient')) {
      throw new GoogleAuthExpiredError(
        'Additional Google Drive or Sheets permission is required. Please sign in again.'
      );
    }
    throw new Error(detail);
  }

  return (await res.json()) as T;
}

/**
 * Extracts a Google Spreadsheet ID from:
 * - Standard Google Sheets URL: https://docs.google.com/spreadsheets/d/{ID}/edit...
 * - Published-to-web URL:       https://docs.google.com/spreadsheets/d/e/2PACX-.../pubhtml
 * - Google Drive file URL:      https://drive.google.com/file/d/{ID}/view...
 * - Google Drive query URL:     https://drive.google.com/open?id={ID}
 * - Bare Spreadsheet ID
 */
export function extractSpreadsheetId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const publishedMatch = trimmed.match(/\/spreadsheets\/d\/(e\/2PACX-[a-zA-Z0-9-_]+)/);
  if (publishedMatch?.[1]) return publishedMatch[1];

  const sheetMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]{15,120})/);
  if (sheetMatch?.[1]) return sheetMatch[1];

  const driveFileMatch = trimmed.match(/\/file\/d\/([a-zA-Z0-9-_]{15,120})/);
  if (driveFileMatch?.[1]) return driveFileMatch[1];

  const queryIdMatch = trimmed.match(/[?&]id=([a-zA-Z0-9-_]{15,120})/);
  if (queryIdMatch?.[1]) return queryIdMatch[1];

  if (/^e\/2PACX-[a-zA-Z0-9-_]{20,160}$/.test(trimmed)) return trimmed;
  if (/^[a-zA-Z0-9-_]{15,120}$/.test(trimmed)) return trimmed;

  return null;
}

function buildSheetWebUrl(spreadsheetId: string): string {
  if (spreadsheetId.startsWith('e/')) {
    return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/pubhtml`;
  }
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
}

/**
 * Lists Google Spreadsheets from the user's Google Drive (supports Shared Drives too).
 */
export async function listDriveSpreadsheets(
  accessToken: string,
  searchQuery = ''
): Promise<DriveSpreadsheetFile[]> {
  const escaped = searchQuery.trim().replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const qParts = [
    "mimeType='application/vnd.google-apps.spreadsheet'",
    'trashed=false',
  ];
  if (escaped) {
    qParts.push(`name contains '${escaped}'`);
  }

  const params = new URLSearchParams({
    q: qParts.join(' and '),
    fields: 'files(id,name,modifiedTime,webViewLink,owners(displayName))',
    orderBy: 'modifiedTime desc',
    pageSize: '30',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });

  const data = await googleFetchJson<{
    files?: Array<{
      id: string;
      name: string;
      modifiedTime: string;
      webViewLink?: string;
      owners?: Array<{ displayName?: string }>;
    }>;
  }>(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, accessToken);

  return (data.files ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    modifiedTime: f.modifiedTime,
    webViewLink: f.webViewLink,
    ownerName: f.owners?.[0]?.displayName,
  }));
}

/**
 * Lightweight Drive metadata probe used by live auto-sync to detect if the spreadsheet changed
 * without transferring all worksheet rows unnecessarily.
 */
export async function getSpreadsheetDriveMetadata(
  accessToken: string,
  spreadsheetId: string
): Promise<DriveSpreadsheetFile> {
  const params = new URLSearchParams({
    fields: 'id,name,modifiedTime,webViewLink,owners(displayName)',
    supportsAllDrives: 'true',
  });

  const data = await googleFetchJson<{
    id: string;
    name: string;
    modifiedTime: string;
    webViewLink?: string;
    owners?: Array<{ displayName?: string }>;
  }>(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(spreadsheetId)}?${params.toString()}`,
    accessToken
  );

  return {
    id: data.id,
    name: data.name,
    modifiedTime: data.modifiedTime,
    webViewLink: data.webViewLink,
    ownerName: data.owners?.[0]?.displayName,
  };
}

function escapeSheetTitleForA1(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

function matrixToRawTableSheet(
  sheetName: string,
  fileName: string,
  values: unknown[][] | undefined
): RawTableSheet | null {
  if (!values || values.length < 2) return null;

  // Find the first non-empty header row
  let headerRowIdx = 0;
  while (
    headerRowIdx < values.length &&
    values[headerRowIdx].every((cell) => String(cell ?? '').trim() === '')
  ) {
    headerRowIdx += 1;
  }
  if (headerRowIdx >= values.length - 1) return null;

  const rawHeaders = values[headerRowIdx].map((h, i) => {
    const cleaned = String(h ?? '').trim();
    return cleaned || `Column_${i + 1}`;
  });

  const rows: Array<Record<string, unknown>> = [];
  for (let r = headerRowIdx + 1; r < values.length; r++) {
    const rowArr = values[r];
    if (
      !rowArr ||
      rowArr.every((cell) => cell === null || cell === undefined || String(cell).trim() === '')
    ) {
      continue;
    }
    const obj: Record<string, unknown> = {};
    for (let c = 0; c < rawHeaders.length; c++) {
      obj[rawHeaders[c]] = c < rowArr.length ? rowArr[c] : '';
    }
    rows.push(obj);
  }

  if (rows.length === 0) return null;

  return {
    sheetName,
    fileName,
    headers: rawHeaders,
    rows,
  };
}

/**
 * Fetches metadata and ALL worksheets (e.g. Transactions, Stores, Products) of a Google Spreadsheet
 * via authenticated Google Sheets API v4 in one atomic batchGet call.
 */
export async function fetchGoogleSpreadsheetWorkbook(
  accessToken: string,
  spreadsheetId: string,
  onProgress?: (pct: number, stage: string) => void
): Promise<FetchedWorkbook> {
  if (spreadsheetId.startsWith('e/')) {
    const pub = await fetchPublicGoogleSpreadsheetWorkbook(spreadsheetId, { onProgress });
    if (pub.unchanged) {
      throw new Error('Published spreadsheet returned unchanged unexpectedly.');
    }
    return pub.workbook;
  }

  onProgress?.(10, 'Reading Google Spreadsheet metadata & worksheets');

  const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId
  )}?fields=spreadsheetId,properties.title,spreadsheetUrl,sheets.properties(sheetId,title)`;

  let meta: {
    spreadsheetId: string;
    spreadsheetUrl?: string;
    properties?: { title?: string };
    sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
  };
  let driveMeta: DriveSpreadsheetFile | null = null;

  try {
    [meta, driveMeta] = await Promise.all([
      googleFetchJson<typeof meta>(metaUrl, accessToken),
      getSpreadsheetDriveMetadata(accessToken, spreadsheetId).catch(() => null),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.toLowerCase().includes('not supported for this document')) {
      // File in Google Drive is an uploaded Excel (.xlsx) workbook rather than a native Google Sheet
      try {
        const pub = await fetchPublicGoogleSpreadsheetWorkbook(spreadsheetId, { onProgress });
        if (!pub.unchanged) {
          return pub.workbook;
        }
      } catch {
        throw new Error(
          'This file is an uploaded Excel (.xlsx) file in Google Drive. In Google Sheets, click File → Save as Google Sheets, or share it as "Anyone with the link (Viewer)" to sync live.'
        );
      }
    }
    throw err;
  }

  const title = driveMeta?.name || meta.properties?.title || 'Linked Google Spreadsheet';
  const sheetNames = (meta.sheets ?? [])
    .map((s) => s.properties?.title)
    .filter((t): t is string => Boolean(t));

  if (sheetNames.length === 0) {
    throw new Error('This Google Spreadsheet contains no worksheets.');
  }

  onProgress?.(35, `Downloading ${sheetNames.length} worksheet(s): ${sheetNames.join(', ')}`);

  const batchParams = new URLSearchParams({
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });
  for (const name of sheetNames) {
    batchParams.append('ranges', escapeSheetTitleForA1(name));
  }

  const batchData = await googleFetchJson<{
    valueRanges?: Array<{
      range?: string;
      values?: unknown[][];
    }>;
  }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values:batchGet?${batchParams.toString()}`,
    accessToken
  );

  onProgress?.(60, 'Parsing all worksheets for cleaning pipeline');

  const rawSheets: RawTableSheet[] = [];
  const valueRanges = batchData.valueRanges ?? [];
  for (let i = 0; i < sheetNames.length; i++) {
    const sheetTitle = sheetNames[i];
    const values = valueRanges[i]?.values;
    const parsed = matrixToRawTableSheet(sheetTitle, `${title} (Google Sheets)`, values);
    if (parsed) {
      rawSheets.push(parsed);
    }
  }

  return {
    spreadsheetId: meta.spreadsheetId || spreadsheetId,
    title,
    sheetNames,
    modifiedTime: driveMeta?.modifiedTime,
    webViewLink: driveMeta?.webViewLink || meta.spreadsheetUrl || buildSheetWebUrl(spreadsheetId),
    rawSheets,
  };
}

// ============================================================================
// Browser-Native Google Visualization JSONP Fallback (zero CORS, zero backend)
// ============================================================================

interface GvizCell {
  v?: unknown;
  f?: string;
}

interface GvizResponse {
  status?: string;
  sig?: string;
  errors?: Array<{ reason?: string; message?: string; detailed_message?: string }>;
  table?: {
    cols?: Array<{ id?: string; label?: string; type?: string }>;
    rows?: Array<{ c?: Array<GvizCell | null> }>;
  };
}

function parseGvizCellValue(cell: GvizCell | null | undefined, colType?: string): unknown {
  if (!cell || (cell.v === null || cell.v === undefined)) {
    return cell?.f ?? '';
  }
  if (colType === 'date' || colType === 'datetime') {
    if (typeof cell.v === 'string') {
      const m = cell.v.match(/^Date\((\d+),(\d+),(\d+)/);
      if (m) {
        const y = Number(m[1]);
        const mo = String(Number(m[2]) + 1).padStart(2, '0');
        const d = String(Number(m[3])).padStart(2, '0');
        return `${y}-${mo}-${d}`;
      }
    }
    return cell.f ?? String(cell.v);
  }
  return cell.v;
}

function gvizTableToRawSheet(
  sheetName: string,
  fileName: string,
  resp: GvizResponse
): RawTableSheet | null {
  const cols = resp.table?.cols ?? [];
  const gvizRows = resp.table?.rows ?? [];
  if (cols.length === 0 || gvizRows.length === 0) return null;

  const colLabels = cols.map((c) => (c.label || '').trim());
  const hasExplicitLabels = colLabels.filter(Boolean).length >= Math.min(2, cols.length);

  if (hasExplicitLabels) {
    const headers = colLabels.map((l, i) => l || `Column_${i + 1}`);
    const rows: Array<Record<string, unknown>> = [];
    for (const r of gvizRows) {
      const cells = r.c ?? [];
      const obj: Record<string, unknown> = {};
      let nonEmpty = false;
      for (let i = 0; i < headers.length; i++) {
        const val = parseGvizCellValue(cells[i], cols[i]?.type);
        if (val !== '' && val !== null && val !== undefined) nonEmpty = true;
        obj[headers[i]] = val;
      }
      if (nonEmpty) rows.push(obj);
    }
    if (rows.length === 0) return null;
    return { sheetName, fileName, headers, rows };
  }

  // Otherwise first data row contains headers
  const matrix: unknown[][] = gvizRows.map((r) =>
    cols.map((col, i) => parseGvizCellValue(r.c?.[i], col.type))
  );
  return matrixToRawTableSheet(sheetName, fileName, matrix);
}

function fetchSingleGvizSheetJsonp(
  spreadsheetId: string,
  sheetName?: string
): Promise<GvizResponse> {
  return new Promise((resolve, reject) => {
    const cbName = `__msGviz_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const win = window as unknown as Record<string, unknown>;
    const script = document.createElement('script');
    let settled = false;

    const cleanup = () => {
      if (script.parentNode) script.parentNode.removeChild(script);
      try {
        delete win[cbName];
      } catch {
        win[cbName] = undefined;
      }
    };

    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new PublicSheetPrivateError());
    }, 12000);

    win[cbName] = (data: GvizResponse) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      cleanup();
      if (data?.status === 'error') {
        const reason = data.errors?.[0]?.reason || '';
        if (reason === 'access_denied' || reason === 'not_modified') {
          reject(new PublicSheetPrivateError());
        } else {
          reject(
            new Error(
              data.errors?.[0]?.detailed_message ||
                data.errors?.[0]?.message ||
                'Unable to read Google Spreadsheet.'
            )
          );
        }
        return;
      }
      resolve(data);
    };

    const base = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq`;
    const params = new URLSearchParams({
      tqx: `out:json;responseHandler:${cbName}`,
    });
    if (sheetName) {
      params.set('sheet', sheetName);
    }
    script.src = `${base}?${params.toString()}`;
    script.async = true;
    script.onerror = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      cleanup();
      reject(new PublicSheetPrivateError());
    };
    document.head.appendChild(script);
  });
}

async function fetchPublicWorkbookViaGvizJsonp(
  spreadsheetId: string,
  options?: {
    ifHash?: string;
    onProgress?: (pct: number, stage: string) => void;
  }
): Promise<{ unchanged: true } | { unchanged: false; workbook: FetchedWorkbook }> {
  options?.onProgress?.(20, 'Connecting directly to Google Sheets');

  const seenSigs = new Set<string>();
  const rawSheets: RawTableSheet[] = [];
  const sheetNames: string[] = [];
  const sigParts: string[] = [];

  const candidateTabNames: Array<{ query?: string; label: string }> = [
    { query: undefined, label: 'Transactions' },
    { query: 'Transactions', label: 'Transactions' },
    { query: 'Stores', label: 'Stores' },
    { query: 'Products', label: 'Products' },
    { query: 'Store', label: 'Stores' },
    { query: 'Product', label: 'Products' },
  ];

  // Probe the primary worksheet first so private/invalid sheets fail immediately
  const firstResp = await fetchSingleGvizSheetJsonp(spreadsheetId);
  if (firstResp.sig) {
    seenSigs.add(firstResp.sig);
    sigParts.push(firstResp.sig);
  }
  const firstParsed = gvizTableToRawSheet('Transactions', 'Linked Google Spreadsheet', firstResp);
  if (firstParsed) {
    rawSheets.push(firstParsed);
    sheetNames.push('Transactions');
  }

  options?.onProgress?.(40, 'Loading Stores and Products worksheets');

  // Probe additional tabs in parallel and keep only distinct worksheets (by Google sig)
  const extraTargets = candidateTabNames.slice(1);
  const extraResults = await Promise.allSettled(
    extraTargets.map((t) => fetchSingleGvizSheetJsonp(spreadsheetId, t.query))
  );

  for (let i = 0; i < extraResults.length; i++) {
    const res = extraResults[i];
    const target = extraTargets[i];
    if (res.status !== 'fulfilled') continue;
    const data = res.value;
    if (data.sig && seenSigs.has(data.sig)) continue;
    if (data.sig) {
      seenSigs.add(data.sig);
      sigParts.push(`${target.label}:${data.sig}`);
    }
    const parsed = gvizTableToRawSheet(target.label, 'Linked Google Spreadsheet', data);
    if (parsed) {
      rawSheets.push(parsed);
      sheetNames.push(target.label);
    }
  }

  const combinedHash = `gviz:${sigParts.join('|')}`;
  if (options?.ifHash && options.ifHash === combinedHash) {
    return { unchanged: true };
  }

  if (rawSheets.length === 0) {
    throw new PublicSheetPrivateError();
  }

  options?.onProgress?.(60, `Loaded ${sheetNames.length} worksheet(s): ${sheetNames.join(', ')}`);

  return {
    unchanged: false,
    workbook: {
      spreadsheetId,
      title: 'Linked Google Spreadsheet',
      sheetNames,
      contentHash: combinedHash,
      webViewLink: buildSheetWebUrl(spreadsheetId),
      rawSheets,
    },
  };
}

/**
 * Fetches ALL worksheets of a link-shared Google Spreadsheet ("Anyone with the link can view").
 * Uses the Express /api/sheets/public-workbook proxy first (full multi-sheet .xlsx + Drive Excel support),
 * and seamlessly falls back to browser-native Google Visualization JSONP if the API route is unavailable.
 */
export async function fetchPublicGoogleSpreadsheetWorkbook(
  spreadsheetId: string,
  options?: {
    ifHash?: string;
    onProgress?: (pct: number, stage: string) => void;
  }
): Promise<{ unchanged: true } | { unchanged: false; workbook: FetchedWorkbook }> {
  options?.onProgress?.(15, 'Downloading live Google Spreadsheet workbook');

  const params = new URLSearchParams({ spreadsheetId });
  if (options?.ifHash && !options.ifHash.startsWith('gviz:')) {
    params.set('ifHash', options.ifHash);
  }

  let shouldFallbackToGviz = false;

  try {
    const res = await fetch(`/api/sheets/public-workbook?${params.toString()}`, {
      cache: 'no-store',
    });

    const contentType = (res.headers.get('content-type') || '').toLowerCase();

    if (!res.ok) {
      if (contentType.includes('application/json')) {
        const payload = (await res.json()) as { code?: string; error?: string };
        if (res.status === 403 && payload.code === 'PRIVATE_SHEET') {
          throw new PublicSheetPrivateError(payload.error);
        }
        if (res.status === 404 && payload.code === 'SHEET_NOT_FOUND') {
          throw new PublicSheetPrivateError(payload.error);
        }
        throw new Error(payload.error || `Failed to load Google Spreadsheet (${res.status}).`);
      }
      // Non-JSON 404/502 means backend proxy route isn't mounted on this host -> use direct browser JSONP
      shouldFallbackToGviz = true;
    } else if (contentType.includes('application/json')) {
      const json = (await res.json()) as { unchanged?: boolean };
      if (json.unchanged) {
        return { unchanged: true };
      }
    } else if (
      contentType.includes('spreadsheetml') ||
      contentType.includes('octet-stream')
    ) {
      options?.onProgress?.(45, 'Parsing all worksheets (Transactions, Stores, Products)');

      const contentHash = res.headers.get('X-Content-Hash') || undefined;
      const rawTitleHeader = res.headers.get('X-Workbook-Title');
      let title = 'Linked Google Spreadsheet';
      if (rawTitleHeader) {
        try {
          title = decodeURIComponent(rawTitleHeader);
        } catch {
          title = rawTitleHeader;
        }
      }

      const arrayBuffer = await res.arrayBuffer();
      const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: false });
      const sheetNames = wb.SheetNames ?? [];

      if (sheetNames.length === 0) {
        throw new Error('This Google Spreadsheet contains no worksheets.');
      }

      const rawSheets: RawTableSheet[] = [];
      for (const sheetTitle of sheetNames) {
        const ws = wb.Sheets[sheetTitle];
        if (!ws) continue;
        const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, {
          header: 1,
          defval: '',
          raw: true,
        });
        const parsed = matrixToRawTableSheet(sheetTitle, `${title} (Google Sheets)`, matrix);
        if (parsed) {
          rawSheets.push(parsed);
        }
      }

      options?.onProgress?.(
        60,
        `Loaded ${sheetNames.length} worksheet(s): ${sheetNames.join(', ')}`
      );

      return {
        unchanged: false,
        workbook: {
          spreadsheetId,
          title,
          sheetNames,
          contentHash,
          webViewLink: buildSheetWebUrl(spreadsheetId),
          rawSheets,
        },
      };
    } else {
      // Unexpected HTML response from static SPA fallback -> use direct browser JSONP
      shouldFallbackToGviz = true;
    }
  } catch (err) {
    if (err instanceof PublicSheetPrivateError) {
      throw err;
    }
    if (err instanceof TypeError) {
      shouldFallbackToGviz = true;
    } else if (!shouldFallbackToGviz) {
      throw err;
    }
  }

  if (shouldFallbackToGviz) {
    return fetchPublicWorkbookViaGvizJsonp(spreadsheetId, options);
  }

  throw new PublicSheetPrivateError();
}
