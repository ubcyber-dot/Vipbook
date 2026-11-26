import React, { useState, useMemo, useEffect } from 'react';
import {
  Plus,
  Trash2,
  Pencil,
  Download,
  Receipt,
  TrendingUp,
  TrendingDown,
  Wallet,
  CheckCircle2,
  XCircle,
  Search,
  ExternalLink,
  Upload,
  RotateCcw,
  Armchair,
  Save,
  Cloud,
  CloudUpload,
  CloudDownload,
  LogOut,
  RefreshCw,
  Settings,
  Eye,
  UserCheck,
  Ticket,
  AlertCircle,
  ArrowRightLeft,
} from 'lucide-react';
import {
  CategoryConfig,
  ExpenseCategoryId,
  ExpenseRecord,
  SeatRecord,
} from '../types/booking';
import {
  EXPENSE_CATEGORY_OPTIONS,
  getExpenseCategoryLabel,
  buildUpdatedSeatRecord,
} from '../utils/excelTemplate';
import { compressImageFileToDataUrl, sanitizeSafeUrl } from '../utils/media';
import { DriveConnectionState, DriveUploadedFile } from '../services/googleDriveGis';
import { formatBaht, formatNowCheckInTimestamp } from './BookingCard';
import { formatPercent } from './DashboardView';
import { SeatDetailModal } from './SeatDetailModal';
import { SlipPreviewModal, SlipPreviewData } from './SlipPreviewModal';
import { AddTableModal } from './AddTableModal';

interface BackOfficeViewProps {
  records: SeatRecord[];
  categories: CategoryConfig[];
  expenses: ExpenseRecord[];
  onAddExpense: (expense: Omit<ExpenseRecord, 'id' | 'createdAt'>) => void;
  onUpdateExpense: (expense: ExpenseRecord) => void;
  onDeleteExpense: (expenseId: string) => void;
  onUpdateRecord: (updated: SeatRecord) => void;
  onAddRecord: (categoryId: string, record: SeatRecord) => void;
  onAddMultipleRecords?: (categoryId: string, records: SeatRecord[]) => void;
  onDeleteRecord: (recordId: string) => void;
  onRequestMoveTable?: (record?: SeatRecord) => void;
  onExportExcel: () => void;
  driveConnection: DriveConnectionState;
  isDriveConnecting: boolean;
  isDriveUploading: boolean;
  isDriveLoadingBackup?: boolean;
  driveError: string | null;
  lastDriveFile: DriveUploadedFile | null;
  onOpenDriveModal: () => void;
  onConnectGoogleDrive: () => void;
  onDisconnectGoogleDrive: () => void;
  onQuickSaveToDrive: (format: 'xlsx' | 'json') => void;
  onLoadFromDrive: () => void;
}

type ActiveSlipTarget =
  | { type: 'seat'; seatId: string; slot: 1 | 2 }
  | { type: 'expense'; expenseId: string }
  | { type: 'draft-expense' }
  | null;

export const BackOfficeView: React.FC<BackOfficeViewProps> = ({
  records,
  categories,
  expenses,
  onAddExpense,
  onUpdateExpense,
  onDeleteExpense,
  onUpdateRecord,
  onAddRecord,
  onAddMultipleRecords,
  onDeleteRecord,
  onRequestMoveTable,
  onExportExcel,
  driveConnection,
  isDriveConnecting,
  isDriveUploading,
  isDriveLoadingBackup = false,
  driveError,
  lastDriveFile,
  onOpenDriveModal,
  onConnectGoogleDrive,
  onDisconnectGoogleDrive,
  onQuickSaveToDrive,
  onLoadFromDrive,
}) => {
  const [subTab, setSubTab] = useState<'expenses' | 'bookings'>('expenses');

  // Expense Form State
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [expTitle, setExpTitle] = useState('');
  const [expCategory, setExpCategory] = useState<ExpenseCategoryId>('food');
  const [expAmountStr, setExpAmountStr] = useState('');
  const [expDate, setExpDate] = useState(() => new Date().toLocaleDateString('th-TH'));
  const [expPayee, setExpPayee] = useState('');
  const [expReceiptUrl, setExpReceiptUrl] = useState('');
  const [expFormError, setExpFormError] = useState<string | null>(null);
  const [expenseFilterCat, setExpenseFilterCat] = useState<string>('all');
  const [expenseSearch, setExpenseSearch] = useState('');

  // Inline 2-click Delete Confirmation States (prevents accidental single-click data loss)
  const [confirmDeleteExpenseId, setConfirmDeleteExpenseId] = useState<string | null>(null);
  const [confirmDeleteSeatId, setConfirmDeleteSeatId] = useState<string | null>(null);

  // Table Manager State
  const [tableFilterCat, setTableFilterCat] = useState<string>('all');
  const [tableCheckInFilter, setTableCheckInFilter] = useState<
    'all' | 'ticketcollected' | 'unticketed' | 'checkedin' | 'uncheckedin'
  >('all');
  const [tableSearch, setTableSearch] = useState('');
  const [isAddingTable, setIsAddingTable] = useState(false);

  // Popup Edit & Live Slip Preview State
  const [activeEditSeatId, setActiveEditSeatId] = useState<string | null>(null);
  const [activeSlipTarget, setActiveSlipTarget] = useState<ActiveSlipTarget>(null);

  // Reset tableFilterCat cleanly if a custom category is deleted in Settings
  useEffect(() => {
    if (
      tableFilterCat !== 'all' &&
      !categories.some((c) => c.id === tableFilterCat)
    ) {
      setTableFilterCat('all');
    }
  }, [categories, tableFilterCat]);

  // Auto-clear delete confirmations after 4 seconds
  useEffect(() => {
    if (!confirmDeleteExpenseId) return;
    const t = window.setTimeout(() => setConfirmDeleteExpenseId(null), 4000);
    return () => window.clearTimeout(t);
  }, [confirmDeleteExpenseId]);

  useEffect(() => {
    if (!confirmDeleteSeatId) return;
    const t = window.setTimeout(() => setConfirmDeleteSeatId(null), 4000);
    return () => window.clearTimeout(t);
  }, [confirmDeleteSeatId]);

  const categoryColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of categories) {
      map[c.id] = c.colorHex;
    }
    return map;
  }, [categories]);

  const activeEditSeat = useMemo(
    () => records.find((r) => r.id === activeEditSeatId) || null,
    [records, activeEditSeatId]
  );

  // Derive activeSlipPreview dynamically from live records/expenses so toggling Paid or replacing slip never uses stale closures!
  const activeSlipPreview: SlipPreviewData | null = useMemo(() => {
    if (!activeSlipTarget) return null;

    if (activeSlipTarget.type === 'draft-expense') {
      if (!expReceiptUrl) return null;
      return {
        slipUrl: expReceiptUrl,
        title: expTitle || 'ตัวอย่างใบเสร็จ / สลิปรายจ่าย',
        badgeText: getExpenseCategoryLabel(expCategory),
        accentColor: '#0F172A',
        amountText: expAmountStr ? `${expAmountStr} บาท` : undefined,
        dateText: expDate,
        onReplaceSlipUrl: (newUrl) => setExpReceiptUrl(newUrl),
      };
    }

    if (activeSlipTarget.type === 'expense') {
      const exp = expenses.find((item) => item.id === activeSlipTarget.expenseId);
      if (!exp || !exp.receiptUrl) return null;
      const catOpt = EXPENSE_CATEGORY_OPTIONS.find((c) => c.id === exp.category);
      return {
        slipUrl: exp.receiptUrl,
        title: `ใบเสร็จ/สลิปรายจ่าย — ${exp.title}`,
        subtitle: exp.payeeOrNote ? `ผู้เบิก/ร้านค้า: ${exp.payeeOrNote}` : undefined,
        badgeText: exp.categoryLabel,
        accentColor: catOpt?.colorHex || '#0F172A',
        amountText: formatBaht(exp.amount),
        dateText: exp.expenseDate || '-',
        onReplaceSlipUrl: (newUrl) =>
          onUpdateExpense({
            ...exp,
            receiptUrl: newUrl,
          }),
      };
    }

    const seat = records.find((r) => r.id === activeSlipTarget.seatId);
    if (!seat) return null;
    const slotUrl = activeSlipTarget.slot === 1 ? seat.slipUrl : seat.slipUrl2 || '';
    if (!slotUrl) return null;
    const zoneColor = categoryColorMap[seat.categoryId] || '#2563EB';
    return {
      slipUrl: slotUrl,
      title: `สลิปที่ ${activeSlipTarget.slot} — โต๊ะ ${seat.tableNumber}`,
      subtitle: seat.fullName
        ? `ผู้จอง: ${seat.fullName}${seat.phone ? ` (${seat.phone})` : ''}`
        : `แผ่นงาน ${seat.sheetName} · แถวที่ ${seat.rowNumber}`,
      badgeText: `โซน ${seat.categoryName} · สลิป ${activeSlipTarget.slot}`,
      accentColor: zoneColor,
      amountText: formatBaht(seat.transferAmount, seat.rawTransferAmount),
      dateText: seat.transferDate || '-',
      isPaid: seat.isPaid,
      onTogglePaid: () => {
        onUpdateRecord(buildUpdatedSeatRecord(seat, { isPaid: !seat.isPaid }));
      },
      onReplaceSlipUrl: (newUrl) => {
        onUpdateRecord(
          buildUpdatedSeatRecord(
            seat,
            activeSlipTarget.slot === 1 ? { slipUrl: newUrl } : { slipUrl2: newUrl }
          )
        );
      },
    };
  }, [
    activeSlipTarget,
    records,
    expenses,
    categoryColorMap,
    expReceiptUrl,
    expTitle,
    expCategory,
    expAmountStr,
    expDate,
    onUpdateRecord,
    onUpdateExpense,
  ]);

  // Financial Calculations
  const financialStats = useMemo(() => {
    const paidIncome = records
      .filter((r) => r.isPaid)
      .reduce((sum, r) => sum + (r.transferAmount || 0), 0);
    const unpaidIncome = records
      .filter((r) => !r.isPaid)
      .reduce((sum, r) => sum + (r.transferAmount || 0), 0);
    const totalIncome = paidIncome + unpaidIncome;
    const totalExpense = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    const netProfit = paidIncome - totalExpense;
    const projectedNetProfit = totalIncome - totalExpense;

    const byExpenseCategory = EXPENSE_CATEGORY_OPTIONS.map((opt) => {
      const items = expenses.filter((e) => e.category === opt.id);
      const sum = items.reduce((acc, e) => acc + (e.amount || 0), 0);
      return {
        ...opt,
        count: items.length,
        amount: sum,
      };
    });

    return {
      paidIncome,
      unpaidIncome,
      totalIncome,
      totalExpense,
      netProfit,
      projectedNetProfit,
      byExpenseCategory,
    };
  }, [records, expenses]);

  // Filtered Expenses
  const filteredExpenses = useMemo(() => {
    const q = expenseSearch.trim().toLowerCase();
    return expenses.filter((e) => {
      if (expenseFilterCat !== 'all' && e.category !== expenseFilterCat) return false;
      if (q) {
        const matchTitle = e.title.toLowerCase().includes(q);
        const matchPayee = e.payeeOrNote.toLowerCase().includes(q);
        const matchCat = e.categoryLabel.toLowerCase().includes(q);
        if (!matchTitle && !matchPayee && !matchCat) return false;
      }
      return true;
    });
  }, [expenses, expenseFilterCat, expenseSearch]);

  // Filtered Tables
  const filteredTables = useMemo(() => {
    const q = tableSearch.trim().toUpperCase();
    return records.filter((r) => {
      if (tableFilterCat !== 'all' && r.categoryId !== tableFilterCat) return false;
      if (tableCheckInFilter === 'ticketcollected' && !r.isTicketCollected)
        return false;
      if (tableCheckInFilter === 'unticketed' && r.isTicketCollected) return false;
      if (tableCheckInFilter === 'checkedin' && !r.isCheckedIn) return false;
      if (tableCheckInFilter === 'uncheckedin' && r.isCheckedIn) return false;
      if (q) {
        const matchTable =
          r.normalizedTableNumber.includes(q.replace(/\s+/g, '')) ||
          r.compactTableNumber.includes(q.replace(/[\s\-_]+/g, ''));
        const matchName = r.fullName.toUpperCase().includes(q);
        const matchPhone = r.phone.toUpperCase().includes(q);
        const matchNote = (r.note || '').toUpperCase().includes(q);
        if (!matchTable && !matchName && !matchPhone && !matchNote) return false;
      }
      return true;
    });
  }, [records, tableFilterCat, tableCheckInFilter, tableSearch]);

  const resetExpenseForm = () => {
    setEditingExpenseId(null);
    setExpTitle('');
    setExpCategory('food');
    setExpAmountStr('');
    setExpDate(new Date().toLocaleDateString('th-TH'));
    setExpPayee('');
    setExpReceiptUrl('');
    setExpFormError(null);
  };

  const handleExpenseSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setExpFormError(null);

    const trimmedTitle = expTitle.trim();
    if (!trimmedTitle) {
      setExpFormError('กรุณาระบุชื่อรายการค่าใช้จ่าย');
      return;
    }

    const cleanedAmountStr = String(expAmountStr).replace(/[,฿\s]|บาท/gi, '').trim();
    const numericAmount = cleanedAmountStr === '' ? NaN : Number(cleanedAmountStr);
    if (!Number.isFinite(numericAmount) || numericAmount < 0) {
      setExpFormError('กรุณาระบุจำนวนเงินที่ถูกต้อง (ตัวเลขตั้งแต่ 0 ขึ้นไป)');
      return;
    }

    const trimmedReceipt = expReceiptUrl.trim();
    const sanitizedReceipt = sanitizeSafeUrl(trimmedReceipt);
    if (trimmedReceipt && !sanitizedReceipt) {
      setExpFormError('ลิงก์ใบเสร็จไม่ถูกต้อง (ต้องขึ้นต้นด้วย https://, http:// หรือแนบรูปภาพ)');
      return;
    }

    const categoryLabel = getExpenseCategoryLabel(expCategory);

    if (editingExpenseId) {
      const existing = expenses.find((item) => item.id === editingExpenseId);
      if (existing) {
        onUpdateExpense({
          ...existing,
          title: trimmedTitle,
          category: expCategory,
          categoryLabel,
          amount: numericAmount,
          expenseDate: expDate.trim() || new Date().toLocaleDateString('th-TH'),
          payeeOrNote: expPayee.trim(),
          receiptUrl: sanitizedReceipt,
        });
      }
    } else {
      onAddExpense({
        title: trimmedTitle,
        category: expCategory,
        categoryLabel,
        amount: numericAmount,
        expenseDate: expDate.trim() || new Date().toLocaleDateString('th-TH'),
        payeeOrNote: expPayee.trim(),
        receiptUrl: sanitizedReceipt,
      });
    }

    resetExpenseForm();
  };

  const handleStartEditExpense = (exp: ExpenseRecord) => {
    setEditingExpenseId(exp.id);
    setExpTitle(exp.title);
    setExpCategory(exp.category);
    setExpAmountStr(String(exp.amount));
    setExpDate(exp.expenseDate);
    setExpPayee(exp.payeeOrNote);
    setExpReceiptUrl(exp.receiptUrl);
    setExpFormError(null);
  };

  const handleDeleteExpenseClick = (expenseId: string) => {
    if (confirmDeleteExpenseId !== expenseId) {
      setConfirmDeleteExpenseId(expenseId);
      return;
    }
    setConfirmDeleteExpenseId(null);
    if (editingExpenseId === expenseId) {
      resetExpenseForm();
    }
    onDeleteExpense(expenseId);
  };

  const handleDeleteSeatClick = (seatId: string) => {
    if (confirmDeleteSeatId !== seatId) {
      setConfirmDeleteSeatId(seatId);
      return;
    }
    setConfirmDeleteSeatId(null);
    if (activeEditSeatId === seatId) {
      setActiveEditSeatId(null);
    }
    onDeleteRecord(seatId);
  };

  const handleExpenseReceiptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setExpFormError(null);
    try {
      const dataUrl = await compressImageFileToDataUrl(file);
      setExpReceiptUrl(dataUrl);
    } catch (err: any) {
      setExpFormError(err?.message || 'ไม่สามารถอ่านไฟล์รูปใบเสร็จได้');
    } finally {
      e.target.value = '';
    }
  };

  return (
    <div className="space-y-8">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            ระบบจัดการหลังบ้าน &amp; บัญชีรายจ่าย (Back-Office)
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            บันทึกค่าใช้จ่ายในการจัดงาน แก้ไขข้อมูลการจองโต๊ะรายโซน คำนวณกำไรสุทธิ และซิงก์ข้อมูลลง Google Drive อัตโนมัติ
          </p>
        </div>

        <button
          type="button"
          onClick={onExportExcel}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-xs transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          <Download className="w-4 h-4" />
          ส่งออกข้อมูลทั้งหมดเป็น Excel (.xlsx)
        </button>
      </div>

      {/* Real Google Drive API v3 & GIS Integration Panel */}
      <section className="bg-white border-[2.5px] border-slate-300 rounded-2xl p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4 shadow-xs">
        <div className="flex items-start gap-3.5 min-w-0 flex-1">
          <div
            className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
              driveConnection.connected
                ? 'bg-emerald-600 text-white'
                : 'bg-blue-600 text-white'
            }`}
          >
            <Cloud className="w-5 h-5" />
          </div>
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm sm:text-base font-bold text-slate-900">
                Google Drive Integration (Real Google Drive API v3)
              </h2>
              {driveConnection.connected ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Connected
                  {driveConnection.user?.emailAddress
                    ? `: ${driveConnection.user.emailAddress}`
                    : ''}
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                  Not Connected
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500">
              {driveConnection.connected
                ? 'เชื่อมต่อ Google Identity Services (scope: drive.file) เรียบร้อยแล้ว สามารถอัปโหลดไฟล์ Excel (.xlsx) หรือ JSON Backup ตรงไปยัง Google Drive root folder ของคุณได้ทันที'
                : 'ตั้งค่า Google Cloud OAuth Client ID และกด Connect Google Drive เพื่ออัปโหลดไฟล์ Excel (.xlsx) หรือ JSON Backup ไปยัง Google Drive จริงของคุณ'}
            </p>
            {driveError && (
              <p className="text-xs font-semibold text-red-600 flex items-center gap-1.5 pt-0.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span className="break-words">{driveError}</span>
              </p>
            )}
            {lastDriveFile && (
              <div className="pt-1 flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-emerald-700">
                  บันทึกล่าสุด: {lastDriveFile.name}
                </span>
                <a
                  href={lastDriveFile.webViewLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-bold text-blue-600 hover:underline"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open in Google Drive
                </a>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onOpenDriveModal}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-xl transition-colors cursor-pointer"
          >
            <Settings className="w-3.5 h-3.5" />
            Drive Settings &amp; Backups
          </button>

          {driveConnection.connected ? (
            <>
              <button
                type="button"
                onClick={onLoadFromDrive}
                disabled={isDriveLoadingBackup || isDriveUploading || isDriveConnecting}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-300 rounded-xl transition-colors cursor-pointer disabled:opacity-60"
              >
                {isDriveLoadingBackup ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CloudDownload className="w-3.5 h-3.5" />
                )}
                {isDriveLoadingBackup ? 'Loading...' : 'Load from Drive'}
              </button>
              <button
                type="button"
                onClick={() => onQuickSaveToDrive('json')}
                disabled={isDriveUploading || isDriveLoadingBackup || isDriveConnecting}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors cursor-pointer disabled:opacity-60"
              >
                {isDriveUploading ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CloudUpload className="w-3.5 h-3.5" />
                )}
                {isDriveUploading ? 'Saving...' : 'Save JSON Backup'}
              </button>
              <button
                type="button"
                onClick={() => onQuickSaveToDrive('xlsx')}
                disabled={isDriveUploading || isDriveLoadingBackup || isDriveConnecting}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-slate-900 bg-white hover:bg-slate-100 border-2 border-slate-300 rounded-xl transition-colors cursor-pointer disabled:opacity-60"
              >
                <CloudUpload className="w-3.5 h-3.5" />
                Save Excel
              </button>
              <button
                type="button"
                onClick={onDisconnectGoogleDrive}
                disabled={isDriveUploading || isDriveLoadingBackup}
                className="inline-flex items-center gap-1 px-3 py-2 text-xs font-bold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl transition-colors cursor-pointer disabled:opacity-60"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onConnectGoogleDrive}
              disabled={isDriveConnecting}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors cursor-pointer disabled:opacity-60"
            >
              {isDriveConnecting ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Cloud className="w-4 h-4" />
              )}
              {isDriveConnecting ? 'Connecting...' : 'Connect Google Drive'}
            </button>
          )}
        </div>
      </section>

      {/* Financial Balance KPI Cards */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* 1. รายรับที่ยืนยันชำระแล้ว */}
        <div className="bg-white border-[2.5px] border-emerald-400 rounded-2xl p-5 flex items-start justify-between gap-4 shadow-xs">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-slate-600">
                รายรับค่าโต๊ะ (ยืนยันชำระแล้ว)
              </span>
              <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-50 text-emerald-700 border-2 border-emerald-200 font-mono tabular-nums">
                {formatPercent(financialStats.paidIncome, financialStats.totalIncome)} ของยอดรวมทั้งหมด
              </span>
            </div>
            <p className="text-2xl sm:text-3xl font-extrabold font-mono tabular-nums text-emerald-700">
              {formatBaht(financialStats.paidIncome)}
            </p>
            <p className="text-xs text-slate-500 font-mono tabular-nums">
              ยอดโอนรวมทั้งหมด: {formatBaht(financialStats.totalIncome)} · รอชำระ{' '}
              {formatBaht(financialStats.unpaidIncome)} ({formatPercent(financialStats.unpaidIncome, financialStats.totalIncome)})
            </p>
          </div>
          <div className="p-3 rounded-xl bg-emerald-50 text-emerald-600 border-2 border-emerald-200 shrink-0">
            <TrendingUp className="w-6 h-6" />
          </div>
        </div>

        {/* 2. รายจ่ายรวมหลังบ้าน */}
        <div className="bg-white border-[2.5px] border-rose-400 rounded-2xl p-5 flex items-start justify-between gap-4 shadow-xs">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-slate-600">
                รายจ่ายรวมทั้งหมด ({expenses.length} รายการ)
              </span>
              <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-rose-50 text-rose-700 border-2 border-rose-200 font-mono tabular-nums">
                {formatPercent(financialStats.totalExpense, financialStats.totalIncome)} ของยอดรวมทั้งหมด
              </span>
            </div>
            <p className="text-2xl sm:text-3xl font-extrabold font-mono tabular-nums text-rose-600">
              {formatBaht(financialStats.totalExpense)}
            </p>
            <p className="text-xs text-slate-500 font-mono tabular-nums">
              คิดเป็น {formatPercent(financialStats.totalExpense, financialStats.paidIncome)} ของรายรับที่ชำระแล้ว
            </p>
          </div>
          <div className="p-3 rounded-xl bg-rose-50 text-rose-600 border-2 border-rose-200 shrink-0">
            <TrendingDown className="w-6 h-6" />
          </div>
        </div>

        {/* 3. กำไรสุทธิ / คงเหลือสุทธิ */}
        <div
          className={`border-[3px] rounded-2xl p-5 flex items-start justify-between gap-4 shadow-xs ${
            financialStats.netProfit >= 0
              ? 'bg-emerald-950 text-white border-emerald-700'
              : 'bg-rose-950 text-white border-rose-700'
          }`}
        >
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-white/80">
                คงเหลือสุทธิ / กำไรสุทธิ
              </span>
              <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-white/15 text-white border-2 border-white/25 font-mono tabular-nums">
                {formatPercent(Math.abs(financialStats.netProfit), financialStats.totalIncome)} ของยอดรวมทั้งหมด
              </span>
            </div>
            <p className="text-2xl sm:text-3xl font-extrabold font-mono tabular-nums text-white">
              {financialStats.netProfit < 0 ? '-' : ''}
              {formatBaht(Math.abs(financialStats.netProfit))}
            </p>
            <p className="text-xs text-white/75 font-mono tabular-nums">
              คิดเป็น {formatPercent(Math.abs(financialStats.netProfit), financialStats.paidIncome)} ของรายรับชำระแล้ว · เก็บครบจะคงเหลือ {formatBaht(financialStats.projectedNetProfit)}
            </p>
          </div>
          <div className="p-3 rounded-xl bg-white/15 text-white border-2 border-white/25 shrink-0">
            <Wallet className="w-6 h-6" />
          </div>
        </div>
      </section>

      {/* Sub-Navigation Switcher */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3">
        <button
          type="button"
          onClick={() => setSubTab('expenses')}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-colors cursor-pointer ${
            subTab === 'expenses'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
          }`}
        >
          <Receipt className="w-4 h-4" />
          ระบบบันทึกรายจ่าย ({expenses.length} รายการ)
        </button>
        <button
          type="button"
          onClick={() => setSubTab('bookings')}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-colors cursor-pointer ${
            subTab === 'bookings'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
          }`}
        >
          <Armchair className="w-4 h-4" />
          จัดการและแก้ไขข้อมูลโต๊ะ ({records.length} โต๊ะ)
        </button>
      </div>

      {/* SUB-TAB 1: EXPENSE TRACKER */}
      {subTab === 'expenses' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Add / Edit Expense Form */}
          <div className="lg:col-span-5 bg-white border-[2.5px] border-slate-300 rounded-2xl p-6 space-y-5 shadow-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  {editingExpenseId ? 'แก้ไขรายการค่าใช้จ่าย' : 'เพิ่มรายการรายจ่ายใหม่'}
                </h2>
                <p className="text-xs text-slate-500">
                  บันทึกรายจ่ายเพื่อนำไปคำนวณงบคงเหลือสุทธิอัตโนมัติ
                </p>
              </div>
              {editingExpenseId && (
                <button
                  type="button"
                  onClick={resetExpenseForm}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
                >
                  ยกเลิกการแก้ไข
                </button>
              )}
            </div>

            <form onSubmit={handleExpenseSubmit} className="space-y-4">
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700">
                  ชื่อรายการค่าใช้จ่าย *
                </label>
                <input
                  type="text"
                  required
                  value={expTitle}
                  onChange={(e) => setExpTitle(e.target.value)}
                  placeholder="เช่น ค่าอาหารโต๊ะจีนมัดจำงวดแรก, ค่าเช่าเครื่องเสียง..."
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-700">
                    หมวดหมู่รายจ่าย *
                  </label>
                  <select
                    value={expCategory}
                    onChange={(e) => setExpCategory(e.target.value as ExpenseCategoryId)}
                    className="w-full px-3 py-2.5 text-xs sm:text-sm font-medium bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:border-slate-900 focus:outline-none"
                  >
                    {EXPENSE_CATEGORY_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-700">
                    จำนวนเงิน (บาท) *
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    required
                    value={expAmountStr}
                    onChange={(e) => setExpAmountStr(e.target.value)}
                    placeholder="เช่น 15000"
                    className="w-full px-3.5 py-2.5 text-sm font-mono font-bold bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:border-slate-900 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-700">
                    วันที่จ่าย
                  </label>
                  <input
                    type="text"
                    value={expDate}
                    onChange={(e) => setExpDate(e.target.value)}
                    placeholder="เช่น 31/10/2569"
                    className="w-full px-3.5 py-2 text-sm font-mono bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:border-slate-900 focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-700">
                    ผู้เบิก / ร้านค้า / หมายเหตุ
                  </label>
                  <input
                    type="text"
                    value={expPayee}
                    onChange={(e) => setExpPayee(e.target.value)}
                    placeholder="เช่น ร้านสมบูรณ์โภชนา"
                    className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:border-slate-900 focus:outline-none"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700">
                  ลิงก์ใบเสร็จ / แนบรูปสลิปการจ่ายเงิน
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={expReceiptUrl}
                    onChange={(e) => setExpReceiptUrl(e.target.value)}
                    placeholder="วาง URL ใบเสร็จ หรือกดปุ่มแนบรูป..."
                    className="flex-1 min-w-0 px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:border-slate-900 focus:outline-none"
                  />
                  <label className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-xl cursor-pointer shrink-0">
                    <Upload className="w-3.5 h-3.5" />
                    แนบรูป
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleExpenseReceiptUpload}
                      className="hidden"
                    />
                  </label>
                  {expReceiptUrl && (
                    <button
                      type="button"
                      onClick={() => setActiveSlipTarget({ type: 'draft-expense' })}
                      className="inline-flex items-center gap-1 px-3 py-2 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl cursor-pointer shrink-0"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      ดูรูป
                    </button>
                  )}
                </div>
              </div>

              {expFormError && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 flex items-center gap-2 text-xs font-semibold text-red-700">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{expFormError}</span>
                </div>
              )}

              <button
                type="submit"
                className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
              >
                {editingExpenseId ? (
                  <>
                    <Save className="w-4 h-4" />
                    บันทึกการแก้ไขรายจ่าย
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    บันทึกรายการรายจ่าย
                  </>
                )}
              </button>
            </form>

            {/* Expense Breakdown by Category */}
            <div className="pt-4 border-t border-slate-100 space-y-2.5">
              <p className="text-xs font-bold text-slate-500">
                สรุปรายจ่ายแยกตามหมวดหมู่ (% ของรายจ่ายรวมทั้งหมด)
              </p>
              <div className="space-y-2">
                {financialStats.byExpenseCategory.map((cat) => (
                  <div
                    key={cat.id}
                    className="flex items-center justify-between text-xs py-1.5 px-3 rounded-lg bg-slate-50"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: cat.colorHex }}
                      />
                      <span className="font-medium text-slate-700">
                        {cat.label} ({cat.count})
                      </span>
                    </div>
                    <span className="font-mono font-bold text-slate-900 tabular-nums">
                      {formatBaht(cat.amount)}{' '}
                      <span className="text-slate-500 font-semibold">
                        ({formatPercent(cat.amount, financialStats.totalExpense)})
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column: Expense List */}
          <div className="lg:col-span-7 bg-white border-[2.5px] border-slate-300 rounded-2xl p-6 space-y-5 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  รายการรายจ่ายทั้งหมด ({filteredExpenses.length} รายการ)
                </h2>
                <p className="text-xs text-slate-500">
                  คลิกแก้ไขหรือลบรายการค่าใช้จ่ายได้ตลอดเวลา
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={expenseSearch}
                    onChange={(e) => setExpenseSearch(e.target.value)}
                    placeholder="ค้นหารายการรายจ่าย..."
                    className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none"
                  />
                </div>
                <select
                  value={expenseFilterCat}
                  onChange={(e) => setExpenseFilterCat(e.target.value)}
                  className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none"
                >
                  <option value="all">ทุกหมวดหมู่</option>
                  {EXPENSE_CATEGORY_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {filteredExpenses.length === 0 ? (
              <div className="py-14 text-center space-y-2 bg-slate-50 rounded-xl border border-slate-200/80">
                <Receipt className="w-8 h-8 text-slate-400 mx-auto" />
                <p className="text-sm font-bold text-slate-700">
                  ยังไม่มีรายการรายจ่ายในระบบ
                </p>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  กรอกฟอร์มทางด้านซ้ายเพื่อเพิ่มค่าสถานที่ ค่าอาหาร ค่าเครื่องเสียง หรือค่าใช้จ่ายอื่นๆ ของงาน
                </p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
                {filteredExpenses.map((exp) => {
                  const catOpt = EXPENSE_CATEGORY_OPTIONS.find((c) => c.id === exp.category);
                  return (
                    <div
                      key={exp.id}
                      className="p-4 rounded-xl border border-slate-200 hover:border-slate-300 bg-white flex flex-wrap items-center justify-between gap-4 transition-colors"
                    >
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className="px-2.5 py-0.5 rounded-md text-[11px] font-bold text-white shrink-0"
                            style={{ backgroundColor: catOpt?.colorHex || '#475569' }}
                          >
                            {exp.categoryLabel}
                          </span>
                          <span className="text-xs font-mono text-slate-400">
                            วันที่: {exp.expenseDate || '-'}
                          </span>
                        </div>
                        <p className="text-sm font-bold text-slate-900">{exp.title}</p>
                        {exp.payeeOrNote && (
                          <p className="text-xs text-slate-500">
                            ผู้เบิก/หมายเหตุ: {exp.payeeOrNote}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <div className="text-right">
                          <p className="text-base font-extrabold font-mono tabular-nums text-rose-600">
                            -{formatBaht(exp.amount)}
                          </p>
                          {exp.receiptUrl && (
                            <button
                              type="button"
                              onClick={() =>
                                setActiveSlipTarget({ type: 'expense', expenseId: exp.id })
                              }
                              className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded-md mt-1 cursor-pointer"
                            >
                              <Eye className="w-3 h-3" />
                              ดูรูปใบเสร็จ
                            </button>
                          )}
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleStartEditExpense(exp)}
                            title="แก้ไขรายการนี้"
                            className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg cursor-pointer"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteExpenseClick(exp.id)}
                            title={
                              confirmDeleteExpenseId === exp.id
                                ? 'คลิกอีกครั้งเพื่อยืนยันการลบ'
                                : 'ลบรายการนี้'
                            }
                            className={`rounded-lg cursor-pointer transition-colors ${
                              confirmDeleteExpenseId === exp.id
                                ? 'px-2.5 py-1.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700'
                                : 'p-2 text-slate-400 hover:text-red-600 hover:bg-red-50'
                            }`}
                          >
                            {confirmDeleteExpenseId === exp.id ? (
                              'ยืนยันลบ?'
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-TAB 2: TABLE BOOKING MANAGER */}
      {subTab === 'bookings' && (
        <div className="bg-white border-[2.5px] border-slate-300 rounded-2xl p-6 space-y-6 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setTableFilterCat('all')}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                  tableFilterCat === 'all'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                ทุกโซน ({records.length})
              </button>
              {categories.map((cat) => {
                const count = records.filter((r) => r.categoryId === cat.id).length;
                const active = tableFilterCat === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setTableFilterCat(cat.id)}
                    className="px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer"
                    style={{
                      backgroundColor: active ? cat.colorHex : `${cat.colorHex}18`,
                      color: active ? '#FFFFFF' : cat.colorHex,
                    }}
                  >
                  โซน {cat.name} ({count} · {formatPercent(count, records.length)})
                  </button>
                );
              })}

              {/* Ticket & Check-In Filter Switcher */}
              <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-xl ml-1">
                <button
                  type="button"
                  onClick={() => setTableCheckInFilter('all')}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                    tableCheckInFilter === 'all'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  ทั้งหมด (100%)
                </button>
                <button
                  type="button"
                  onClick={() => setTableCheckInFilter('ticketcollected')}
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                    tableCheckInFilter === 'ticketcollected'
                      ? 'bg-violet-600 text-white shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Ticket className="w-3.5 h-3.5" />
                  รับบัตรแล้ว ({records.filter((r) => r.isTicketCollected).length} ·{' '}
                  {formatPercent(
                    records.filter((r) => r.isTicketCollected).length,
                    records.length
                  )}
                  )
                </button>
                <button
                  type="button"
                  onClick={() => setTableCheckInFilter('unticketed')}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                    tableCheckInFilter === 'unticketed'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  รอรับบัตร ({records.filter((r) => !r.isTicketCollected).length} ·{' '}
                  {formatPercent(
                    records.filter((r) => !r.isTicketCollected).length,
                    records.length
                  )}
                  )
                </button>
                <button
                  type="button"
                  onClick={() => setTableCheckInFilter('checkedin')}
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                    tableCheckInFilter === 'checkedin'
                      ? 'bg-sky-600 text-white shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <UserCheck className="w-3.5 h-3.5" />
                  เช็คอินแล้ว ({records.filter((r) => r.isCheckedIn).length} ·{' '}
                  {formatPercent(
                    records.filter((r) => r.isCheckedIn).length,
                    records.length
                  )}
                  )
                </button>
                <button
                  type="button"
                  onClick={() => setTableCheckInFilter('uncheckedin')}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                    tableCheckInFilter === 'uncheckedin'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  รอเช็คอิน ({records.filter((r) => !r.isCheckedIn).length})
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={tableSearch}
                  onChange={(e) => setTableSearch(e.target.value)}
                  placeholder="ค้นหาเลขโต๊ะ ชื่อ หรือเบอร์โทร..."
                  className="pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:border-slate-900 focus:outline-none w-56"
                />
              </div>

              {onRequestMoveTable && (
                <button
                  type="button"
                  onClick={() => onRequestMoveTable()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl cursor-pointer shadow-2xs"
                >
                  <ArrowRightLeft className="w-4 h-4" />
                  ย้าย / สลับโต๊ะ
                </button>
              )}

              <button
                type="button"
                onClick={() => setIsAddingTable(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl cursor-pointer shadow-2xs"
              >
                <Plus className="w-4 h-4" />
                เพิ่มโต๊ะใหม่ (รายโต๊ะ / หลายโต๊ะ)
              </button>
            </div>
          </div>

          {/* Table List */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-bold text-slate-500">
                  <th className="py-3 px-3">โซน</th>
                  <th className="py-3 px-3">เลขโต๊ะ</th>
                  <th className="py-3 px-3">ชื่อ-นามสกุล ผู้จอง</th>
                  <th className="py-3 px-3">เบอร์โทร</th>
                  <th className="py-3 px-3">ยอดโอน</th>
                  <th className="py-3 px-3">วันที่โอน</th>
                  <th className="py-3 px-3">สลิปโอนเงิน</th>
                  <th className="py-3 px-3">สถานะชำระเงิน (คลิกสลับได้)</th>
                  <th className="py-3 px-3">สถานะรับบัตร (คลิกสลับได้)</th>
                  <th className="py-3 px-3">เช็คอินหน้างาน (คลิกสลับได้)</th>
                  <th className="py-3 px-3 text-right">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs sm:text-sm">
                {filteredTables.map((seat) => {
                  const zoneColor = categoryColorMap[seat.categoryId] || '#2563EB';
                  return (
                    <tr
                      key={seat.id}
                      className={`hover:bg-slate-50/80 transition-colors ${
                        seat.isCheckedIn ? 'bg-sky-50/30' : ''
                      }`}
                    >
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span
                          className="px-2.5 py-1 rounded-md text-xs font-bold text-white"
                          style={{ backgroundColor: zoneColor }}
                        >
                          {seat.categoryName}
                        </span>
                      </td>
                      <td
                        className="py-3 px-3 font-mono font-extrabold text-base whitespace-nowrap"
                        style={{ color: zoneColor }}
                      >
                        {seat.tableNumber}
                      </td>
                      <td className="py-3 px-3 font-semibold text-slate-900">
                        {seat.fullName || (
                          <span className="text-slate-400 font-normal italic">
                            โต๊ะว่าง
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 font-mono text-slate-700">
                        {seat.phone || '-'}
                      </td>
                      <td className="py-3 px-3 font-mono font-bold text-slate-900 whitespace-nowrap">
                        {formatBaht(seat.transferAmount, seat.rawTransferAmount)}
                      </td>
                      <td className="py-3 px-3 font-mono text-slate-600 whitespace-nowrap">
                        {seat.transferDate || '-'}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        {seat.slipUrl || seat.slipUrl2 ? (
                          <div className="flex items-center gap-1.5">
                            {seat.slipUrl && (
                              <button
                                type="button"
                                onClick={() =>
                                  setActiveSlipTarget({
                                    type: 'seat',
                                    seatId: seat.id,
                                    slot: 1,
                                  })
                                }
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 cursor-pointer transition-colors"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                สลิป 1
                              </button>
                            )}
                            {seat.slipUrl2 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setActiveSlipTarget({
                                    type: 'seat',
                                    seatId: seat.id,
                                    slot: 2,
                                  })
                                }
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 cursor-pointer transition-colors"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                สลิป 2
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">ไม่มีสลิป</span>
                        )}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateRecord(
                              buildUpdatedSeatRecord(seat, { isPaid: !seat.isPaid })
                            )
                          }
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold text-white cursor-pointer transition-opacity hover:opacity-90 ${
                            seat.isPaid ? 'bg-emerald-600' : 'bg-red-600'
                          }`}
                        >
                          {seat.isPaid ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              ชำระแล้ว
                            </>
                          ) : (
                            <>
                              <XCircle className="w-3.5 h-3.5" />
                              ยังไม่ชำระ
                            </>
                          )}
                        </button>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="flex flex-col items-start gap-0.5">
                          <button
                            type="button"
                            onClick={() => {
                              const nextCollected = !seat.isTicketCollected;
                              onUpdateRecord(
                                buildUpdatedSeatRecord(seat, {
                                  isTicketCollected: nextCollected,
                                  ticketCollectedAt: nextCollected
                                    ? seat.ticketCollectedAt || formatNowCheckInTimestamp()
                                    : '',
                                })
                              );
                            }}
                            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold cursor-pointer transition-all ${
                              seat.isTicketCollected
                                ? 'bg-violet-600 hover:bg-violet-700 text-white shadow-2xs'
                                : 'bg-slate-100 hover:bg-violet-100 text-slate-700 hover:text-violet-800 border border-slate-200'
                            }`}
                          >
                            <Ticket className="w-3.5 h-3.5" />
                            {seat.isTicketCollected ? 'รับบัตรแล้ว' : 'กดยืนยันรับบัตร'}
                          </button>
                          {seat.isTicketCollected && seat.ticketCollectedAt && (
                            <span className="text-[11px] font-mono text-violet-700 pl-1">
                              {seat.ticketCollectedAt}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="flex flex-col items-start gap-0.5">
                          <button
                            type="button"
                            onClick={() => {
                              const nextCheckedIn = !seat.isCheckedIn;
                              onUpdateRecord(
                                buildUpdatedSeatRecord(seat, {
                                  isCheckedIn: nextCheckedIn,
                                  checkedInAt: nextCheckedIn
                                    ? seat.checkedInAt || formatNowCheckInTimestamp()
                                    : '',
                                })
                              );
                            }}
                            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold cursor-pointer transition-all ${
                              seat.isCheckedIn
                                ? 'bg-sky-600 hover:bg-sky-700 text-white shadow-2xs'
                                : 'bg-slate-100 hover:bg-sky-100 text-slate-700 hover:text-sky-800 border border-slate-200'
                            }`}
                          >
                            <UserCheck className="w-3.5 h-3.5" />
                            {seat.isCheckedIn ? 'เช็คอินแล้ว' : 'กดเช็คอินเข้างาน'}
                          </button>
                          {seat.isCheckedIn && seat.checkedInAt && (
                            <span className="text-[11px] font-mono text-sky-700 pl-1">
                              {seat.checkedInAt}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setActiveEditSeatId(seat.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-white rounded-lg cursor-pointer transition-opacity hover:opacity-90"
                            style={{ backgroundColor: zoneColor }}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            แก้ไข
                          </button>
                          {onRequestMoveTable && seat.isBooked && (
                            <button
                              type="button"
                              onClick={() => onRequestMoveTable(seat)}
                              title="ย้ายหรือสลับโต๊ะนี้"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg cursor-pointer transition-colors"
                            >
                              <ArrowRightLeft className="w-3.5 h-3.5" />
                              ย้ายโต๊ะ
                            </button>
                          )}
                          {seat.isBooked && (
                            <button
                              type="button"
                              onClick={() =>
                                onUpdateRecord(
                                  buildUpdatedSeatRecord(seat, {
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
                                  })
                                )
                              }
                              title="ล้างข้อมูลผู้จอง (คืนโต๊ะว่าง)"
                              className="p-1.5 text-amber-700 hover:bg-amber-50 rounded-lg cursor-pointer"
                            >
                              <RotateCcw className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDeleteSeatClick(seat.id)}
                            title={
                              confirmDeleteSeatId === seat.id
                                ? 'คลิกอีกครั้งเพื่อยืนยันการลบโต๊ะนี้'
                                : 'ลบโต๊ะนี้'
                            }
                            className={`rounded-lg cursor-pointer transition-colors ${
                              confirmDeleteSeatId === seat.id
                                ? 'px-2.5 py-1 text-xs font-bold text-white bg-red-600 hover:bg-red-700'
                                : 'p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50'
                            }`}
                          >
                            {confirmDeleteSeatId === seat.id ? (
                              'ยืนยันลบ?'
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Zone-Colored Popup Modal when editing a seat from the table manager */}
      <SeatDetailModal
        record={activeEditSeat}
        categoryColor={
          activeEditSeat
            ? categoryColorMap[activeEditSeat.categoryId] || '#2563EB'
            : '#2563EB'
        }
        categoryColorMap={categoryColorMap}
        onUpdateRecord={onUpdateRecord}
        onDeleteRecord={onDeleteRecord}
        onRequestMoveTable={
          onRequestMoveTable ? (rec) => onRequestMoveTable(rec) : undefined
        }
        defaultEditing={true}
        onClose={() => setActiveEditSeatId(null)}
      />

      {/* Slip / Receipt Image Popup Modal */}
      <SlipPreviewModal
        preview={activeSlipPreview}
        onClose={() => setActiveSlipTarget(null)}
      />

      {/* Zone-Colored Add Table Modal (Single & Batch Range) */}
      <AddTableModal
        isOpen={isAddingTable}
        categories={categories}
        existingRecords={records}
        initialCategoryId={
          tableFilterCat !== 'all' ? tableFilterCat : categories[0]?.id
        }
        onAddRecord={onAddRecord}
        onAddMultipleRecords={onAddMultipleRecords}
        onClose={() => setIsAddingTable(false)}
      />
    </div>
  );
};
