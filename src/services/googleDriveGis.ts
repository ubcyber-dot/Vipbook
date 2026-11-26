/**
 * Real Google Identity Services (GIS) OAuth 2.0 + Google Drive API v3 Integration
 *
 * Features:
 * - Persistent Google Drive Session in localStorage (access_token, expires_at, user profile/email)
 *   so the user remains signed in across page reloads until explicitly clicking Sign Out / Disconnect.
 * - Automatic Silent Token Renewal via GIS (`requestAccessToken({ prompt: '', hint: savedEmail })`)
 *   when the stored token is expired or when Google Drive API returns HTTP 401 Unauthorized,
 *   seamlessly retrying the failed request once.
 * - Real Google Drive API v3 operations:
 *   - List backups: GET https://www.googleapis.com/drive/v3/files
 *   - Download backup: GET https://www.googleapis.com/drive/v3/files/{fileId}?alt=media
 *   - Create file: POST https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart
 *   - Update existing file: PATCH https://www.googleapis.com/upload/drive/v3/files/{fileId}?uploadType=multipart
 */

import firebaseConfig from '../../firebase-applet-config.json';

export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const CANONICAL_JSON_BACKUP_FILENAME = 'Seat_Booking_System_Backup.json';
export const CANONICAL_EXCEL_EXPORT_FILENAME = 'Seat_Bookings_VIP_Standard.xlsx';

const STORAGE_KEY_GDRIVE_CLIENT_ID = 'seat_lookup_gdrive_client_id_v1';
const STORAGE_KEY_GDRIVE_SESSION = 'seat_lookup_gdrive_session_v1';
const STORAGE_KEY_GDRIVE_ACTIVE_FILES = 'seat_lookup_gdrive_active_files_v1';
const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';

export interface DriveConnectedUser {
  displayName?: string;
  emailAddress?: string;
  photoLink?: string;
}

export interface DriveUploadedFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string;
  modifiedTime?: string;
  size?: string;
}

export interface ActiveDriveFilesMap {
  json?: DriveUploadedFile;
  xlsx?: DriveUploadedFile;
}

export interface DriveConnectionState {
  /** True as long as a persistent Google Drive session exists (until manual Sign Out) */
  connected: boolean;
  /** True when the current access_token is still within its validity window */
  tokenValid: boolean;
  /** True while an automatic silent token renewal is in progress */
  isRefreshing: boolean;
  /** True if silent refresh failed and user needs to click Reconnect */
  needsReauth: boolean;
  expiresAt: number | null;
  clientId: string;
  user: DriveConnectedUser | null;
}

interface PersistedDriveSession {
  access_token: string;
  expires_at: number;
  client_id: string;
  user: DriveConnectedUser | null;
}

interface GisTokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
  error_uri?: string;
}

interface GisErrorResponse {
  type?: string;
  message?: string;
}

interface GisTokenClient {
  requestAccessToken: (overrideConfig?: {
    prompt?: string;
    hint?: string;
    login_hint?: string;
  }) => void;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            hint?: string;
            callback: (response: GisTokenResponse) => void;
            error_callback?: (error: GisErrorResponse) => void;
          }) => GisTokenClient;
          revoke: (token: string, done?: () => void) => void;
        };
      };
    };
  }
}

// Active session state (hydrated immediately from localStorage on module load)
let currentToken: string | null = null;
let currentExpiresAt: number | null = null;
let currentClientId = '';
let currentDriveUser: DriveConnectedUser | null = null;
let isRefreshingToken = false;
let sessionNeedsReauth = false;

// Deduplicate concurrent silent refresh attempts
let inFlightSilentRefresh: Promise<string> | null = null;

type ConnectionListener = (state: DriveConnectionState) => void;
const listeners = new Set<ConnectionListener>();

function emitConnectionChange() {
  const snapshot = getDriveConnectionState();
  listeners.forEach((cb) => cb(snapshot));
}

export function subscribeDriveConnection(listener: ConnectionListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getDefaultAppletClientId(): string {
  return String((firebaseConfig as { oAuthClientId?: string })?.oAuthClientId || '').trim();
}

export function getStoredDriveClientId(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_GDRIVE_CLIENT_ID);
    if (saved && saved.trim()) {
      return saved.trim();
    }
  } catch {
    // ignore storage read errors
  }
  return getDefaultAppletClientId();
}

export function hasCustomStoredDriveClientId(): boolean {
  try {
    return Boolean(localStorage.getItem(STORAGE_KEY_GDRIVE_CLIENT_ID)?.trim());
  } catch {
    return false;
  }
}

function persistSessionToStorage() {
  if (!currentToken || !currentExpiresAt) return;
  const payload: PersistedDriveSession = {
    access_token: currentToken,
    expires_at: currentExpiresAt,
    client_id: currentClientId || getStoredDriveClientId(),
    user: currentDriveUser,
  };
  try {
    localStorage.setItem(STORAGE_KEY_GDRIVE_SESSION, JSON.stringify(payload));
  } catch {
    // ignore storage write quota errors
  }
}

function clearPersistedSessionStorage() {
  try {
    localStorage.removeItem(STORAGE_KEY_GDRIVE_SESSION);
  } catch {
    // ignore
  }
}

/**
 * Restores a previously signed-in Google Drive session from localStorage on page load/refresh.
 * Even if expires_at has passed, the session stays active so silent renewal runs automatically
 * on the next Drive API call without forcing a full logout.
 */
export function hydrateSessionFromStorage(): DriveConnectionState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_GDRIVE_SESSION);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedDriveSession>;
      if (parsed && typeof parsed.access_token === 'string' && parsed.access_token.trim()) {
        currentToken = parsed.access_token;
        currentExpiresAt =
          typeof parsed.expires_at === 'number' && Number.isFinite(parsed.expires_at)
            ? parsed.expires_at
            : 0;
        currentClientId =
          typeof parsed.client_id === 'string' && parsed.client_id.trim()
            ? parsed.client_id.trim()
            : getStoredDriveClientId();
        currentDriveUser =
          parsed.user && typeof parsed.user === 'object' ? parsed.user : null;
        sessionNeedsReauth = false;
      }
    }
  } catch {
    // ignore malformed storage entry
  }
  return getDriveConnectionState();
}

// Immediately restore persisted session on app boot
hydrateSessionFromStorage();

export function getActiveDriveFiles(): ActiveDriveFilesMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_GDRIVE_ACTIVE_FILES);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as ActiveDriveFilesMap;
    }
  } catch {
    // ignore
  }
  return {};
}

export function saveActiveDriveFile(
  format: 'json' | 'xlsx',
  file: DriveUploadedFile
): ActiveDriveFilesMap {
  const existing = getActiveDriveFiles();
  const next: ActiveDriveFilesMap = {
    ...existing,
    [format]: file,
  };
  try {
    localStorage.setItem(STORAGE_KEY_GDRIVE_ACTIVE_FILES, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

export function clearActiveDriveFiles() {
  try {
    localStorage.removeItem(STORAGE_KEY_GDRIVE_ACTIVE_FILES);
  } catch {
    // ignore
  }
}

export function saveDriveClientId(clientId: string): string {
  const cleaned = clientId.trim();
  try {
    if (cleaned) {
      localStorage.setItem(STORAGE_KEY_GDRIVE_CLIENT_ID, cleaned);
    } else {
      localStorage.removeItem(STORAGE_KEY_GDRIVE_CLIENT_ID);
    }
  } catch {
    // ignore storage errors
  }

  // If the user explicitly changed to a different Client ID, invalidate old session token
  if (currentToken && currentClientId && cleaned && currentClientId !== cleaned) {
    currentToken = null;
    currentExpiresAt = null;
    currentClientId = cleaned;
    currentDriveUser = null;
    sessionNeedsReauth = false;
    clearPersistedSessionStorage();
    clearActiveDriveFiles();
    emitConnectionChange();
  }

  return cleaned;
}

function isTokenCurrentlyValid(bufferMs = 60_000): boolean {
  if (!currentToken || !currentExpiresAt) return false;
  return Date.now() < currentExpiresAt - bufferMs;
}

export function getDriveConnectionState(): DriveConnectionState {
  const hasSession = Boolean(currentToken || currentDriveUser);
  const tokenValid = isTokenCurrentlyValid(30_000);
  return {
    connected: hasSession,
    tokenValid,
    isRefreshing: isRefreshingToken,
    needsReauth: sessionNeedsReauth,
    expiresAt: currentExpiresAt,
    clientId: currentClientId || getStoredDriveClientId(),
    user: currentDriveUser,
  };
}

/**
 * Ensures the Google Identity Services (GIS) library is loaded and initialized.
 */
export function ensureGisLoaded(timeoutMs = 10_000): Promise<void> {
  if (window.google?.accounts?.oauth2?.initTokenClient) {
    return Promise.resolve();
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return Promise.reject(
      new Error(
        'ไม่มีการเชื่อมต่ออินเทอร์เน็ต (Offline) จึงไม่สามารถโหลด Google Identity Services ได้'
      )
    );
  }

  return new Promise((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[src^="${GIS_SCRIPT_URL}"]`
    );

    if (!existingScript) {
      const script = document.createElement('script');
      script.src = GIS_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      script.onerror = () => {
        reject(
          new Error(
            'ไม่สามารถโหลด Google Identity Services (accounts.google.com/gsi/client) ได้ กรุณาตรวจสอบอินเทอร์เน็ตหรือตัวบล็อกโฆษณา'
          )
        );
      };
      document.head.appendChild(script);
    }

    const startedAt = Date.now();
    const interval = window.setInterval(() => {
      if (window.google?.accounts?.oauth2?.initTokenClient) {
        window.clearInterval(interval);
        resolve();
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        window.clearInterval(interval);
        reject(
          new Error(
            'หมดเวลารอโหลด Google Identity Services (GIS) กรุณารีเฟรชหน้าเว็บหรือตรวจสอบว่า accounts.google.com ไม่ได้ถูกบล็อก'
          )
        );
      }
    }, 100);
  });
}

async function fetchDriveAboutUser(token: string): Promise<DriveConnectedUser | null> {
  try {
    const res = await fetch(
      'https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress,photoLink)',
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.user) {
      return {
        displayName: data.user.displayName,
        emailAddress: data.user.emailAddress,
        photoLink: data.user.photoLink,
      };
    }
  } catch {
    // Non-fatal: drive.file token still works even if about endpoint fails
  }
  return null;
}

function requestGisToken(
  clientId: string,
  options: { prompt: '' | 'consent' | 'select_account'; loginHint?: string; timeoutMs?: number }
): Promise<GisTokenResponse> {
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2?.initTokenClient) {
    return Promise.reject(
      new Error('Google Identity Services OAuth2 client ไม่พร้อมใช้งาน')
    );
  }

  return new Promise<GisTokenResponse>((resolve, reject) => {
    let settled = false;
    const timeoutId =
      options.timeoutMs && options.timeoutMs > 0
        ? window.setTimeout(() => {
            if (settled) return;
            settled = true;
            reject(
              new Error(
                options.prompt === ''
                  ? 'การต่ออายุเซสชันอัตโนมัติหมดเวลา กรุณากดปุ่ม Reconnect Google Drive เพื่อต่ออายุสิทธิ์'
                  : 'หมดเวลารอการยืนยันตัวตนจาก Google กรุณาลองใหม่อีกครั้ง'
              )
            );
          }, options.timeoutMs)
        : null;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      fn();
    };

    try {
      const tokenClient = oauth2.initTokenClient({
        client_id: clientId,
        scope: DRIVE_FILE_SCOPE,
        hint: options.loginHint || undefined,
        callback: (response: GisTokenResponse) => {
          finish(() => {
            if (response.error) {
              const detail = response.error_description
                ? `${response.error}: ${response.error_description}`
                : response.error;
              reject(new Error(`Google OAuth error (${detail})`));
              return;
            }
            if (!response.access_token) {
              reject(new Error('Google ไม่ได้ส่ง Access Token กลับมา'));
              return;
            }
            resolve(response);
          });
        },
        error_callback: (err: GisErrorResponse) => {
          finish(() => {
            if (err?.type === 'popup_closed') {
              reject(
                new Error(
                  'หน้าต่างเข้าสู่ระบบ Google ถูกปิดก่อนเสร็จสิ้นการอนุญาต'
                )
              );
              return;
            }
            if (err?.type === 'popup_failed_to_open') {
              reject(
                new Error(
                  'เบราว์เซอร์บล็อกหน้าต่างป๊อปอัป Google Sign-In กรุณาอนุญาตป๊อปอัปสำหรับเว็บไซต์นี้แล้วลองอีกครั้ง'
                )
              );
              return;
            }
            reject(
              new Error(
                err?.message ||
                  `Google Identity Services error (${err?.type || 'unknown'}). ตรวจสอบว่าได้เพิ่ม ${window.location.origin} ใน Authorized JavaScript origins ของ Google Cloud Console แล้ว`
              )
            );
          });
        },
      });

      tokenClient.requestAccessToken({
        prompt: options.prompt,
        hint: options.loginHint || undefined,
        login_hint: options.loginHint || undefined,
      });
    } catch (err: any) {
      finish(() => {
        reject(
          new Error(err?.message || 'ไม่สามารถเริ่มต้น Google OAuth token client ได้')
        );
      });
    }
  });
}

/**
 * Initiates real OAuth 2.0 user sign-in via Google Identity Services (GIS)
 * requesting `https://www.googleapis.com/auth/drive.file`, and immediately stores
 * access_token, expires_at, and user profile/email in localStorage for persistence.
 */
export async function connectGoogleDrive(
  clientIdInput?: string,
  options?: { prompt?: '' | 'consent' | 'select_account'; loginHint?: string }
): Promise<DriveConnectionState> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error(
      'ไม่มีการเชื่อมต่ออินเทอร์เน็ต (Offline) กรุณาเชื่อมต่อเครือข่ายก่อนเข้าสู่ระบบ Google Drive'
    );
  }

  const clientId = (clientIdInput ?? getStoredDriveClientId()).trim();

  if (!clientId) {
    throw new Error(
      'กรุณาระบุ Google Cloud OAuth Client ID ในหน้าต่าง Google Drive Settings ก่อนเชื่อมต่อ'
    );
  }

  if (!clientId.includes('.apps.googleusercontent.com')) {
    throw new Error(
      'รูปแบบ Google OAuth Client ID ไม่ถูกต้อง (ต้องลงท้ายด้วย ".apps.googleusercontent.com")'
    );
  }

  await ensureGisLoaded();

  const savedEmail = options?.loginHint || currentDriveUser?.emailAddress || undefined;
  const prompt = options?.prompt ?? (currentToken ? '' : 'consent');

  const tokenResult = await requestGisToken(clientId, {
    prompt,
    loginHint: savedEmail,
  });

  const expiresInSec = Number(tokenResult.expires_in) || 3600;
  currentToken = tokenResult.access_token!;
  currentExpiresAt = Date.now() + expiresInSec * 1000;
  currentClientId = clientId;
  sessionNeedsReauth = false;

  const fetchedUser = await fetchDriveAboutUser(currentToken);
  if (fetchedUser) {
    currentDriveUser = fetchedUser;
  }

  persistSessionToStorage();
  emitConnectionChange();
  return getDriveConnectionState();
}

/**
 * Automatic Silent Token Renewal using GIS (`prompt: ''` + saved email `hint`).
 * Deduplicated so parallel API calls wait on the same renewal promise.
 * Never clears the stored session on failure — marks `needsReauth = true` so the user
 * remains recognized and can reconnect with 1 click (or sign out manually).
 */
export async function refreshAccessTokenSilently(): Promise<string> {
  if (inFlightSilentRefresh) {
    return inFlightSilentRefresh;
  }

  const clientId = (currentClientId || getStoredDriveClientId()).trim();
  if (!clientId) {
    sessionNeedsReauth = true;
    emitConnectionChange();
    throw new Error(
      'ไม่พบ Google Cloud OAuth Client ID สำหรับต่ออายุเซสชัน กรุณาเปิด Google Drive Settings'
    );
  }

  const savedEmail = currentDriveUser?.emailAddress || undefined;

  inFlightSilentRefresh = (async () => {
    isRefreshingToken = true;
    emitConnectionChange();
    try {
      await ensureGisLoaded();
      const tokenResult = await requestGisToken(clientId, {
        prompt: '',
        loginHint: savedEmail,
        timeoutMs: 15_000,
      });

      const expiresInSec = Number(tokenResult.expires_in) || 3600;
      currentToken = tokenResult.access_token!;
      currentExpiresAt = Date.now() + expiresInSec * 1000;
      currentClientId = clientId;
      sessionNeedsReauth = false;

      if (!currentDriveUser?.emailAddress) {
        const fetchedUser = await fetchDriveAboutUser(currentToken);
        if (fetchedUser) {
          currentDriveUser = fetchedUser;
        }
      }

      persistSessionToStorage();
      return currentToken;
    } catch (err: any) {
      sessionNeedsReauth = true;
      const reason = err?.message ? ` (${err.message})` : '';
      throw new Error(
        `เซสชัน Google Drive หมดอายุและไม่สามารถต่ออายุอัตโนมัติได้${reason} กรุณากดปุ่ม "Reconnect Google Drive" เพื่อยืนยันสิทธิ์อีกครั้ง`
      );
    } finally {
      isRefreshingToken = false;
      inFlightSilentRefresh = null;
      emitConnectionChange();
    }
  })();

  return inFlightSilentRefresh;
}

/**
 * Explicit manual Sign Out / Disconnect:
 * Revokes the OAuth access token with Google, clears localStorage session & tracked Drive files,
 * and disconnects the app cleanly.
 */
export function disconnectGoogleDrive(): Promise<void> {
  const tokenToRevoke = currentToken;
  currentToken = null;
  currentExpiresAt = null;
  currentClientId = '';
  currentDriveUser = null;
  isRefreshingToken = false;
  sessionNeedsReauth = false;
  inFlightSilentRefresh = null;

  clearPersistedSessionStorage();
  clearActiveDriveFiles();
  emitConnectionChange();

  return new Promise((resolve) => {
    if (tokenToRevoke && window.google?.accounts?.oauth2?.revoke) {
      try {
        window.google.accounts.oauth2.revoke(tokenToRevoke, () => resolve());
        return;
      } catch {
        // ignore revoke error
      }
    }
    resolve();
  });
}

async function parseGoogleApiError(res: Response): Promise<string> {
  const rawText = await res.text().catch(() => '');
  try {
    const parsed = JSON.parse(rawText);
    const apiErr = parsed?.error;
    if (apiErr) {
      const code = apiErr.code || res.status;
      const reason = apiErr.errors?.[0]?.reason ? ` [${apiErr.errors[0].reason}]` : '';
      const message = apiErr.message || res.statusText || 'Unknown Google Drive API error';
      return `Google Drive API Error ${code}${reason}: ${message}`;
    }
  } catch {
    // not JSON
  }
  return `Google Drive API Error (HTTP ${res.status}): ${rawText || res.statusText || 'Request failed'}`;
}

/**
 * Returns a valid access token, automatically performing silent renewal if the stored token
 * has expired or is within 60 seconds of expiration.
 */
async function ensureValidAccessToken(): Promise<string> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error(
      'ไม่มีการเชื่อมต่ออินเทอร์เน็ต (Offline) ไม่สามารถติดต่อ Google Drive ได้ในขณะนี้'
    );
  }

  if (!currentToken && !currentDriveUser) {
    throw new Error(
      'ยังไม่ได้เชื่อมต่อ Google Drive กรุณากดปุ่ม "Connect Google Drive" ก่อนใช้งาน'
    );
  }

  if (isTokenCurrentlyValid(60_000) && currentToken) {
    return currentToken;
  }

  return refreshAccessTokenSilently();
}

/**
 * Performs an authenticated Google Drive API v3 request with:
 * - Offline / network error detection
 * - Automatic pre-flight silent renewal if expired
 * - Seamless 1-time silent renewal & retry on HTTP 401 Unauthorized
 */
async function driveAuthorizedFetch(
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  let token = await ensureValidAccessToken();

  const execute = async (bearerToken: string): Promise<Response> => {
    const headers = new Headers(init.headers || {});
    headers.set('Authorization', `Bearer ${bearerToken}`);
    try {
      return await fetch(url, {
        ...init,
        headers,
      });
    } catch (err: any) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new Error(
          'ขาดการเชื่อมต่ออินเทอร์เน็ต (Offline) กรุณาตรวจสอบเครือข่ายแล้วลองใหม่อีกครั้ง'
        );
      }
      throw new Error(
        `ไม่สามารถเชื่อมต่อ Google Drive API ได้ (Network Error): ${err?.message || 'Failed to fetch'}`
      );
    }
  };

  let res = await execute(token);

  if (res.status === 401) {
    // Seamlessly attempt silent token refresh and retry the request once
    token = await refreshAccessTokenSilently();
    res = await execute(token);
  }

  return res;
}

export interface UploadToDriveParams {
  filename: string;
  mimeType: string;
  content: string | Uint8Array | ArrayBuffer | Blob;
  description?: string;
  /** Optional existing file ID to update in-place via PATCH */
  existingFileId?: string;
}

/**
 * Real Google Drive API v3 Multipart Upload
 * - Updates an existing file via PATCH https://www.googleapis.com/upload/drive/v3/files/{fileId}?uploadType=multipart
 *   (falls back cleanly to POST if the existing file was deleted on Drive / HTTP 404).
 * - Creates a new file in the user's Google Drive root folder via
 *   POST https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart
 */
export async function uploadFileToGoogleDrive(
  params: UploadToDriveParams
): Promise<DriveUploadedFile> {
  const cleanFilename = params.filename.trim();
  if (!cleanFilename) {
    throw new Error('กรุณาระบุชื่อไฟล์ก่อนบันทึกขึ้น Google Drive');
  }

  const buildMultipartRequest = (isUpdate: boolean) => {
    const boundary = `SeatBookingDriveBoundary_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 10)}`;

    const metadata: Record<string, unknown> = {
      name: cleanFilename,
      mimeType: params.mimeType,
    };
    if (params.description) {
      metadata.description = params.description;
    }
    if (!isUpdate) {
      metadata.parents = ['root'];
    }

    const filePart: BlobPart =
      params.content instanceof Uint8Array
        ? new Uint8Array(params.content)
        : params.content;

    const multipartBlob = new Blob(
      [
        `--${boundary}\r\n`,
        'Content-Type: application/json; charset=UTF-8\r\n\r\n',
        JSON.stringify(metadata),
        `\r\n--${boundary}\r\n`,
        `Content-Type: ${params.mimeType}\r\n\r\n`,
        filePart,
        `\r\n--${boundary}--`,
      ],
      { type: `multipart/related; boundary=${boundary}` }
    );

    return { boundary, multipartBlob };
  };

  let isUpdate = Boolean(params.existingFileId);
  let { boundary, multipartBlob } = buildMultipartRequest(isUpdate);
  let endpoint = isUpdate
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(
        params.existingFileId!
      )}?uploadType=multipart&fields=id,name,mimeType,webViewLink,modifiedTime,size`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink,modifiedTime,size';

  let res = await driveAuthorizedFetch(endpoint, {
    method: isUpdate ? 'PATCH' : 'POST',
    headers: {
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipartBlob,
  });

  // If the previously tracked file was deleted in Google Drive (404), create a fresh file cleanly
  if (isUpdate && res.status === 404) {
    isUpdate = false;
    ({ boundary, multipartBlob } = buildMultipartRequest(false));
    endpoint =
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink,modifiedTime,size';
    res = await driveAuthorizedFetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBlob,
    });
  }

  if (!res.ok) {
    throw new Error(await parseGoogleApiError(res));
  }

  const data = await res.json();
  if (!data?.id) {
    throw new Error('Google Drive API ไม่ได้ส่งคืนรหัสไฟล์ (file ID)');
  }

  const uploaded: DriveUploadedFile = {
    id: data.id,
    name: data.name || cleanFilename,
    mimeType: data.mimeType || params.mimeType,
    webViewLink: data.webViewLink || `https://drive.google.com/file/d/${data.id}/view`,
    modifiedTime: data.modifiedTime || new Date().toISOString(),
    size: data.size,
  };

  // Track this file as the active canonical file for its format so future saves update it cleanly
  const isJson =
    uploaded.mimeType === 'application/json' ||
    uploaded.name.toLowerCase().endsWith('.json');
  saveActiveDriveFile(isJson ? 'json' : 'xlsx', uploaded);

  return uploaded;
}

/**
 * Queries real non-trashed backup files created/accessible by this app in Google Drive
 * matching JSON or Excel backup MIME types or filenames, ordered by modifiedTime desc.
 */
export async function listAppCreatedDriveFiles(): Promise<DriveUploadedFile[]> {
  const url = new URL('https://www.googleapis.com/drive/v3/files');
  const query =
    "trashed = false and (mimeType = 'application/json' or mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' or name contains 'Seat_Booking')";
  url.searchParams.set('q', query);
  url.searchParams.set('orderBy', 'modifiedTime desc');
  url.searchParams.set('pageSize', '30');
  url.searchParams.set('fields', 'files(id,name,mimeType,webViewLink,modifiedTime,size)');

  const res = await driveAuthorizedFetch(url.toString(), { method: 'GET' });

  if (!res.ok) {
    throw new Error(await parseGoogleApiError(res));
  }

  const data = await res.json();
  const files = Array.isArray(data?.files) ? data.files : [];
  return files.map((f: any) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    webViewLink: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
    modifiedTime: f.modifiedTime,
    size: f.size,
  }));
}

/**
 * Finds an existing non-trashed file by exact name in Google Drive (ordered by modifiedTime desc)
 * so saves can cleanly PATCH the existing file without creating duplicate files.
 */
export async function findExistingDriveFileByName(
  filename: string
): Promise<DriveUploadedFile | null> {
  const escaped = filename.trim().replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  if (!escaped) return null;

  const url = new URL('https://www.googleapis.com/drive/v3/files');
  url.searchParams.set('q', `trashed = false and name = '${escaped}'`);
  url.searchParams.set('orderBy', 'modifiedTime desc');
  url.searchParams.set('pageSize', '1');
  url.searchParams.set('fields', 'files(id,name,mimeType,webViewLink,modifiedTime,size)');

  const res = await driveAuthorizedFetch(url.toString(), { method: 'GET' });
  if (!res.ok) {
    throw new Error(await parseGoogleApiError(res));
  }
  const data = await res.json();
  const first = Array.isArray(data?.files) ? data.files[0] : null;
  if (!first?.id) return null;

  return {
    id: first.id,
    name: first.name,
    mimeType: first.mimeType,
    webViewLink: first.webViewLink || `https://drive.google.com/file/d/${first.id}/view`,
    modifiedTime: first.modifiedTime,
    size: first.size,
  };
}

/**
 * Downloads and parses a JSON backup file directly from Google Drive API v3 (`?alt=media`).
 */
export async function downloadJsonFileFromGoogleDrive<T = unknown>(
  fileId: string
): Promise<T> {
  const res = await driveAuthorizedFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    { method: 'GET' }
  );

  if (!res.ok) {
    throw new Error(await parseGoogleApiError(res));
  }

  const text = await res.text();
  if (!text || !text.trim()) {
    throw new Error('ไฟล์สำรองบน Google Drive ว่างเปล่า (Empty file)');
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error('ไม่สามารถอ่านข้อมูล JSON จากไฟล์บน Google Drive ได้ (ไฟล์เสียหายหรือไม่ใช่ JSON)');
  }
}

/**
 * Downloads binary file bytes (e.g., .xlsx backup) directly from Google Drive API v3 (`?alt=media`).
 */
export async function downloadBinaryFileFromGoogleDrive(
  fileId: string
): Promise<ArrayBuffer> {
  const res = await driveAuthorizedFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    { method: 'GET' }
  );

  if (!res.ok) {
    throw new Error(await parseGoogleApiError(res));
  }

  const buffer = await res.arrayBuffer();
  if (!buffer || buffer.byteLength === 0) {
    throw new Error('ไฟล์ Excel บน Google Drive ว่างเปล่า (Empty file)');
  }
  return buffer;
}
