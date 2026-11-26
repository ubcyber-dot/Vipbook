/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FileSpreadsheet,
  AlertTriangle,
  RefreshCw,
  Settings,
  ExternalLink,
  Search,
  Share2,
  FolderOpen,
  Cloud,
  CloudUpload,
  CloudDownload,
  CheckCircle2,
  AlertCircle,
  LogOut,
  X,
  ArrowRightLeft,
} from 'lucide-react';
import {
  ActiveTab,
  CategoryConfig,
  CategorySheetResult,
  DriveFilterMode,
  ExpenseRecord,
  SeatRecord,
  SpreadsheetFileItem,
} from './types/booking';
import {
  initAuth,
  googleSignIn,
  getPersistentUser,
  hasActiveDriveToken,
  PersistentUserProfile,
} from './services/auth';
import {
  BatchReadResponse,
  CloudSystemState,
  fetchAllCategorySheets,
  listDriveSpreadsheets,
  TemplateSheetPayload,
} from './services/sheetsApi';
import {
  CANONICAL_EXCEL_EXPORT_FILENAME,
  CANONICAL_JSON_BACKUP_FILENAME,
  DriveConnectionState,
  DriveUploadedFile,
  connectGoogleDrive,
  disconnectGoogleDrive,
  downloadBinaryFileFromGoogleDrive,
  downloadJsonFileFromGoogleDrive,
  findExistingDriveFileByName,
  getActiveDriveFiles,
  getDriveConnectionState,
  getStoredDriveClientId,
  listAppCreatedDriveFiles,
  subscribeDriveConnection,
  uploadFileToGoogleDrive,
} from './services/googleDriveGis';
import {
  buildBatchReadResponseFromSheets,
  buildCloudSystemStateFromExcelBuffer,
  buildUpdatedSeatRecord,
  createInitialTemplateResponse,
  exportCurrentDataToExcel,
  generateCurrentDataExcelBytes,
  resolveColumnMapFromRow,
  STANDARD_TEMPLATE_HEADERS,
  validateAndHydrateCloudState,
} from './utils/excelTemplate';
import { Navbar } from './components/Navbar';
import { LookupView } from './components/LookupView';
import { DashboardView } from './components/DashboardView';
import { SeatMapView } from './components/SeatMapView';
import { BackOfficeView } from './components/BackOfficeView';
import { SettingsModal } from './components/SettingsModal';
import { ExcelTemplateImporter } from './components/ExcelTemplateImporter';
import { GoogleDriveModal } from './components/GoogleDriveModal';
import { MoveTableModal } from './components/MoveTableModal';

const STORAGE_KEY_CATEGORIES = 'seat_lookup_categories_v1';
const STORAGE_KEY_SPREADSHEET_ID = 'seat_lookup_spreadsheet_id_v2';
const STORAGE_KEY_TEMPLATE_SESSION = 'seat_lookup_template_session_v2';
const STORAGE_KEY_EXPENSES = 'seat_lookup_expenses_v1';

const DEFAULT_CATEGORIES: CategoryConfig[] = [
  {
    id: 'vip',
    name: 'VIP',
    sheetName: 'VIP',
    colorHex: '#D97706', // Gold default for VIP
    isDefault: true,
  },
  {
    id: 'standard',
    name: 'Standard',
    sheetName: 'Standard',
    colorHex: '#2563EB', // Blue default for Standard
    isDefault: true,
  },
];

function loadSavedCategories(): CategoryConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CATEGORIES);
    if (!raw) return DEFAULT_CATEGORIES;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch (e) {
    console.error('Failed to load categories from localStorage:', e);
  }
  return DEFAULT_CATEGORIES;
}

function loadSavedTemplateSession(): BatchReadResponse | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_TEMPLATE_SESSION);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.categoryResults)) {
      return parsed as BatchReadResponse;
    }
  } catch (e) {
    console.error('Failed to load template session:', e);
  }
  return null;
}

function loadSavedExpenses(): ExpenseRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_EXPENSES);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed as ExpenseRecord[];
    }
  } catch (e) {
    console.error('Failed to load expenses:', e);
  }
  return [];
}

function getCanonicalFilename(format: 'xlsx' | 'json'): string {
  return format === 'json'
    ? CANONICAL_JSON_BACKUP_FILENAME
    : CANONICAL_EXCEL_EXPORT_FILENAME;
}

function getTimestampedCopyFilename(format: 'xlsx' | 'json'): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  return format === 'xlsx'
    ? `Seat_Bookings_VIP_Standard_${yyyy}-${mm}-${dd}_${hh}${min}.xlsx`
    : `Seat_Booking_System_Backup_${yyyy}-${mm}-${dd}_${hh}${min}.json`;
}

function getInitialLastDriveFile(): DriveUploadedFile | null {
  const active = getActiveDriveFiles();
  const candidates = [active.json, active.xlsx].filter(Boolean) as DriveUploadedFile[];
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const tA = a.modifiedTime ? Date.parse(a.modifiedTime) : 0;
    const tB = b.modifiedTime ? Date.parse(b.modifiedTime) : 0;
    return tB - tA;
  });
  return candidates[0];
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('lookup');
  const [seatMapCategoryFilter, setSeatMapCategoryFilter] = useState<string>('all');

  // Legacy Firebase Auth state (used only if user picks an existing Google Sheet to import)
  const [persistentUser, setPersistentUser] = useState<PersistentUserProfile | null>(() =>
    getPersistentUser()
  );
  const [hasLegacySheetToken, setHasLegacySheetToken] = useState<boolean>(() =>
    hasActiveDriveToken()
  );
  const [isLoggingInSheets, setIsLoggingInSheets] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const userEmail = persistentUser?.email || null;

  // REAL Google Identity Services (GIS) + Google Drive API v3 Persistent Session State
  const [driveConnection, setDriveConnection] = useState<DriveConnectionState>(() =>
    getDriveConnectionState()
  );
  const [isDriveModalOpen, setIsDriveModalOpen] = useState<boolean>(false);
  const [isDriveConnecting, setIsDriveConnecting] = useState<boolean>(false);
  const [isDriveUploading, setIsDriveUploading] = useState<boolean>(false);
  const [isDriveLoadingBackup, setIsDriveLoadingBackup] = useState<boolean>(false);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [driveSuccessNotice, setDriveSuccessNotice] = useState<string | null>(null);
  const [lastDriveFile, setLastDriveFile] = useState<DriveUploadedFile | null>(() =>
    getInitialLastDriveFile()
  );
  const [pendingQuickOverwrite, setPendingQuickOverwrite] = useState<{
    file: DriveUploadedFile;
    format: 'xlsx' | 'json';
  } | null>(null);
  const [pendingQuickRestore, setPendingQuickRestore] = useState<DriveUploadedFile | null>(null);

  // Configuration & Expenses State
  const [categories, setCategories] = useState<CategoryConfig[]>(loadSavedCategories);
  const [expenses, setExpenses] = useState<ExpenseRecord[]>(loadSavedExpenses);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);

  // Load persisted Excel template session if available (or auto-create default template)
  const initialTemplateSession = useMemo(() => {
    const saved = loadSavedTemplateSession();
    if (saved) return saved;
    const initialCategories = loadSavedCategories();
    const defaultRes = createInitialTemplateResponse(initialCategories);
    try {
      localStorage.setItem(STORAGE_KEY_TEMPLATE_SESSION, JSON.stringify(defaultRes));
      localStorage.removeItem(STORAGE_KEY_SPREADSHEET_ID);
    } catch {
      // ignore initial storage error
    }
    return defaultRes;
  }, []);

  const [spreadsheetId, setSpreadsheetId] = useState<string>(() => {
    if (initialTemplateSession) return 'template-import';
    return localStorage.getItem(STORAGE_KEY_SPREADSHEET_ID) || 'template-import';
  });

  const [spreadsheetTitle, setSpreadsheetTitle] = useState<string>(
    () => initialTemplateSession?.spreadsheetTitle || ''
  );
  const [spreadsheetUrl, setSpreadsheetUrl] = useState<string>(
    () => initialTemplateSession?.spreadsheetUrl || ''
  );
  const [availableSheets, setAvailableSheets] = useState<string[]>(
    () => initialTemplateSession?.availableSheets || []
  );
  const [categoryResults, setCategoryResults] = useState<CategorySheetResult[]>(
    () => initialTemplateSession?.categoryResults || []
  );
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(
    () => initialTemplateSession?.fetchedAt || null
  );
  const [isLoadingData, setIsLoadingData] = useState<boolean>(false);
  const [dataError, setDataError] = useState<string | null>(null);

  // Drive Files for Shared / All Google Sheets import picker
  const [driveFilter, setDriveFilter] = useState<DriveFilterMode>('sharedWithMe');
  const [driveFiles, setDriveFiles] = useState<SpreadsheetFileItem[]>([]);
  const [driveSearchQuery, setDriveSearchQuery] = useState<string>('');
  const [isLoadingDriveFiles, setIsLoadingDriveFiles] = useState<boolean>(false);

  // Settings Modal State
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);

  // Move / Swap Table Modal State
  const [isMoveModalOpen, setIsMoveModalOpen] = useState<boolean>(false);
  const [moveModalSourceSeatId, setMoveModalSourceSeatId] = useState<string | null>(null);
  const [transferNotice, setTransferNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!transferNotice) return;
    const timer = window.setTimeout(() => setTransferNotice(null), 6500);
    return () => window.clearTimeout(timer);
  }, [transferNotice]);

  // Clean up legacy v1 key
  useEffect(() => {
    try {
      localStorage.removeItem('seat_lookup_spreadsheet_id_v1');
    } catch {
      // ignore
    }
  }, []);

  // Subscribe to real Google Drive GIS connection state changes
  useEffect(() => {
    return subscribeDriveConnection((nextState) => {
      setDriveConnection(nextState);
    });
  }, []);

  // Initialize Firebase Auth Listener (for optional Google Sheets import picker)
  useEffect(() => {
    const unsubscribe = initAuth(
      (profile, tokenActive) => {
        setPersistentUser(profile);
        setHasLegacySheetToken(tokenActive);
      },
      () => {
        setPersistentUser(null);
        setHasLegacySheetToken(false);
      }
    );
    return () => unsubscribe();
  }, []);

  // Safely persist categories in localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_CATEGORIES, JSON.stringify(categories));
    } catch (e) {
      console.error('Failed to save categories:', e);
    }
  }, [categories]);

  // Safely persist expenses in localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_EXPENSES, JSON.stringify(expenses));
      setStorageWarning(null);
    } catch (e: any) {
      if (e?.name === 'QuotaExceededError') {
        setStorageWarning(
          'พื้นที่เก็บข้อมูลในเบราว์เซอร์ใกล้เต็ม กรุณาบันทึกข้อมูลขึ้น Google Drive เพื่อสำรองข้อมูลอย่างปลอดภัย'
        );
      }
      console.error('Failed to save expenses:', e);
    }
  }, [expenses]);

  // Safely persist current session categoryResults whenever modified
  useEffect(() => {
    if (categoryResults.length === 0) return;
    try {
      const sessionPayload: BatchReadResponse = {
        spreadsheetId: spreadsheetId || 'template-import',
        spreadsheetTitle: spreadsheetTitle || 'ข้อมูลการจองโต๊ะ (แก้ไขล่าสุด)',
        spreadsheetUrl,
        availableSheets,
        categoryResults,
        fetchedAt: lastSyncedAt || new Date().toISOString(),
      };
      localStorage.setItem(
        STORAGE_KEY_TEMPLATE_SESSION,
        JSON.stringify(sessionPayload)
      );
      setStorageWarning(null);
    } catch (e: any) {
      if (e?.name === 'QuotaExceededError') {
        setStorageWarning(
          'พื้นที่เก็บข้อมูลในเบราว์เซอร์เต็ม (อาจเกิดจากรูปสลิปจำนวนมาก) กรุณาบันทึกไฟล์สำรองขึ้น Google Drive ทันที'
        );
      }
      console.error('Failed to persist session records:', e);
    }
  }, [categoryResults, spreadsheetId, spreadsheetTitle, spreadsheetUrl, availableSheets, lastSyncedAt]);

  // Persist spreadsheetId in localStorage (only for real Sheets spreadsheet IDs)
  useEffect(() => {
    try {
      if (spreadsheetId && spreadsheetId !== 'template-import') {
        localStorage.setItem(STORAGE_KEY_SPREADSHEET_ID, spreadsheetId);
      } else if (!spreadsheetId) {
        localStorage.removeItem(STORAGE_KEY_SPREADSHEET_ID);
      }
    } catch (e) {
      console.error('Failed to save spreadsheetId:', e);
    }
  }, [spreadsheetId]);

  const applyBatchResponse = useCallback((res: BatchReadResponse, isTemplate = false) => {
    setSpreadsheetId(isTemplate ? 'template-import' : res.spreadsheetId);
    setSpreadsheetTitle(res.spreadsheetTitle);
    setSpreadsheetUrl(res.spreadsheetUrl || '');
    setAvailableSheets(res.availableSheets || []);
    setCategoryResults(res.categoryResults || []);
    setLastSyncedAt(res.fetchedAt);
    setDataError(null);

    if (!isTemplate) {
      try {
        localStorage.removeItem(STORAGE_KEY_TEMPLATE_SESSION);
      } catch {
        // ignore
      }
    }
  }, []);

  /**
   * REAL Google Identity Services (GIS) OAuth 2.0 Sign-In for Google Drive
   * Stores access_token, expires_at, and user profile in localStorage until explicit Sign Out.
   */
  const handleConnectGoogleDrive = useCallback(async () => {
    const clientId = getStoredDriveClientId();
    if (!clientId) {
      setDriveError(
        'กรุณาวาง Google Cloud OAuth Client ID ในหน้าต่าง Google Drive Settings ก่อนเชื่อมต่อ'
      );
      setIsDriveModalOpen(true);
      return;
    }

    setIsDriveConnecting(true);
    setDriveError(null);
    setDriveSuccessNotice(null);
    try {
      await connectGoogleDrive(clientId, {
        prompt: driveConnection.connected ? 'select_account' : 'consent',
      });
    } catch (err: any) {
      setDriveError(err?.message || 'ไม่สามารถเชื่อมต่อ Google Drive ได้');
    } finally {
      setIsDriveConnecting(false);
    }
  }, [driveConnection.connected]);

  /**
   * Explicit manual Sign Out / Disconnect from Google Drive
   */
  const handleDisconnectGoogleDrive = useCallback(async () => {
    setDriveError(null);
    setDriveSuccessNotice(null);
    setPendingQuickOverwrite(null);
    setPendingQuickRestore(null);
    await disconnectGoogleDrive();
    setLastDriveFile(null);
  }, []);

  /**
   * Executes the actual Google Drive API v3 multipart upload (PATCH existing file or POST new file)
   */
  const executeQuickDriveUpload = useCallback(
    async (format: 'xlsx' | 'json', existingFileId?: string, forceNewCopy = false) => {
      setIsDriveUploading(true);
      setDriveError(null);
      setDriveSuccessNotice(null);
      setPendingQuickOverwrite(null);

      try {
        const filename = forceNewCopy
          ? getTimestampedCopyFilename(format)
          : getCanonicalFilename(format);
        let uploaded: DriveUploadedFile;

        if (format === 'xlsx') {
          const excelBytes = generateCurrentDataExcelBytes(
            categories,
            categoryResults,
            expenses
          );
          uploaded = await uploadFileToGoogleDrive({
            filename,
            mimeType:
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            content: excelBytes,
            description:
              'VIP & Standard Seat Booking & Back-Office Expenses Excel Export',
            existingFileId: forceNewCopy ? undefined : existingFileId,
          });
        } else {
          const payload: CloudSystemState = {
            categories,
            categoryResults,
            expenses,
            spreadsheetTitle:
              spreadsheetTitle || 'VIP & Standard Seat Booking System',
            availableSheets,
            updatedAt: new Date().toISOString(),
          };
          uploaded = await uploadFileToGoogleDrive({
            filename,
            mimeType: 'application/json',
            content: JSON.stringify(payload, null, 2),
            description:
              'VIP & Standard Seat Booking System Complete JSON Backup',
            existingFileId: forceNewCopy ? undefined : existingFileId,
          });
        }

        setLastDriveFile(uploaded);
        setDriveSuccessNotice(
          existingFileId && !forceNewCopy
            ? `อัปเดตไฟล์เดิม "${uploaded.name}" บน Google Drive เรียบร้อยแล้ว`
            : `บันทึกไฟล์ใหม่ "${uploaded.name}" ขึ้น Google Drive เรียบร้อยแล้ว`
        );
      } catch (err: any) {
        setDriveError(
          err?.message || 'อัปโหลดไฟล์ไปยัง Google Drive ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'
        );
      } finally {
        setIsDriveUploading(false);
      }
    },
    [categories, categoryResults, expenses, spreadsheetTitle, availableSheets]
  );

  /**
   * REAL Google Drive API v3 Save:
   * - Checks if the canonical file already exists on Google Drive (without duplicating).
   * - If found, prompts explicit confirmation to update in-place via PATCH (or save as new copy).
   * - If not found, creates the file cleanly via POST.
   */
  const handleQuickSaveToGoogleDrive = useCallback(
    async (format: 'xlsx' | 'json' = 'json') => {
      const clientId = getStoredDriveClientId();
      if (!clientId) {
        setDriveError(
          'กรุณาระบุ Google Cloud OAuth Client ID ในหน้าต่าง Google Drive Settings ก่อนบันทึก'
        );
        setIsDriveModalOpen(true);
        return;
      }

      setDriveError(null);
      setDriveSuccessNotice(null);
      setPendingQuickRestore(null);

      try {
        if (!getDriveConnectionState().connected) {
          setIsDriveConnecting(true);
          try {
            await connectGoogleDrive(clientId, { prompt: 'consent' });
          } finally {
            setIsDriveConnecting(false);
          }
        }

        setIsDriveUploading(true);
        const canonicalName = getCanonicalFilename(format);
        const tracked = getActiveDriveFiles()[format];
        let existing: DriveUploadedFile | null = tracked || null;
        if (!existing) {
          existing = await findExistingDriveFileByName(canonicalName);
        }
        setIsDriveUploading(false);

        if (existing) {
          setPendingQuickOverwrite({ file: existing, format });
          return;
        }

        await executeQuickDriveUpload(format);
      } catch (err: any) {
        setIsDriveUploading(false);
        setDriveError(
          err?.message || 'ไม่สามารถเชื่อมต่อ Google Drive เพื่อบันทึกข้อมูลได้'
        );
      }
    },
    [executeQuickDriveUpload]
  );

  /**
   * Restore full validated app state from a real JSON or Excel backup file downloaded from Google Drive
   */
  const handleRestoreFromGoogleDrive = useCallback(
    (state: CloudSystemState, sourceFile: DriveUploadedFile) => {
      const hydrated = validateAndHydrateCloudState(state, categories);
      setCategories(hydrated.categories);
      setExpenses(hydrated.expenses);
      applyBatchResponse(
        {
          spreadsheetId: 'template-import',
          spreadsheetTitle:
            hydrated.spreadsheetTitle || `โหลดจาก Google Drive (${sourceFile.name})`,
          spreadsheetUrl: '',
          availableSheets:
            hydrated.availableSheets ||
            hydrated.categoryResults.map((r) => r.sheetName),
          categoryResults: hydrated.categoryResults,
          fetchedAt: sourceFile.modifiedTime || hydrated.updatedAt || new Date().toISOString(),
        },
        true
      );
      setLastDriveFile(sourceFile);
      setDriveError(null);
      setDriveSuccessNotice(
        `ดึงข้อมูลจาก Google Drive (${sourceFile.name}) เข้าสู่ระบบเรียบร้อยแล้ว`
      );
      setPendingQuickRestore(null);
      setIsDriveModalOpen(false);
    },
    [applyBatchResponse, categories]
  );

  /**
   * Queries Google Drive API v3 for the latest non-trashed backup file and asks explicit confirmation
   * before downloading (`?alt=media`) and replacing current workspace state.
   */
  const handleCheckLatestBackupFromDrive = useCallback(async () => {
    const clientId = getStoredDriveClientId();
    if (!clientId) {
      setDriveError(
        'กรุณาระบุ Google Cloud OAuth Client ID ในหน้าต่าง Google Drive Settings ก่อนดึงข้อมูล'
      );
      setIsDriveModalOpen(true);
      return;
    }

    setIsDriveLoadingBackup(true);
    setDriveError(null);
    setDriveSuccessNotice(null);
    setPendingQuickOverwrite(null);

    try {
      if (!getDriveConnectionState().connected) {
        await connectGoogleDrive(clientId, { prompt: 'consent' });
      }

      const files = await listAppCreatedDriveFiles();
      const latest =
        files.find(
          (f) =>
            f.mimeType === 'application/json' || f.name.toLowerCase().endsWith('.json')
        ) ||
        files.find(
          (f) =>
            f.mimeType ===
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
            f.name.toLowerCase().endsWith('.xlsx')
        );

      if (!latest) {
        setDriveError(
          'ไม่พบไฟล์สำรอง (.json หรือ .xlsx) ใน Google Drive ของคุณ กรุณากด "Save to Drive" เพื่อบันทึกไฟล์แรกก่อน'
        );
        return;
      }

      setPendingQuickRestore(latest);
    } catch (err: any) {
      setDriveError(
        err?.message || 'ไม่สามารถดึงรายการไฟล์สำรองจาก Google Drive ได้'
      );
    } finally {
      setIsDriveLoadingBackup(false);
    }
  }, []);

  /**
   * Downloads the confirmed backup file via GET /drive/v3/files/{fileId}?alt=media and hydrates state
   */
  const handleConfirmQuickRestore = useCallback(
    async (file: DriveUploadedFile) => {
      setIsDriveLoadingBackup(true);
      setDriveError(null);
      setDriveSuccessNotice(null);
      try {
        const isJson =
          file.mimeType === 'application/json' ||
          file.name.toLowerCase().endsWith('.json');
        let hydrated: CloudSystemState;

        if (isJson) {
          const rawJson = await downloadJsonFileFromGoogleDrive<unknown>(file.id);
          hydrated = validateAndHydrateCloudState(rawJson, categories);
        } else {
          const buffer = await downloadBinaryFileFromGoogleDrive(file.id);
          hydrated = buildCloudSystemStateFromExcelBuffer(
            buffer,
            file.name,
            categories
          );
        }

        handleRestoreFromGoogleDrive(hydrated, file);
      } catch (err: any) {
        setDriveError(
          err?.message || 'ไม่สามารถดาวน์โหลดหรืออ่านข้อมูลจากไฟล์สำรองใน Google Drive ได้'
        );
      } finally {
        setIsDriveLoadingBackup(false);
      }
    },
    [categories, handleRestoreFromGoogleDrive]
  );

  const loadSheetData = useCallback(
    async (targetSpreadsheetId: string, targetCategories: CategoryConfig[]) => {
      if (!targetSpreadsheetId || targetSpreadsheetId === 'template-import') return;
      if (!hasActiveDriveToken()) {
        return;
      }

      setIsLoadingData(true);
      setDataError(null);
      try {
        const res = await fetchAllCategorySheets(targetSpreadsheetId, targetCategories);
        applyBatchResponse(res, false);
      } catch (err: any) {
        console.error('Error loading spreadsheet data:', err);
        if (err.code === 'UNAUTHENTICATED') {
          setHasLegacySheetToken(false);
        }
        setDataError(
          err.message ||
            'ไม่สามารถเชื่อมต่อไฟล์ Google Sheets นี้ได้ คุณสามารถสลับไปนำเข้าไฟล์แม่แบบ Excel (.xlsx) หรือเลือกไฟล์ใหม่ได้ด้านล่าง'
        );
      } finally {
        setIsLoadingData(false);
      }
    },
    [applyBatchResponse]
  );

  useEffect(() => {
    if (hasLegacySheetToken && spreadsheetId && spreadsheetId !== 'template-import') {
      loadSheetData(spreadsheetId, categories);
    }
  }, [hasLegacySheetToken, spreadsheetId, categories, loadSheetData]);

  const loadInitialDriveSpreadsheets = useCallback(
    async (query = '', mode: DriveFilterMode = driveFilter) => {
      if (!hasActiveDriveToken()) return;
      setIsLoadingDriveFiles(true);
      try {
        const files = await listDriveSpreadsheets(query, mode);
        setDriveFiles(files);
      } catch (err: any) {
        console.error('Error listing drive spreadsheets:', err);
      } finally {
        setIsLoadingDriveFiles(false);
      }
    },
    [driveFilter]
  );

  useEffect(() => {
    if (hasLegacySheetToken && !spreadsheetId) {
      loadInitialDriveSpreadsheets(driveSearchQuery, driveFilter);
    }
  }, [hasLegacySheetToken, spreadsheetId, driveFilter, loadInitialDriveSpreadsheets, driveSearchQuery]);

  const handleLegacySheetsLogin = async () => {
    setIsLoggingInSheets(true);
    setAuthError(null);
    try {
      const result = await googleSignIn({ loginHint: userEmail || undefined });
      if (result) {
        setPersistentUser(result.profile);
        setHasLegacySheetToken(true);
      }
    } catch (err: any) {
      const errorCode = err?.code || '';
      if (
        errorCode === 'auth/popup-closed-by-user' ||
        errorCode === 'auth/cancelled-popup-request' ||
        errorCode === 'auth/user-cancelled'
      ) {
        return;
      }
      if (errorCode === 'auth/popup-blocked') {
        setAuthError(
          'เบราว์เซอร์บล็อกหน้าต่างป๊อปอัป กรุณาอนุญาตป๊อปอัปสำหรับเว็บไซต์นี้แล้วลองอีกครั้ง'
        );
        return;
      }
      setAuthError(err.message || 'การเข้าสู่ระบบด้วย Google ล้มเหลว กรุณาลองใหม่อีกครั้ง');
    } finally {
      setIsLoggingInSheets(false);
    }
  };

  /**
   * 100% Client-Side Instant Excel Template Import
   */
  const handleImportTemplateFiles = async (
    targetCategories: CategoryConfig[],
    sheets: TemplateSheetPayload[],
    title?: string,
    availSheets?: string[],
    importedExpenses?: ExpenseRecord[]
  ) => {
    setIsLoadingData(true);
    setDataError(null);
    try {
      setCategories(targetCategories);
      const res = buildBatchReadResponseFromSheets(
        targetCategories,
        sheets,
        title || 'นำเข้าจากแม่แบบ Excel (VIP & Standard)',
        availSheets
      );
      applyBatchResponse(res, true);
      if (importedExpenses && importedExpenses.length > 0) {
        setExpenses(importedExpenses);
      }
    } catch (err: any) {
      setDataError(err?.message || 'เกิดข้อผิดพลาดในการอ่านไฟล์แม่แบบ Excel');
    } finally {
      setIsLoadingData(false);
    }
  };

  const handleLoadDefaultTemplate = useCallback(() => {
    const res = createInitialTemplateResponse(categories);
    applyBatchResponse(res, true);
  }, [categories, applyBatchResponse]);

  /**
   * Functional state updates eliminate stale-closure bugs during rapid edits
   */
  const handleUpdateRecord = useCallback((updated: SeatRecord) => {
    setLastSyncedAt(new Date().toISOString());
    setCategoryResults((prev) =>
      prev.map((catRes) => {
        if (catRes.categoryId !== updated.categoryId) return catRes;
        return {
          ...catRes,
          records: catRes.records.map((r) => (r.id === updated.id ? updated : r)),
        };
      })
    );
  }, []);

  const handleAddRecord = useCallback(
    (categoryId: string, newRecord: SeatRecord) => {
      const catConfig = categories.find((c) => c.id === categoryId);
      setLastSyncedAt(new Date().toISOString());
      setCategoryResults((prev) => {
        const exists = prev.some((r) => r.categoryId === categoryId);
        if (exists) {
          return prev.map((catRes) => {
            if (catRes.categoryId !== categoryId) return catRes;
            if (catRes.records.some((r) => r.id === newRecord.id)) return catRes;
            return {
              ...catRes,
              foundSheet: true,
              records: [...catRes.records, newRecord],
            };
          });
        }
        return [
          ...prev,
          {
            categoryId,
            categoryName: catConfig?.name || categoryId,
            sheetName: catConfig?.sheetName || categoryId,
            foundSheet: true,
            columnMap: resolveColumnMapFromRow(STANDARD_TEMPLATE_HEADERS).columnMap,
            records: [newRecord],
          },
        ];
      });
    },
    [categories]
  );

  const handleAddMultipleRecords = useCallback(
    (categoryId: string, newRecords: SeatRecord[]) => {
      if (newRecords.length === 0) return;
      const catConfig = categories.find((c) => c.id === categoryId);
      setLastSyncedAt(new Date().toISOString());
      setCategoryResults((prev) => {
        const exists = prev.some((r) => r.categoryId === categoryId);
        if (exists) {
          return prev.map((catRes) => {
            if (catRes.categoryId !== categoryId) return catRes;
            return {
              ...catRes,
              foundSheet: true,
              records: [...catRes.records, ...newRecords],
            };
          });
        }
        return [
          ...prev,
          {
            categoryId,
            categoryName: catConfig?.name || categoryId,
            sheetName: catConfig?.sheetName || categoryId,
            foundSheet: true,
            columnMap: resolveColumnMapFromRow(STANDARD_TEMPLATE_HEADERS).columnMap,
            records: newRecords,
          },
        ];
      });
    },
    [categories]
  );

  const handleDeleteRecord = useCallback((recordId: string) => {
    setLastSyncedAt(new Date().toISOString());
    setCategoryResults((prev) =>
      prev.map((catRes) => ({
        ...catRes,
        records: catRes.records.filter((r) => r.id !== recordId),
      }))
    );
  }, []);

  const handleOpenMoveTableModal = useCallback((seat?: SeatRecord) => {
    setMoveModalSourceSeatId(seat?.id || null);
    setIsMoveModalOpen(true);
  }, []);

  /**
   * Atomically moves a booking to an empty table OR swaps two booked tables
   * (supports both same-zone and cross-zone transfers without losing any field).
   */
  const handleMoveOrSwapTable = useCallback(
    (
      sourceId: string,
      targetId: string,
      options: { appendTransferNote: boolean } = { appendTransferNote: true }
    ) => {
      if (!sourceId || !targetId || sourceId === targetId) return;

      const extractBookingPayload = (seat: SeatRecord): Partial<SeatRecord> => ({
        fullName: seat.fullName || '',
        phone: seat.phone || '',
        transferAmount: seat.transferAmount || 0,
        rawTransferAmount: seat.rawTransferAmount || '',
        transferDate: seat.transferDate || '',
        slipUrl: seat.slipUrl || '',
        slipUrl2: seat.slipUrl2 || '',
        isPaid: Boolean(seat.isPaid),
        isCheckedIn: Boolean(seat.isCheckedIn),
        checkedInAt: seat.checkedInAt || '',
        isTicketCollected: Boolean(seat.isTicketCollected),
        ticketCollectedAt: seat.ticketCollectedAt || '',
        note: seat.note || '',
      });

      const emptyPayload: Partial<SeatRecord> = {
        fullName: '',
        phone: '',
        transferAmount: 0,
        rawTransferAmount: '',
        transferDate: '',
        slipUrl: '',
        slipUrl2: '',
        isPaid: false,
        isCheckedIn: false,
        checkedInAt: '',
        isTicketCollected: false,
        ticketCollectedAt: '',
        note: '',
      };

      const appendTag = (existingNote: string | undefined, tag: string): string => {
        const cleanExisting = String(existingNote || '').trim();
        if (!cleanExisting) return tag;
        if (cleanExisting.includes(tag)) return cleanExisting;
        return `${cleanExisting} | ${tag}`;
      };

      // Build human-readable notice before atomic state update
      let snapshotSource: SeatRecord | null = null;
      let snapshotTarget: SeatRecord | null = null;
      for (const cat of categoryResults) {
        for (const rec of cat.records) {
          if (rec.id === sourceId) snapshotSource = rec;
          if (rec.id === targetId) snapshotTarget = rec;
        }
      }

      setLastSyncedAt(new Date().toISOString());
      setCategoryResults((prev) => {
        let sourceRec: SeatRecord | null = null;
        let targetRec: SeatRecord | null = null;
        for (const catRes of prev) {
          for (const r of catRes.records) {
            if (r.id === sourceId) sourceRec = r;
            if (r.id === targetId) targetRec = r;
          }
        }
        if (!sourceRec || !targetRec) return prev;
        if (!sourceRec.isBooked && !targetRec.isBooked) return prev;

        const isSwap = sourceRec.isBooked && targetRec.isBooked;
        const isCrossZone = sourceRec.categoryId !== targetRec.categoryId;
        const shouldLogNote = Boolean(options.appendTransferNote);

        let nextSourcePayload: Partial<SeatRecord>;
        let nextTargetPayload: Partial<SeatRecord>;

        if (isSwap) {
          const fromSource = extractBookingPayload(sourceRec);
          const fromTarget = extractBookingPayload(targetRec);
          nextTargetPayload = {
            ...fromSource,
            note: shouldLogNote
              ? appendTag(
                  fromSource.note,
                  `[สลับจาก ${sourceRec.tableNumber}${isCrossZone ? ` (${sourceRec.categoryName})` : ''}]`
                )
              : fromSource.note,
          };
          nextSourcePayload = {
            ...fromTarget,
            note: shouldLogNote
              ? appendTag(
                  fromTarget.note,
                  `[สลับจาก ${targetRec.tableNumber}${isCrossZone ? ` (${targetRec.categoryName})` : ''}]`
                )
              : fromTarget.note,
          };
        } else if (sourceRec.isBooked && !targetRec.isBooked) {
          const fromSource = extractBookingPayload(sourceRec);
          nextTargetPayload = {
            ...fromSource,
            note: shouldLogNote
              ? appendTag(
                  fromSource.note,
                  `[ย้ายจาก ${sourceRec.tableNumber}${isCrossZone ? ` (${sourceRec.categoryName})` : ''}]`
                )
              : fromSource.note,
          };
          nextSourcePayload = emptyPayload;
        } else {
          // targetRec is booked and sourceRec is empty -> move target into source
          const fromTarget = extractBookingPayload(targetRec);
          nextSourcePayload = {
            ...fromTarget,
            note: shouldLogNote
              ? appendTag(
                  fromTarget.note,
                  `[ย้ายจาก ${targetRec.tableNumber}${isCrossZone ? ` (${targetRec.categoryName})` : ''}]`
                )
              : fromTarget.note,
          };
          nextTargetPayload = emptyPayload;
        }

        const updatedSource = buildUpdatedSeatRecord(sourceRec, nextSourcePayload);
        const updatedTarget = buildUpdatedSeatRecord(targetRec, nextTargetPayload);

        return prev.map((catRes) => ({
          ...catRes,
          records: catRes.records.map((r) => {
            if (r.id === sourceId) return updatedSource;
            if (r.id === targetId) return updatedTarget;
            return r;
          }),
        }));
      });

      if (snapshotSource && snapshotTarget) {
        if (snapshotSource.isBooked && snapshotTarget.isBooked) {
          setTransferNotice(
            `สลับโต๊ะ ${snapshotSource.tableNumber} (${snapshotSource.fullName || 'จองแล้ว'}) ↔ โต๊ะ ${snapshotTarget.tableNumber} (${snapshotTarget.fullName || 'จองแล้ว'}) เรียบร้อยแล้ว`
          );
        } else if (snapshotSource.isBooked) {
          setTransferNotice(
            `ย้ายข้อมูลโต๊ะ ${snapshotSource.tableNumber} (${snapshotSource.fullName || 'จองแล้ว'}) ไปยังโต๊ะ ${snapshotTarget.tableNumber} (${snapshotTarget.categoryName}) เรียบร้อยแล้ว`
          );
        } else if (snapshotTarget.isBooked) {
          setTransferNotice(
            `ย้ายข้อมูลโต๊ะ ${snapshotTarget.tableNumber} (${snapshotTarget.fullName || 'จองแล้ว'}) ไปยังโต๊ะ ${snapshotSource.tableNumber} (${snapshotSource.categoryName}) เรียบร้อยแล้ว`
          );
        }
      }
    },
    [categoryResults]
  );

  const handleAddExpense = useCallback(
    (expenseInput: Omit<ExpenseRecord, 'id' | 'createdAt'>) => {
      const newExp: ExpenseRecord = {
        ...expenseInput,
        id: `exp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        createdAt: new Date().toISOString(),
      };
      setExpenses((prev) => [newExp, ...prev]);
    },
    []
  );

  const handleUpdateExpense = useCallback((updatedExp: ExpenseRecord) => {
    setExpenses((prev) =>
      prev.map((item) => (item.id === updatedExp.id ? updatedExp : item))
    );
  }, []);

  const handleDeleteExpense = useCallback((expenseId: string) => {
    setExpenses((prev) => prev.filter((item) => item.id !== expenseId));
  }, []);

  const handleExportExcel = useCallback(() => {
    exportCurrentDataToExcel(categories, categoryResults, expenses);
  }, [categories, categoryResults, expenses]);

  /**
   * Reconciles categoryResults whenever categories are added, renamed, or deleted in SettingsModal
   */
  const handleSaveSettings = (newId: string, newCategories: CategoryConfig[]) => {
    setCategories(newCategories);

    if (newId && newId !== 'template-import') {
      if (newId !== spreadsheetId) {
        setSpreadsheetId(newId);
      } else {
        loadSheetData(newId, newCategories);
      }
      return;
    }

    // Reconcile local template categoryResults with updated categories
    setCategoryResults((prev) => {
      const existingById = new Map(prev.map((r) => [r.categoryId, r]));
      return newCategories.map((cat) => {
        const existing = existingById.get(cat.id);
        if (existing) {
          return {
            ...existing,
            categoryName: cat.name,
            sheetName: cat.sheetName,
            records: existing.records.map((rec) => ({
              ...rec,
              categoryName: cat.name,
              sheetName: cat.sheetName,
            })),
          };
        }
        return {
          categoryId: cat.id,
          categoryName: cat.name,
          sheetName: cat.sheetName,
          foundSheet: true,
          columnMap: resolveColumnMapFromRow(STANDARD_TEMPLATE_HEADERS).columnMap,
          records: [],
        };
      });
    });
    setAvailableSheets(newCategories.map((c) => c.sheetName));
    setLastSyncedAt(new Date().toISOString());
  };

  const handleResetColors = () => {
    setCategories((prev) =>
      prev.map((c) => {
        if (c.id === 'vip') return { ...c, colorHex: '#D97706' };
        if (c.id === 'standard') return { ...c, colorHex: '#2563EB' };
        return c;
      })
    );
  };

  // Flatten all SeatRecord items strictly belonging to active configured categories
  const activeCategoryIdSet = useMemo(
    () => new Set(categories.map((c) => c.id)),
    [categories]
  );

  const allRecords: SeatRecord[] = useMemo(() => {
    return categoryResults
      .filter((res) => activeCategoryIdSet.has(res.categoryId))
      .flatMap((res) => res.records || []);
  }, [categoryResults, activeCategoryIdSet]);

  const missingSheetWarnings = useMemo(() => {
    return categoryResults.filter(
      (r) => activeCategoryIdSet.has(r.categoryId) && !r.foundSheet
    );
  }, [categoryResults, activeCategoryIdSet]);

  const driveUserLabel =
    driveConnection.user?.emailAddress || driveConnection.user?.displayName || null;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Top Bar */}
      <Navbar
        activeTab={activeTab}
        onSelectTab={(tab) => {
          setActiveTab(tab);
          if (tab !== 'seatmap') {
            setSeatMapCategoryFilter('all');
          }
        }}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenDriveModal={() => setIsDriveModalOpen(true)}
        isDriveConnected={driveConnection.connected}
        isDriveNeedsReauth={driveConnection.needsReauth}
        driveUserLabel={driveUserLabel}
        isDriveConnecting={isDriveConnecting || driveConnection.isRefreshing}
        isDriveUploading={isDriveUploading}
        isDriveLoadingBackup={isDriveLoadingBackup}
        onConnectOrSaveDrive={() => {
          if (driveConnection.connected && !driveConnection.needsReauth) {
            handleQuickSaveToGoogleDrive('json');
          } else {
            handleConnectGoogleDrive();
          }
        }}
        onLoadFromDrive={handleCheckLatestBackupFromDrive}
        onDisconnectDrive={handleDisconnectGoogleDrive}
      />

      {/* Main Content Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Storage Quota Warning (if any) */}
        {storageWarning && (
          <div className="bg-amber-50 border-2 border-amber-400 rounded-xl px-4 py-3 flex items-center justify-between gap-3 text-xs text-amber-950">
            <div className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>{storageWarning}</span>
            </div>
            <button
              type="button"
              onClick={() => setIsDriveModalOpen(true)}
              className="px-3 py-1.5 font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer shrink-0"
            >
              Save to Google Drive
            </button>
          </div>
        )}

        {/* Table Transfer / Swap Success Banner */}
        {transferNotice && (
          <div className="bg-indigo-50 border-2 border-indigo-400 rounded-xl px-4 py-3 flex items-center justify-between gap-3 text-xs sm:text-sm text-indigo-950 shadow-2xs">
            <div className="flex items-center gap-2.5 font-bold min-w-0">
              <div className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0">
                <ArrowRightLeft className="w-4 h-4" />
              </div>
              <span className="break-words">{transferNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setTransferNotice(null)}
              aria-label="ปิดการแจ้งเตือน"
              className="p-1 text-indigo-500 hover:text-indigo-900 rounded-lg cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* State 1: No Data Imported Yet -> Show Excel Template Import & Sheets Hub */}
        {!spreadsheetId ? (
          <div className="max-w-4xl mx-auto space-y-6 my-4">
            <div className="bg-white border-2 border-slate-300 rounded-2xl p-6 sm:p-8 space-y-6">
              {/* Header */}
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-5">
                <div className="flex items-start gap-3.5">
                  <div className="w-12 h-12 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0">
                    <FileSpreadsheet className="w-6 h-6" />
                  </div>
                  <div>
                    <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
                      นำเข้าข้อมูลการจองโต๊ะจากแม่แบบ Excel (VIP & Standard)
                    </h1>
                    <p className="text-xs sm:text-sm text-slate-500 mt-1">
                      อัปโหลดไฟล์แม่แบบ Excel (.xlsx / .xls / .csv) หรือเชื่อมต่อ Google Drive เพื่อบันทึกและกู้คืนข้อมูล
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setIsDriveModalOpen(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl cursor-pointer"
                >
                  <Cloud className="w-4 h-4" />
                  Google Drive Settings
                </button>
              </div>

              {/* Section 1: Excel Multi-Sheet Template Importer */}
              <ExcelTemplateImporter
                categories={categories}
                isSubmitting={isLoadingData}
                onImportSheets={handleImportTemplateFiles}
                onLoadDefaultTemplate={handleLoadDefaultTemplate}
              />

              {/* Section 2: Import Existing Google Sheet */}
              <div className="space-y-4 pt-2 border-t border-slate-100">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                      นำเข้าข้อมูลจากไฟล์ Google Sheets ที่มีอยู่แล้ว
                    </h2>
                  </div>

                  {hasLegacySheetToken && (
                    <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                      <button
                        type="button"
                        onClick={() => setDriveFilter('sharedWithMe')}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                          driveFilter === 'sharedWithMe'
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        <Share2 className="w-3.5 h-3.5" />
                        แชร์กับฉัน
                      </button>
                      <button
                        type="button"
                        onClick={() => setDriveFilter('all')}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                          driveFilter === 'all'
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                        ไฟล์ทั้งหมดใน Drive
                      </button>
                    </div>
                  )}
                </div>

                {authError && (
                  <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs font-medium text-red-700">
                    {authError}
                  </div>
                )}

                {!hasLegacySheetToken ? (
                  <div className="p-5 bg-slate-50 border border-slate-200 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-4">
                    <p className="text-xs text-slate-600">
                      เข้าสู่ระบบ Google เพื่อเลือกไฟล์ Google Sheets ที่มีอยู่แล้วใน Drive มาเปิดใช้งาน
                    </p>
                    <button
                      type="button"
                      onClick={handleLegacySheetsLogin}
                      disabled={isLoggingInSheets}
                      className="px-4 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl cursor-pointer shrink-0"
                    >
                      {isLoggingInSheets ? 'กำลังเชื่อมต่อ...' : 'เชื่อมต่อ Google Sheets'}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          value={driveSearchQuery}
                          onChange={(e) => setDriveSearchQuery(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              loadInitialDriveSpreadsheets(driveSearchQuery, driveFilter);
                            }
                          }}
                          placeholder="ค้นหาชื่อไฟล์ใน Google Drive..."
                          className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:border-slate-900"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => loadInitialDriveSpreadsheets(driveSearchQuery, driveFilter)}
                        disabled={isLoadingDriveFiles}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isLoadingDriveFiles ? 'animate-spin' : ''}`} />
                        ค้นหา
                      </button>
                    </div>

                    {isLoadingDriveFiles ? (
                      <div className="py-10 text-center text-sm text-slate-500">
                        กำลังดึงรายการไฟล์จาก Google Drive...
                      </div>
                    ) : driveFiles.length === 0 ? (
                      <div className="py-8 text-center text-xs text-slate-500 bg-slate-50 rounded-xl border border-slate-200">
                        ไม่พบไฟล์ Google Sheets ในรายการ
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-80 overflow-y-auto">
                        {driveFiles.map((file) => {
                          const ownerName =
                            file.owners?.[0]?.displayName || file.owners?.[0]?.emailAddress || '';
                          return (
                            <button
                              key={file.id}
                              type="button"
                              onClick={() => setSpreadsheetId(file.id)}
                              className="p-3.5 text-left bg-slate-50 hover:bg-slate-100 border border-slate-200 hover:border-slate-400 rounded-xl transition-all flex items-center justify-between gap-3 cursor-pointer"
                            >
                              <div className="min-w-0 flex-1 space-y-0.5">
                                <p className="text-sm font-semibold text-slate-900 truncate">
                                  {file.name}
                                </p>
                                <p className="text-xs text-slate-500 truncate">
                                  {ownerName ? `แชร์โดย: ${ownerName}` : 'Google Sheets'}
                                  {file.modifiedTime &&
                                    ` · ${new Date(file.modifiedTime).toLocaleDateString('th-TH')}`}
                                </p>
                              </div>
                              <FileSpreadsheet className="w-5 h-5 text-emerald-600 shrink-0" />
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* State 2: Main Operational Console */
          <>
            {/* Real Google Drive Persistent Session Bar */}
            <div className="bg-white border-2 border-slate-300 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shadow-xs">
              <div className="flex flex-wrap items-center gap-2.5 text-xs min-w-0 flex-1">
                {driveConnection.isRefreshing ? (
                  <span className="inline-flex items-center gap-1.5 font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-md shrink-0">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    กำลังต่ออายุเซสชัน Google Drive...
                  </span>
                ) : driveConnection.connected && !driveConnection.needsReauth ? (
                  <span className="inline-flex items-center gap-1.5 font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-md shrink-0">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Google Drive Connected
                    {driveUserLabel ? `: ${driveUserLabel}` : ''}
                  </span>
                ) : driveConnection.connected && driveConnection.needsReauth ? (
                  <span className="inline-flex items-center gap-1.5 font-bold text-amber-800 bg-amber-50 border border-amber-300 px-2.5 py-1 rounded-md shrink-0">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    เซสชันหมดอายุ ({driveUserLabel || 'Google Drive'}) — กด Reconnect
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 font-bold text-slate-700 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-md shrink-0">
                    <Cloud className="w-3.5 h-3.5 text-slate-500" />
                    Google Drive: Not Connected
                  </span>
                )}

                {isDriveUploading && (
                  <span className="inline-flex items-center gap-1.5 text-emerald-700 font-bold">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    กำลังบันทึกไฟล์ขึ้น Google Drive...
                  </span>
                )}

                {isDriveLoadingBackup && (
                  <span className="inline-flex items-center gap-1.5 text-blue-700 font-bold">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    กำลังดึงข้อมูลจาก Google Drive...
                  </span>
                )}

                {!isDriveUploading && !isDriveLoadingBackup && lastDriveFile && (
                  <span className="inline-flex flex-wrap items-center gap-2 text-emerald-800 font-semibold">
                    <span>
                      {driveSuccessNotice || `ไฟล์ล่าสุดบน Drive: ${lastDriveFile.name}`}
                    </span>
                    <a
                      href={lastDriveFile.webViewLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-100 hover:bg-emerald-200 text-emerald-900 font-bold transition-colors"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Open in Drive
                    </a>
                  </span>
                )}

                {!isDriveUploading && !isDriveLoadingBackup && !lastDriveFile && !driveError && (
                  <span className="text-slate-500">
                    {driveConnection.connected
                      ? 'เซสชันจะคงอยู่ตลอดจนกว่าจะกด Sign Out — กด Load เพื่อดึงข้อมูล หรือ Save เพื่ออัปเดตไฟล์ขึ้น Drive'
                      : 'เชื่อมต่อ Google Drive เพื่อบันทึกและดึงข้อมูลข้ามเครื่องได้จริงผ่าน Google Drive API v3'}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsDriveModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg transition-colors cursor-pointer"
                >
                  <Settings className="w-3.5 h-3.5" />
                  Drive Settings &amp; Backups
                </button>

                {driveConnection.connected ? (
                  <>
                    <button
                      type="button"
                      onClick={handleCheckLatestBackupFromDrive}
                      disabled={isDriveLoadingBackup || isDriveUploading || isDriveConnecting}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-300 rounded-lg transition-colors cursor-pointer disabled:opacity-60"
                    >
                      {isDriveLoadingBackup ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <CloudDownload className="w-3.5 h-3.5" />
                      )}
                      Load from Drive
                    </button>

                    {driveConnection.needsReauth ? (
                      <button
                        type="button"
                        onClick={handleConnectGoogleDrive}
                        disabled={isDriveConnecting}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors cursor-pointer disabled:opacity-60"
                      >
                        {isDriveConnecting ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Cloud className="w-3.5 h-3.5" />
                        )}
                        Reconnect
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleQuickSaveToGoogleDrive('json')}
                        disabled={isDriveUploading || isDriveLoadingBackup || isDriveConnecting}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors cursor-pointer disabled:opacity-60"
                      >
                        {isDriveUploading ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <CloudUpload className="w-3.5 h-3.5" />
                        )}
                        {isDriveUploading ? 'Saving...' : 'Save to Google Drive'}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={handleDisconnectGoogleDrive}
                      disabled={isDriveUploading || isDriveLoadingBackup}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors cursor-pointer disabled:opacity-60"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      Sign Out
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={handleConnectGoogleDrive}
                    disabled={isDriveConnecting}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer disabled:opacity-60"
                  >
                    {isDriveConnecting ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Cloud className="w-3.5 h-3.5" />
                    )}
                    {isDriveConnecting ? 'Connecting...' : 'Connect Google Drive'}
                  </button>
                )}
              </div>
            </div>

            {/* Explicit In-App Confirmation for Updating Existing Google Drive File (PATCH) */}
            {pendingQuickOverwrite && (
              <div className="bg-amber-50 border-2 border-amber-400 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs text-amber-950">
                <div className="flex items-start gap-2.5 min-w-0 flex-1">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <p className="break-words">
                    พบไฟล์ <strong className="font-mono">{pendingQuickOverwrite.file.name}</strong> บน Google Drive อยู่แล้ว ยืนยันการอัปเดตทับไฟล์เดิม (PATCH) เพื่อไม่ให้มีไฟล์ซ้ำใช่หรือไม่?
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setPendingQuickOverwrite(null)}
                    disabled={isDriveUploading}
                    className="px-3 py-1.5 font-bold text-slate-700 bg-white border border-slate-300 rounded-lg cursor-pointer"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      executeQuickDriveUpload(pendingQuickOverwrite.format, undefined, true)
                    }
                    disabled={isDriveUploading}
                    className="px-3 py-1.5 font-bold text-slate-800 bg-white hover:bg-slate-100 border border-slate-400 rounded-lg cursor-pointer"
                  >
                    สร้างเป็นไฟล์ใหม่แทน
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      executeQuickDriveUpload(
                        pendingQuickOverwrite.format,
                        pendingQuickOverwrite.file.id,
                        false
                      )
                    }
                    disabled={isDriveUploading}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg cursor-pointer disabled:opacity-60"
                  >
                    {isDriveUploading && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                    ยืนยันอัปเดตไฟล์เดิม
                  </button>
                </div>
              </div>
            )}

            {/* Explicit In-App Confirmation for Loading / Restoring Latest Backup from Google Drive */}
            {pendingQuickRestore && (
              <div className="bg-blue-50 border-2 border-blue-400 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs text-blue-950">
                <div className="flex items-start gap-2.5 min-w-0 flex-1">
                  <CloudDownload className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                  <p className="break-words">
                    พบไฟล์สำรองล่าสุดบน Google Drive:{' '}
                    <strong className="font-mono">{pendingQuickRestore.name}</strong>
                    {pendingQuickRestore.modifiedTime && (
                      <> (แก้ไขล่าสุด {new Date(pendingQuickRestore.modifiedTime).toLocaleString('th-TH')})</>
                    )}{' '}
                    — ยืนยันการโหลดข้อมูลนี้มาแทนที่ข้อมูลบนหน้าจอปัจจุบันใช่หรือไม่?
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setPendingQuickRestore(null)}
                    disabled={isDriveLoadingBackup}
                    className="px-3 py-1.5 font-bold text-slate-700 bg-white border border-slate-300 rounded-lg cursor-pointer"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPendingQuickRestore(null);
                      setIsDriveModalOpen(true);
                    }}
                    disabled={isDriveLoadingBackup}
                    className="px-3 py-1.5 font-bold text-blue-800 bg-white hover:bg-blue-100 border border-blue-300 rounded-lg cursor-pointer"
                  >
                    เลือกจากรายการทั้งหมด
                  </button>
                  <button
                    type="button"
                    onClick={() => handleConfirmQuickRestore(pendingQuickRestore)}
                    disabled={isDriveLoadingBackup}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer disabled:opacity-60"
                  >
                    {isDriveLoadingBackup && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                    ยืนยันโหลดข้อมูลล่าสุด
                  </button>
                </div>
              </div>
            )}

            {/* Real Google Drive API / GIS Error Banner (if any) */}
            {driveError && (
              <div className="bg-red-50 border-2 border-red-300 rounded-xl px-4 py-3 flex items-start justify-between gap-3 text-xs text-red-900">
                <div className="flex items-start gap-2.5 min-w-0">
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <p className="font-extrabold text-red-800">
                      Google Drive Error
                    </p>
                    <p className="font-medium break-words">{driveError}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {driveConnection.needsReauth && (
                    <button
                      type="button"
                      onClick={handleConnectGoogleDrive}
                      disabled={isDriveConnecting}
                      className="px-2.5 py-1 font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg cursor-pointer"
                    >
                      Reconnect
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsDriveModalOpen(true)}
                    className="px-2.5 py-1 font-bold text-red-800 bg-white hover:bg-red-100 border border-red-300 rounded-lg cursor-pointer"
                  >
                    Open Drive Settings
                  </button>
                  <button
                    type="button"
                    onClick={() => setDriveError(null)}
                    aria-label="Dismiss error"
                    className="p-1 text-red-500 hover:text-red-800 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Connection Context & Error Recovery Banner (if any) */}
            {dataError && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-red-900">
                      ไม่สามารถเชื่อมต่อไฟล์ต้นทางได้
                    </h3>
                    <p className="text-xs text-red-700">{dataError}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDataError(null);
                      setSpreadsheetId('');
                    }}
                    className="px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
                  >
                    กลับไปหน้านำเข้าแม่แบบ Excel (.xlsx)
                  </button>
                  <button
                    type="button"
                    onClick={handleLoadDefaultTemplate}
                    className="px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer"
                  >
                    เปิดตารางแม่แบบเริ่มต้นทันที
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsSettingsOpen(true)}
                    className="px-3.5 py-2 text-xs font-semibold text-red-800 bg-white border border-red-300 hover:bg-red-100 rounded-lg cursor-pointer"
                  >
                    ตั้งค่าแผ่นงาน
                  </button>
                </div>
              </div>
            )}

            {/* Warning if some configured sheets were not found */}
            {!dataError && !isLoadingData && missingSheetWarnings.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-900 space-y-1">
                    <p className="font-bold text-sm">
                      ยังไม่มีข้อมูลบางแผ่นงานใน &ldquo;{spreadsheetTitle}&rdquo;
                    </p>
                    <p>
                      แผ่นงานที่ยังไม่ได้นำเข้า:{' '}
                      <span className="font-semibold">
                        {missingSheetWarnings.map((w) => w.sheetName).join(', ')}
                      </span>
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-amber-900 bg-white border border-amber-300 hover:bg-amber-100 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Settings className="w-3.5 h-3.5" />
                  นำเข้าแม่แบบ Excel / จับคู่แผ่นงาน
                </button>
              </div>
            )}

            {/* Active View Content */}
            {activeTab === 'lookup' && (
              <LookupView
                records={allRecords}
                categories={categories}
                isLoading={isLoadingData}
                onRefresh={() => {
                  if (spreadsheetId === 'template-import') {
                    setIsSettingsOpen(true);
                  } else {
                    loadSheetData(spreadsheetId, categories);
                  }
                }}
                lastSyncedAt={lastDriveFile?.modifiedTime || lastSyncedAt}
                onUpdateRecord={handleUpdateRecord}
                onDeleteRecord={handleDeleteRecord}
                onAddRecord={handleAddRecord}
                onAddMultipleRecords={handleAddMultipleRecords}
                onRequestMoveTable={handleOpenMoveTableModal}
              />
            )}

            {activeTab === 'dashboard' && (
              <DashboardView
                records={allRecords}
                categories={categories}
                categoryResults={categoryResults}
                expenses={expenses}
                isLoading={isLoadingData}
                onRefresh={() => {
                  if (spreadsheetId === 'template-import') {
                    setIsSettingsOpen(true);
                  } else {
                    loadSheetData(spreadsheetId, categories);
                  }
                }}
                onOpenSettings={() => setIsSettingsOpen(true)}
                onOpenBackOffice={() => setActiveTab('backoffice')}
                onExportExcel={handleExportExcel}
                onInspectCategoryInSeatMap={(categoryId) => {
                  setSeatMapCategoryFilter(categoryId);
                  setActiveTab('seatmap');
                }}
                onUpdateRecord={handleUpdateRecord}
                onDeleteRecord={handleDeleteRecord}
                onAddRecord={handleAddRecord}
                onAddMultipleRecords={handleAddMultipleRecords}
                onRequestMoveTable={handleOpenMoveTableModal}
              />
            )}

            {activeTab === 'seatmap' && (
              <SeatMapView
                records={allRecords}
                categories={categories}
                initialCategoryFilter={seatMapCategoryFilter}
                onUpdateRecord={handleUpdateRecord}
                onDeleteRecord={handleDeleteRecord}
                onAddRecord={handleAddRecord}
                onAddMultipleRecords={handleAddMultipleRecords}
                onRequestMoveTable={handleOpenMoveTableModal}
              />
            )}

            {activeTab === 'backoffice' && (
              <BackOfficeView
                records={allRecords}
                categories={categories}
                expenses={expenses}
                onAddExpense={handleAddExpense}
                onUpdateExpense={handleUpdateExpense}
                onDeleteExpense={handleDeleteExpense}
                onUpdateRecord={handleUpdateRecord}
                onAddRecord={handleAddRecord}
                onAddMultipleRecords={handleAddMultipleRecords}
                onDeleteRecord={handleDeleteRecord}
                onRequestMoveTable={handleOpenMoveTableModal}
                onExportExcel={handleExportExcel}
                driveConnection={driveConnection}
                isDriveConnecting={isDriveConnecting || driveConnection.isRefreshing}
                isDriveUploading={isDriveUploading}
                isDriveLoadingBackup={isDriveLoadingBackup}
                driveError={driveError}
                lastDriveFile={lastDriveFile}
                onOpenDriveModal={() => setIsDriveModalOpen(true)}
                onConnectGoogleDrive={handleConnectGoogleDrive}
                onDisconnectGoogleDrive={handleDisconnectGoogleDrive}
                onQuickSaveToDrive={handleQuickSaveToGoogleDrive}
                onLoadFromDrive={handleCheckLatestBackupFromDrive}
              />
            )}
          </>
        )}
      </main>

      {/* Clean Minimal Footer */}
      <footer className="bg-white border-t-2 border-slate-300 px-6 py-4 mt-12">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-semibold text-slate-700">
              VIP &amp; Standard Seat Booking Lookup System
            </span>
            {spreadsheetTitle && (
              <>
                <span aria-hidden="true">·</span>
                <span>แหล่งข้อมูล: {spreadsheetTitle}</span>
              </>
            )}
            {spreadsheetUrl && (
              <a
                href={spreadsheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-blue-600 hover:underline font-medium"
              >
                เปิดไฟล์ใน Google Sheets
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>

          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              className="text-slate-700 hover:text-slate-900 font-semibold cursor-pointer"
            >
              นำเข้าแม่แบบ Excel / เปลี่ยนไฟล์
            </button>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={() => setIsDriveModalOpen(true)}
              className="text-blue-700 hover:underline font-semibold cursor-pointer"
            >
              Google Drive Settings
            </button>
          </div>
        </div>
      </footer>

      {/* Settings & Excel Template Import Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        spreadsheetId={spreadsheetId}
        spreadsheetTitle={spreadsheetTitle}
        availableSheets={availableSheets}
        categories={categories}
        categoryResults={categoryResults}
        onSaveConfig={handleSaveSettings}
        onImportTemplateFiles={handleImportTemplateFiles}
        onLoadDefaultTemplate={handleLoadDefaultTemplate}
        onResetColors={handleResetColors}
        isAuthenticated={hasLegacySheetToken}
        onRequestGoogleLogin={handleLegacySheetsLogin}
      />

      {/* Real Google Drive GIS Settings & Upload Modal */}
      <GoogleDriveModal
        isOpen={isDriveModalOpen}
        onClose={() => setIsDriveModalOpen(false)}
        categories={categories}
        categoryResults={categoryResults}
        expenses={expenses}
        spreadsheetTitle={spreadsheetTitle}
        availableSheets={availableSheets}
        connectionState={driveConnection}
        lastUploadedFile={lastDriveFile}
        onUploadSuccess={(file) => {
          setLastDriveFile(file);
          setDriveError(null);
        }}
        onRestoreCloudState={handleRestoreFromGoogleDrive}
      />

      {/* Global Table Move / Swap Modal */}
      <MoveTableModal
        isOpen={isMoveModalOpen}
        records={allRecords}
        categories={categories}
        initialSourceSeatId={moveModalSourceSeatId}
        onConfirmMove={handleMoveOrSwapTable}
        onClose={() => {
          setIsMoveModalOpen(false);
          setMoveModalSourceSeatId(null);
        }}
      />
    </div>
  );
}
