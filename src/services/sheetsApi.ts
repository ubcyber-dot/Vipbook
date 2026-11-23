import {
  CategoryConfig,
  CategorySheetResult,
  DriveFilterMode,
  ExpenseRecord,
  SpreadsheetFileItem,
  SpreadsheetMetadata,
} from '../types/booking';
import { getAccessToken, getPersistentUser } from './auth';

export interface BatchReadResponse {
  spreadsheetId: string;
  spreadsheetTitle: string;
  spreadsheetUrl?: string;
  availableSheets: string[];
  categoryResults: CategorySheetResult[];
  fetchedAt: string;
}

export interface TemplateSheetPayload {
  categoryId: string;
  categoryName: string;
  sheetName: string;
  rows?: string[][];
  formulaRows?: string[][];
  csvContent?: string;
  fileName?: string;
}

export interface CloudSystemState {
  categories: CategoryConfig[];
  categoryResults: CategorySheetResult[];
  expenses: ExpenseRecord[];
  spreadsheetTitle: string;
  availableSheets: string[];
  updatedAt: string;
}

export interface CloudStateReadResponse {
  found: boolean;
  fileId?: string;
  fileName?: string;
  modifiedTime?: string;
  state?: CloudSystemState;
}

export interface CloudStateSaveResponse {
  saved: boolean;
  savedToGoogleDrive?: boolean;
  storageTarget?: 'google_drive' | 'server_local';
  fileId: string;
  fileName: string;
  webViewLink?: string;
  modifiedTime: string;
}

async function fetchWithAuth<T>(
  url: string,
  options: RequestInit = {},
  requireAuth = false
): Promise<T> {
  const token = await getAccessToken();
  if (requireAuth && !token) {
    const err = new Error('กรุณาเข้าสู่ระบบด้วยบัญชี Google เพื่อเชื่อมต่อ Google Drive และ Google Sheets');
    (err as any).code = 'UNAUTHENTICATED';
    throw err;
  }

  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      const authErr = new Error(
        data?.error || 'คุณไม่มีสิทธิ์เข้าถึงไฟล์นี้ กรุณาตรวจสอบสิทธิ์หรือเข้าสู่ระบบด้วย Google อีกครั้ง'
      );
      (authErr as any).code = res.status === 401 ? 'UNAUTHENTICATED' : 'PERMISSION_DENIED';
      throw authErr;
    }
    throw new Error(data?.error || `เกิดข้อผิดพลาดในการเชื่อมต่อ (HTTP ${res.status})`);
  }

  return data as T;
}

export async function listDriveSpreadsheets(
  searchQuery = '',
  filterMode: DriveFilterMode = 'sharedWithMe'
): Promise<SpreadsheetFileItem[]> {
  const params = new URLSearchParams();
  if (searchQuery.trim()) {
    params.set('q', searchQuery.trim());
  }
  params.set('filter', filterMode);
  const queryStr = params.toString() ? `?${params.toString()}` : '';
  const data = await fetchWithAuth<{ files: SpreadsheetFileItem[] }>(
    `/api/drive/spreadsheets${queryStr}`,
    {},
    false
  );
  return data.files || [];
}

export async function fetchSpreadsheetMetadata(spreadsheetId: string): Promise<SpreadsheetMetadata> {
  return fetchWithAuth<SpreadsheetMetadata>(
    `/api/sheets/${encodeURIComponent(spreadsheetId)}/metadata`,
    {},
    false
  );
}

export async function fetchAllCategorySheets(
  spreadsheetId: string,
  categories: CategoryConfig[]
): Promise<BatchReadResponse> {
  return fetchWithAuth<BatchReadResponse>(
    `/api/sheets/${encodeURIComponent(spreadsheetId)}/batch-read`,
    {
      method: 'POST',
      body: JSON.stringify({
        categories: categories.map((c) => ({
          id: c.id,
          name: c.name,
          sheetName: c.sheetName,
        })),
      }),
    },
    false
  );
}

export async function importFromTemplateSheets(
  categories: CategoryConfig[],
  sheets: TemplateSheetPayload[],
  title?: string,
  availableSheets?: string[]
): Promise<BatchReadResponse> {
  return fetchWithAuth<BatchReadResponse>(
    '/api/sheets/import-template',
    {
      method: 'POST',
      body: JSON.stringify({
        title: title || 'นำเข้าจากแม่แบบ Excel (VIP & Standard)',
        availableSheets,
        categories: categories.map((c) => ({
          id: c.id,
          name: c.name,
          sheetName: c.sheetName,
        })),
        sheets,
      }),
    },
    false
  );
}

export async function loadCloudStateFromDrive(email?: string | null): Promise<CloudStateReadResponse> {
  const targetEmail = email || getPersistentUser()?.email || 'ubcyber@gmail.com';
  return fetchWithAuth<CloudStateReadResponse>(
    `/api/drive/cloud-state?email=${encodeURIComponent(targetEmail)}`,
    {},
    false
  );
}

export async function saveCloudStateToDrive(
  state: CloudSystemState,
  fileId?: string | null,
  email?: string | null
): Promise<CloudStateSaveResponse> {
  const targetEmail = email || getPersistentUser()?.email || 'ubcyber@gmail.com';
  return fetchWithAuth<CloudStateSaveResponse>(
    '/api/drive/cloud-state',
    {
      method: 'POST',
      body: JSON.stringify({
        email: targetEmail,
        fileId: fileId || undefined,
        state,
      }),
    },
    false
  );
}

export async function syncStateToNewGoogleSheet(
  categories: CategoryConfig[],
  categoryResults: CategorySheetResult[],
  expenses: ExpenseRecord[],
  title?: string
): Promise<{ spreadsheetId: string; spreadsheetUrl: string; title: string }> {
  return fetchWithAuth<{ spreadsheetId: string; spreadsheetUrl: string; title: string }>(
    '/api/drive/sync-google-sheet',
    {
      method: 'POST',
      body: JSON.stringify({
        categories,
        categoryResults,
        expenses,
        title,
      }),
    },
    true
  );
}
