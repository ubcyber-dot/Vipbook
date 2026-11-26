import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Search,
  ArrowRightLeft,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  User,
  StickyNote,
  Ticket,
  UserCheck,
  Repeat,
} from 'lucide-react';
import { CategoryConfig, SeatRecord } from '../types/booking';
import { formatBaht } from './BookingCard';

interface MoveTableModalProps {
  isOpen: boolean;
  records: SeatRecord[];
  categories: CategoryConfig[];
  initialSourceSeatId?: string | null;
  onConfirmMove: (
    sourceId: string,
    targetId: string,
    options: { appendTransferNote: boolean }
  ) => void;
  onClose: () => void;
}

export const MoveTableModal: React.FC<MoveTableModalProps> = ({
  isOpen,
  records,
  categories,
  initialSourceSeatId = null,
  onConfirmMove,
  onClose,
}) => {
  const [sourceId, setSourceId] = useState<string>('');
  const [targetId, setTargetId] = useState<string>('');

  // Source filters
  const [sourceCategoryFilter, setSourceCategoryFilter] = useState<string>('all');
  const [sourceSearch, setSourceSearch] = useState<string>('');
  const [sourceOnlyBooked, setSourceOnlyBooked] = useState<boolean>(true);

  // Target filters
  const [targetCategoryFilter, setTargetCategoryFilter] = useState<string>('all');
  const [targetSearch, setTargetSearch] = useState<string>('');
  const [targetOnlyEmpty, setTargetOnlyEmpty] = useState<boolean>(true);

  // Transfer options
  const [appendTransferNote, setAppendTransferNote] = useState<boolean>(true);

  // Reset modal state whenever opened
  useEffect(() => {
    if (!isOpen) return;

    const initialSeat = initialSourceSeatId
      ? records.find((r) => r.id === initialSourceSeatId) || null
      : null;

    if (initialSeat) {
      setSourceId(initialSeat.id);
      setSourceCategoryFilter('all');
      setSourceOnlyBooked(initialSeat.isBooked);
      setTargetCategoryFilter(initialSeat.categoryId);
    } else {
      const firstBooked = records.find((r) => r.isBooked);
      setSourceId(firstBooked?.id || '');
      setSourceCategoryFilter('all');
      setSourceOnlyBooked(true);
      setTargetCategoryFilter('all');
    }

    setTargetId('');
    setSourceSearch('');
    setTargetSearch('');
    setTargetOnlyEmpty(true);
    setAppendTransferNote(true);
  }, [isOpen, initialSourceSeatId, records]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const categoryColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of categories) {
      map[c.id] = c.colorHex;
    }
    return map;
  }, [categories]);

  const sourceSeat = useMemo(
    () => records.find((r) => r.id === sourceId) || null,
    [records, sourceId]
  );

  const targetSeat = useMemo(
    () => records.find((r) => r.id === targetId) || null,
    [records, targetId]
  );

  const filteredSourceSeats = useMemo(() => {
    const q = sourceSearch.trim().toLowerCase();
    const qCompact = q.replace(/\s+/g, '');
    return records.filter((r) => {
      if (sourceCategoryFilter !== 'all' && r.categoryId !== sourceCategoryFilter) {
        return false;
      }
      if (sourceOnlyBooked && !r.isBooked && r.id !== sourceId) {
        return false;
      }
      if (q) {
        const matchTable =
          r.tableNumber.toLowerCase().includes(q) ||
          r.normalizedTableNumber.toLowerCase().includes(qCompact) ||
          r.compactTableNumber.toLowerCase().includes(qCompact);
        const matchName = r.fullName.toLowerCase().includes(q);
        const matchPhone = r.phone.toLowerCase().includes(q);
        const matchNote = (r.note || '').toLowerCase().includes(q);
        if (!matchTable && !matchName && !matchPhone && !matchNote) return false;
      }
      return true;
    });
  }, [records, sourceCategoryFilter, sourceOnlyBooked, sourceSearch, sourceId]);

  const filteredTargetSeats = useMemo(() => {
    const q = targetSearch.trim().toLowerCase();
    const qCompact = q.replace(/\s+/g, '');
    return records.filter((r) => {
      if (r.id === sourceId) return false;
      if (targetCategoryFilter !== 'all' && r.categoryId !== targetCategoryFilter) {
        return false;
      }
      if (targetOnlyEmpty && r.isBooked) {
        return false;
      }
      if (q) {
        const matchTable =
          r.tableNumber.toLowerCase().includes(q) ||
          r.normalizedTableNumber.toLowerCase().includes(qCompact) ||
          r.compactTableNumber.toLowerCase().includes(qCompact);
        const matchName = r.fullName.toLowerCase().includes(q);
        const matchPhone = r.phone.toLowerCase().includes(q);
        if (!matchTable && !matchName && !matchPhone) return false;
      }
      return true;
    });
  }, [records, sourceId, targetCategoryFilter, targetOnlyEmpty, targetSearch]);

  const totalBookedCount = useMemo(
    () => records.filter((r) => r.isBooked).length,
    [records]
  );

  const totalEmptyCount = useMemo(
    () => records.filter((r) => !r.isBooked && r.id !== sourceId).length,
    [records, sourceId]
  );

  if (!isOpen) return null;

  const isSwapMode = Boolean(sourceSeat?.isBooked && targetSeat?.isBooked);
  const isCrossZone = Boolean(
    sourceSeat && targetSeat && sourceSeat.categoryId !== targetSeat.categoryId
  );
  const hasAnyBooking = Boolean(sourceSeat?.isBooked || targetSeat?.isBooked);
  const canConfirm = Boolean(
    sourceSeat && targetSeat && sourceSeat.id !== targetSeat.id && hasAnyBooking
  );

  const handleSelectSource = (seat: SeatRecord) => {
    setSourceId(seat.id);
    if (targetId === seat.id) {
      setTargetId('');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canConfirm || !sourceSeat || !targetSeat) return;
    onConfirmMove(sourceSeat.id, targetSeat.id, { appendTransferNote });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/65 backdrop-blur-xs overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl bg-white rounded-3xl shadow-2xl border-[3px] border-slate-300 ring-4 ring-slate-950/20 overflow-hidden my-auto flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 sm:px-6 py-4 bg-slate-900 text-white border-b-2 border-slate-700 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-indigo-500 text-white flex items-center justify-center shrink-0 shadow-sm">
              <ArrowRightLeft className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-extrabold tracking-tight truncate">
                ระบบย้ายโต๊ะ / สลับโต๊ะ (Table Transfer)
              </h2>
              <p className="text-xs text-slate-300 truncate">
                ย้ายข้อมูลผู้จอง ยอดโอน สลิป สถานะชำระเงิน การรับบัตร เช็คอิน และหมายเหตุ ไปยังโต๊ะปลายทาง (รองรับข้ามโซน)
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="ปิดหน้าต่าง"
            className="p-2 text-slate-300 hover:text-white bg-white/10 hover:bg-white/20 rounded-xl transition-colors cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto flex flex-col">
          <div className="p-4 sm:p-6 space-y-5 flex-1">
            {records.length < 2 ? (
              <div className="p-8 text-center bg-slate-50 border-2 border-slate-200 rounded-2xl space-y-2">
                <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto" />
                <p className="text-sm font-bold text-slate-800">
                  ต้องมีอย่างน้อย 2 โต๊ะในระบบจึงจะสามารถย้ายหรือสลับโต๊ะได้
                </p>
              </div>
            ) : (
              <>
                {/* 2-Column Picker Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  {/* LEFT COLUMN: Step 1 - Source Table */}
                  <div className="bg-slate-50 border-2 border-slate-300 rounded-2xl p-4 flex flex-col gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-lg bg-slate-900 text-white text-xs font-extrabold flex items-center justify-center shrink-0">
                          1
                        </span>
                        <div>
                          <h3 className="text-sm font-extrabold text-slate-900">
                            เลือกโต๊ะต้นทาง (โต๊ะเดิม)
                          </h3>
                          <p className="text-[11px] text-slate-500">
                            โต๊ะที่มีผู้จองทั้งหมด {totalBookedCount} โต๊ะ
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 p-0.5 bg-white border border-slate-300 rounded-lg">
                        <button
                          type="button"
                          onClick={() => setSourceOnlyBooked(true)}
                          className={`px-2 py-1 text-[11px] font-bold rounded-md cursor-pointer transition-colors ${
                            sourceOnlyBooked
                              ? 'bg-slate-900 text-white'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          เฉพาะจองแล้ว ({totalBookedCount})
                        </button>
                        <button
                          type="button"
                          onClick={() => setSourceOnlyBooked(false)}
                          className={`px-2 py-1 text-[11px] font-bold rounded-md cursor-pointer transition-colors ${
                            !sourceOnlyBooked
                              ? 'bg-slate-900 text-white'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          ทั้งหมด ({records.length})
                        </button>
                      </div>
                    </div>

                    {/* Source Zone Tabs */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setSourceCategoryFilter('all')}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer border transition-colors ${
                          sourceCategoryFilter === 'all'
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'
                        }`}
                      >
                        ทุกโซน
                      </button>
                      {categories.map((cat) => {
                        const active = sourceCategoryFilter === cat.id;
                        return (
                          <button
                            key={cat.id}
                            type="button"
                            onClick={() => setSourceCategoryFilter(cat.id)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer border transition-all"
                            style={{
                              backgroundColor: active ? cat.colorHex : '#FFFFFF',
                              color: active ? '#FFFFFF' : '#334155',
                              borderColor: active ? cat.colorHex : '#CBD5E1',
                            }}
                          >
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{
                                backgroundColor: active ? '#FFFFFF' : cat.colorHex,
                              }}
                            />
                            {cat.name}
                          </button>
                        );
                      })}
                    </div>

                    {/* Source Search */}
                    <div className="relative">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={sourceSearch}
                        onChange={(e) => setSourceSearch(e.target.value)}
                        placeholder="ค้นหาเลขโต๊ะต้นทาง ชื่อผู้จอง หรือเบอร์โทร..."
                        className="w-full pl-9 pr-8 py-2 text-xs font-medium bg-white border-2 border-slate-300 rounded-xl focus:border-slate-900 focus:outline-none"
                      />
                      {sourceSearch && (
                        <button
                          type="button"
                          onClick={() => setSourceSearch('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Source List */}
                    <div className="max-h-60 overflow-y-auto pr-1 space-y-1.5">
                      {filteredSourceSeats.length === 0 ? (
                        <div className="py-8 text-center text-xs text-slate-500 bg-white rounded-xl border border-slate-200">
                          {totalBookedCount === 0 && sourceOnlyBooked
                            ? 'ยังไม่มีโต๊ะที่มีข้อมูลการจองในระบบ'
                            : 'ไม่พบโต๊ะต้นทางที่ตรงกับเงื่อนไข'}
                        </div>
                      ) : (
                        filteredSourceSeats.map((seat) => {
                          const zoneColor = categoryColorMap[seat.categoryId] || '#2563EB';
                          const isSelected = seat.id === sourceId;
                          return (
                            <button
                              key={seat.id}
                              type="button"
                              onClick={() => handleSelectSource(seat)}
                              className={`w-full text-left p-2.5 rounded-xl border-2 transition-all flex items-center justify-between gap-2.5 cursor-pointer ${
                                isSelected
                                  ? 'bg-indigo-50 border-indigo-600 ring-2 ring-indigo-200 shadow-xs'
                                  : 'bg-white border-slate-200 hover:border-slate-400'
                              }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <span
                                  className="px-2 py-1 rounded-lg text-xs font-mono font-extrabold text-white shrink-0"
                                  style={{ backgroundColor: zoneColor }}
                                >
                                  {seat.tableNumber}
                                </span>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-xs font-bold text-slate-900 truncate">
                                      {seat.fullName || (
                                        <span className="text-slate-400 font-normal italic">
                                          โต๊ะว่าง
                                        </span>
                                      )}
                                    </span>
                                    <span
                                      className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0"
                                      style={{
                                        backgroundColor: `${zoneColor}18`,
                                        color: zoneColor,
                                      }}
                                    >
                                      {seat.categoryName}
                                    </span>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                                    {seat.phone && (
                                      <span className="font-mono">{seat.phone}</span>
                                    )}
                                    {seat.transferAmount > 0 && (
                                      <span className="font-mono font-semibold text-slate-700">
                                        {formatBaht(seat.transferAmount)}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-1 shrink-0">
                                {seat.isPaid && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                                    ชำระแล้ว
                                  </span>
                                )}
                                {isSelected && (
                                  <CheckCircle2 className="w-4 h-4 text-indigo-600 shrink-0" />
                                )}
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* RIGHT COLUMN: Step 2 - Target Table */}
                  <div className="bg-slate-50 border-2 border-slate-300 rounded-2xl p-4 flex flex-col gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-lg bg-indigo-600 text-white text-xs font-extrabold flex items-center justify-center shrink-0">
                          2
                        </span>
                        <div>
                          <h3 className="text-sm font-extrabold text-slate-900">
                            เลือกโต๊ะปลายทาง (โต๊ะใหม่)
                          </h3>
                          <p className="text-[11px] text-slate-500">
                            โต๊ะว่างพร้อมย้าย {totalEmptyCount} โต๊ะ
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 p-0.5 bg-white border border-slate-300 rounded-lg">
                        <button
                          type="button"
                          onClick={() => setTargetOnlyEmpty(true)}
                          className={`px-2 py-1 text-[11px] font-bold rounded-md cursor-pointer transition-colors ${
                            targetOnlyEmpty
                              ? 'bg-emerald-600 text-white'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          เฉพาะโต๊ะว่าง ({totalEmptyCount})
                        </button>
                        <button
                          type="button"
                          onClick={() => setTargetOnlyEmpty(false)}
                          className={`px-2 py-1 text-[11px] font-bold rounded-md cursor-pointer transition-colors ${
                            !targetOnlyEmpty
                              ? 'bg-amber-600 text-white'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          ทั้งหมด / สลับโต๊ะ
                        </button>
                      </div>
                    </div>

                    {/* Target Zone Tabs */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setTargetCategoryFilter('all')}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer border transition-colors ${
                          targetCategoryFilter === 'all'
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'
                        }`}
                      >
                        ทุกโซน
                      </button>
                      {categories.map((cat) => {
                        const active = targetCategoryFilter === cat.id;
                        const emptyInZone = records.filter(
                          (r) =>
                            r.categoryId === cat.id &&
                            !r.isBooked &&
                            r.id !== sourceId
                        ).length;
                        return (
                          <button
                            key={cat.id}
                            type="button"
                            onClick={() => setTargetCategoryFilter(cat.id)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer border transition-all"
                            style={{
                              backgroundColor: active ? cat.colorHex : '#FFFFFF',
                              color: active ? '#FFFFFF' : '#334155',
                              borderColor: active ? cat.colorHex : '#CBD5E1',
                            }}
                          >
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{
                                backgroundColor: active ? '#FFFFFF' : cat.colorHex,
                              }}
                            />
                            {cat.name}
                            <span className="opacity-80 font-mono">
                              ({emptyInZone})
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Target Search */}
                    <div className="relative">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={targetSearch}
                        onChange={(e) => setTargetSearch(e.target.value)}
                        placeholder="ค้นหาเลขโต๊ะปลายทาง หรือชื่อผู้จอง (สำหรับสลับโต๊ะ)..."
                        className="w-full pl-9 pr-8 py-2 text-xs font-medium bg-white border-2 border-slate-300 rounded-xl focus:border-slate-900 focus:outline-none"
                      />
                      {targetSearch && (
                        <button
                          type="button"
                          onClick={() => setTargetSearch('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Target List / Grid */}
                    <div className="max-h-60 overflow-y-auto pr-1">
                      {filteredTargetSeats.length === 0 ? (
                        <div className="py-8 px-4 text-center space-y-2 bg-white rounded-xl border border-slate-200">
                          <p className="text-xs font-semibold text-slate-600">
                            {targetOnlyEmpty
                              ? 'ไม่พบโต๊ะว่างในโซนที่เลือก'
                              : 'ไม่พบโต๊ะปลายทางที่ตรงกับคำค้นหา'}
                          </p>
                          {targetOnlyEmpty && (
                            <button
                              type="button"
                              onClick={() => setTargetOnlyEmpty(false)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-300 rounded-lg cursor-pointer"
                            >
                              <Repeat className="w-3.5 h-3.5" />
                              แสดงโต๊ะทั้งหมดเพื่อสลับโต๊ะ
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {filteredTargetSeats.map((seat) => {
                            const zoneColor = categoryColorMap[seat.categoryId] || '#2563EB';
                            const isSelected = seat.id === targetId;
                            return (
                              <button
                                key={seat.id}
                                type="button"
                                onClick={() => setTargetId(seat.id)}
                                className={`text-left p-2.5 rounded-xl border-2 transition-all flex flex-col justify-between gap-1.5 cursor-pointer ${
                                  isSelected
                                    ? seat.isBooked
                                      ? 'bg-amber-50 border-amber-500 ring-2 ring-amber-200 shadow-xs'
                                      : 'bg-emerald-50 border-emerald-600 ring-2 ring-emerald-200 shadow-xs'
                                    : 'bg-white border-slate-200 hover:border-slate-400'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-1">
                                  <span
                                    className="text-sm font-mono font-extrabold truncate"
                                    style={{ color: zoneColor }}
                                  >
                                    {seat.tableNumber}
                                  </span>
                                  <span
                                    className="px-1.5 py-0.5 rounded text-[10px] font-bold text-white shrink-0"
                                    style={{ backgroundColor: zoneColor }}
                                  >
                                    {seat.categoryName}
                                  </span>
                                </div>

                                {seat.isBooked ? (
                                  <div className="space-y-0.5">
                                    <p className="text-[11px] font-bold text-slate-800 truncate">
                                      {seat.fullName || 'จองแล้ว'}
                                    </p>
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                                      <Repeat className="w-2.5 h-2.5" />
                                      สลับโต๊ะ
                                    </span>
                                  </div>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 w-fit">
                                    <CheckCircle2 className="w-2.5 h-2.5" />
                                    โต๊ะว่าง
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Live Transfer Preview Box */}
                <div
                  className={`rounded-2xl border-2 p-4 sm:p-5 space-y-3.5 transition-colors ${
                    !sourceSeat || !targetSeat
                      ? 'bg-slate-50 border-slate-200'
                      : isSwapMode
                        ? 'bg-amber-50/70 border-amber-400'
                        : 'bg-emerald-50/70 border-emerald-400'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-extrabold uppercase tracking-wider text-slate-700">
                      ตัวอย่างสรุปการย้ายโต๊ะก่อนยืนยัน
                    </span>

                    <div className="flex flex-wrap items-center gap-2">
                      {sourceSeat && targetSeat && (
                        <>
                          {isSwapMode ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-600 text-white shadow-2xs">
                              <Repeat className="w-3.5 h-3.5" />
                              โหมดสลับโต๊ะ (ข้อมูลทั้ง 2 โต๊ะจะสลับตำแหน่งกัน)
                            </span>
                          ) : hasAnyBooking ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-600 text-white shadow-2xs">
                              <ArrowRight className="w-3.5 h-3.5" />
                              โหมดย้ายไปโต๊ะว่าง (โต๊ะเดิมจะคืนเป็นโต๊ะว่าง)
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-red-600 text-white">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              กรุณาเลือกโต๊ะที่มีข้อมูลการจองอย่างน้อย 1 โต๊ะ
                            </span>
                          )}

                          {isCrossZone && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-indigo-600 text-white">
                              ย้ายข้ามโซน: {sourceSeat.categoryName} → {targetSeat.categoryName}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Visual From -> To Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-11 gap-3 items-center">
                    {/* Source Preview Card */}
                    <div className="md:col-span-5 bg-white border-2 border-slate-300 rounded-xl p-3.5 space-y-1.5">
                      <p className="text-[11px] font-bold text-slate-400 uppercase">
                        โต๊ะต้นทาง (จาก)
                      </p>
                      {sourceSeat ? (
                        <>
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span
                                className="px-2.5 py-0.5 rounded-lg text-sm font-mono font-extrabold text-white"
                                style={{
                                  backgroundColor:
                                    categoryColorMap[sourceSeat.categoryId] || '#2563EB',
                                }}
                              >
                                {sourceSeat.tableNumber}
                              </span>
                              <span className="text-xs font-bold text-slate-600">
                                โซน {sourceSeat.categoryName}
                              </span>
                            </div>
                            <span className="text-xs font-mono font-bold text-slate-700">
                              {formatBaht(sourceSeat.transferAmount, sourceSeat.rawTransferAmount)}
                            </span>
                          </div>
                          <p className="text-sm font-bold text-slate-900 flex items-center gap-1.5 truncate">
                            <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            {sourceSeat.fullName || (
                              <span className="text-slate-400 font-normal italic">
                                โต๊ะว่าง
                              </span>
                            )}
                          </p>
                          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                            {sourceSeat.isPaid && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                                ชำระแล้ว
                              </span>
                            )}
                            {sourceSeat.isTicketCollected && (
                              <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[10px] font-bold bg-violet-100 text-violet-800">
                                <Ticket className="w-2.5 h-2.5" />
                                รับบัตรแล้ว
                              </span>
                            )}
                            {sourceSeat.isCheckedIn && (
                              <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[10px] font-bold bg-sky-100 text-sky-800">
                                <UserCheck className="w-2.5 h-2.5" />
                                เช็คอินแล้ว
                              </span>
                            )}
                            {sourceSeat.note && (
                              <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 max-w-full truncate">
                                <StickyNote className="w-2.5 h-2.5 shrink-0" />
                                {sourceSeat.note}
                              </span>
                            )}
                          </div>
                        </>
                      ) : (
                        <p className="text-xs text-slate-400 py-3">
                          ยังไม่ได้เลือกโต๊ะต้นทาง
                        </p>
                      )}
                    </div>

                    {/* Direction Arrow */}
                    <div className="md:col-span-1 flex items-center justify-center">
                      <div
                        className={`w-10 h-10 rounded-full flex items-center justify-center border-2 shadow-xs ${
                          isSwapMode
                            ? 'bg-amber-600 border-amber-700 text-white'
                            : 'bg-indigo-600 border-indigo-700 text-white'
                        }`}
                      >
                        {isSwapMode ? (
                          <ArrowRightLeft className="w-5 h-5" />
                        ) : (
                          <ArrowRight className="w-5 h-5" />
                        )}
                      </div>
                    </div>

                    {/* Target Preview Card */}
                    <div className="md:col-span-5 bg-white border-2 border-slate-300 rounded-xl p-3.5 space-y-1.5">
                      <p className="text-[11px] font-bold text-slate-400 uppercase">
                        โต๊ะปลายทาง (ไปยัง)
                      </p>
                      {targetSeat ? (
                        <>
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span
                                className="px-2.5 py-0.5 rounded-lg text-sm font-mono font-extrabold text-white"
                                style={{
                                  backgroundColor:
                                    categoryColorMap[targetSeat.categoryId] || '#2563EB',
                                }}
                              >
                                {targetSeat.tableNumber}
                              </span>
                              <span className="text-xs font-bold text-slate-600">
                                โซน {targetSeat.categoryName}
                              </span>
                            </div>
                            {targetSeat.isBooked ? (
                              <span className="text-xs font-mono font-bold text-slate-700">
                                {formatBaht(
                                  targetSeat.transferAmount,
                                  targetSeat.rawTransferAmount
                                )}
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                                ว่างพร้อมรับย้าย
                              </span>
                            )}
                          </div>
                          <p className="text-sm font-bold text-slate-900 flex items-center gap-1.5 truncate">
                            <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            {targetSeat.fullName || (
                              <span className="text-emerald-700 font-semibold">
                                โต๊ะว่าง — จะรับข้อมูลจากโต๊ะ {sourceSeat?.tableNumber || '...'}
                              </span>
                            )}
                          </p>
                          {targetSeat.isBooked && (
                            <p className="text-[11px] text-amber-800 font-medium">
                              ผู้จองโต๊ะนี้จะถูกสลับไปอยู่ที่โต๊ะ {sourceSeat?.tableNumber || '...'} โดยข้อมูลครบถ้วน
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="text-xs text-slate-400 py-3">
                          กรุณาคลิกเลือกโต๊ะปลายทางจากรายการด้านบน
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Option: Append transfer trail to Note */}
                  <label className="flex items-center gap-2.5 pt-1 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={appendTransferNote}
                      onChange={(e) => setAppendTransferNote(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                    <span className="text-xs font-semibold text-slate-700">
                      บันทึกประวัติการย้ายลงในช่องหมายเหตุ (Note) อัตโนมัติ (เช่น{' '}
                      <span className="font-mono text-indigo-700">
                        {isSwapMode
                          ? `[สลับจาก ${sourceSeat?.tableNumber || 'A01'}]`
                          : `[ย้ายจาก ${sourceSeat?.tableNumber || 'A01'}]`}
                      </span>
                      )
                    </span>
                  </label>
                </div>
              </>
            )}
          </div>

          {/* Modal Footer */}
          <div className="px-5 sm:px-6 py-4 bg-slate-50 border-t-2 border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
            <span className="text-xs text-slate-500">
              ข้อมูลทุกอย่างรวมถึงสลิปที่ 1 &amp; 2 และสถานะเช็คอิน/รับบัตรจะถูกย้ายตามไปด้วย
            </span>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 border-2 border-slate-300 rounded-xl transition-colors cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={!canConfirm}
                className={`inline-flex items-center gap-2 px-5 py-2.5 text-xs sm:text-sm font-extrabold text-white rounded-xl shadow-xs transition-all cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                  isSwapMode
                    ? 'bg-amber-600 hover:bg-amber-700'
                    : 'bg-indigo-600 hover:bg-indigo-700'
                }`}
              >
                <ArrowRightLeft className="w-4 h-4" />
                {isSwapMode
                  ? `ยืนยันสลับโต๊ะ ${sourceSeat?.tableNumber} ↔ ${targetSeat?.tableNumber}`
                  : sourceSeat && targetSeat
                    ? `ยืนยันย้ายโต๊ะ ${sourceSeat.tableNumber} → ${targetSeat.tableNumber}`
                    : 'ยืนยันย้ายโต๊ะ'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
