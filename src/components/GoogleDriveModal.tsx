import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  X,
  Cloud,
  CloudUpload,
  CloudDownload,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  KeyRound,
  Copy,
  Check,
  FileSpreadsheet,
  FileJson,
  LogOut,
  FolderOpen,
  Download,
  ShieldCheck,
  AlertTriangle,
  CopyPlus,
} from 'lucide-react';
import {
  CategoryConfig,
  CategorySheetResult,
  ExpenseRecord,
} from '../types/booking';
import { CloudSystemState } from '../services/sheetsApi';
import {
  CANONICAL_EXCEL_EXPORT_FILENAME,
  CANONICAL_JSON_BACKUP_FILENAME,
  DRIVE_FILE_SCOPE,
  DriveConnectionState,
  DriveUploadedFile,
  connectGoogleDrive,
  disconnectGoogleDrive,
  downloadBinaryFileFromGoogleDrive,
  downloadJsonFileFromGoogleDrive,
  findExistingDriveFileByName,
  getActiveDriveFiles,
  getDefaultAppletClientId,
  getDriveConnectionState,
  getStoredDriveClientId,
  listAppCreatedDriveFiles,
  saveDriveClientId,
  uploadFileToGoogleDrive,
} from '../services/googleDriveGis';
import {
  buildCloudSystemStateFromExcelBuffer,
  generateCurrentDataExcelBytes,
  validateAndHydrateCloudState,
} from '../utils/excelTemplate';

export type DriveExportFormat = 'json' | 'xlsx';

interface GoogleDriveModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: CategoryConfig[];
  categoryResults: CategorySheetResult[];
  expenses: ExpenseRecord[];
  spreadsheetTitle: string;
  availableSheets: string[];
  connectionState: DriveConnectionState;
  lastUploadedFile: DriveUploadedFile | null;
  onUploadSuccess: (file: DriveUploadedFile) => void;
  onRestoreCloudState: (state: CloudSystemState, sourceFile: DriveUploadedFile) => void;
}

function getCanonicalFilename(format: DriveExportFormat): string {
  return format === 'json'
    ? CANONICAL_JSON_BACKUP_FILENAME
    : CANONICAL_EXCEL_EXPORT_FILENAME;
}

function getTimestampedCopyFilename(format: DriveExportFormat): string {
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

function formatBytes(sizeStr?: string): string {
  const bytes = Number(sizeStr);
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function isJsonDriveFile(file: DriveUploadedFile): boolean {
  return (
    file.mimeType === 'application/json' ||
    file.name.toLowerCase().endsWith('.json')
  );
}

function isExcelDriveFile(file: DriveUploadedFile): boolean {
  return (
    file.mimeType ===
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    file.name.toLowerCase().endsWith('.xlsx') ||
    file.name.toLowerCase().endsWith('.xls')
  );
}

export const GoogleDriveModal: React.FC<GoogleDriveModalProps> = ({
  isOpen,
  onClose,
  categories,
  categoryResults,
  expenses,
  spreadsheetTitle,
  availableSheets,
  connectionState,
  lastUploadedFile,
  onUploadSuccess,
  onRestoreCloudState,
}) => {
  // Google Drive Settings (Client ID saved in localStorage)
  const [clientIdInput, setClientIdInput] = useState<string>(() => getStoredDriveClientId());
  const [clientIdSavedNotice, setClientIdSavedNotice] = useState<boolean>(false);
  const [copiedOrigin, setCopiedOrigin] = useState<boolean>(false);

  // Connection, Upload, & Restore States
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [isDisconnecting, setIsDisconnecting] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadFormat, setUploadFormat] = useState<DriveExportFormat>('json');
  const [filename, setFilename] = useState<string>(() => getCanonicalFilename('json'));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [latestUpload, setLatestUpload] = useState<DriveUploadedFile | null>(lastUploadedFile);

  // Real App-Created Drive Files List
  const [driveFiles, setDriveFiles] = useState<DriveUploadedFile[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState<boolean>(false);
  const [restoringFileId, setRestoringFileId] = useState<string | null>(null);

  // Explicit Confirmation State before Overwriting an Existing Drive File or Restoring Workspace
  const [pendingOverwrite, setPendingOverwrite] = useState<{
    file: DriveUploadedFile;
    targetName: string;
    format: DriveExportFormat;
  } | null>(null);
  const [pendingRestoreFile, setPendingRestoreFile] = useState<DriveUploadedFile | null>(null);

  const defaultClientId = getDefaultAppletClientId();
  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';

  useEffect(() => {
    setLatestUpload(lastUploadedFile);
  }, [lastUploadedFile]);

  const refreshDriveFiles = useCallback(async (): Promise<DriveUploadedFile[]> => {
    if (!getDriveConnectionState().connected) return [];
    setIsLoadingFiles(true);
    try {
      const files = await listAppCreatedDriveFiles();
      setDriveFiles(files);
      return files;
    } catch (err: any) {
      setErrorMessage(err?.message || 'ไม่สามารถดึงรายการไฟล์จาก Google Drive ได้');
      return [];
    } finally {
      setIsLoadingFiles(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setClientIdInput(getStoredDriveClientId());
    setFilename(getCanonicalFilename(uploadFormat));
    setErrorMessage(null);
    setStatusNotice(null);
    setPendingOverwrite(null);
    setPendingRestoreFile(null);

    if (connectionState.connected && !connectionState.needsReauth) {
      refreshDriveFiles();
    }
  }, [isOpen, connectionState.connected, connectionState.needsReauth, refreshDriveFiles]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isUploading && !restoringFileId) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isUploading, restoringFileId, onClose]);

  const matchedExistingFile = useMemo(() => {
    const clean = filename.trim().toLowerCase();
    if (!clean) return null;
    const byName = driveFiles.find((f) => f.name.toLowerCase() === clean);
    if (byName) return byName;

    const tracked = getActiveDriveFiles()[uploadFormat];
    if (tracked && tracked.name.toLowerCase() === clean) {
      return tracked;
    }
    return null;
  }, [driveFiles, filename, uploadFormat]);

  const latestRestorableBackup = useMemo(() => {
    const jsonFirst = driveFiles.find((f) => isJsonDriveFile(f));
    if (jsonFirst) return jsonFirst;
    return driveFiles.find((f) => isExcelDriveFile(f)) || null;
  }, [driveFiles]);

  if (!isOpen) return null;

  const isBusy =
    isConnecting ||
    isDisconnecting ||
    isUploading ||
    isLoadingFiles ||
    Boolean(restoringFileId) ||
    connectionState.isRefreshing;

  const handleFormatChange = (nextFormat: DriveExportFormat) => {
    setUploadFormat(nextFormat);
    setFilename(getCanonicalFilename(nextFormat));
    setPendingOverwrite(null);
  };

  const handleSaveClientId = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleaned = saveDriveClientId(clientIdInput);
    setClientIdInput(cleaned);
    setClientIdSavedNotice(true);
    setErrorMessage(null);
    window.setTimeout(() => setClientIdSavedNotice(false), 2500);
  };

  const handleCopyOrigin = async () => {
    try {
      await navigator.clipboard.writeText(currentOrigin);
      setCopiedOrigin(true);
      window.setTimeout(() => setCopiedOrigin(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleConnectDrive = async () => {
    const trimmedClientId = clientIdInput.trim();
    saveDriveClientId(trimmedClientId);
    setIsConnecting(true);
    setErrorMessage(null);
    setStatusNotice(null);
    try {
      await connectGoogleDrive(trimmedClientId, {
        prompt: connectionState.connected ? 'select_account' : 'consent',
      });
      await refreshDriveFiles();
    } catch (err: any) {
      setErrorMessage(err?.message || 'ไม่สามารถเชื่อมต่อบัญชี Google Drive ได้');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnectDrive = async () => {
    setIsDisconnecting(true);
    setErrorMessage(null);
    setStatusNotice(null);
    try {
      await disconnectGoogleDrive();
      setDriveFiles([]);
      setPendingOverwrite(null);
      setPendingRestoreFile(null);
      setLatestUpload(null);
    } finally {
      setIsDisconnecting(false);
    }
  };

  const normalizeTargetFilename = (rawName: string, fmt: DriveExportFormat): string => {
    const trimmed = rawName.trim() || getCanonicalFilename(fmt);
    if (fmt === 'xlsx' && !trimmed.toLowerCase().endsWith('.xlsx')) {
      return `${trimmed}.xlsx`;
    }
    if (fmt === 'json' && !trimmed.toLowerCase().endsWith('.json')) {
      return `${trimmed}.json`;
    }
    return trimmed;
  };

  const executeRealDriveUpload = async (options: {
    format: DriveExportFormat;
    targetName: string;
    existingFileId?: string;
  }) => {
    const finalName = normalizeTargetFilename(options.targetName, options.format);
    setIsUploading(true);
    setErrorMessage(null);
    setStatusNotice(null);
    setPendingOverwrite(null);

    try {
      if (!getDriveConnectionState().connected) {
        const trimmedClientId = clientIdInput.trim();
        saveDriveClientId(trimmedClientId);
        await connectGoogleDrive(trimmedClientId, { prompt: 'consent' });
      }

      let uploaded: DriveUploadedFile;

      if (options.format === 'xlsx') {
        const excelBytes = generateCurrentDataExcelBytes(
          categories,
          categoryResults,
          expenses
        );
        uploaded = await uploadFileToGoogleDrive({
          filename: finalName,
          mimeType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          content: excelBytes,
          description:
            'VIP & Standard Seat Booking & Back-Office Expenses Excel Export',
          existingFileId: options.existingFileId,
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
          filename: finalName,
          mimeType: 'application/json',
          content: JSON.stringify(payload, null, 2),
          description:
            'VIP & Standard Seat Booking System Complete JSON Backup',
          existingFileId: options.existingFileId,
        });
      }

      setLatestUpload(uploaded);
      setStatusNotice(
        options.existingFileId
          ? `อัปเดตไฟล์เดิม "${uploaded.name}" บน Google Drive เรียบร้อยแล้ว`
          : `สร้างไฟล์ใหม่ "${uploaded.name}" บน Google Drive เรียบร้อยแล้ว`
      );
      onUploadSuccess(uploaded);
      await refreshDriveFiles();
    } catch (err: any) {
      setErrorMessage(
        err?.message ||
          'อัปโหลดไฟล์ไปยัง Google Drive ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตหรือสิทธิ์การเข้าถึง'
      );
    } finally {
      setIsUploading(false);
    }
  };

  /**
   * Smart Save handler: checks if a non-trashed file with the same name already exists in Drive.
   * If yes -> asks explicit confirmation to PATCH (update without duplicating).
   * If no -> creates a fresh file via POST directly.
   */
  const handleSmartSaveClick = async () => {
    const finalName = normalizeTargetFilename(filename, uploadFormat);
    setErrorMessage(null);
    setStatusNotice(null);

    try {
      if (!getDriveConnectionState().connected) {
        setIsConnecting(true);
        try {
          const trimmedClientId = clientIdInput.trim();
          saveDriveClientId(trimmedClientId);
          await connectGoogleDrive(trimmedClientId, { prompt: 'consent' });
        } finally {
          setIsConnecting(false);
        }
      }

      // Check local list first, then query Drive for exact filename to prevent accidental duplicates
      let existing = matchedExistingFile;
      if (!existing) {
        setIsLoadingFiles(true);
        try {
          existing = await findExistingDriveFileByName(finalName);
        } finally {
          setIsLoadingFiles(false);
        }
      }

      if (existing) {
        setPendingOverwrite({
          file: existing,
          targetName: finalName,
          format: uploadFormat,
        });
        return;
      }

      await executeRealDriveUpload({
        format: uploadFormat,
        targetName: finalName,
      });
    } catch (err: any) {
      setErrorMessage(
        err?.message || 'ไม่สามารถตรวจสอบไฟล์บน Google Drive ได้ กรุณาลองใหม่อีกครั้ง'
      );
    }
  };

  const handleSaveAsNewCopyClick = async () => {
    const copyName = getTimestampedCopyFilename(uploadFormat);
    await executeRealDriveUpload({
      format: uploadFormat,
      targetName: copyName,
    });
  };

  const handleClickLoadLatestBackup = async () => {
    setErrorMessage(null);
    setStatusNotice(null);
    try {
      const files = driveFiles.length > 0 ? driveFiles : await refreshDriveFiles();
      const target =
        files.find((f) => isJsonDriveFile(f)) ||
        files.find((f) => isExcelDriveFile(f));

      if (!target) {
        setErrorMessage(
          'ไม่พบไฟล์สำรอง (.json หรือ .xlsx) ใน Google Drive ของคุณ กด "Save to Google Drive" เพื่อสร้างไฟล์สำรองแรก'
        );
        return;
      }
      setPendingRestoreFile(target);
    } catch (err: any) {
      setErrorMessage(err?.message || 'ไม่สามารถค้นหาไฟล์สำรองล่าสุดจาก Google Drive ได้');
    }
  };

  const handleConfirmRestore = async (file: DriveUploadedFile) => {
    setRestoringFileId(file.id);
    setErrorMessage(null);
    setStatusNotice(null);
    setPendingRestoreFile(null);

    try {
      let hydratedState: CloudSystemState;

      if (isJsonDriveFile(file)) {
        const rawJson = await downloadJsonFileFromGoogleDrive<unknown>(file.id);
        hydratedState = validateAndHydrateCloudState(rawJson, categories);
      } else if (isExcelDriveFile(file)) {
        const buffer = await downloadBinaryFileFromGoogleDrive(file.id);
        hydratedState = buildCloudSystemStateFromExcelBuffer(
          buffer,
          file.name,
          categories
        );
      } else {
        throw new Error(
          `ไม่รองรับรูปแบบไฟล์ "${file.name}" กรุณาเลือกไฟล์สำรอง .json หรือ .xlsx`
        );
      }

      onRestoreCloudState(hydratedState, file);
    } catch (err: any) {
      setErrorMessage(
        err?.message || 'ไม่สามารถดาวน์โหลดหรืออ่านข้อมูลไฟล์สำรองจาก Google Drive ได้'
      );
    } finally {
      setRestoringFileId(null);
    }
  };

  const totalSeats = categoryResults.reduce((acc, r) => acc + (r.records?.length || 0), 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/65 backdrop-blur-xs overflow-y-auto"
      onClick={() => {
        if (!isUploading && !restoringFileId) onClose();
      }}
    >
      <div
        className="w-full max-w-3xl bg-white rounded-3xl border-[3px] border-slate-300 shadow-2xl overflow-hidden my-auto flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between gap-4 border-b-2 border-slate-800">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-emerald-500 text-white flex items-center justify-center shrink-0">
              <Cloud className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-extrabold tracking-tight truncate">
                Google Drive Sync — Save &amp; Restore Data
              </h2>
              <p className="text-xs text-slate-300 truncate">
                เซสชันถาวร + ต่ออายุ Token อัตโนมัติ + บันทึก/ดึงข้อมูลจริงผ่าน Google Drive API v3
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isUploading || Boolean(restoringFileId)}
            aria-label="Close Google Drive modal"
            className="p-2 text-slate-300 hover:text-white bg-white/10 hover:bg-white/20 disabled:opacity-40 rounded-xl transition-colors cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-5">
          {/* Error Alert Banner */}
          {errorMessage && (
            <div className="p-4 rounded-2xl bg-red-50 border-2 border-red-300 flex items-start gap-3 text-red-900">
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div className="space-y-1 min-w-0 flex-1">
                <p className="text-xs font-extrabold uppercase tracking-wide text-red-700">
                  Google Drive Error
                </p>
                <p className="text-xs sm:text-sm font-medium break-words whitespace-pre-wrap">
                  {errorMessage}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setErrorMessage(null)}
                className="p-1 text-red-500 hover:text-red-800 cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Success Banner with Real Google Drive File Link */}
          {latestUpload && (
            <div className="p-4 rounded-2xl bg-emerald-50 border-2 border-emerald-400 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <div className="min-w-0 space-y-0.5">
                  <p className="text-xs font-extrabold text-emerald-800">
                    {statusNotice || 'ซิงก์กับ Google Drive สำเร็จแล้ว!'}
                  </p>
                  <p className="text-sm font-bold text-slate-900 truncate">
                    {latestUpload.name}
                  </p>
                  <p className="text-[11px] font-mono text-emerald-700 break-all">
                    File ID: {latestUpload.id}
                    {latestUpload.modifiedTime &&
                      ` · ${new Date(latestUpload.modifiedTime).toLocaleString('th-TH')}`}
                  </p>
                </div>
              </div>
              <a
                href={latestUpload.webViewLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-xs transition-colors shrink-0"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Open in Google Drive
              </a>
            </div>
          )}

          {/* SECTION 1: Persistent Account Session (Stay Logged In Until Manual Sign Out) */}
          <section className="p-4 sm:p-5 rounded-2xl bg-white border-2 border-slate-300 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1.5 min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-extrabold text-slate-900">
                  1. สถานะบัญชี Google Drive (เข้าสู่ระบบค้างไว้อัตโนมัติ)
                </h3>
                {connectionState.isRefreshing ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-bold bg-blue-100 text-blue-800 border border-blue-300">
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    กำลังต่ออายุเซสชัน...
                  </span>
                ) : connectionState.connected && !connectionState.needsReauth ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {connectionState.tokenValid ? 'Connected' : 'Connected (Auto-Refresh Ready)'}
                  </span>
                ) : connectionState.connected && connectionState.needsReauth ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    ต้องการยืนยันสิทธิ์อีกครั้ง
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-bold bg-slate-100 text-slate-700 border border-slate-300">
                    Not Connected
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2.5 text-xs text-slate-600">
                {connectionState.user?.photoLink && (
                  <img
                    src={connectionState.user.photoLink}
                    alt={connectionState.user.displayName || 'Google User'}
                    className="w-7 h-7 rounded-full border border-slate-300 shrink-0"
                    referrerPolicy="no-referrer"
                  />
                )}
                <p className="min-w-0 break-words">
                  {connectionState.connected ? (
                    <>
                      <span className="font-bold text-slate-900">
                        {connectionState.user?.displayName || 'บัญชี Google Drive'}
                      </span>
                      {connectionState.user?.emailAddress && (
                        <span className="font-mono text-slate-700">
                          {' '}
                          ({connectionState.user.emailAddress})
                        </span>
                      )}
                      {connectionState.expiresAt && connectionState.tokenValid ? (
                        <span className="text-slate-500 font-mono">
                          {' '}
                          · Token หมดอายุ{' '}
                          {new Date(connectionState.expiresAt).toLocaleTimeString('th-TH')} (ต่ออายุอัตโนมัติ)
                        </span>
                      ) : (
                        <span className="text-slate-500">
                          {' '}
                          · ระบบจะต่ออายุ Token อัตโนมัติเมื่อบันทึกหรือดึงข้อมูล
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      เชื่อมต่อด้วย Google Identity Services (<code className="font-mono">{DRIVE_FILE_SCOPE}</code>) ระบบจะจดจำเซสชันไว้จนกว่าคุณจะกด Sign Out
                    </>
                  )}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleConnectDrive}
                disabled={isBusy || !clientIdInput.trim()}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-xl shadow-xs transition-colors cursor-pointer whitespace-nowrap"
              >
                {isConnecting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    {connectionState.connected
                      ? connectionState.needsReauth
                        ? 'Reconnect Now'
                        : 'Switch / Reconnect'
                      : 'Connect Google Drive'}
                  </>
                )}
              </button>

              {connectionState.connected && (
                <button
                  type="button"
                  onClick={handleDisconnectDrive}
                  disabled={isBusy}
                  title="Sign out, revoke OAuth token, and clear local session"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-bold text-red-700 bg-red-50 hover:bg-red-100 disabled:opacity-50 border border-red-200 rounded-xl cursor-pointer whitespace-nowrap"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  {isDisconnecting ? 'Signing Out...' : 'Sign Out / Disconnect'}
                </button>
              )}
            </div>
          </section>

          {/* SECTION 2: Load / Sync Data FROM Google Drive */}
          {connectionState.connected && (
            <section className="p-4 sm:p-5 rounded-2xl bg-blue-50/60 border-2 border-blue-200 space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <FolderOpen className="w-4 h-4 text-blue-700" />
                    <h3 className="text-sm font-extrabold text-slate-900">
                      2. Load / Sync from Google Drive (ดึงข้อมูลกลับเข้าระบบ)
                    </h3>
                  </div>
                  <p className="text-xs text-slate-600">
                    พบไฟล์สำรองทั้งหมด {driveFiles.length} ไฟล์ (เรียงจากแก้ไขล่าสุด) รองรับทั้งไฟล์ .json และ .xlsx
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleClickLoadLatestBackup}
                    disabled={isBusy}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-extrabold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-xl shadow-xs transition-colors cursor-pointer"
                  >
                    {restoringFileId ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <CloudDownload className="w-3.5 h-3.5" />
                    )}
                    {restoringFileId
                      ? 'กำลังดึงข้อมูล...'
                      : latestRestorableBackup
                      ? 'Load Latest Backup'
                      : 'Check & Load Latest'}
                  </button>

                  <button
                    type="button"
                    onClick={refreshDriveFiles}
                    disabled={isBusy}
                    className="inline-flex items-center gap-1 px-3 py-2 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 disabled:opacity-50 border border-slate-300 rounded-xl cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoadingFiles ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                </div>
              </div>

              {/* Explicit Confirmation Dialog for Restoring a Backup */}
              {pendingRestoreFile && (
                <div className="p-3.5 rounded-xl bg-white border-2 border-blue-500 flex flex-wrap items-center justify-between gap-3 shadow-xs">
                  <div className="flex items-start gap-2.5 text-xs text-slate-900 min-w-0 flex-1">
                    <AlertTriangle className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                    <p className="break-words">
                      ยืนยันการโหลดข้อมูลจากไฟล์{' '}
                      <strong className="font-mono text-blue-900">{pendingRestoreFile.name}</strong>
                      {pendingRestoreFile.modifiedTime && (
                        <> ({new Date(pendingRestoreFile.modifiedTime).toLocaleString('th-TH')})</>
                      )}
                      ? ข้อมูลบนหน้าจอปัจจุบันจะถูกแทนที่ด้วยข้อมูลจาก Google Drive ไฟล์นี้
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setPendingRestoreFile(null)}
                      disabled={Boolean(restoringFileId)}
                      className="px-3 py-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg cursor-pointer"
                    >
                      ยกเลิก
                    </button>
                    <button
                      type="button"
                      onClick={() => handleConfirmRestore(pendingRestoreFile)}
                      disabled={Boolean(restoringFileId)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg cursor-pointer"
                    >
                      {restoringFileId && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                      ยืนยันโหลดข้อมูลจาก Drive
                    </button>
                  </div>
                </div>
              )}

              {isLoadingFiles ? (
                <div className="py-5 text-center text-xs font-semibold text-blue-700 flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  กำลังดึงรายการไฟล์สำรองจาก Google Drive...
                </div>
              ) : driveFiles.length === 0 ? (
                <p className="text-xs text-slate-600 py-4 text-center bg-white/80 rounded-xl border border-blue-200/70">
                  ยังไม่พบไฟล์สำรองใน Google Drive กดปุ่ม &ldquo;Save to Google Drive&rdquo; ด้านล่างเพื่อสร้างไฟล์แรก
                </p>
              ) : (
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {driveFiles.map((file, index) => {
                    const isJson = isJsonDriveFile(file);
                    const isExcel = isExcelDriveFile(file);
                    const canRestore = isJson || isExcel;
                    const isMatchingFormat =
                      (uploadFormat === 'json' && isJson) ||
                      (uploadFormat === 'xlsx' && isExcel);

                    return (
                      <div
                        key={file.id}
                        className="p-3 rounded-xl bg-white border border-slate-200 hover:border-blue-300 flex flex-wrap items-center justify-between gap-2.5 transition-colors"
                      >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          {isJson ? (
                            <FileJson className="w-4 h-4 text-blue-600 shrink-0" />
                          ) : (
                            <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-xs font-bold text-slate-900 truncate">
                                {file.name}
                              </p>
                              {index === 0 && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 shrink-0">
                                  ล่าสุด
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] font-mono text-slate-500">
                              {file.modifiedTime
                                ? new Date(file.modifiedTime).toLocaleString('th-TH')
                                : '-'}
                              {file.size ? ` · ${formatBytes(file.size)}` : ''}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {canRestore && (
                            <button
                              type="button"
                              onClick={() => setPendingRestoreFile(file)}
                              disabled={isBusy}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 border border-blue-200 rounded-lg cursor-pointer"
                            >
                              {restoringFileId === file.id ? (
                                <RefreshCw className="w-3 h-3 animate-spin" />
                              ) : (
                                <Download className="w-3 h-3" />
                              )}
                              {restoringFileId === file.id ? 'กำลังโหลด...' : 'โหลดข้อมูล'}
                            </button>
                          )}
                          {isMatchingFormat && (
                            <button
                              type="button"
                              onClick={() =>
                                setPendingOverwrite({
                                  file,
                                  targetName: file.name,
                                  format: isJson ? 'json' : 'xlsx',
                                })
                              }
                              disabled={isBusy}
                              className="px-2.5 py-1.5 text-[11px] font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 disabled:opacity-50 border border-amber-200 rounded-lg cursor-pointer"
                            >
                              อัปเดตไฟล์นี้
                            </button>
                          )}
                          <a
                            href={file.webViewLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
                          >
                            <ExternalLink className="w-3 h-3" />
                            เปิดใน Drive
                          </a>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* SECTION 3: Save to Google Drive (Clean Update Existing via PATCH or Create New) */}
          <section className="p-4 sm:p-5 rounded-2xl bg-white border-2 border-slate-300 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-extrabold text-slate-900">
                  3. Save to Google Drive (อัปเดตไฟล์เดิมอัตโนมัติ ไม่สร้างไฟล์ซ้ำ)
                </h3>
                <p className="text-xs text-slate-500">
                  ข้อมูลที่จะบันทึก: {categories.length} โซน · {totalSeats} โต๊ะ · {expenses.length} รายการรายจ่าย
                </p>
              </div>
              {matchedExistingFile && (
                <span className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                  พบไฟล์เดิมบน Drive — จะอัปเดตทับโดยไม่สร้างไฟล์ซ้ำ
                </span>
              )}
            </div>

            {/* Format Selector */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => handleFormatChange('json')}
                disabled={isBusy}
                className={`p-3.5 rounded-xl border-2 text-left flex items-start gap-3 transition-all cursor-pointer disabled:opacity-60 ${
                  uploadFormat === 'json'
                    ? 'border-blue-600 bg-blue-50/70 shadow-2xs'
                    : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                }`}
              >
                <FileJson
                  className={`w-5 h-5 shrink-0 mt-0.5 ${
                    uploadFormat === 'json' ? 'text-blue-600' : 'text-slate-400'
                  }`}
                />
                <div className="min-w-0">
                  <p className="text-xs font-extrabold text-slate-900">
                    JSON System Backup (.json) — แนะนำสำหรับ Sync
                  </p>
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    สำรองข้อมูลครบ 100% (สลิป 1-2, หมายเหตุ, สีโซน, เช็คอิน, รายจ่าย) ดึงกลับมาได้สมบูรณ์ที่สุด
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleFormatChange('xlsx')}
                disabled={isBusy}
                className={`p-3.5 rounded-xl border-2 text-left flex items-start gap-3 transition-all cursor-pointer disabled:opacity-60 ${
                  uploadFormat === 'xlsx'
                    ? 'border-emerald-600 bg-emerald-50/70 shadow-2xs'
                    : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                }`}
              >
                <FileSpreadsheet
                  className={`w-5 h-5 shrink-0 mt-0.5 ${
                    uploadFormat === 'xlsx' ? 'text-emerald-600' : 'text-slate-400'
                  }`}
                />
                <div className="min-w-0">
                  <p className="text-xs font-extrabold text-slate-900">
                    Excel Workbook (.xlsx)
                  </p>
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    ไฟล์ Excel แยกชีตทุกโซน + ชีตรายจ่าย + ชีตสรุปงบการเงิน เปิดใน Google Sheets/Excel ได้ทันที
                  </p>
                </div>
              </button>
            </div>

            {/* Explicit Confirmation Dialog before Overwriting an Existing File on Google Drive */}
            {pendingOverwrite && (
              <div className="p-3.5 rounded-xl bg-amber-50 border-2 border-amber-400 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-start gap-2.5 text-xs text-amber-950 min-w-0 flex-1">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <p className="break-words">
                    พบไฟล์ <strong className="font-mono">{pendingOverwrite.file.name}</strong> อยู่แล้วบน Google Drive ยืนยันการอัปเดตทับไฟล์เดิม (PATCH) ด้วยข้อมูลล่าสุด หรือต้องการบันทึกเป็นไฟล์ใหม่แยกต่างหาก?
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setPendingOverwrite(null)}
                    disabled={isUploading}
                    className="px-3 py-1.5 text-xs font-bold text-slate-700 bg-white border border-slate-300 rounded-lg cursor-pointer"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      executeRealDriveUpload({
                        format: pendingOverwrite.format,
                        targetName: getTimestampedCopyFilename(pendingOverwrite.format),
                      })
                    }
                    disabled={isUploading}
                    className="px-3 py-1.5 text-xs font-bold text-slate-800 bg-white hover:bg-slate-100 border border-slate-400 rounded-lg cursor-pointer"
                  >
                    สร้างเป็นไฟล์ใหม่แทน
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      executeRealDriveUpload({
                        format: pendingOverwrite.format,
                        targetName: pendingOverwrite.targetName,
                        existingFileId: pendingOverwrite.file.id,
                      })
                    }
                    disabled={isUploading}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 rounded-lg cursor-pointer"
                  >
                    {isUploading && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                    ยืนยันอัปเดตไฟล์เดิม
                  </button>
                </div>
              </div>
            )}

            {/* Filename & Upload Actions */}
            <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-end">
              <div className="flex-1 space-y-1">
                <label className="block text-xs font-bold text-slate-700">
                  ชื่อไฟล์บน Google Drive (Filename)
                </label>
                <input
                  type="text"
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  disabled={isUploading}
                  className="w-full px-3.5 py-2.5 text-xs sm:text-sm font-mono font-semibold text-slate-900 bg-slate-50 border-2 border-slate-300 rounded-xl focus:bg-white focus:border-slate-900 focus:outline-none disabled:opacity-60"
                />
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleSmartSaveClick}
                  disabled={isBusy || !filename.trim()}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-xs sm:text-sm font-extrabold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-xl shadow-sm transition-colors cursor-pointer whitespace-nowrap"
                >
                  {isUploading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <CloudUpload className="w-4 h-4" />
                      {matchedExistingFile ? 'Update File on Drive' : 'Save to Google Drive'}
                    </>
                  )}
                </button>

                {matchedExistingFile && (
                  <button
                    type="button"
                    onClick={handleSaveAsNewCopyClick}
                    disabled={isBusy}
                    title="สร้างไฟล์สำเนาใหม่แบบระบุวันเวลา โดยไม่ทับไฟล์เดิม"
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 border border-slate-300 rounded-xl cursor-pointer whitespace-nowrap"
                  >
                    <CopyPlus className="w-4 h-4" />
                    Save Copy
                  </button>
                )}
              </div>
            </div>
          </section>

          {/* SECTION 4: Google Cloud OAuth Client ID Settings */}
          <section className="p-4 sm:p-5 rounded-2xl bg-slate-50 border-2 border-slate-200 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-slate-700" />
                <h3 className="text-xs sm:text-sm font-extrabold text-slate-900">
                  4. Google Cloud OAuth 2.0 Client ID Settings
                </h3>
              </div>
              <span className="text-[11px] font-mono font-semibold text-slate-500">
                Scope: drive.file
              </span>
            </div>

            <form onSubmit={handleSaveClientId} className="space-y-2">
              <label className="block text-xs font-semibold text-slate-600">
                วาง Google Cloud OAuth Client ID ของคุณ (บันทึกลง localStorage อัตโนมัติ)
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={clientIdInput}
                  onChange={(e) => setClientIdInput(e.target.value)}
                  placeholder="xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com"
                  className="flex-1 px-3.5 py-2 text-xs sm:text-sm font-mono text-slate-900 bg-white border-2 border-slate-300 rounded-xl focus:border-slate-900 focus:outline-none"
                />
                <button
                  type="submit"
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl cursor-pointer shrink-0"
                >
                  {clientIdSavedNotice ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      บันทึกแล้ว
                    </>
                  ) : (
                    'บันทึก Client ID'
                  )}
                </button>
              </div>
            </form>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5 text-[11px] text-slate-600">
              <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                <span className="font-semibold text-slate-700">
                  Authorized JavaScript Origin:
                </span>
                <code className="px-2 py-0.5 rounded bg-white border border-slate-300 font-mono text-slate-800 break-all">
                  {currentOrigin}
                </code>
                <button
                  type="button"
                  onClick={handleCopyOrigin}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white hover:bg-slate-100 border border-slate-300 font-semibold text-slate-700 cursor-pointer"
                >
                  {copiedOrigin ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-600" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      Copy
                    </>
                  )}
                </button>
              </div>

              {defaultClientId && clientIdInput.trim() !== defaultClientId && (
                <button
                  type="button"
                  onClick={() => {
                    setClientIdInput(defaultClientId);
                    saveDriveClientId(defaultClientId);
                    setClientIdSavedNotice(true);
                    window.setTimeout(() => setClientIdSavedNotice(false), 2000);
                  }}
                  className="text-blue-700 hover:underline font-semibold cursor-pointer"
                >
                  ใช้ Client ID เริ่มต้นของแอป
                </button>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
