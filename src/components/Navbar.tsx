import React from 'react';
import {
  Cloud,
  CloudUpload,
  CheckCircle2,
  RefreshCw,
  Settings,
} from 'lucide-react';
import { ActiveTab } from '../types/booking';

interface NavbarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  onOpenSettings: () => void;
  onOpenDriveModal: () => void;
  isDriveConnected: boolean;
  driveUserLabel?: string | null;
  isDriveUploading?: boolean;
  onConnectOrSaveDrive: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onSelectTab,
  onOpenSettings,
  onOpenDriveModal,
  isDriveConnected,
  driveUserLabel,
  isDriveUploading = false,
  onConnectOrSaveDrive,
}) => {
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

        {/* Zone 3: Real Google Drive GIS Connection & Settings Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onOpenDriveModal}
            title="Google Drive Settings (Client ID & Upload Options)"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Drive Settings</span>
          </button>

          <button
            type="button"
            onClick={onConnectOrSaveDrive}
            disabled={isDriveUploading}
            title={
              isDriveConnected
                ? `Connected to Google Drive${driveUserLabel ? ` (${driveUserLabel})` : ''} — Click to Save to Google Drive`
                : 'Connect Google Drive via Google Identity Services (OAuth 2.0)'
            }
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60 ${
              isDriveConnected
                ? 'bg-emerald-600 hover:bg-emerald-700'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {isDriveUploading ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Uploading...</span>
              </>
            ) : isDriveConnected ? (
              <>
                <CloudUpload className="w-3.5 h-3.5" />
                <span>Save to Google Drive</span>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-200" />
              </>
            ) : (
              <>
                <Cloud className="w-3.5 h-3.5" />
                <span>Connect Google Drive</span>
              </>
            )}
          </button>
        </div>
      </div>
    </header>
  );
};
