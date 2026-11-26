import React from 'react';
import {
  Cloud,
  CloudUpload,
  CloudDownload,
  RefreshCw,
  Settings,
  LogOut,
} from 'lucide-react';
import { ActiveTab } from '../types/booking';

interface NavbarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  onOpenSettings: () => void;
  onOpenDriveModal: () => void;
  isDriveConnected: boolean;
  isDriveNeedsReauth?: boolean;
  driveUserLabel?: string | null;
  isDriveConnecting?: boolean;
  isDriveUploading?: boolean;
  isDriveLoadingBackup?: boolean;
  onConnectOrSaveDrive: () => void;
  onLoadFromDrive: () => void;
  onDisconnectDrive: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onSelectTab,
  onOpenSettings,
  onOpenDriveModal,
  isDriveConnected,
  isDriveNeedsReauth = false,
  driveUserLabel,
  isDriveConnecting = false,
  isDriveUploading = false,
  isDriveLoadingBackup = false,
  onConnectOrSaveDrive,
  onLoadFromDrive,
  onDisconnectDrive,
}) => {
  const isBusy = isDriveConnecting || isDriveUploading || isDriveLoadingBackup;

  return (
    <header className="sticky top-0 z-30 bg-white border-b-2 border-slate-300 px-4 sm:px-6 py-3 shadow-2xs">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#lookup"
          onClick={(e) => {
            e.preventDefault();
            onSelectTab('lookup');
          }}
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          Seat Booking Lookup
        </a>

        {/* Zone 2: Clean single-line text navigation links */}
        <nav className="flex items-center gap-5 sm:gap-6 text-sm font-medium text-slate-600 overflow-x-auto">
          <button
            type="button"
            onClick={() => onSelectTab('lookup')}
            className={`py-1 border-b-[3px] transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'lookup'
                ? 'border-slate-900 text-slate-900 font-bold'
                : 'border-transparent hover:text-slate-900 hover:border-slate-300'
            }`}
          >
            ค้นหาโต๊ะ
          </button>
          <button
            type="button"
            onClick={() => onSelectTab('dashboard')}
            className={`py-1 border-b-[3px] transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'dashboard'
                ? 'border-slate-900 text-slate-900 font-bold'
                : 'border-transparent hover:text-slate-900 hover:border-slate-300'
            }`}
          >
            Dashboard
          </button>
          <button
            type="button"
            onClick={() => onSelectTab('seatmap')}
            className={`py-1 border-b-[3px] transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'seatmap'
                ? 'border-slate-900 text-slate-900 font-bold'
                : 'border-transparent hover:text-slate-900 hover:border-slate-300'
            }`}
          >
            ผังโต๊ะ
          </button>
          <button
            type="button"
            onClick={() => onSelectTab('backoffice')}
            className={`py-1 border-b-[3px] transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'backoffice'
                ? 'border-slate-900 text-slate-900 font-bold'
                : 'border-transparent hover:text-slate-900 hover:border-slate-300'
            }`}
          >
            จัดการหลังบ้าน &amp; รายจ่าย
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            className="py-1 border-b-[3px] border-transparent hover:text-slate-900 hover:border-slate-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            นำเข้าแม่แบบ / ตั้งค่าสี
          </button>
        </nav>

        {/* Zone 3: Real Google Drive GIS Persistent Session Actions */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button
            type="button"
            onClick={onOpenDriveModal}
            title="Google Drive Settings, Backups & Client ID"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Settings className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Drive</span>
          </button>

          {isDriveConnected && (
            <button
              type="button"
              onClick={onLoadFromDrive}
              disabled={isBusy}
              title="ดึงข้อมูลล่าสุดจาก Google Drive"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-60 border border-blue-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isDriveLoadingBackup ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CloudDownload className="w-3.5 h-3.5" />
              )}
              <span>{isDriveLoadingBackup ? 'Loading...' : 'Load'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={onConnectOrSaveDrive}
            disabled={isBusy}
            title={
              isDriveConnected
                ? isDriveNeedsReauth
                  ? 'เซสชันหมดอายุ — คลิกเพื่อเชื่อมต่อ Google Drive อีกครั้ง'
                  : `เชื่อมต่อแล้ว${driveUserLabel ? ` (${driveUserLabel})` : ''} — คลิกเพื่อบันทึกข้อมูลขึ้น Google Drive`
                : 'เชื่อมต่อบัญชี Google Drive ผ่าน OAuth 2.0'
            }
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60 ${
              isDriveConnected
                ? isDriveNeedsReauth
                  ? 'bg-amber-600 hover:bg-amber-700'
                  : 'bg-emerald-600 hover:bg-emerald-700'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {isDriveUploading ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Saving...</span>
              </>
            ) : isDriveConnecting ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Connecting...</span>
              </>
            ) : isDriveConnected ? (
              isDriveNeedsReauth ? (
                <>
                  <Cloud className="w-3.5 h-3.5" />
                  <span>Reconnect Drive</span>
                </>
              ) : (
                <>
                  <CloudUpload className="w-3.5 h-3.5" />
                  <span>Save to Drive</span>
                </>
              )
            ) : (
              <>
                <Cloud className="w-3.5 h-3.5" />
                <span>Connect Google Drive</span>
              </>
            )}
          </button>

          {isDriveConnected && (
            <button
              type="button"
              onClick={onDisconnectDrive}
              disabled={isBusy}
              title={`ออกจากระบบ Google Drive${driveUserLabel ? ` (${driveUserLabel})` : ''}`}
              aria-label="Sign out of Google Drive"
              className="p-1.5 text-slate-500 hover:text-red-700 hover:bg-red-50 disabled:opacity-50 border border-slate-200 rounded-lg transition-colors cursor-pointer shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
