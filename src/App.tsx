/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
  CheckCircle2,
  AlertCircle,
  X,
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
  loadCloudStateFromDrive,
  saveCloudStateToDrive,
  TemplateSheetPayload,
} from './services/sheetsApi';
import {
  DriveConnectionState,
  DriveUploadedFile,
  connectGoogleDrive,
  getDriveConnectionState,
  getStoredDriveClientId,
  subscribeDriveConnection,
  uploadFileToGoogleDrive,
} from './services/googleDriveGis';
import {
  buildBatchReadResponseFromSheets,
  createInitialTemplateResponse,
  exportCurrentDataToExcel,
  generateCurrentDataExcelBytes,
  resolveColumnMapFromRow,
  STANDARD_TEMPLATE_HEADERS,
} from './utils/excelTemplate';
import { Navbar } from './components/Navbar';
import { LookupView } from './components/LookupView';
import { DashboardView } from './components/DashboardView';
import { SeatMapView } from './components/SeatMapView';
import { BackOfficeView } from './components/BackOfficeView';
import { SettingsModal } from './components/SettingsModal';
import { ExcelTemplateImporter } from './components/ExcelTemplateImporter';
import { GoogleDriveModal } from './components/GoogleDriveModal';

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

function buildTimestampedFilename(format: 'xlsx' | 'json'): string {
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

  // REAL Google Identity Services (GIS) + Google Drive API v3 State
  const [driveConnection, setDriveConnection] = useState<DriveConnectionState>(() =>
    getDriveConnectionState()
  );
  const [isDriveModalOpen, setIsDriveModalOpen] = useState<boolean>(false);
  const [isDriveConnecting, setIsDriveConnecting] = useState<boolean>(false);
  const [isDriveUploading, setIsDriveUploading] = useState<boolean>(false);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [lastDriveFile, setLastDriveFile] = useState<DriveUploadedFile | null>(null);

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

  // Local server backup state (strictly separated from real Google Drive uploads)
  const hasLoadedServerBackupRef = useRef<boolean>(false);
  const skipNextServerBackupRef = useRef<boolean>(false);

  // Drive Files for Shared / All Google Sheets import picker
  const [driveFilter, setDriveFilter] = useState<DriveFilterMode>('sharedWithMe');
  const [driveFiles, setDriveFiles] = useState<SpreadsheetFileItem[]>([]);
  const [driveSearchQuery, setDriveSearchQuery] = useState<string>('');
  const [isLoadingDriveFiles, setIsLoadingDriveFiles] = useState<boolean>(false);

  // Settings Modal State
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);

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

  // Load local server-side session backup on initial startup (if local browser session was empty/default)
  useEffect(() => {
    if (hasLoadedServerBackupRef.current) return;
    hasLoadedServerBackupRef.current = true;

    const loadServerBackup = async () => {
      try {
        const res = await loadCloudStateFromDrive(userEmail);
        if (res.found && res.state && Array.isArray(res.state.categoryResults)) {
          // Only overwrite if local browser storage didn't already have newer edits
          const localTime = lastSyncedAt ? Date.parse(lastSyncedAt) : 0;
          const serverTime = Date.parse(res.modifiedTime || res.state.updatedAt || '');
          const hasLocalBooked = categoryResults.some((c) =>
            c.records.some((r) => r.isBooked)
          );
          if (!hasLocalBooked || (Number.isFinite(serverTime) && serverTime > localTime)) {
            skipNextServerBackupRef.current = true;
            if (Array.isArray(res.state.categories) && res.state.categories.length > 0) {
              setCategories(res.state.categories);
            }
            if (Array.isArray(res.state.expenses)) {
              setExpenses(res.state.expenses);
            }
            applyBatchResponse(
              {
                spreadsheetId: 'template-import',
                spreadsheetTitle:
                  res.state.spreadsheetTitle || 'ข้อมูลระบบจองโต๊ะ VIP & Standard',
                spreadsheetUrl: '',
                availableSheets:
                  res.state.availableSheets ||
                  res.state.categoryResults.map((r) => r.sheetName),
                categoryResults: res.state.categoryResults,
                fetchedAt: res.modifiedTime || res.state.updatedAt || new Date().toISOString(),
              },
              true
            );
          }
        }
      } catch {
        // Server local backup is optional; never block UI
      }
    };

    loadServerBackup();
  }, [userEmail, applyBatchResponse, categoryResults, lastSyncedAt]);

  // Background debounced save to local server store so data survives browser cache clears
  // (Never claims this is a Google Drive save!)
  useEffect(() => {
    if (!hasLoadedServerBackupRef.current) return;
    if (categoryResults.length === 0 && expenses.length === 0) return;
    if (skipNextServerBackupRef.current) {
      skipNextServerBackupRef.current = false;
      return;
    }

    const timer = window.setTimeout(() => {
      const payload: CloudSystemState = {
        categories,
        categoryResults,
        expenses,
        spreadsheetTitle: spreadsheetTitle || 'ระบบจองโต๊ะ VIP & Standard',
        availableSheets,
        updatedAt: new Date().toISOString(),
      };
      saveCloudStateToDrive(payload, null, userEmail).catch(() => {
        // Silent background local server cache backup
      });
    }, 1500);

    return () => window.clearTimeout(timer);
  }, [categories, categoryResults, expenses, spreadsheetTitle, availableSheets, userEmail]);

  /**
   * REAL Google Identity Services (GIS) OAuth 2.0 Sign-In for Google Drive
   */
  const handleConnectGoogleDrive = useCallback(async () => {
    const clientId = getStoredDriveClientId();
    if (!clientId) {
      setDriveError(
        'Please paste your Google Cloud OAuth Client ID in Google Drive Settings first.'
      );
      setIsDriveModalOpen(true);
      return;
    }

    setIsDriveConnecting(true);
    setDriveError(null);
    try {
      await connectGoogleDrive(clientId, { prompt: 'consent' });
    } catch (err: any) {
      setDriveError(err?.message || 'Failed to connect to Google Drive.');
    } finally {
      setIsDriveConnecting(false);
    }
  }, []);

  /**
   * REAL Google Drive API v3 Multipart Upload to user's Google Drive Root Folder
   */
  const handleQuickSaveToGoogleDrive = useCallback(
    async (format: 'xlsx' | 'json' = 'xlsx') => {
      const clientId = getStoredDriveClientId();
      if (!clientId) {
        setDriveError(
          'Please configure your Google Cloud OAuth Client ID in Google Drive Settings first.'
        );
        setIsDriveModalOpen(true);
        return;
      }

      setIsDriveUploading(true);
      setDriveError(null);

      try {
        if (!getDriveConnectionState().connected) {
          await connectGoogleDrive(clientId, { prompt: 'consent' });
        }

        const filename = buildTimestampedFilename(format);
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
          });
        }

        setLastDriveFile(uploaded);
      } catch (err: any) {
        setDriveError(
          err?.message || 'Failed to upload file to Google Drive. Please try again.'
        );
      } finally {
        setIsDriveUploading(false);
      }
    },
    [categories, categoryResults, expenses, spreadsheetTitle, availableSheets]
  );

  /**
   * Restore full app state from a real JSON backup file downloaded from Google Drive
   */
  const handleRestoreFromGoogleDrive = useCallback(
    (state: CloudSystemState, sourceFile: DriveUploadedFile) => {
      if (Array.isArray(state.categories) && state.categories.length > 0) {
        setCategories(state.categories);
      }
      if (Array.isArray(state.expenses)) {
        setExpenses(state.expenses);
      }
      applyBatchResponse(
        {
          spreadsheetId: 'template-import',
          spreadsheetTitle:
            state.spreadsheetTitle || `กู้คืนจาก Google Drive (${sourceFile.name})`,
          spreadsheetUrl: '',
          availableSheets:
            state.availableSheets ||
            state.categoryResults.map((r) => r.sheetName),
          categoryResults: state.categoryResults,
          fetchedAt: sourceFile.modifiedTime || state.updatedAt || new Date().toISOString(),
        },
        true
      );
      setLastDriveFile(sourceFile);
      setIsDriveModalOpen(false);
    },
    [applyBatchResponse]
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

  // Flatten all SeatRecord items across all configured categories
  const allRecords: SeatRecord[] = useMemo(() => {
    return categoryResults.flatMap((res) => res.records || []);
  }, [categoryResults]);

  const missingSheetWarnings = useMemo(() => {
    return categoryResults.filter((r) => !r.foundSheet);
  }, [categoryResults]);

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
        driveUserLabel={driveUserLabel}
        isDriveUploading={isDriveUploading}
        onConnectOrSaveDrive={() => {
          if (driveConnection.connected) {
            handleQuickSaveToGoogleDrive('xlsx');
          } else {
            handleConnectGoogleDrive();
          }
        }}
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
            {/* Real Google Drive Integration Bar */}
            <div className="bg-white border-2 border-slate-300 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shadow-xs">
              <div className="flex flex-wrap items-center gap-2.5 text-xs min-w-0 flex-1">
                {driveConnection.connected ? (
                  <span className="inline-flex items-center gap-1.5 font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-md shrink-0">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Google Drive Connected
                    {driveUserLabel ? `: ${driveUserLabel}` : ''}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 font-bold text-slate-700 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-md shrink-0">
                    <Cloud className="w-3.5 h-3.5 text-slate-500" />
                    Google Drive: Not Connected
                  </span>
                )}

                {isDriveUploading && (
                  <span className="inline-flex items-center gap-1.5 text-blue-700 font-bold">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    กำลังอัปโหลดไฟล์ไปยัง Google Drive...
                  </span>
                )}

                {!isDriveUploading && lastDriveFile && (
                  <span className="inline-flex flex-wrap items-center gap-2 text-emerald-800 font-semibold">
                    <span>บันทึกขึ้น Drive แล้ว: {lastDriveFile.name}</span>
                    <a
                      href={lastDriveFile.webViewLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-100 hover:bg-emerald-200 text-emerald-900 font-bold transition-colors"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Open in Google Drive
                    </a>
                  </span>
                )}

                {!isDriveUploading && !lastDriveFile && !driveError && (
                  <span className="text-slate-500">
                    {driveConnection.connected
                      ? 'กดปุ่ม Save to Google Drive เพื่ออัปโหลดไฟล์ Excel (.xlsx) หรือ JSON Backup ไปยัง Google Drive ของคุณ'
                      : 'ตั้งค่า OAuth Client ID และกด Connect Google Drive เพื่อบันทึกไฟล์ตรงไปยัง Google Drive'}
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
                  Google Drive Settings
                </button>

                {driveConnection.connected ? (
                  <button
                    type="button"
                    onClick={() => handleQuickSaveToGoogleDrive('xlsx')}
                    disabled={isDriveUploading}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors cursor-pointer disabled:opacity-60"
                  >
                    {isDriveUploading ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <CloudUpload className="w-3.5 h-3.5" />
                    )}
                    {isDriveUploading ? 'Uploading...' : 'Save to Google Drive'}
                  </button>
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
                onExportExcel={handleExportExcel}
                driveConnection={driveConnection}
                isDriveConnecting={isDriveConnecting}
                isDriveUploading={isDriveUploading}
                driveError={driveError}
                lastDriveFile={lastDriveFile}
                onOpenDriveModal={() => setIsDriveModalOpen(true)}
                onConnectGoogleDrive={handleConnectGoogleDrive}
                onQuickSaveToDrive={handleQuickSaveToGoogleDrive}
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
    </div>
  );
}
