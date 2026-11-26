import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  Users,
  Banknote,
  RefreshCw,
  Palette,
  Receipt,
  TrendingUp,
  TrendingDown,
  Wallet,
  Download,
  UserCheck,
  Ticket,
  Plus,
  ArrowRightLeft,
} from 'lucide-react';
import {
  CategoryConfig,
  CategorySheetResult,
  CategorySummaryStats,
  ExpenseRecord,
  OverallDashboardStats,
  SeatRecord,
} from '../types/booking';
import { formatBaht } from './BookingCard';
import { AddTableModal } from './AddTableModal';

interface DashboardViewProps {
  records: SeatRecord[];
  categories: CategoryConfig[];
  categoryResults: CategorySheetResult[];
  expenses: ExpenseRecord[];
  isLoading: boolean;
  onRefresh: () => void;
  onOpenSettings: () => void;
  onOpenBackOffice: () => void;
  onExportExcel: () => void;
  onInspectCategoryInSeatMap: (categoryId: string) => void;
  onUpdateRecord?: (updated: SeatRecord) => void;
  onDeleteRecord?: (recordId: string) => void;
  onAddRecord?: (categoryId: string, record: SeatRecord) => void;
  onAddMultipleRecords?: (categoryId: string, records: SeatRecord[]) => void;
  onRequestMoveTable?: (record?: SeatRecord) => void;
}

export function formatPercent(part: number, total: number): string {
  if (!total || total <= 0 || !Number.isFinite(part) || !Number.isFinite(total)) {
    return '0%';
  }
  const raw = (part / total) * 100;
  const rounded = Math.round(raw * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  records,
  categories,
  categoryResults,
  expenses,
  isLoading,
  onRefresh,
  onOpenSettings,
  onOpenBackOffice,
  onExportExcel,
  onInspectCategoryInSeatMap,
  onAddRecord,
  onAddMultipleRecords,
  onRequestMoveTable,
}) => {
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);

  const stats: OverallDashboardStats = useMemo(() => {
    const byCategory: CategorySummaryStats[] = categories.map((cat) => {
      const sheetRes = categoryResults.find((r) => r.categoryId === cat.id);
      const catRecords = records.filter((r) => r.categoryId === cat.id);

      const totalSeats = catRecords.length;
      const bookedSeats = catRecords.filter((r) => r.isBooked).length;
      const unbookedSeats = totalSeats - bookedSeats;
      const paidSeats = catRecords.filter((r) => r.isPaid).length;
      const unpaidSeats = totalSeats - paidSeats;
      const checkedInSeats = catRecords.filter((r) => r.isCheckedIn).length;
      const uncheckedInSeats = totalSeats - checkedInSeats;
      const ticketCollectedSeats = catRecords.filter((r) => r.isTicketCollected).length;
      const unticketedSeats = totalSeats - ticketCollectedSeats;
      const totalTransferAmount = catRecords.reduce((sum, r) => sum + (r.transferAmount || 0), 0);

      return {
        categoryId: cat.id,
        categoryName: cat.name,
        sheetName: cat.sheetName,
        colorHex: cat.colorHex,
        foundSheet: sheetRes ? sheetRes.foundSheet : false,
        totalSeats,
        bookedSeats,
        unbookedSeats,
        paidSeats,
        unpaidSeats,
        checkedInSeats,
        uncheckedInSeats,
        ticketCollectedSeats,
        unticketedSeats,
        totalTransferAmount,
      };
    });

    const vipStat = byCategory.find(
      (c) => c.categoryId === 'vip' || c.categoryName.toLowerCase() === 'vip'
    );
    const stdStat = byCategory.find(
      (c) => c.categoryId === 'standard' || c.categoryName.toLowerCase() === 'standard'
    );

    const totalSeats = byCategory.reduce((acc, c) => acc + c.totalSeats, 0);
    const bookedSeats = byCategory.reduce((acc, c) => acc + c.bookedSeats, 0);
    const unbookedSeats = byCategory.reduce((acc, c) => acc + c.unbookedSeats, 0);
    const paidSeats = byCategory.reduce((acc, c) => acc + c.paidSeats, 0);
    const unpaidSeats = byCategory.reduce((acc, c) => acc + c.unpaidSeats, 0);
    const checkedInSeats = byCategory.reduce((acc, c) => acc + c.checkedInSeats, 0);
    const uncheckedInSeats = byCategory.reduce((acc, c) => acc + c.uncheckedInSeats, 0);
    const ticketCollectedSeats = byCategory.reduce(
      (acc, c) => acc + c.ticketCollectedSeats,
      0
    );
    const unticketedSeats = byCategory.reduce((acc, c) => acc + c.unticketedSeats, 0);
    const totalTransferAmount = byCategory.reduce((acc, c) => acc + c.totalTransferAmount, 0);

    return {
      totalSeats,
      totalVipSeats: vipStat?.totalSeats ?? 0,
      totalStandardSeats: stdStat?.totalSeats ?? 0,
      bookedSeats,
      unbookedSeats,
      paidSeats,
      unpaidSeats,
      checkedInSeats,
      uncheckedInSeats,
      ticketCollectedSeats,
      unticketedSeats,
      totalTransferAmount,
      vipTransferAmount: vipStat?.totalTransferAmount ?? 0,
      standardTransferAmount: stdStat?.totalTransferAmount ?? 0,
      byCategory,
    };
  }, [records, categories, categoryResults]);

  const financialSummary = useMemo(() => {
    const paidRevenue = records
      .filter((r) => r.isPaid)
      .reduce((sum, r) => sum + (r.transferAmount || 0), 0);
    const unpaidRevenue = records
      .filter((r) => !r.isPaid)
      .reduce((sum, r) => sum + (r.transferAmount || 0), 0);
    const totalExpenses = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    const netProfit = paidRevenue - totalExpenses;
    return { paidRevenue, unpaidRevenue, totalExpenses, netProfit };
  }, [records, expenses]);

  const vipColor =
    categories.find((c) => c.id === 'vip' || c.name.toLowerCase() === 'vip')?.colorHex || '#D97706';
  const stdColor =
    categories.find((c) => c.id === 'standard' || c.name.toLowerCase() === 'standard')?.colorHex ||
    '#2563EB';

  const vipSeatsPercentStr = formatPercent(stats.totalVipSeats, stats.totalSeats);
  const stdSeatsPercentStr = formatPercent(stats.totalStandardSeats, stats.totalSeats);
  const vipAmountPercentStr = formatPercent(stats.vipTransferAmount, stats.totalTransferAmount);
  const stdAmountPercentStr = formatPercent(stats.standardTransferAmount, stats.totalTransferAmount);

  const checkedInPercentStr = formatPercent(stats.checkedInSeats, stats.totalSeats);
  const uncheckedInPercentStr = formatPercent(stats.uncheckedInSeats, stats.totalSeats);
  const ticketCollectedPercentStr = formatPercent(stats.ticketCollectedSeats, stats.totalSeats);
  const unticketedPercentStr = formatPercent(stats.unticketedSeats, stats.totalSeats);
  const bookedPercentStr = formatPercent(stats.bookedSeats, stats.totalSeats);
  const unbookedPercentStr = formatPercent(stats.unbookedSeats, stats.totalSeats);
  const paidSeatsPercentStr = formatPercent(stats.paidSeats, stats.totalSeats);
  const unpaidSeatsPercentStr = formatPercent(stats.unpaidSeats, stats.totalSeats);

  const paidRevenuePercentStr = formatPercent(
    financialSummary.paidRevenue,
    stats.totalTransferAmount
  );
  const unpaidRevenuePercentStr = formatPercent(
    financialSummary.unpaidRevenue,
    stats.totalTransferAmount
  );
  const expenseOfTotalRevenuePercentStr = formatPercent(
    financialSummary.totalExpenses,
    stats.totalTransferAmount
  );
  const expenseOfPaidRevenuePercentStr = formatPercent(
    financialSummary.totalExpenses,
    financialSummary.paidRevenue
  );
  const netProfitOfPaidPercentStr = formatPercent(
    Math.abs(financialSummary.netProfit),
    financialSummary.paidRevenue
  );
  const netProfitOfTotalPercentStr = formatPercent(
    Math.abs(financialSummary.netProfit),
    stats.totalTransferAmount
  );

  return (
    <div className="space-y-8">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Dashboard สรุปข้อมูลการจองโต๊ะ การรับบัตร การเช็คอิน &amp; งบรายรับ-รายจ่าย
          </h1>
          <p className="text-sm text-slate-600 mt-0.5">
            คำนวณข้อมูลและสัดส่วนเปอร์เซ็นต์ (% ของยอดรวมทั้งหมด) แบบเรียลไทม์แยกตามโซนที่นั่ง สถานะการรับบัตร การเช็คอิน และการชำระเงิน
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {onRequestMoveTable && (
            <button
              type="button"
              onClick={() => onRequestMoveTable()}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 border-2 border-amber-800 rounded-xl shadow-xs transition-all whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ArrowRightLeft className="w-4 h-4" />
              ย้าย / สลับโต๊ะ
            </button>
          )}
          {onAddRecord && (
            <button
              type="button"
              onClick={() => setIsAddModalOpen(true)}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 border-2 border-indigo-800 rounded-xl shadow-xs transition-all whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              เพิ่มโต๊ะใหม่
            </button>
          )}
          <button
            type="button"
            onClick={onOpenBackOffice}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 border-2 border-rose-800 rounded-xl shadow-xs transition-all whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Receipt className="w-4 h-4" />
            จัดการรายจ่ายหลังบ้าน ({expenses.length})
          </button>
          <button
            type="button"
            onClick={onExportExcel}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 border-2 border-emerald-800 rounded-xl shadow-xs transition-all whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            ส่งออก Excel (.xlsx)
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-bold text-slate-800 bg-white border-2 border-slate-300 hover:border-slate-400 hover:bg-slate-50 rounded-xl shadow-xs transition-all whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Palette className="w-4 h-4 text-slate-600" />
            ปรับแต่งสีโซน
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 border-2 border-slate-950 rounded-xl shadow-xs transition-all disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            รีเฟรช
          </button>
        </div>
      </div>

      {/* Financial Balance Strip (Income vs Expenses & Net Profit) */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-2xl p-5 flex items-center justify-between gap-3 bg-white border-[2.5px] border-emerald-400 shadow-xs">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-bold text-slate-700">
                รายรับค่าโต๊ะที่ยืนยันชำระแล้ว
              </p>
              <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-50 text-emerald-800 border-2 border-emerald-300 font-mono tabular-nums">
                {paidRevenuePercentStr} ของยอดรวมทั้งหมด
              </span>
            </div>
            <p className="text-2xl font-extrabold font-mono tabular-nums text-emerald-700">
              {formatBaht(financialSummary.paidRevenue)}
            </p>
            <p className="text-xs text-slate-600 font-mono tabular-nums">
              รอชำระ: {formatBaht(financialSummary.unpaidRevenue)} ({unpaidRevenuePercentStr} ของยอดรวม)
            </p>
          </div>
          <span className="p-3 rounded-xl shrink-0 border-2 bg-emerald-50 text-emerald-600 border-emerald-200">
            <TrendingUp className="w-6 h-6" />
          </span>
        </div>

        <div className="rounded-2xl p-5 flex items-center justify-between gap-3 bg-white border-[2.5px] border-rose-400 shadow-xs">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-bold text-slate-700">
                รายจ่ายรวมหลังบ้าน ({expenses.length} รายการ)
              </p>
              <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-rose-50 text-rose-800 border-2 border-rose-300 font-mono tabular-nums">
                {expenseOfTotalRevenuePercentStr} ของยอดรวมทั้งหมด
              </span>
            </div>
            <p className="text-2xl font-extrabold font-mono tabular-nums text-rose-600">
              {formatBaht(financialSummary.totalExpenses)}
            </p>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-600 font-mono tabular-nums">
                คิดเป็น {expenseOfPaidRevenuePercentStr} ของรายรับชำระแล้ว
              </span>
              <button
                type="button"
                onClick={onOpenBackOffice}
                className="font-bold text-rose-600 hover:underline cursor-pointer"
              >
                + จัดการรายจ่าย
              </button>
            </div>
          </div>
          <span className="p-3 rounded-xl shrink-0 border-2 bg-rose-50 text-rose-600 border-rose-200">
            <TrendingDown className="w-6 h-6" />
          </span>
        </div>

        <div
          className={`rounded-2xl p-5 flex items-center justify-between gap-3 ${
            financialSummary.netProfit >= 0
              ? 'bg-emerald-950 text-white border-[3px] border-emerald-700 shadow-xs'
              : 'bg-rose-950 text-white border-[3px] border-rose-700 shadow-xs'
          }`}
        >
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-bold text-white/90">
                กำไรสุทธิ / คงเหลือสุทธิ
              </p>
              <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-white/15 text-white border-2 border-white/30 font-mono tabular-nums">
                {netProfitOfTotalPercentStr} ของยอดรวมทั้งหมด
              </span>
            </div>
            <p className="text-2xl font-extrabold font-mono tabular-nums text-white">
              {financialSummary.netProfit < 0 ? '-' : ''}
              {formatBaht(Math.abs(financialSummary.netProfit))}
            </p>
            <p className="text-xs text-white/80 font-mono tabular-nums">
              คิดเป็น {netProfitOfPaidPercentStr} ของรายรับชำระแล้ว · ยอดโอนรวม {formatBaht(stats.totalTransferAmount)}
            </p>
          </div>
          <span className="p-3 rounded-xl shrink-0 border-2 bg-white/15 text-white border-white/30">
            <Wallet className="w-6 h-6" />
          </span>
        </div>
      </section>

      {/* Top Summary Metrics Grid */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
        {/* 1. จำนวนโต๊ะ VIP ทั้งหมด */}
        <div className="rounded-2xl p-5 space-y-2 bg-white border-[2.5px] border-amber-300 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700">
              โต๊ะ VIP ({vipSeatsPercentStr} ของทั้งหมด)
            </span>
            <span
              className="w-3.5 h-3.5 rounded-sm shrink-0 border border-black/15"
              style={{ backgroundColor: vipColor }}
            />
          </div>
          <div className="flex items-baseline gap-2">
            <p
              className="text-3xl font-bold font-mono tabular-nums"
              style={{ color: vipColor }}
            >
              {stats.totalVipSeats.toLocaleString('th-TH')}
            </p>
            <span className="text-xs font-mono font-bold text-slate-600">
              ({vipSeatsPercentStr})
            </span>
          </div>
          <p className="text-xs text-slate-600 font-mono tabular-nums">
            ยอดโอน VIP: {formatBaht(stats.vipTransferAmount)} ({vipAmountPercentStr} ของยอดรวม)
          </p>
        </div>

        {/* 2. จำนวนโต๊ะ Standard ทั้งหมด */}
        <div className="rounded-2xl p-5 space-y-2 bg-white border-[2.5px] border-blue-300 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700">
              โต๊ะ Standard ({stdSeatsPercentStr} ของทั้งหมด)
            </span>
            <span
              className="w-3.5 h-3.5 rounded-sm shrink-0 border border-black/15"
              style={{ backgroundColor: stdColor }}
            />
          </div>
          <div className="flex items-baseline gap-2">
            <p
              className="text-3xl font-bold font-mono tabular-nums"
              style={{ color: stdColor }}
            >
              {stats.totalStandardSeats.toLocaleString('th-TH')}
            </p>
            <span className="text-xs font-mono font-bold text-slate-600">
              ({stdSeatsPercentStr})
            </span>
          </div>
          <p className="text-xs text-slate-600 font-mono tabular-nums">
            ยอดโอน Standard: {formatBaht(stats.standardTransferAmount)} ({stdAmountPercentStr} ของยอดรวม)
          </p>
        </div>

        {/* 3. จำนวนโต๊ะที่เข้ารับบัตรแล้ว */}
        <div className="rounded-2xl p-5 space-y-2 bg-violet-50/70 border-[2.5px] border-violet-300 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-violet-900">
              โต๊ะที่เข้ารับบัตรแล้ว ({ticketCollectedPercentStr})
            </span>
            <Ticket className="w-4 h-4 text-violet-600" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold font-mono tabular-nums text-violet-700">
              {stats.ticketCollectedSeats.toLocaleString('th-TH')}
            </span>
            <span className="text-xs font-bold text-violet-800">
              รับบัตรแล้ว ({ticketCollectedPercentStr})
            </span>
          </div>
          <p className="text-xs text-violet-800/80 font-mono tabular-nums">
            รอรับบัตร: {stats.unticketedSeats.toLocaleString('th-TH')} โต๊ะ ({unticketedPercentStr} ของทั้งหมด)
          </p>
        </div>

        {/* 4. จำนวนโต๊ะที่เช็คอินเข้างานแล้ว */}
        <div className="rounded-2xl p-5 space-y-2 bg-sky-50/70 border-[2.5px] border-sky-300 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-sky-900">
              โต๊ะที่เข้าเช็คอินแล้ว ({checkedInPercentStr})
            </span>
            <UserCheck className="w-4 h-4 text-sky-600" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold font-mono tabular-nums text-sky-700">
              {stats.checkedInSeats.toLocaleString('th-TH')}
            </span>
            <span className="text-xs font-bold text-sky-800">
              เช็คอินแล้ว ({checkedInPercentStr})
            </span>
          </div>
          <p className="text-xs text-sky-800/80 font-mono tabular-nums">
            รอเช็คอิน: {stats.uncheckedInSeats.toLocaleString('th-TH')} โต๊ะ ({uncheckedInPercentStr} ของทั้งหมด)
          </p>
        </div>

        {/* 5. จำนวนโต๊ะที่จองแล้ว / ยังไม่มีข้อมูลการจอง */}
        <div className="rounded-2xl p-5 space-y-2 bg-white border-[2.5px] border-slate-300 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700">
              จองแล้ว ({bookedPercentStr} ของทั้งหมด)
            </span>
            <Users className="w-4 h-4 text-slate-600" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold font-mono tabular-nums text-slate-900">
              {stats.bookedSeats.toLocaleString('th-TH')}
            </span>
            <span className="text-xs font-bold text-slate-600">
              จองแล้ว ({bookedPercentStr})
            </span>
          </div>
          <p className="text-xs text-slate-600 font-mono tabular-nums">
            ว่าง: {stats.unbookedSeats.toLocaleString('th-TH')} โต๊ะ ({unbookedPercentStr} ของทั้งหมด)
          </p>
        </div>

        {/* 6. จำนวนที่ชำระเงินแล้ว / ยังไม่ชำระเงิน */}
        <div className="rounded-2xl p-5 space-y-2 bg-white border-[2.5px] border-emerald-300 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700">
              สถานะการชำระเงิน ({paidSeatsPercentStr})
            </span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold font-mono tabular-nums text-emerald-700">
              {stats.paidSeats.toLocaleString('th-TH')}
            </span>
            <span className="text-xs font-bold text-emerald-700">
              ชำระแล้ว ({paidSeatsPercentStr})
            </span>
          </div>
          <p className="text-xs text-red-600 font-mono tabular-nums font-medium">
            ยังไม่ชำระ: {stats.unpaidSeats.toLocaleString('th-TH')} โต๊ะ ({unpaidSeatsPercentStr} ของทั้งหมด)
          </p>
        </div>
      </section>

      {/* Secondary Row: Detailed Breakdown KPI Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="rounded-2xl p-5 flex items-center justify-between bg-white border-2 border-violet-300 shadow-xs">
          <div>
            <p className="text-xs font-bold text-violet-900">จำนวนโต๊ะที่เข้ารับบัตรแล้วทั้งหมด</p>
            <p className="text-2xl font-bold font-mono tabular-nums text-violet-700 mt-1">
              {stats.ticketCollectedSeats.toLocaleString('th-TH')} / {stats.totalSeats.toLocaleString('th-TH')} โต๊ะ
            </p>
            <p className="text-xs font-bold text-violet-600 font-mono tabular-nums mt-0.5">
              คิดเป็น {ticketCollectedPercentStr} ของยอดรวมทั้งหมด
            </p>
          </div>
          <span className="p-3 rounded-xl bg-violet-50 text-violet-600 border-2 border-violet-200">
            <Ticket className="w-6 h-6" />
          </span>
        </div>

        <div className="rounded-2xl p-5 flex items-center justify-between bg-white border-2 border-sky-300 shadow-xs">
          <div>
            <p className="text-xs font-bold text-sky-900">จำนวนโต๊ะที่เข้าเช็คอินแล้วทั้งหมด</p>
            <p className="text-2xl font-bold font-mono tabular-nums text-sky-700 mt-1">
              {stats.checkedInSeats.toLocaleString('th-TH')} / {stats.totalSeats.toLocaleString('th-TH')} โต๊ะ
            </p>
            <p className="text-xs font-bold text-sky-600 font-mono tabular-nums mt-0.5">
              คิดเป็น {checkedInPercentStr} ของยอดรวมทั้งหมด
            </p>
          </div>
          <span className="p-3 rounded-xl bg-sky-50 text-sky-600 border-2 border-sky-200">
            <UserCheck className="w-6 h-6" />
          </span>
        </div>

        <div className="rounded-2xl p-5 flex items-center justify-between bg-white border-2 border-emerald-300 shadow-xs">
          <div>
            <p className="text-xs font-bold text-slate-600">จำนวนที่ชำระเงินแล้วทั้งหมด</p>
            <p className="text-2xl font-bold font-mono tabular-nums text-emerald-700 mt-1">
              {stats.paidSeats.toLocaleString('th-TH')} โต๊ะ
            </p>
            <p className="text-xs font-bold text-emerald-600 font-mono tabular-nums mt-0.5">
              คิดเป็น {paidSeatsPercentStr} ของโต๊ะทั้งหมด
            </p>
          </div>
          <span className="p-3 rounded-xl bg-emerald-50 text-emerald-600 border-2 border-emerald-200">
            <CheckCircle2 className="w-6 h-6" />
          </span>
        </div>

        <div className="rounded-2xl p-5 flex items-center justify-between bg-white border-2 border-rose-300 shadow-xs">
          <div>
            <p className="text-xs font-bold text-slate-600">จำนวนที่ยังไม่ชำระเงินทั้งหมด</p>
            <p className="text-2xl font-bold font-mono tabular-nums text-red-600 mt-1">
              {stats.unpaidSeats.toLocaleString('th-TH')} โต๊ะ
            </p>
            <p className="text-xs font-bold text-red-600 font-mono tabular-nums mt-0.5">
              คิดเป็น {unpaidSeatsPercentStr} ของโต๊ะทั้งหมด
            </p>
          </div>
          <span className="p-3 rounded-xl bg-red-50 text-red-600 border-2 border-red-200">
            <XCircle className="w-6 h-6" />
          </span>
        </div>

        <div className="rounded-2xl p-5 flex items-center justify-between bg-white border-2 border-amber-300 shadow-xs">
          <div>
            <p className="text-xs font-bold text-slate-600">ยอดโอนรวมทั้งหมด (100% ทุกโซน)</p>
            <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
              {formatBaht(stats.totalTransferAmount)}
            </p>
            <p className="text-xs font-semibold text-slate-600 font-mono tabular-nums mt-0.5">
              ชำระแล้ว {paidRevenuePercentStr} · รอชำระ {unpaidRevenuePercentStr}
            </p>
          </div>
          <span className="p-3 rounded-xl bg-slate-100 text-slate-700 border-2 border-slate-300">
            <Banknote className="w-6 h-6" />
          </span>
        </div>
      </section>

      {/* Per-Category Breakdown Cards (VIP vs Standard & Any Custom Category) */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-slate-900">
            สรุปข้อมูลและสัดส่วนเปอร์เซ็นต์แยกตามประเภทโต๊ะ ({stats.byCategory.map((c) => c.categoryName).join(' / ')})
          </h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {stats.byCategory.map((cat) => {
            const paidPercentStr = formatPercent(cat.paidSeats, cat.totalSeats);
            const unpaidPercentStr = formatPercent(cat.unpaidSeats, cat.totalSeats);
            const bookedPercentCatStr = formatPercent(cat.bookedSeats, cat.totalSeats);
            const unbookedPercentCatStr = formatPercent(cat.unbookedSeats, cat.totalSeats);
            const catCheckedInPercentStr = formatPercent(cat.checkedInSeats, cat.totalSeats);
            const catTicketPercentStr = formatPercent(cat.ticketCollectedSeats, cat.totalSeats);

            // Share of overall grand totals
            const shareOfTotalSeatsStr = formatPercent(cat.totalSeats, stats.totalSeats);
            const shareOfTotalAmountStr = formatPercent(
              cat.totalTransferAmount,
              stats.totalTransferAmount
            );
            const shareOfTotalAmountNum =
              stats.totalTransferAmount > 0
                ? Math.min(100, Math.round((cat.totalTransferAmount / stats.totalTransferAmount) * 1000) / 10)
                : 0;

            return (
              <div
                key={cat.categoryId}
                className="bg-white rounded-2xl overflow-hidden flex flex-col justify-between transition-all border-[3px]"
                style={{
                  borderColor: cat.colorHex,
                  boxShadow: '0 4px 12px -2px rgba(15, 23, 42, 0.08)',
                }}
              >
                {/* Category Header */}
                <div
                  className="px-6 py-4 border-b-2 flex items-center justify-between gap-4"
                  style={{
                    backgroundColor: `${cat.colorHex}18`,
                    borderColor: `${cat.colorHex}45`,
                  }}
                >
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span
                      className="px-3 py-1 rounded-lg text-xs font-bold text-white whitespace-nowrap shrink-0 border-2 border-white/40"
                      style={{ backgroundColor: cat.colorHex }}
                    >
                      {cat.categoryName}
                    </span>
                    <span className="px-2.5 py-0.5 rounded-lg text-xs font-bold bg-white border-2 border-slate-300 text-slate-800 font-mono tabular-nums">
                      {shareOfTotalSeatsStr} ของโต๊ะทั้งหมด
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => onInspectCategoryInSeatMap(cat.categoryId)}
                    className="text-xs font-bold text-slate-800 hover:text-slate-950 underline cursor-pointer whitespace-nowrap shrink-0"
                  >
                    ดูผังโต๊ะ {cat.categoryName}
                  </button>
                </div>

                {/* Stats Body */}
                <div className="p-6 space-y-6">
                  {/* Transfer Amount Banner with % of Grand Total */}
                  <div className="space-y-2.5 pb-4 border-b-2 border-slate-200">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div className="space-y-0.5">
                        <span className="text-sm font-bold text-slate-700">
                          ยอดโอนรวมประเภท {cat.categoryName}
                        </span>
                        <p className="text-xs font-bold text-slate-600 font-mono tabular-nums">
                          คิดเป็น {shareOfTotalAmountStr} ของยอดโอนรวมทั้งหมด ({formatBaht(stats.totalTransferAmount)})
                        </p>
                      </div>
                      <div className="text-right">
                        <span
                          className="text-2xl sm:text-3xl font-bold font-mono tabular-nums"
                          style={{ color: cat.colorHex }}
                        >
                          {formatBaht(cat.totalTransferAmount)}
                        </span>
                        <span
                          className="ml-2 px-2.5 py-0.5 rounded-lg text-xs font-extrabold text-white font-mono tabular-nums align-middle border-2 border-black/10"
                          style={{ backgroundColor: cat.colorHex }}
                        >
                          {shareOfTotalAmountStr}
                        </span>
                      </div>
                    </div>

                    {/* Visual Progress Bar of Total Amount Share */}
                    <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden border-2 border-slate-300">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${shareOfTotalAmountNum}%`,
                          backgroundColor: cat.colorHex,
                        }}
                      />
                    </div>
                  </div>

                  {/* 6 Core Numbers with % */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <div className="p-3.5 rounded-xl bg-slate-50 border-2 border-slate-300">
                      <p className="text-xs font-bold text-slate-600">
                        โต๊ะทั้งหมด ({shareOfTotalSeatsStr} ของรวม)
                      </p>
                      <p className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                        {cat.totalSeats.toLocaleString('th-TH')}
                      </p>
                    </div>

                    <div className="p-3.5 rounded-xl bg-slate-50 border-2 border-slate-300">
                      <p className="text-xs font-bold text-slate-600">
                        จองแล้ว ({bookedPercentCatStr})
                      </p>
                      <p className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                        {cat.bookedSeats.toLocaleString('th-TH')}
                      </p>
                    </div>

                    <div className="p-3.5 rounded-xl bg-slate-50 border-2 border-slate-300">
                      <p className="text-xs font-bold text-slate-600">
                        ยังไม่มีข้อมูลการจอง ({unbookedPercentCatStr})
                      </p>
                      <p className="text-xl font-bold font-mono tabular-nums text-slate-600 mt-1">
                        {cat.unbookedSeats.toLocaleString('th-TH')}
                      </p>
                    </div>

                    <div className="p-3.5 rounded-xl bg-violet-50/80 border-2 border-violet-300">
                      <p className="text-xs font-bold text-violet-900">
                        รับบัตรแล้ว ({catTicketPercentStr})
                      </p>
                      <p className="text-xl font-bold font-mono tabular-nums text-violet-700 mt-1">
                        {cat.ticketCollectedSeats.toLocaleString('th-TH')}{' '}
                        <span className="text-xs font-normal text-violet-800">
                          (รอ {cat.unticketedSeats})
                        </span>
                      </p>
                    </div>

                    <div className="p-3.5 rounded-xl bg-sky-50/80 border-2 border-sky-300">
                      <p className="text-xs font-bold text-sky-900">
                        เช็คอินแล้ว ({catCheckedInPercentStr})
                      </p>
                      <p className="text-xl font-bold font-mono tabular-nums text-sky-700 mt-1">
                        {cat.checkedInSeats.toLocaleString('th-TH')}{' '}
                        <span className="text-xs font-normal text-sky-800">
                          (รอ {cat.uncheckedInSeats})
                        </span>
                      </p>
                    </div>

                    <div className="p-3.5 rounded-xl bg-emerald-50/70 border-2 border-emerald-300">
                      <p className="text-xs font-bold text-emerald-900">
                        ชำระแล้ว ({paidPercentStr}) · รอชำระ ({unpaidPercentStr})
                      </p>
                      <p className="text-xl font-bold font-mono tabular-nums text-emerald-700 mt-1">
                        {cat.paidSeats.toLocaleString('th-TH')}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Add Table Modal */}
      {onAddRecord && (
        <AddTableModal
          isOpen={isAddModalOpen}
          categories={categories}
          existingRecords={records}
          onAddRecord={onAddRecord}
          onAddMultipleRecords={onAddMultipleRecords}
          onClose={() => setIsAddModalOpen(false)}
        />
      )}
    </div>
  );
};
