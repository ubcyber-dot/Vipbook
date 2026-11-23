/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  FileSpreadsheet,
  AlertTriangle,
  RefreshCw,
  LogOut,
  Settings,
  ExternalLink,
  Search,
  Share2,
  FolderOpen,
  Cloud,
  CloudCheck,
  CloudUpload,
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
  logout,
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
  syncStateToNewGoogleSheet,
  TemplateSheetPayload,
} from './services/sheetsApi';
import {
  buildBatchReadResponseFromSheets,
  createInitialTemplateResponse,
  exportCurrentDataToExcel,
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

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('lookup');
  const [seatMapCategoryFilter, setSeatMapCategoryFilter] = useState<string>('all');

  // Persistent Email Auth State (remains logged in permanently until explicit logout)
  const [persistentUser, setPersistentUser] = useState<PersistentUserProfile | null>(() =>
    getPersistentUser()
  );
  const [hasDriveToken, setHasDriveToken] = useState<boolean>(() => hasActiveDriveToken());
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const isLoggedIn = Boolean(persistentUser);
  const userEmail = persistentUser?.email || null;

  // Configuration & Expenses State
  const [categories, setCategories] = useState<CategoryConfig[]>(loadSavedCategories);
  const [expenses, setExpenses] = useState<ExpenseRecord[]>(loadSavedExpenses);

  // Load persisted Excel template session if available (or auto-create default template so logged-in user enters ready workspace)
  const initialTemplateSession = useMemo(() => {
    const saved = loadSavedTemplateSession();
    if (saved) return saved;
    const initialCategories = loadSavedCategories();
    const defaultRes = createInitialTemplateResponse(initialCategories);
    try {
      localStorage.setItem(STORAGE_KEY_TEMPLATE_SESSION, JSON.stringify(defaultRes));
      localStorage.removeItem(STORAGE_KEY_SPREADSHEET_ID);
    } catch {
      // ignore
    }
    return defaultRes;
  }, []);

  const [spreadsheetId, setSpreadsheetId] = useState<string>(() => {
    if (initialTemplateSession) return 'template-import';
    return localStorage.getItem(STORAGE_KEY_SPREADSHEET_ID) || 'template-import';
  });

  // Connected Spreadsheet / Excel Template Data State
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

  // Google Drive Cloud Persistence State
  const [cloudFileId, setCloudFileId] = useState<string | null>(null);
  const [cloudSyncStatus, setCloudSyncStatus] = useState<
    'idle' | 'saving' | 'saved' | 'loading' | 'error'
  >('idle');
  const [lastCloudSavedAt, setLastCloudSavedAt] = useState<string | null>(null);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [syncedGoogleSheetUrl, setSyncedGoogleSheetUrl] = useState<string | null>(null);
  const hasLoadedInitialCloudRef = useRef<boolean>(false);
  const skipNextAutoSaveRef = useRef<boolean>(false);

  // Drive Files for Shared / All picker when no spreadsheet is selected yet
  const [driveFilter, setDriveFilter] = useState<DriveFilterMode>('sharedWithMe');
  const [driveFiles, setDriveFiles] = useState<SpreadsheetFileItem[]>([]);
  const [driveSearchQuery, setDriveSearchQuery] = useState<string>('');
  const [isLoadingDriveFiles, setIsLoadingDriveFiles] = useState<boolean>(false);

  // Settings Modal State
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);

  // Clean up legacy v1 key that may have held an invalid URL/ID
  useEffect(() => {
    try {
      localStorage.removeItem('seat_lookup_spreadsheet_id_v1');
    } catch {
      // ignore
    }
  }, []);

  // Initialize Firebase Auth Listener (Preserves persistent email login across reloads)
  useEffect(() => {
    const unsubscribe = initAuth(
      (profile, tokenActive) => {
        setPersistentUser(profile);
        setHasDriveToken(tokenActive);
      },
      () => {
        setPersistentUser(null);
        setHasDriveToken(false);
        hasLoadedInitialCloudRef.current = false;
      }
    );
    return () => unsubscribe();
  }, []);

  // Persist categories in localStorage whenever modified
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_CATEGORIES, JSON.stringify(categories));
    } catch (e) {
      console.error('Failed to save categories:', e);
    }
  }, [categories]);

  // Persist expenses in localStorage whenever modified
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_EXPENSES, JSON.stringify(expenses));
    } catch (e) {
      console.error('Failed to save expenses:', e);
    }
  }, [expenses]);

  // Persist spreadsheetId in localStorage (only for real Drive spreadsheet IDs)
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

    if (isTemplate) {
      try {
        localStorage.setItem(STORAGE_KEY_TEMPLATE_SESSION, JSON.stringify(res));
        localStorage.removeItem(STORAGE_KEY_SPREADSHEET_ID);
      } catch (e) {
        console.error('Failed to persist template session:', e);
      }
    } else {
      try {
        localStorage.removeItem(STORAGE_KEY_TEMPLATE_SESSION);
      } catch {
        // ignore
      }
    }
  }, []);

  /**
   * Save current system state (`categories`, `categoryResults`, `expenses`) to Cloud & Google Drive
   */
  const handleSaveToCloudDrive = useCallback(
    async (overrideState?: Partial<CloudSystemState>, _isInteractive = false) => {
      if (!isLoggedIn) return;

      const targetCategories = overrideState?.categories ?? categories;
      const targetResults = overrideState?.categoryResults ?? categoryResults;
      const targetExpenses = overrideState?.expenses ?? expenses;
      const targetTitle =
        overrideState?.spreadsheetTitle ??
        (spreadsheetTitle || 'ข้อมูลระบบจองโต๊ะ VIP & Standard (Google Drive Cloud)');
      const targetSheets = overrideState?.availableSheets ?? availableSheets;

      // Only save if there is meaningful data
      if (targetResults.length === 0 && targetExpenses.length === 0) return;

      setCloudSyncStatus('saving');
      setCloudError(null);
      try {
        const nowIso = new Date().toISOString();
        const payload: CloudSystemState = {
          categories: targetCategories,
          categoryResults: targetResults,
          expenses: targetExpenses,
          spreadsheetTitle: targetTitle,
          availableSheets: targetSheets,
          updatedAt: nowIso,
        };
        const res = await saveCloudStateToDrive(payload, cloudFileId, userEmail);
        setCloudFileId(res.fileId);
        setLastCloudSavedAt(res.modifiedTime || nowIso);
        setCloudSyncStatus('saved');
      } catch (err: any) {
        console.error('Failed to save state to Cloud:', err);
        if (err.code === 'UNAUTHENTICATED') {
          setHasDriveToken(false);
        }
        setCloudSyncStatus('error');
        setCloudError(err.message || 'ไม่สามารถบันทึกข้อมูลลง Cloud ได้');
      }
    },
    [
      isLoggedIn,
      userEmail,
      categories,
      categoryResults,
      expenses,
      spreadsheetTitle,
      availableSheets,
      cloudFileId,
    ]
  );

  /**
   * Load saved system state from Cloud & Google Drive
   */
  const handleLoadFromCloudDrive = useCallback(
    async (_isInteractive = false) => {
      if (!isLoggedIn) return;

      setCloudSyncStatus('loading');
      setCloudError(null);
      try {
        const res = await loadCloudStateFromDrive(userEmail);
        if (res.found && res.state && Array.isArray(res.state.categoryResults)) {
          skipNextAutoSaveRef.current = true;
          setCloudFileId(res.fileId || null);

          if (Array.isArray(res.state.categories) && res.state.categories.length > 0) {
            setCategories(res.state.categories);
          }
          if (Array.isArray(res.state.expenses)) {
            setExpenses(res.state.expenses);
          }

          const loadedTitle =
            res.state.spreadsheetTitle || 'ข้อมูลจาก Google Drive Cloud';
          const loadedSheets =
            res.state.availableSheets ||
            res.state.categoryResults.map((r) => r.sheetName);
          const loadedTime =
            res.modifiedTime || res.state.updatedAt || new Date().toISOString();

          applyBatchResponse(
            {
              spreadsheetId: 'template-import',
              spreadsheetTitle: loadedTitle,
              spreadsheetUrl: '',
              availableSheets: loadedSheets,
              categoryResults: res.state.categoryResults,
              fetchedAt: loadedTime,
            },
            true
          );

          setLastCloudSavedAt(loadedTime);
          setCloudSyncStatus('saved');
        } else {
          // No cloud file yet for this user:
          // If user already has local data on this device, back it up immediately!
          if (categoryResults.length > 0 || expenses.length > 0) {
            await handleSaveToCloudDrive(undefined, false);
          } else {
            setCloudSyncStatus('idle');
          }
        }
      } catch (err: any) {
        console.error('Failed to load cloud state:', err);
        if (err.code === 'UNAUTHENTICATED') {
          setHasDriveToken(false);
        }
        setCloudSyncStatus('idle');
      } finally {
        hasLoadedInitialCloudRef.current = true;
      }
    },
    [
      isLoggedIn,
      userEmail,
      categoryResults.length,
      expenses.length,
      applyBatchResponse,
      handleSaveToCloudDrive,
    ]
  );

  // Automatically load cloud state when user is logged in
  useEffect(() => {
    if (isLoggedIn && !hasLoadedInitialCloudRef.current) {
      handleLoadFromCloudDrive(false);
    }
  }, [isLoggedIn, handleLoadFromCloudDrive]);

  // Automatically sync changes (`categories`, `categoryResults`, `expenses`) to Cloud (debounced 800ms)
  useEffect(() => {
    if (!isLoggedIn || !hasLoadedInitialCloudRef.current) return;
    if (categoryResults.length === 0 && expenses.length === 0) return;

    if (skipNextAutoSaveRef.current) {
      skipNextAutoSaveRef.current = false;
      return;
    }

    const timer = setTimeout(() => {
      handleSaveToCloudDrive(undefined, false);
    }, 800);

    return () => clearTimeout(timer);
  }, [isLoggedIn, categories, categoryResults, expenses, handleSaveToCloudDrive]);

  /**
   * Export & Sync current state into a live Google Spreadsheet inside the user's Google Drive
   */
  const handleExportToGoogleSheet = useCallback(async () => {
    if (!isLoggedIn) return;
    if (!hasActiveDriveToken()) {
      try {
        const signInRes = await googleSignIn({ loginHint: userEmail || undefined });
        if (!signInRes) return;
        setPersistentUser(signInRes.profile);
        setHasDriveToken(true);
      } catch (err: any) {
        setCloudError(err.message || 'ไม่สามารถเชื่อมต่อ Google Drive ได้');
        return;
      }
    }

    setCloudSyncStatus('saving');
    setCloudError(null);
    try {
      const sheetRes = await syncStateToNewGoogleSheet(
        categories,
        categoryResults,
        expenses,
        spreadsheetTitle
          ? `${spreadsheetTitle} (ซิงค์ล่าสุด)`
          : 'ระบบจองโต๊ะ VIP & Standard และรายจ่าย'
      );
      if (sheetRes.spreadsheetUrl) {
        setSyncedGoogleSheetUrl(sheetRes.spreadsheetUrl);
        setSpreadsheetUrl(sheetRes.spreadsheetUrl);
      }
      setCloudSyncStatus('saved');
    } catch (err: any) {
      console.error('Failed to create Google Sheet in Drive:', err);
      setCloudSyncStatus('error');
      setCloudError(err.message || 'ไม่สามารถสร้างไฟล์ Google Sheets ใน Drive ได้');
    }
  }, [isLoggedIn, userEmail, categories, categoryResults, expenses, spreadsheetTitle]);

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
          setHasDriveToken(false);
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

  // Automatically load sheet data when Drive token is active and a Drive spreadsheetId is set
  useEffect(() => {
    if (hasDriveToken && spreadsheetId && spreadsheetId !== 'template-import') {
      loadSheetData(spreadsheetId, categories);
    }
  }, [hasDriveToken, spreadsheetId, categories, loadSheetData]);

  // Load Drive spreadsheet list when Drive token is active and no spreadsheet is chosen yet
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
    if (hasDriveToken && !spreadsheetId) {
      loadInitialDriveSpreadsheets(driveSearchQuery, driveFilter);
    }
  }, [hasDriveToken, spreadsheetId, driveFilter, loadInitialDriveSpreadsheets]);

  const handleGoogleLogin = async () => {
    setIsLoggingIn(true);
    setAuthError(null);
    setCloudError(null);
    try {
      const result = await googleSignIn({ loginHint: userEmail || undefined });
      if (result) {
        setPersistentUser(result.profile);
        setHasDriveToken(true);
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
        setAuthError('เบราว์เซอร์บล็อกหน้าต่างป๊อปอัป กรุณาอนุญาตป๊อปอัปสำหรับเว็บไซต์นี้แล้วลองอีกครั้ง');
        return;
      }
      setAuthError(err.message || 'การเข้าสู่ระบบด้วย Google ล้มเหลว กรุณาลองใหม่อีกครั้ง');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    setPersistentUser(null);
    setHasDriveToken(false);
    hasLoadedInitialCloudRef.current = false;
  };

  /**
   * 100% Client-Side Instant Excel Template Import (Zero network failure!)
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

  /**
   * One-Click Starter: Loads the standard pre-numbered VIP & Standard Excel template structure immediately
   */
  const handleLoadDefaultTemplate = useCallback(() => {
    const res = createInitialTemplateResponse(categories);
    applyBatchResponse(res, true);
  }, [categories, applyBatchResponse]);

  /**
   * Persist edited categoryResults into localStorage session so live edits survive page reloads
   */
  const persistUpdatedCategoryResults = useCallback(
    (nextResults: CategorySheetResult[]) => {
      const nowIso = new Date().toISOString();
      setCategoryResults(nextResults);
      setLastSyncedAt(nowIso);
      try {
        const sessionPayload: BatchReadResponse = {
          spreadsheetId: spreadsheetId || 'template-import',
          spreadsheetTitle: spreadsheetTitle || 'ข้อมูลการจองโต๊ะ (แก้ไขล่าสุด)',
          spreadsheetUrl,
          availableSheets,
          categoryResults: nextResults,
          fetchedAt: nowIso,
        };
        localStorage.setItem(
          STORAGE_KEY_TEMPLATE_SESSION,
          JSON.stringify(sessionPayload)
        );
      } catch (e) {
        console.error('Failed to persist updated records:', e);
      }
    },
    [spreadsheetId, spreadsheetTitle, spreadsheetUrl, availableSheets]
  );

  const handleUpdateRecord = useCallback(
    (updated: SeatRecord) => {
      const nextResults = categoryResults.map((catRes) => {
        if (catRes.categoryId !== updated.categoryId) return catRes;
        return {
          ...catRes,
          records: catRes.records.map((r) => (r.id === updated.id ? updated : r)),
        };
      });
      persistUpdatedCategoryResults(nextResults);
    },
    [categoryResults, persistUpdatedCategoryResults]
  );

  const handleAddRecord = useCallback(
    (categoryId: string, newRecord: SeatRecord) => {
      const catConfig = categories.find((c) => c.id === categoryId);
      const existsInResults = categoryResults.some((r) => r.categoryId === categoryId);

      let nextResults: CategorySheetResult[];
      if (existsInResults) {
        nextResults = categoryResults.map((catRes) => {
          if (catRes.categoryId !== categoryId) return catRes;
          return {
            ...catRes,
            foundSheet: true,
            records: [...catRes.records, newRecord],
          };
        });
      } else {
        nextResults = [
          ...categoryResults,
          {
            categoryId,
            categoryName: catConfig?.name || categoryId,
            sheetName: catConfig?.sheetName || categoryId,
            foundSheet: true,
            columnMap: resolveColumnMapFromRow(STANDARD_TEMPLATE_HEADERS).columnMap,
            records: [newRecord],
          },
        ];
      }
      persistUpdatedCategoryResults(nextResults);
    },
    [categories, categoryResults, persistUpdatedCategoryResults]
  );

  const handleAddMultipleRecords = useCallback(
    (categoryId: string, newRecords: SeatRecord[]) => {
      if (newRecords.length === 0) return;
      const catConfig = categories.find((c) => c.id === categoryId);
      const existsInResults = categoryResults.some((r) => r.categoryId === categoryId);

      let nextResults: CategorySheetResult[];
      if (existsInResults) {
        nextResults = categoryResults.map((catRes) => {
          if (catRes.categoryId !== categoryId) return catRes;
          return {
            ...catRes,
            foundSheet: true,
            records: [...catRes.records, ...newRecords],
          };
        });
      } else {
        nextResults = [
          ...categoryResults,
          {
            categoryId,
            categoryName: catConfig?.name || categoryId,
            sheetName: catConfig?.sheetName || categoryId,
            foundSheet: true,
            columnMap: resolveColumnMapFromRow(STANDARD_TEMPLATE_HEADERS).columnMap,
            records: newRecords,
          },
        ];
      }
      persistUpdatedCategoryResults(nextResults);
    },
    [categories, categoryResults, persistUpdatedCategoryResults]
  );

  const handleDeleteRecord = useCallback(
    (recordId: string) => {
      const nextResults = categoryResults.map((catRes) => ({
        ...catRes,
        records: catRes.records.filter((r) => r.id !== recordId),
      }));
      persistUpdatedCategoryResults(nextResults);
    },
    [categoryResults, persistUpdatedCategoryResults]
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

  const handleSaveSettings = (newId: string, newCategories: CategoryConfig[]) => {
    setCategories(newCategories);
    if (newId && newId !== 'template-import') {
      if (newId !== spreadsheetId) {
        setSpreadsheetId(newId);
      } else {
        loadSheetData(newId, newCategories);
      }
    }
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

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Top Bar following 3-Zone Contract */}
      <Navbar
        activeTab={activeTab}
        onSelectTab={(tab) => {
          setActiveTab(tab);
          if (tab !== 'seatmap') {
            setSeatMapCategoryFilter('all');
          }
        }}
        onOpenSettings={() => setIsSettingsOpen(true)}
        isConnected={Boolean(spreadsheetId) && !dataError}
        spreadsheetTitle={spreadsheetTitle}
        userEmail={userEmail}
        isAuthenticated={isLoggedIn}
        hasDriveToken={hasDriveToken}
        cloudSyncStatus={cloudSyncStatus}
        lastCloudSavedAt={lastCloudSavedAt}
        onRequestGoogleLogin={handleGoogleLogin}
        onSaveToCloudDrive={() => handleSaveToCloudDrive(undefined, true)}
        onLogout={handleLogout}
      />

      {/* Main Content Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* State 1: No Data Imported Yet -> Show Excel Template Import & Google Drive Hub */}
        {!spreadsheetId ? (
          <div className="max-w-4xl mx-auto space-y-6 my-4">
            <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6">
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
                      อัปโหลดไฟล์แม่แบบ Excel (.xlsx / .xls / .csv) หรือเข้าสู่ระบบ Google Drive เพื่อซิงค์ข้อมูลข้ามอุปกรณ์อัตโนมัติ
                    </p>
                  </div>
                </div>

                {isLoggedIn && userEmail && (
                  <div className="flex items-center gap-2 text-xs text-slate-600 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
                    <CloudCheck className="w-4 h-4 text-emerald-600" />
                    <span>เข้าสู่ระบบถาวร: {userEmail}</span>
                    <button
                      type="button"
                      onClick={() => handleLoadFromCloudDrive(true)}
                      disabled={cloudSyncStatus === 'loading'}
                      className="inline-flex items-center gap-1 px-2 py-0.5 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded border border-emerald-200 font-semibold cursor-pointer"
                    >
                      <RefreshCw
                        className={`w-3 h-3 ${cloudSyncStatus === 'loading' ? 'animate-spin' : ''}`}
                      />
                      ดึงข้อมูลจาก Cloud
                    </button>
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="inline-flex items-center gap-1 text-slate-500 hover:text-red-600 cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      ออกจากระบบ
                    </button>
                  </div>
                )}
              </div>

              {/* Section 1: Excel (.xlsx / .xls) Multi-Sheet Template Importer */}
              <ExcelTemplateImporter
                categories={categories}
                isSubmitting={isLoadingData}
                onImportSheets={handleImportTemplateFiles}
                onLoadDefaultTemplate={handleLoadDefaultTemplate}
              />

              {/* Section 2: Select Template File from Google Drive ("Shared with me" / "All") */}
              <div className="space-y-4 pt-2 border-t border-slate-100">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <Cloud className="w-4 h-4 text-emerald-600" />
                      เชื่อมต่อ Google Drive เพื่อบันทึกข้อมูลบนคลาวด์ หรือเลือกไฟล์ Google Sheets
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      เมื่อเข้าสู่ระบบ Google Drive ข้อมูลการจองและรายจ่ายทั้งหมดจะถูกบันทึกไว้ในเมลของคุณ เปิดจากเครื่องไหนก็ได้ข้อมูลครบถ้วน
                    </p>
                  </div>

                  {hasDriveToken && (
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
                        แชร์กับฉัน (Shared with me)
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

                {!hasDriveToken ? (
                  <div className="p-6 bg-slate-50 border border-slate-200 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="space-y-1 text-center sm:text-left">
                      <p className="text-sm font-semibold text-slate-800">
                        เข้าสู่ระบบด้วยบัญชี Google เพื่อบันทึกและดึงข้อมูลจาก Google Drive อัตโนมัติ
                      </p>
                      <p className="text-xs text-slate-500">
                        ข้อมูลการจองโต๊ะทุกโซนและรายจ่ายหลังบ้านจะถูกผูกไว้กับ Google Drive ของเมลคุณ เปิดใช้งานได้ทุกที่ทุกอุปกรณ์
                      </p>
                    </div>

                    {/* Official Google Sign-In Material Button */}
                    <button
                      type="button"
                      onClick={handleGoogleLogin}
                      disabled={isLoggingIn}
                      className="gsi-material-button shrink-0"
                    >
                      <div className="gsi-material-button-state"></div>
                      <div className="gsi-material-button-content-wrapper">
                        <div className="gsi-material-button-icon">
                          <svg
                            version="1.1"
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 48 48"
                            style={{ display: 'block' }}
                          >
                            <path
                              fill="#EA4335"
                              d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                            ></path>
                            <path
                              fill="#4285F4"
                              d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                            ></path>
                            <path
                              fill="#FBBC05"
                              d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                            ></path>
                            <path
                              fill="#34A853"
                              d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                            ></path>
                            <path fill="none" d="M0 0h48v48H0z"></path>
                          </svg>
                        </div>
                        <span className="gsi-material-button-contents">
                          {isLoggingIn ? 'กำลังเชื่อมต่อ...' : 'Sign in with Google'}
                        </span>
                      </div>
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
                      <div className="py-8 text-center text-xs text-slate-500 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                        <p>
                          {driveFilter === 'sharedWithMe'
                            ? 'ไม่พบไฟล์ Google Sheets ในหมวด "แชร์กับฉัน"'
                            : 'ไม่พบไฟล์ Google Sheets ในรายการ'}
                        </p>
                        {driveFilter === 'sharedWithMe' && (
                          <button
                            type="button"
                            onClick={() => setDriveFilter('all')}
                            className="text-xs font-semibold text-blue-600 hover:underline cursor-pointer"
                          >
                            ดูไฟล์ Google Sheets ทั้งหมดใน Drive ของคุณ
                          </button>
                        )}
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
          /* State 2: Connected to Excel Template or Spreadsheet — Main Operational Console */
          <>
            {/* Compact Google Drive Cloud Sync Status Bar */}
            <div className="bg-white border-2 border-slate-300 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shadow-xs">
              <div className="flex flex-wrap items-center gap-2.5 text-xs">
                {isLoggedIn && userEmail ? (
                  <>
                    <span className="inline-flex items-center gap-1.5 font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-md">
                      <CloudCheck className="w-3.5 h-3.5" />
                      เข้าสู่ระบบถาวร: {userEmail}
                    </span>
                    {cloudSyncStatus === 'saving' && (
                      <span className="inline-flex items-center gap-1 text-blue-600 font-semibold">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        กำลังบันทึกข้อมูลลง Google Drive...
                      </span>
                    )}
                    {cloudSyncStatus === 'loading' && (
                      <span className="inline-flex items-center gap-1 text-blue-600 font-semibold">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        กำลังดึงข้อมูลจาก Google Drive...
                      </span>
                    )}
                    {cloudSyncStatus === 'saved' && lastCloudSavedAt ? (
                      <span className="text-slate-500">
                        บันทึกล่าสุดบน Drive เมื่อ{' '}
                        {new Date(lastCloudSavedAt).toLocaleTimeString('th-TH', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}{' '}
                        (เปิดจากเครื่องไหนก็ได้ข้อมูลตรงกัน)
                      </span>
                    ) : (
                      <span className="text-slate-500">
                        จดจำสถานะล็อกอินไว้ถาวรจนกว่าจะกดออกจากระบบเอง · บันทึกข้อมูลอัตโนมัติพร้อมซิงค์ Google Drive
                      </span>
                    )}
                    {cloudError && (
                      <span className="text-red-600 font-semibold">{cloudError}</span>
                    )}
                  </>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-amber-800 font-medium">
                    <Cloud className="w-4 h-4 text-amber-600" />
                    ขณะนี้ออกจากระบบอยู่ — กดเข้าสู่ระบบเพื่อจดจำบัญชีอีเมลไว้แบบถาวรและซิงค์ข้อมูลกับ Google Drive
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {isLoggedIn ? (
                  <>
                    <button
                      type="button"
                      onClick={() => handleSaveToCloudDrive(undefined, true)}
                      disabled={cloudSyncStatus === 'saving'}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors cursor-pointer disabled:opacity-60"
                    >
                      <CloudUpload className="w-3.5 h-3.5" />
                      บันทึกขึ้น Google Drive
                    </button>
                    <button
                      type="button"
                      onClick={() => handleLoadFromCloudDrive(true)}
                      disabled={cloudSyncStatus === 'loading'}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer disabled:opacity-60"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${
                          cloudSyncStatus === 'loading' ? 'animate-spin' : ''
                        }`}
                      />
                      ดึงข้อมูลจาก Drive
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={handleGoogleLogin}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer"
                  >
                    <Cloud className="w-3.5 h-3.5" />
                    เข้าสู่ระบบ Google (จดจำถาวร)
                  </button>
                )}
              </div>
            </div>

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

            {/* Warning if some configured sheets (e.g. VIP or Standard) were not found */}
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
                  if (hasDriveToken) {
                    handleLoadFromCloudDrive(true);
                  } else if (spreadsheetId === 'template-import') {
                    setIsSettingsOpen(true);
                  } else {
                    loadSheetData(spreadsheetId, categories);
                  }
                }}
                lastSyncedAt={lastCloudSavedAt || lastSyncedAt}
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
                  if (hasDriveToken) {
                    handleLoadFromCloudDrive(true);
                  } else if (spreadsheetId === 'template-import') {
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
                isAuthenticated={isLoggedIn}
                hasDriveToken={hasDriveToken}
                userEmail={userEmail}
                cloudSyncStatus={cloudSyncStatus}
                lastCloudSavedAt={lastCloudSavedAt}
                cloudError={cloudError}
                syncedGoogleSheetUrl={syncedGoogleSheetUrl}
                onRequestGoogleLogin={handleGoogleLogin}
                onSaveToCloudDrive={() => handleSaveToCloudDrive(undefined, true)}
                onLoadFromCloudDrive={() => handleLoadFromCloudDrive(true)}
                onExportToGoogleSheet={handleExportToGoogleSheet}
                onLogout={handleLogout}
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
              VIP & Standard Seat Booking Lookup System
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
            {isLoggedIn && userEmail ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-medium text-emerald-700">บัญชีถาวร: {userEmail}</span>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="text-slate-600 hover:text-red-600 font-medium cursor-pointer"
                >
                  ออกจากระบบ
                </button>
              </>
            ) : (
              <>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={handleGoogleLogin}
                  className="text-blue-600 hover:underline font-medium cursor-pointer"
                >
                  เข้าสู่ระบบ Google (จดจำถาวร)
                </button>
              </>
            )}
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
        isAuthenticated={hasDriveToken}
        onRequestGoogleLogin={handleGoogleLogin}
      />
    </div>
  );
}
