import React from 'react';
import { Cloud, CheckCircle2, RefreshCw, LogOut, UserCheck } from 'lucide-react';
import { ActiveTab } from '../types/booking';

interface NavbarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  onOpenSettings: () => void;
  isConnected: boolean;
  spreadsheetTitle?: string;
  userEmail?: string | null;
  isAuthenticated?: boolean;
  hasDriveToken?: boolean;
  cloudSyncStatus?: 'idle' | 'saving' | 'saved' | 'loading' | 'error';
  lastCloudSavedAt?: string | null;
  onRequestGoogleLogin?: () => void;
  onSaveToCloudDrive?: () => void;
  onLogout?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onSelectTab,
  onOpenSettings,
  userEmail,
  isAuthenticated = false,
  hasDriveToken = false,
  cloudSyncStatus = 'idle',
  lastCloudSavedAt,
  onRequestGoogleLogin,
  onSaveToCloudDrive,
  onLogout,
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

        {/* Zone 3: Persistent Email Login & Google Drive Cloud Sync Action */}
        <div className="flex items-center gap-2 shrink-0">
          {isAuthenticated && userEmail ? (
            <>
              <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-700">
                <UserCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span className="truncate max-w-[180px]" title={`เข้าสู่ระบบถาวร: ${userEmail}`}>
                  {userEmail}
                </span>
              </div>

              <button
                type="button"
                onClick={onSaveToCloudDrive}
                title={
                  lastCloudSavedAt
                    ? `ซิงค์ข้อมูลลง Google Drive (${userEmail}) ล่าสุดเมื่อ ${new Date(
                        lastCloudSavedAt
                      ).toLocaleTimeString('th-TH')}`
                    : `คลิกเพื่อซิงค์ข้อมูลลง Google Drive (${userEmail})`
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {cloudSyncStatus === 'saving' || cloudSyncStatus === 'loading' ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : hasDriveToken ? (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                ) : (
                  <Cloud className="w-3.5 h-3.5" />
                )}
                <span>
                  {cloudSyncStatus === 'saving'
                    ? 'กำลังซิงค์...'
                    : cloudSyncStatus === 'loading'
                    ? 'กำลังโหลด...'
                    : hasDriveToken
                    ? 'ซิงค์ Drive แล้ว'
                    : 'ซิงค์ Google Drive'}
                </span>
              </button>

              {onLogout && (
                <button
                  type="button"
                  onClick={onLogout}
                  title="ออกจากระบบ (ล้างการจดจำอีเมลถาวร)"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:text-red-600 bg-white hover:bg-red-50 border border-slate-200 hover:border-red-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">ออกจากระบบ</span>
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={onRequestGoogleLogin}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Cloud className="w-3.5 h-3.5" />
              <span>เข้าสู่ระบบอีเมล (จดจำถาวร)</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
