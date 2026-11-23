import React, { useState, useMemo, useEffect } from 'react';
import {
  Search,
  X,
  CheckCircle2,
  XCircle,
  ArrowUpDown,
  Grid,
  UserCheck,
  UserX,
  Plus,
  Ticket,
  StickyNote,
} from 'lucide-react';
import { CategoryConfig, SeatRecord } from '../types/booking';
import { buildUpdatedSeatRecord } from '../utils/excelTemplate';
import { formatNowCheckInTimestamp } from './BookingCard';
import { formatPercent } from './DashboardView';
import { SeatDetailModal } from './SeatDetailModal';
import { AddTableModal } from './AddTableModal';

interface SeatMapViewProps {
  records: SeatRecord[];
  categories: CategoryConfig[];
  initialCategoryFilter?: string;
  onUpdateRecord?: (updated: SeatRecord) => void;
  onDeleteRecord?: (recordId: string) => void;
  onAddRecord?: (categoryId: string, record: SeatRecord) => void;
  onAddMultipleRecords?: (categoryId: string, records: SeatRecord[]) => void;
}

type StatusFilter =
  | 'all'
  | 'ticketcollected'
  | 'unticketed'
  | 'checkedin'
  | 'uncheckedin'
  | 'booked'
  | 'unbooked'
  | 'paid'
  | 'unpaid';
type SortOrder = 'sheet' | 'alphanumeric';

export const SeatMapView: React.FC<SeatMapViewProps> = ({
  records,
  categories,
  initialCategoryFilter = 'all',
  onUpdateRecord,
  onDeleteRecord,
  onAddRecord,
  onAddMultipleRecords,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>(initialCategoryFilter);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortOrder, setSortOrder] = useState<SortOrder>('sheet');
  const [activeSeatId, setActiveSeatId] = useState<string | null>(null);

  // Add Table Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [addModalCategoryId, setAddModalCategoryId] = useState<string | undefined>(
    undefined
  );

  // Sync category filter whenever parent navigates to SeatMap for a specific zone
  useEffect(() => {
    setSelectedCategory(initialCategoryFilter);
  }, [initialCategoryFilter]);

  // Reset to 'all' if the currently selected category was deleted in Settings
  useEffect(() => {
    if (
      selectedCategory !== 'all' &&
      !categories.some((c) => c.id === selectedCategory)
    ) {
      setSelectedCategory('all');
    }
  }, [categories, selectedCategory]);

  const activeSeat = useMemo(
    () => records.find((r) => r.id === activeSeatId) || null,
    [records, activeSeatId]
  );

  const categoryColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of categories) {
      map[c.id] = c.colorHex;
    }
    return map;
  }, [categories]);

  const visibleCategories = useMemo(() => {
    if (selectedCategory === 'all') return categories;
    return categories.filter((c) => c.id === selectedCategory);
  }, [categories, selectedCategory]);

  const handleOpenAddModal = (categoryId?: string) => {
    setAddModalCategoryId(
      categoryId || (selectedCategory !== 'all' ? selectedCategory : categories[0]?.id)
    );
    setIsAddModalOpen(true);
  };

  const handleQuickToggleCheckIn = (e: React.MouseEvent, seat: SeatRecord) => {
    e.stopPropagation();
    if (!onUpdateRecord) return;
    const nextCheckedIn = !seat.isCheckedIn;
    const updated = buildUpdatedSeatRecord(seat, {
      isCheckedIn: nextCheckedIn,
      checkedInAt: nextCheckedIn ? seat.checkedInAt || formatNowCheckInTimestamp() : '',
    });
    onUpdateRecord(updated);
  };

  const handleQuickToggleTicketCollected = (e: React.MouseEvent, seat: SeatRecord) => {
    e.stopPropagation();
    if (!onUpdateRecord) return;
    const nextCollected = !seat.isTicketCollected;
    const updated = buildUpdatedSeatRecord(seat, {
      isTicketCollected: nextCollected,
      ticketCollectedAt: nextCollected
        ? seat.ticketCollectedAt || formatNowCheckInTimestamp()
        : '',
    });
    onUpdateRecord(updated);
  };

  const filterAndSortRecords = (catRecords: SeatRecord[]) => {
    const q = searchQuery.trim().replace(/\s+/g, '').toUpperCase();

    const filtered = catRecords.filter((r) => {
      if (q) {
        const matchTable = r.normalizedTableNumber.includes(q) || r.compactTableNumber.includes(q);
        const matchName = r.fullName.toUpperCase().includes(q);
        const matchNote = (r.note || '').toUpperCase().includes(q);
        if (!matchTable && !matchName && !matchNote) return false;
      }

      if (statusFilter === 'ticketcollected' && !r.isTicketCollected) return false;
      if (statusFilter === 'unticketed' && r.isTicketCollected) return false;
      if (statusFilter === 'checkedin' && !r.isCheckedIn) return false;
      if (statusFilter === 'uncheckedin' && r.isCheckedIn) return false;
      if (statusFilter === 'booked' && !r.isBooked) return false;
      if (statusFilter === 'unbooked' && r.isBooked) return false;
      if (statusFilter === 'paid' && !r.isPaid) return false;
      if (statusFilter === 'unpaid' && r.isPaid) return false;

      return true;
    });

    if (sortOrder === 'alphanumeric') {
      return [...filtered].sort((a, b) =>
        a.tableNumber.localeCompare(b.tableNumber, 'th', { numeric: true, sensitivity: 'base' })
      );
    }

    return filtered;
  };

  const totalCheckedIn = useMemo(
    () => records.filter((r) => r.isCheckedIn).length,
    [records]
  );

  const totalTicketCollected = useMemo(
    () => records.filter((r) => r.isTicketCollected).length,
    [records]
  );

  return (
    <div className="space-y-8">
      {/* Header & Controls Bar */}
      <section className="bg-white border-[2.5px] border-slate-300 rounded-2xl p-6 space-y-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                ระบบผังโต๊ะ (Seat Map Grid)
              </h1>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-extrabold bg-violet-600 text-white shadow-2xs font-mono tabular-nums">
                <Ticket className="w-3.5 h-3.5" />
                รับบัตรแล้ว {totalTicketCollected} / {records.length} โต๊ะ ({formatPercent(totalTicketCollected, records.length)})
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-extrabold bg-sky-600 text-white shadow-2xs font-mono tabular-nums">
                <UserCheck className="w-3.5 h-3.5" />
                เช็คอินเข้างานแล้ว {totalCheckedIn} / {records.length} โต๊ะ ({formatPercent(totalCheckedIn, records.length)})
              </span>
            </div>
            <p className="text-sm text-slate-500 mt-1">
              จัดเรียงเลขโต๊ะอัตโนมัติในรูปแบบ Grid แยกตามประเภท VIP และ Standard คลิกที่ปุ่มรับบัตรหรือเช็คอินบนการ์ดโต๊ะได้ทันที หรือคลิกที่โต๊ะเพื่อดูข้อมูลการจองและสลิปโอนเงิน
            </p>
          </div>

          {/* Sort Mode Toggle & Add Table Button */}
          <div className="flex flex-wrap items-center gap-2">
            {onAddRecord && (
              <button
                type="button"
                onClick={() => handleOpenAddModal()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-2xs"
              >
                <Plus className="w-4 h-4" />
                เพิ่มโต๊ะใหม่
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                setSortOrder((prev) => (prev === 'sheet' ? 'alphanumeric' : 'sheet'))
              }
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ArrowUpDown className="w-3.5 h-3.5 text-slate-500" />
              เรียงตาม: {sortOrder === 'sheet' ? 'ลำดับแถวในตาราง' : 'เลขโต๊ะ (A-Z / 1-9)'}
            </button>
          </div>
        </div>

        {/* Search & Interactive Segmented Filters */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
          {/* Map Search Input */}
          <div className="lg:col-span-3 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ค้นหาเลขโต๊ะ ชื่อผู้จอง หรือหมายเหตุ..."
              className="w-full pl-10 pr-9 py-2 text-sm font-medium text-slate-900 bg-slate-50 border-2 border-slate-300 rounded-lg focus:bg-white focus:border-slate-900 focus:outline-none transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Category Filter Buttons */}
          <div className="lg:col-span-3 flex items-center gap-1 p-1 bg-slate-100 border-2 border-slate-300 rounded-xl overflow-x-auto">
            <button
              type="button"
              onClick={() => setSelectedCategory('all')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                selectedCategory === 'all'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              ทุกประเภท ({records.length})
            </button>
            {categories.map((cat) => {
              const count = records.filter((r) => r.categoryId === cat.id).length;
              const isSelected = selectedCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    isSelected
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: cat.colorHex }}
                  />
                  <span>
                    {cat.name} ({count})
                  </span>
                </button>
              );
            })}
          </div>

          {/* Ticket, Check-In, Booking & Payment Status Filter Buttons */}
          <div className="lg:col-span-6 flex items-center gap-1 p-1 bg-slate-100 border-2 border-slate-300 rounded-xl overflow-x-auto">
            {(
              [
                { id: 'all', label: 'ทั้งหมด' },
                {
                  id: 'ticketcollected',
                  label: `รับบัตรแล้ว (${totalTicketCollected})`,
                },
                {
                  id: 'unticketed',
                  label: `รอรับบัตร (${records.length - totalTicketCollected})`,
                },
                { id: 'checkedin', label: `เช็คอินแล้ว (${totalCheckedIn})` },
                {
                  id: 'uncheckedin',
                  label: `รอเช็คอิน (${records.length - totalCheckedIn})`,
                },
                { id: 'booked', label: 'จองแล้ว' },
                { id: 'unbooked', label: 'ว่าง' },
                { id: 'paid', label: 'ชำระแล้ว' },
                { id: 'unpaid', label: 'ยังไม่ชำระ' },
              ] as Array<{ id: StatusFilter; label: string }>
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  statusFilter === tab.id
                    ? tab.id === 'ticketcollected'
                      ? 'bg-violet-600 text-white shadow-xs'
                      : tab.id === 'checkedin'
                        ? 'bg-sky-600 text-white shadow-xs'
                        : 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Visual Color Key Legend */}
        <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-600">
          <div className="flex flex-wrap items-center gap-4">
            <span className="font-semibold text-slate-500">สีประจำประเภท:</span>
            {categories.map((cat) => (
              <span key={cat.id} className="inline-flex items-center gap-1.5 font-medium">
                <span
                  className="w-3 h-3 rounded-xs shrink-0"
                  style={{ backgroundColor: cat.colorHex }}
                />
                {cat.name}
              </span>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <span className="inline-flex items-center gap-1 text-violet-700 font-bold">
              <Ticket className="w-3.5 h-3.5 text-violet-600" />
              สีม่วง = เข้ารับบัตรแล้ว
            </span>
            <span className="inline-flex items-center gap-1 text-sky-700 font-bold">
              <UserCheck className="w-3.5 h-3.5 text-sky-600" />
              สีฟ้า = เช็คอินเข้างานแล้ว
            </span>
            <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              สีเขียว = ชำระแล้ว
            </span>
            <span className="inline-flex items-center gap-1 text-red-600 font-semibold">
              <XCircle className="w-3.5 h-3.5 text-red-600" />
              สีแดง = ยังไม่ชำระ
            </span>
          </div>
        </div>
      </section>

      {/* Seat Grids Separated by Category */}
      <div className="space-y-8">
        {visibleCategories.map((cat) => {
          const allCatRecords = records.filter((r) => r.categoryId === cat.id);
          const catCheckedInCount = allCatRecords.filter((r) => r.isCheckedIn).length;
          const catTicketCount = allCatRecords.filter((r) => r.isTicketCollected).length;
          const filteredRecords = filterAndSortRecords(allCatRecords);

          return (
            <section
              key={cat.id}
              className="bg-white border-[3px] rounded-2xl overflow-hidden shadow-xs"
              style={{ borderColor: cat.colorHex }}
            >
              {/* Category Section Header */}
              <div
                className="px-6 py-4 border-b-2 flex flex-wrap items-center justify-between gap-4"
                style={{
                  backgroundColor: `${cat.colorHex}15`,
                  borderColor: `${cat.colorHex}45`,
                }}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span
                    className="px-3 py-1 rounded-md text-xs font-bold text-white whitespace-nowrap shrink-0"
                    style={{ backgroundColor: cat.colorHex }}
                  >
                    โซน {cat.name}
                  </span>
                  <h2 className="text-base font-bold text-slate-900">
                    ผังโต๊ะประเภท {cat.name} ({formatPercent(allCatRecords.length, records.length)} ของทั้งหมด)
                  </h2>
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-bold bg-violet-100 text-violet-800 border border-violet-200 font-mono tabular-nums">
                    <Ticket className="w-3.5 h-3.5 text-violet-600" />
                    รับบัตรแล้ว {catTicketCount} / {allCatRecords.length} โต๊ะ ({formatPercent(catTicketCount, allCatRecords.length)})
                  </span>
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-bold bg-sky-100 text-sky-800 border border-sky-200 font-mono tabular-nums">
                    <UserCheck className="w-3.5 h-3.5 text-sky-600" />
                    เช็คอินแล้ว {catCheckedInCount} / {allCatRecords.length} โต๊ะ ({formatPercent(catCheckedInCount, allCatRecords.length)})
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-xs text-slate-600 font-mono tabular-nums">
                    แสดง {filteredRecords.length} จาก {allCatRecords.length} โต๊ะ
                  </span>
                  {onAddRecord && (
                    <button
                      type="button"
                      onClick={() => handleOpenAddModal(cat.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white shadow-2xs transition-opacity hover:opacity-90 cursor-pointer whitespace-nowrap shrink-0"
                      style={{ backgroundColor: cat.colorHex }}
                    >
                      <Plus className="w-3.5 h-3.5" />
                      เพิ่มโต๊ะโซน {cat.name}
                    </button>
                  )}
                </div>
              </div>

              {/* Grid Body */}
              <div className="p-6">
                {filteredRecords.length === 0 ? (
                  <div className="py-12 text-center space-y-3">
                    <Grid className="w-8 h-8 text-slate-300 mx-auto" />
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-slate-700">
                        ไม่พบรายการโต๊ะในหมวดหมู่ {cat.name} ที่ตรงกับตัวกรอง
                      </p>
                      <p className="text-xs text-slate-400">
                        ลองเปลี่ยนคำค้นหาหรือกดปุ่มด้านล่างเพื่อเพิ่มโต๊ะใหม่ในโซน {cat.name}
                      </p>
                    </div>
                    {onAddRecord && (
                      <button
                        type="button"
                        onClick={() => handleOpenAddModal(cat.id)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white shadow-2xs transition-opacity hover:opacity-90 cursor-pointer"
                        style={{ backgroundColor: cat.colorHex }}
                      >
                        <Plus className="w-4 h-4" />
                        เพิ่มโต๊ะใหม่ในโซน {cat.name}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
                    {filteredRecords.map((seat) => {
                      return (
                        <div
                          key={seat.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => setActiveSeatId(seat.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setActiveSeatId(seat.id);
                            }
                          }}
                          className={`group text-left border-[2.5px] rounded-xl p-3 transition-all flex flex-col justify-between gap-2 cursor-pointer focus:outline-none focus:ring-2 focus:ring-slate-900 shadow-2xs ${
                            seat.isCheckedIn
                              ? 'bg-sky-50/75 hover:bg-sky-50 ring-2 ring-sky-400/50'
                              : seat.isTicketCollected
                                ? 'bg-violet-50/75 hover:bg-violet-50 ring-2 ring-violet-400/50'
                                : 'bg-white hover:bg-slate-50'
                          }`}
                          style={{
                            borderColor: seat.isCheckedIn
                              ? '#0284c7'
                              : seat.isTicketCollected
                                ? '#7c3aed'
                                : seat.isBooked
                                  ? cat.colorHex
                                  : '#cbd5e1',
                          }}
                        >
                          {/* Top row: Category indicator + Table Number + Payment Badge */}
                          <div className="w-full flex items-start justify-between gap-1">
                            <span
                              className="text-base font-bold font-mono tabular-nums tracking-tight truncate"
                              style={{ color: cat.colorHex }}
                              title={seat.tableNumber}
                            >
                              {seat.tableNumber}
                            </span>

                            {/* Payment Status Icon (Green = Paid, Red = Unpaid) */}
                            {seat.isPaid ? (
                              <span
                                title="ชำระแล้ว"
                                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0"
                              >
                                ชำระแล้ว
                              </span>
                            ) : (
                              <span
                                title="ยังไม่ชำระ"
                                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-50 text-red-600 border border-red-200 shrink-0"
                              >
                                ยังไม่ชำระ
                              </span>
                            )}
                          </div>

                          {/* Middle row: Customer Name or Empty State */}
                          <div className="w-full min-h-[2.1rem] flex flex-col justify-center gap-1">
                            {seat.isBooked ? (
                              <p
                                className="text-xs font-semibold text-slate-800 line-clamp-2 leading-snug"
                                title={seat.fullName || 'จองแล้ว'}
                              >
                                {seat.fullName || 'จองแล้ว (ไม่ระบุชื่อ)'}
                              </p>
                            ) : (
                              <p className="text-xs text-slate-400 italic">ยังไม่มีข้อมูลการจอง</p>
                            )}

                            {seat.note && (
                              <div
                                title={`หมายเหตุ: ${seat.note}`}
                                className="inline-flex items-start gap-1 px-1.5 py-1 rounded-md bg-amber-50 border border-amber-300 text-[10px] font-semibold text-amber-900 w-full"
                              >
                                <StickyNote className="w-3 h-3 text-amber-600 shrink-0 mt-0.5" />
                                <span className="line-clamp-1 break-all">
                                  {seat.note}
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Quick 1-Click Ticket Collection & Check-In Buttons */}
                          {onUpdateRecord && (
                            <div className="grid grid-cols-2 gap-1 w-full">
                              <button
                                type="button"
                                onClick={(e) => handleQuickToggleTicketCollected(e, seat)}
                                title={
                                  seat.isTicketCollected
                                    ? `รับบัตรแล้ว (${seat.ticketCollectedAt || '-'}) — คลิกเพื่อยกเลิก`
                                    : 'คลิกเพื่อยืนยันการรับบัตรโต๊ะนี้ทันที'
                                }
                                className={`inline-flex items-center justify-center gap-1 py-1 px-1.5 rounded-lg text-[10px] font-bold transition-colors cursor-pointer ${
                                  seat.isTicketCollected
                                    ? 'bg-violet-600 hover:bg-violet-700 text-white shadow-2xs'
                                    : 'bg-slate-100 hover:bg-violet-100 text-slate-700 hover:text-violet-800 border border-slate-200'
                                }`}
                              >
                                <Ticket className="w-3 h-3 shrink-0" />
                                <span className="truncate">
                                  {seat.isTicketCollected ? 'รับบัตรแล้ว' : 'กดรับบัตร'}
                                </span>
                              </button>

                              <button
                                type="button"
                                onClick={(e) => handleQuickToggleCheckIn(e, seat)}
                                title={
                                  seat.isCheckedIn
                                    ? `เช็คอินแล้ว (${seat.checkedInAt || '-'}) — คลิกเพื่อยกเลิกเช็คอิน`
                                    : 'คลิกเพื่อเช็คอินเข้างานโต๊ะนี้ทันที'
                                }
                                className={`inline-flex items-center justify-center gap-1 py-1 px-1.5 rounded-lg text-[10px] font-bold transition-colors cursor-pointer ${
                                  seat.isCheckedIn
                                    ? 'bg-sky-600 hover:bg-sky-700 text-white shadow-2xs'
                                    : 'bg-slate-100 hover:bg-sky-100 text-slate-700 hover:text-sky-800 border border-slate-200'
                                }`}
                              >
                                <UserCheck className="w-3 h-3 shrink-0" />
                                <span className="truncate">
                                  {seat.isCheckedIn ? 'เช็คอินแล้ว' : 'กดเช็คอิน'}
                                </span>
                              </button>
                            </div>
                          )}

                          {/* Bottom row: Booking Status & Category Pill */}
                          <div className="w-full pt-1.5 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                            <span className="inline-flex items-center gap-1 font-medium">
                              {seat.isBooked ? (
                                <>
                                  <UserCheck className="w-3 h-3 text-slate-700" />
                                  <span className="text-slate-700">จองแล้ว</span>
                                </>
                              ) : (
                                <>
                                  <UserX className="w-3 h-3 text-slate-400" />
                                  <span className="text-slate-400">ว่าง</span>
                                </>
                              )}
                            </span>
                            <span
                              className="font-semibold"
                              style={{ color: cat.colorHex }}
                            >
                              {cat.name}
                            </span>
                          </div>
                        </div>
                      );
                    })}

                    {/* Quick "+ เพิ่มโต๊ะใหม่" Tile at the end of the Grid */}
                    {onAddRecord && (
                      <button
                        type="button"
                        onClick={() => handleOpenAddModal(cat.id)}
                        className="group border-[2.5px] border-dashed rounded-xl p-3 transition-all flex flex-col items-center justify-center gap-2 min-h-[112px] cursor-pointer hover:bg-slate-50"
                        style={{
                          borderColor: cat.colorHex,
                          color: cat.colorHex,
                        }}
                      >
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-white transition-transform group-hover:scale-110"
                          style={{ backgroundColor: cat.colorHex }}
                        >
                          <Plus className="w-4 h-4" />
                        </div>
                        <span className="text-xs font-bold text-center">
                          + เพิ่มโต๊ะโซน {cat.name}
                        </span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {/* Seat Detail Modal on Click */}
      <SeatDetailModal
        record={activeSeat}
        categoryColor={activeSeat ? categoryColorMap[activeSeat.categoryId] || '#2563EB' : '#2563EB'}
        categoryColorMap={categoryColorMap}
        onUpdateRecord={onUpdateRecord}
        onDeleteRecord={onDeleteRecord}
        onClose={() => setActiveSeatId(null)}
      />

      {/* Add Table Modal */}
      {onAddRecord && (
        <AddTableModal
          isOpen={isAddModalOpen}
          categories={categories}
          existingRecords={records}
          initialCategoryId={addModalCategoryId}
          onAddRecord={onAddRecord}
          onAddMultipleRecords={onAddMultipleRecords}
          onClose={() => setIsAddModalOpen(false)}
        />
      )}
    </div>
  );
};
