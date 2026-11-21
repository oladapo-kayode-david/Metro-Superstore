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
    message = 'This Google Spreadsheet is private. Sign in with Google to access private Drive sheets, or set Share to "Anyone with the link (Viewer)".'
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
 * Extracts a Google Spreadsheet ID from either a full Google Sheets URL or a bare ID string.
 */
export function extractSpreadsheetId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const urlMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (urlMatch?.[1]) return urlMatch[1];
  if (/^[a-zA-Z0-9-_]{15,120}$/.test(trimmed)) return trimmed;
  return null;
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
  onProgress?.(10, 'Reading Google Spreadsheet metadata & worksheets');

  const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId
  )}?fields=spreadsheetId,properties.title,spreadsheetUrl,sheets.properties(sheetId,title)`;

  const [meta, driveMeta] = await Promise.all([
    googleFetchJson<{
      spreadsheetId: string;
      spreadsheetUrl?: string;
      properties?: { title?: string };
      sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
    }>(metaUrl, accessToken),
    getSpreadsheetDriveMetadata(accessToken, spreadsheetId).catch(() => null),
  ]);

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
    webViewLink:
      driveMeta?.webViewLink ||
      meta.spreadsheetUrl ||
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    rawSheets,
  };
}

/**
 * Fetches ALL worksheets of a link-shared Google Spreadsheet ("Anyone with the link can view")
 * via the server proxy (/api/sheets/public-workbook) and parses every worksheet into RawTableSheet[].
 * Supports SHA-256 content hash checks for lightweight live auto-sync polling.
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
  if (options?.ifHash) {
    params.set('ifHash', options.ifHash);
  }

  const res = await fetch(`/api/sheets/public-workbook?${params.toString()}`, {
    cache: 'no-store',
  });

  const contentType = (res.headers.get('content-type') || '').toLowerCase();

  if (!res.ok) {
    let payload: { code?: string; error?: string } = {};
    try {
      payload = (await res.json()) as { code?: string; error?: string };
    } catch {
      // ignore parse failure
    }
    if (res.status === 403 && payload.code === 'PRIVATE_SHEET') {
      throw new PublicSheetPrivateError(payload.error);
    }
    throw new Error(payload.error || `Failed to load Google Spreadsheet (${res.status}).`);
  }

  if (contentType.includes('application/json')) {
    const json = (await res.json()) as { unchanged?: boolean };
    if (json.unchanged) {
      return { unchanged: true };
    }
  }

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

  options?.onProgress?.(60, `Loaded ${sheetNames.length} worksheet(s): ${sheetNames.join(', ')}`);

  return {
    unchanged: false,
    workbook: {
      spreadsheetId,
      title,
      sheetNames,
      contentHash,
      webViewLink: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
      rawSheets,
    },
  };
}
