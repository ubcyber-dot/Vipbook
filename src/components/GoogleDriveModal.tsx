import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Cloud,
  CloudUpload,
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
} from 'lucide-react';
import {
  CategoryConfig,
  CategorySheetResult,
  ExpenseRecord,
} from '../types/booking';
import { CloudSystemState } from '../services/sheetsApi';
import {
  DRIVE_FILE_SCOPE,
  DriveConnectionState,
  DriveUploadedFile,
  connectGoogleDrive,
  disconnectGoogleDrive,
  downloadJsonFileFromGoogleDrive,
  getDefaultAppletClientId,
  getDriveConnectionState,
  getStoredDriveClientId,
  listAppCreatedDriveFiles,
  saveDriveClientId,
  uploadFileToGoogleDrive,
} from '../services/googleDriveGis';
import { generateCurrentDataExcelBytes } from '../utils/excelTemplate';

export type DriveExportFormat = 'xlsx' | 'json';

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

function getDefaultFilename(format: DriveExportFormat): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  if (format === 'xlsx') {
    return `Seat_Bookings_VIP_Standard_${yyyy}-${mm}-${dd}_${hh}${min}.xlsx`;
  }
  return `Seat_Booking_System_Backup_${yyyy}-${mm}-${dd}_${hh}${min}.json`;
}

function formatBytes(sizeStr?: string): string {
  const bytes = Number(sizeStr);
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
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

  // Connection & Upload States
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadFormat, setUploadFormat] = useState<DriveExportFormat>('xlsx');
  const [filename, setFilename] = useState<string>(() => getDefaultFilename('xlsx'));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [latestUpload, setLatestUpload] = useState<DriveUploadedFile | null>(lastUploadedFile);

  // Real App-Created Drive Files List
  const [driveFiles, setDriveFiles] = useState<DriveUploadedFile[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState<boolean>(false);
  const [restoringFileId, setRestoringFileId] = useState<string | null>(null);

  // Explicit Confirmation State before Overwriting an Existing Drive File or Restoring
  const [pendingOverwriteFile, setPendingOverwriteFile] = useState<DriveUploadedFile | null>(null);
  const [pendingRestoreFile, setPendingRestoreFile] = useState<DriveUploadedFile | null>(null);

  const defaultClientId = getDefaultAppletClientId();
  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';

  useEffect(() => {
    setLatestUpload(lastUploadedFile);
  }, [lastUploadedFile]);

  const refreshDriveFiles = useCallback(async () => {
    if (!getDriveConnectionState().connected) return;
    setIsLoadingFiles(true);
    try {
      const files = await listAppCreatedDriveFiles();
      setDriveFiles(files);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to load files from Google Drive.');
    } finally {
      setIsLoadingFiles(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setClientIdInput(getStoredDriveClientId());
    setFilename(getDefaultFilename(uploadFormat));
    setErrorMessage(null);
    setPendingOverwriteFile(null);
    setPendingRestoreFile(null);

    if (connectionState.connected) {
      refreshDriveFiles();
    }
  }, [isOpen, connectionState.connected, refreshDriveFiles]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleFormatChange = (nextFormat: DriveExportFormat) => {
    setUploadFormat(nextFormat);
    setFilename(getDefaultFilename(nextFormat));
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
    try {
      await connectGoogleDrive(trimmedClientId, { prompt: 'consent' });
      await refreshDriveFiles();
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to authenticate with Google Drive.');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnectDrive = async () => {
    await disconnectGoogleDrive();
    setDriveFiles([]);
    setPendingOverwriteFile(null);
    setPendingRestoreFile(null);
    setErrorMessage(null);
  };

  const executeRealDriveUpload = async (existingFileId?: string) => {
    const trimmedName = filename.trim() || getDefaultFilename(uploadFormat);
    const finalName =
      uploadFormat === 'xlsx' && !trimmedName.toLowerCase().endsWith('.xlsx')
        ? `${trimmedName}.xlsx`
        : uploadFormat === 'json' && !trimmedName.toLowerCase().endsWith('.json')
        ? `${trimmedName}.json`
        : trimmedName;

    setIsUploading(true);
    setErrorMessage(null);
    setPendingOverwriteFile(null);

    try {
      // Ensure user is connected before uploading
      if (!getDriveConnectionState().connected) {
        const trimmedClientId = clientIdInput.trim();
        saveDriveClientId(trimmedClientId);
        await connectGoogleDrive(trimmedClientId, { prompt: 'consent' });
      }

      let uploaded: DriveUploadedFile;

      if (uploadFormat === 'xlsx') {
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
          existingFileId,
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
        const jsonText = JSON.stringify(payload, null, 2);
        uploaded = await uploadFileToGoogleDrive({
          filename: finalName,
          mimeType: 'application/json',
          content: jsonText,
          description:
            'VIP & Standard Seat Booking System Complete JSON Backup',
          existingFileId,
        });
      }

      setLatestUpload(uploaded);
      onUploadSuccess(uploaded);
      // Update file list from Drive
      await refreshDriveFiles();
    } catch (err: any) {
      setErrorMessage(
        err?.message || 'Upload to Google Drive failed. Please check your permissions and try again.'
      );
    } finally {
      setIsUploading(false);
    }
  };

  const handleConfirmRestore = async (file: DriveUploadedFile) => {
    setRestoringFileId(file.id);
    setErrorMessage(null);
    setPendingRestoreFile(null);
    try {
      const parsed = await downloadJsonFileFromGoogleDrive<CloudSystemState>(file.id);
      if (!parsed || !Array.isArray(parsed.categoryResults)) {
        throw new Error(
          'This JSON file does not match the Seat Booking System backup schema.'
        );
      }
      onRestoreCloudState(parsed, file);
    } catch (err: any) {
      setErrorMessage(
        err?.message || 'Failed to download or parse backup file from Google Drive.'
      );
    } finally {
      setRestoringFileId(null);
    }
  };

  const totalSeats = categoryResults.reduce((acc, r) => acc + (r.records?.length || 0), 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/65 backdrop-blur-xs overflow-y-auto"
      onClick={onClose}
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
                Google Drive Settings &amp; Save to Google Drive
              </h2>
              <p className="text-xs text-slate-300 truncate">
                เชื่อมต่อ Google Drive จริงผ่าน Google Identity Services (GIS) &amp; Drive API v3
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close Google Drive modal"
            className="p-2 text-slate-300 hover:text-white bg-white/10 hover:bg-white/20 rounded-xl transition-colors cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-5">
          {/* Error Alert Banner (Real GIS / Google Drive API Errors) */}
          {errorMessage && (
            <div className="p-4 rounded-2xl bg-red-50 border-2 border-red-300 flex items-start gap-3 text-red-900">
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div className="space-y-1 min-w-0 flex-1">
                <p className="text-xs font-extrabold uppercase tracking-wide text-red-700">
                  Google Drive Authentication / Upload Error
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
                    บันทึกไฟล์ขึ้น Google Drive สำเร็จแล้ว! (Saved to My Drive Root)
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

          {/* SECTION 1: Google Drive Settings (OAuth Client ID) */}
          <section className="p-4 sm:p-5 rounded-2xl bg-slate-50 border-2 border-slate-200 space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-slate-700" />
                <h3 className="text-sm font-extrabold text-slate-900">
                  1. Google Drive Settings (Google Cloud OAuth Client ID)
                </h3>
              </div>
              <span className="text-[11px] font-mono font-semibold text-slate-500">
                Scope: drive.file
              </span>
            </div>

            <form onSubmit={handleSaveClientId} className="space-y-2.5">
              <label className="block text-xs font-semibold text-slate-600">
                วาง Google Cloud OAuth 2.0 Client ID ของคุณ (บันทึกลง localStorage อัตโนมัติ ไม่ต้องแก้โค้ด)
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={clientIdInput}
                  onChange={(e) => setClientIdInput(e.target.value)}
                  placeholder="xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com"
                  className="flex-1 px-3.5 py-2.5 text-xs sm:text-sm font-mono text-slate-900 bg-white border-2 border-slate-300 rounded-xl focus:border-slate-900 focus:outline-none"
                />
                <button
                  type="submit"
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl cursor-pointer shrink-0"
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

            {/* Authorized JavaScript Origin helper for Google Cloud Console */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-slate-600">
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

          {/* SECTION 2: Connect Google Drive (GIS OAuth 2.0) */}
          <section className="p-4 sm:p-5 rounded-2xl bg-white border-2 border-slate-300 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-extrabold text-slate-900">
                  2. เชื่อมต่อบัญชี Google Drive
                </h3>
                {connectionState.connected ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Connected
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">
                    Not Connected
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-600">
                {connectionState.connected ? (
                  <>
                    เชื่อมต่อแล้ว
                    {connectionState.user?.emailAddress
                      ? ` ในชื่อ ${connectionState.user.displayName || ''} (${connectionState.user.emailAddress})`
                      : ' (สิทธิ์ drive.file พร้อมอัปโหลดไฟล์ไปยัง Google Drive)'}
                    {connectionState.expiresAt && (
                      <span className="text-slate-500 font-mono">
                        {' '}
                        · หมดอายุเวลา{' '}
                        {new Date(connectionState.expiresAt).toLocaleTimeString('th-TH')}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    กดปุ่มเพื่อขอสิทธิ์ OAuth 2.0 (<code className="font-mono">{DRIVE_FILE_SCOPE}</code>) ผ่าน Google Identity Services (เก็บ Token ในหน่วยความจำเท่านั้น)
                  </>
                )}
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleConnectDrive}
                disabled={isConnecting || !clientIdInput.trim()}
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
                    {connectionState.connected ? 'Reconnect Google Drive' : 'Connect Google Drive'}
                  </>
                )}
              </button>

              {connectionState.connected && (
                <button
                  type="button"
                  onClick={handleDisconnectDrive}
                  title="Revoke access token and disconnect"
                  className="inline-flex items-center gap-1 px-3 py-2.5 text-xs font-bold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Disconnect
                </button>
              )}
            </div>
          </section>

          {/* SECTION 3: Save to Google Drive (Real Multipart Upload to Root Folder) */}
          <section className="p-4 sm:p-5 rounded-2xl bg-white border-2 border-slate-300 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-extrabold text-slate-900">
                  3. Save to Google Drive (อัปโหลดไฟล์จริงไปยัง Root Folder)
                </h3>
                <p className="text-xs text-slate-500">
                  ข้อมูลที่จะบันทึก: {categories.length} โซน · {totalSeats} โต๊ะ · {expenses.length} รายการรายจ่าย
                </p>
              </div>
            </div>

            {/* Format Selector */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => handleFormatChange('xlsx')}
                className={`p-3.5 rounded-xl border-2 text-left flex items-start gap-3 transition-all cursor-pointer ${
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
                    ไฟล์ Excel แยกชีตทุกโซน + ชีตรายจ่าย + ชีตสรุปงบการเงิน เปิดดูใน Google Sheets/Excel ได้ทันที
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleFormatChange('json')}
                className={`p-3.5 rounded-xl border-2 text-left flex items-start gap-3 transition-all cursor-pointer ${
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
                    JSON System Backup (.json)
                  </p>
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    สำรองข้อมูลทั้งระบบครบทุกฟิลด์ (รวมสลิป 1-2, หมายเหตุ, สีโซน, รายจ่าย) และกู้คืนกลับมาได้
                  </p>
                </div>
              </button>
            </div>

            {/* Filename & Primary Upload Button */}
            <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-end">
              <div className="flex-1 space-y-1">
                <label className="block text-xs font-bold text-slate-700">
                  ชื่อไฟล์บน Google Drive (Filename)
                </label>
                <input
                  type="text"
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs sm:text-sm font-mono font-semibold text-slate-900 bg-slate-50 border-2 border-slate-300 rounded-xl focus:bg-white focus:border-slate-900 focus:outline-none"
                />
              </div>

              <button
                type="button"
                onClick={() => executeRealDriveUpload()}
                disabled={isUploading || isConnecting || !filename.trim()}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-extrabold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-xl shadow-sm transition-colors cursor-pointer whitespace-nowrap"
              >
                {isUploading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Uploading to Google Drive...
                  </>
                ) : (
                  <>
                    <CloudUpload className="w-4 h-4" />
                    Save to Google Drive
                  </>
                )}
              </button>
            </div>
          </section>

          {/* SECTION 4: Existing App Files on Google Drive (with Overwrite / Restore Confirmations) */}
          {connectionState.connected && (
            <section className="p-4 sm:p-5 rounded-2xl bg-slate-50 border-2 border-slate-200 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <FolderOpen className="w-4 h-4 text-slate-700" />
                  <h3 className="text-xs sm:text-sm font-extrabold text-slate-900">
                    ไฟล์ที่บันทึกไว้ใน Google Drive ของคุณ ({driveFiles.length})
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={refreshDriveFiles}
                  disabled={isLoadingFiles}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg cursor-pointer"
                >
                  <RefreshCw className={`w-3 h-3 ${isLoadingFiles ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>

              {/* Explicit Confirmation Dialog for Overwriting an Existing Drive File */}
              {pendingOverwriteFile && (
                <div className="p-3.5 rounded-xl bg-amber-50 border-2 border-amber-400 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-start gap-2.5 text-xs text-amber-950">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <p>
                      ยืนยันการเขียนทับไฟล์{' '}
                      <strong className="font-mono">{pendingOverwriteFile.name}</strong> บน Google Drive ด้วยข้อมูลปัจจุบันใช่หรือไม่?
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setPendingOverwriteFile(null)}
                      className="px-3 py-1.5 text-xs font-bold text-slate-700 bg-white border border-slate-300 rounded-lg cursor-pointer"
                    >
                      ยกเลิก
                    </button>
                    <button
                      type="button"
                      onClick={() => executeRealDriveUpload(pendingOverwriteFile.id)}
                      disabled={isUploading}
                      className="px-3 py-1.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg cursor-pointer"
                    >
                      ยืนยันเขียนทับไฟล์เดิม
                    </button>
                  </div>
                </div>
              )}

              {/* Explicit Confirmation Dialog for Restoring a JSON Backup */}
              {pendingRestoreFile && (
                <div className="p-3.5 rounded-xl bg-blue-50 border-2 border-blue-400 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-start gap-2.5 text-xs text-blue-950">
                    <AlertTriangle className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                    <p>
                      ยืนยันการกู้คืนข้อมูลจาก{' '}
                      <strong className="font-mono">{pendingRestoreFile.name}</strong>? ข้อมูลบนหน้าจอปัจจุบันจะถูกแทนที่ด้วยไฟล์สำรองนี้
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setPendingRestoreFile(null)}
                      className="px-3 py-1.5 text-xs font-bold text-slate-700 bg-white border border-slate-300 rounded-lg cursor-pointer"
                    >
                      ยกเลิก
                    </button>
                    <button
                      type="button"
                      onClick={() => handleConfirmRestore(pendingRestoreFile)}
                      disabled={Boolean(restoringFileId)}
                      className="px-3 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer"
                    >
                      ยืนยันกู้คืนข้อมูล
                    </button>
                  </div>
                </div>
              )}

              {isLoadingFiles ? (
                <p className="text-xs text-slate-500 py-4 text-center">
                  กำลังโหลดรายการไฟล์จาก Google Drive...
                </p>
              ) : driveFiles.length === 0 ? (
                <p className="text-xs text-slate-500 py-4 text-center">
                  ยังไม่มีไฟล์ที่บันทึกจากแอปนี้ กดปุ่ม &ldquo;Save to Google Drive&rdquo; ด้านบนเพื่ออัปโหลดไฟล์แรก
                </p>
              ) : (
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {driveFiles.map((file) => {
                    const isJson =
                      file.mimeType === 'application/json' ||
                      file.name.toLowerCase().endsWith('.json');
                    const isMatchingFormat =
                      (uploadFormat === 'json' && isJson) ||
                      (uploadFormat === 'xlsx' && !isJson);
                    return (
                      <div
                        key={file.id}
                        className="p-3 rounded-xl bg-white border border-slate-200 flex flex-wrap items-center justify-between gap-2.5"
                      >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          {isJson ? (
                            <FileJson className="w-4 h-4 text-blue-600 shrink-0" />
                          ) : (
                            <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-slate-900 truncate">
                              {file.name}
                            </p>
                            <p className="text-[11px] font-mono text-slate-500">
                              {file.modifiedTime
                                ? new Date(file.modifiedTime).toLocaleString('th-TH')
                                : ''}
                              {file.size ? ` · ${formatBytes(file.size)}` : ''}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {isJson && (
                            <button
                              type="button"
                              onClick={() => setPendingRestoreFile(file)}
                              disabled={restoringFileId === file.id}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg cursor-pointer"
                            >
                              <Download className="w-3 h-3" />
                              {restoringFileId === file.id ? 'กำลังกู้คืน...' : 'กู้คืนข้อมูล'}
                            </button>
                          )}
                          {isMatchingFormat && (
                            <button
                              type="button"
                              onClick={() => setPendingOverwriteFile(file)}
                              disabled={isUploading}
                              className="px-2.5 py-1.5 text-[11px] font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg cursor-pointer"
                            >
                              อัปเดตทับไฟล์นี้
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
        </div>
      </div>
    </div>
  );
};
