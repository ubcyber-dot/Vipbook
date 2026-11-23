/**
 * Real Google Identity Services (GIS) OAuth 2.0 + Google Drive API v3 Integration
 *
 * Security notes:
 * - OAuth Client ID is public and stored in localStorage for user convenience.
 * - OAuth Access Tokens are cached STRICTLY IN MEMORY (never in localStorage or sessionStorage).
 * - Uploads go directly to the real Google Drive API v3 multipart endpoint:
 *   https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart
 */

import firebaseConfig from '../../firebase-applet-config.json';

export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const STORAGE_KEY_GDRIVE_CLIENT_ID = 'seat_lookup_gdrive_client_id_v1';
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

export interface DriveConnectionState {
  connected: boolean;
  expiresAt: number | null;
  clientId: string;
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
  requestAccessToken: (overrideConfig?: { prompt?: string; hint?: string }) => void;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: GisTokenResponse) => void;
            error_callback?: (error: GisErrorResponse) => void;
          }) => GisTokenClient;
          revoke: (token: string, done?: () => void) => void;
        };
      };
    };
  }
}

// Strictly in-memory OAuth access token cache (never persisted to browser storage)
let inMemoryToken: string | null = null;
let inMemoryExpiresAt: number | null = null;
let inMemoryClientId = '';
let inMemoryDriveUser: DriveConnectedUser | null = null;

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
  // If the user switched Client IDs, clear any previous in-memory token
  if (inMemoryToken && inMemoryClientId && inMemoryClientId !== cleaned) {
    clearInMemoryDriveToken();
  }
  return cleaned;
}

export function clearInMemoryDriveToken() {
  inMemoryToken = null;
  inMemoryExpiresAt = null;
  inMemoryClientId = '';
  inMemoryDriveUser = null;
  emitConnectionChange();
}

export function getInMemoryDriveToken(): string | null {
  if (!inMemoryToken || !inMemoryExpiresAt) {
    return null;
  }
  // Expire 30 seconds early to avoid race conditions mid-upload
  if (Date.now() >= inMemoryExpiresAt - 30_000) {
    clearInMemoryDriveToken();
    return null;
  }
  return inMemoryToken;
}

export function getDriveConnectionState(): DriveConnectionState {
  const token = getInMemoryDriveToken();
  return {
    connected: Boolean(token),
    expiresAt: token ? inMemoryExpiresAt : null,
    clientId: token ? inMemoryClientId : getStoredDriveClientId(),
    user: token ? inMemoryDriveUser : null,
  };
}

/**
 * Ensures the Google Identity Services (GIS) library is loaded and initialized.
 */
export function ensureGisLoaded(timeoutMs = 10_000): Promise<void> {
  if (window.google?.accounts?.oauth2?.initTokenClient) {
    return Promise.resolve();
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
            'Failed to load Google Identity Services (https://accounts.google.com/gsi/client). Please check your network connection or ad-blocker.'
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
            'Timed out waiting for Google Identity Services (GIS) to load. Please refresh the page or check if accounts.google.com is blocked.'
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
    // Non-fatal: drive.file token still works for uploading even if about call fails
  }
  return null;
}

/**
 * Initiates real OAuth 2.0 user sign-in via Google Identity Services (GIS)
 * requesting `https://www.googleapis.com/auth/drive.file`.
 */
export async function connectGoogleDrive(
  clientIdInput?: string,
  options?: { prompt?: '' | 'consent' | 'select_account'; loginHint?: string }
): Promise<DriveConnectionState> {
  const clientId = (clientIdInput ?? getStoredDriveClientId()).trim();

  if (!clientId) {
    throw new Error(
      'Google Cloud OAuth Client ID is required. Please open Google Drive Settings and paste your OAuth 2.0 Client ID.'
    );
  }

  if (!clientId.includes('.apps.googleusercontent.com')) {
    throw new Error(
      'Invalid Google OAuth Client ID format. It should end with ".apps.googleusercontent.com".'
    );
  }

  await ensureGisLoaded();

  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2?.initTokenClient) {
    throw new Error('Google Identity Services OAuth2 client is unavailable.');
  }

  const tokenResult = await new Promise<GisTokenResponse>((resolve, reject) => {
    try {
      const tokenClient = oauth2.initTokenClient({
        client_id: clientId,
        scope: DRIVE_FILE_SCOPE,
        callback: (response: GisTokenResponse) => {
          if (response.error) {
            const detail = response.error_description
              ? `${response.error}: ${response.error_description}`
              : response.error;
            reject(new Error(`Google OAuth error (${detail})`));
            return;
          }
          if (!response.access_token) {
            reject(new Error('Google did not return an access token.'));
            return;
          }
          resolve(response);
        },
        error_callback: (err: GisErrorResponse) => {
          if (err?.type === 'popup_closed') {
            reject(new Error('Google sign-in popup was closed before completing authorization.'));
            return;
          }
          if (err?.type === 'popup_failed_to_open') {
            reject(
              new Error(
                'Browser blocked the Google sign-in popup. Please allow popups for this site and try again.'
              )
            );
            return;
          }
          reject(
            new Error(
              err?.message ||
                `Google Identity Services error (${err?.type || 'unknown'}). Check that ${window.location.origin} is added to Authorized JavaScript origins in Google Cloud Console.`
            )
          );
        },
      });

      tokenClient.requestAccessToken({
        prompt: options?.prompt ?? (inMemoryToken ? '' : 'consent'),
        hint: options?.loginHint,
      });
    } catch (err: any) {
      reject(new Error(err?.message || 'Failed to initialize Google OAuth token client.'));
    }
  });

  const expiresInSec = Number(tokenResult.expires_in) || 3600;
  inMemoryToken = tokenResult.access_token!;
  inMemoryExpiresAt = Date.now() + expiresInSec * 1000;
  inMemoryClientId = clientId;
  inMemoryDriveUser = await fetchDriveAboutUser(inMemoryToken);

  emitConnectionChange();
  return getDriveConnectionState();
}

/**
 * Revokes the current in-memory Google Drive access token and disconnects.
 */
export function disconnectGoogleDrive(): Promise<void> {
  const tokenToRevoke = inMemoryToken;
  clearInMemoryDriveToken();

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

export interface UploadToDriveParams {
  filename: string;
  mimeType: string;
  content: string | Uint8Array | ArrayBuffer | Blob;
  description?: string;
  /** Optional existing file ID to overwrite (PATCH) — caller must confirm with user first */
  existingFileId?: string;
}

/**
 * Real Google Drive API v3 Multipart Upload
 * Uploads directly to the user's Google Drive root folder via:
 * POST https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart
 * (or PATCH when updating an explicitly confirmed existingFileId).
 */
export async function uploadFileToGoogleDrive(
  params: UploadToDriveParams
): Promise<DriveUploadedFile> {
  const token = getInMemoryDriveToken();
  if (!token) {
    throw new Error(
      'Not connected to Google Drive (or session expired). Please click "Connect Google Drive" first.'
    );
  }

  const cleanFilename = params.filename.trim();
  if (!cleanFilename) {
    throw new Error('Filename is required before uploading to Google Drive.');
  }

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
  // Explicitly place new files in the user's Google Drive root folder
  if (!params.existingFileId) {
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

  const isUpdate = Boolean(params.existingFileId);
  const endpoint = isUpdate
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(
        params.existingFileId!
      )}?uploadType=multipart&fields=id,name,mimeType,webViewLink,modifiedTime,size`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink,modifiedTime,size';

  const res = await fetch(endpoint, {
    method: isUpdate ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipartBlob,
  });

  if (!res.ok) {
    if (res.status === 401) {
      clearInMemoryDriveToken();
    }
    const errMsg = await parseGoogleApiError(res);
    throw new Error(errMsg);
  }

  const data = await res.json();
  if (!data?.id) {
    throw new Error('Google Drive API returned a response without a file ID.');
  }

  return {
    id: data.id,
    name: data.name || cleanFilename,
    mimeType: data.mimeType || params.mimeType,
    webViewLink: data.webViewLink || `https://drive.google.com/file/d/${data.id}/view`,
    modifiedTime: data.modifiedTime || new Date().toISOString(),
    size: data.size,
  };
}

/**
 * Lists files created/accessible by this app under the `drive.file` scope.
 */
export async function listAppCreatedDriveFiles(): Promise<DriveUploadedFile[]> {
  const token = getInMemoryDriveToken();
  if (!token) {
    throw new Error('Not connected to Google Drive. Please connect first.');
  }

  const url = new URL('https://www.googleapis.com/drive/v3/files');
  url.searchParams.set('q', 'trashed = false');
  url.searchParams.set('orderBy', 'modifiedTime desc');
  url.searchParams.set('pageSize', '20');
  url.searchParams.set('fields', 'files(id,name,mimeType,webViewLink,modifiedTime,size)');

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    if (res.status === 401) {
      clearInMemoryDriveToken();
    }
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
 * Downloads a JSON backup file previously saved by this app to Google Drive.
 */
export async function downloadJsonFileFromGoogleDrive<T = unknown>(
  fileId: string
): Promise<T> {
  const token = getInMemoryDriveToken();
  if (!token) {
    throw new Error('Not connected to Google Drive. Please connect first.');
  }

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!res.ok) {
    if (res.status === 401) {
      clearInMemoryDriveToken();
    }
    throw new Error(await parseGoogleApiError(res));
  }

  return (await res.json()) as T;
}
