import React, { useState, useMemo, useEffect } from 'react';
import {
  Search,
  X,
  RefreshCw,
  AlertCircle,
  Layers,
  CheckCircle2,
  XCircle,
  Maximize2,
  Plus,
} from 'lucide-react';
import { CategoryConfig, SeatRecord } from '../types/booking';
import { BookingCard } from './BookingCard';
import { formatPercent } from './DashboardView';
import { SeatDetailModal } from './SeatDetailModal';
import { AddTableModal } from './AddTableModal';

interface LookupViewProps {
  records: SeatRecord[];
  categories: CategoryConfig[];
  isLoading: boolean;
  onRefresh: () => void;
  lastSyncedAt: string | null;
  onUpdateRecord?: (updated: SeatRecord) => void;
  onDeleteRecord?: (recordId: string) => void;
  onAddRecord?: (categoryId: string, record: SeatRecord) => void;
  onAddMultipleRecords?: (categoryId: string, records: SeatRecord[]) => void;
}

function normalizeQuery(input: string): string {
  return String(input || '')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase();
}

function compactQuery(input: string): string {
  return String(input || '')
    .trim()
    .replace(/[\s\-_]+/g, '')
    .toUpperCase();
}

export const LookupView: React.FC<LookupViewProps> = ({
  records,
  categories,
  isLoading,
  onRefresh,
  lastSyncedAt,
  onUpdateRecord,
  onDeleteRecord,
  onAddRecord,
  onAddMultipleRecords,
}) => {
  const [inputValue, setInputValue] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [popupRecordIds, setPopupRecordIds] = useState<string[]>([]);
  const [popupNotFoundQuery, setPopupNotFoundQuery] = useState<string | null>(null);

  // Add Table Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [addModalCategoryId, setAddModalCategoryId] = useState<string | undefined>(
    undefined
  );
  const [addModalPrefillTableNo, setAddModalPrefillTableNo] = useState<string>('');

  const popupRecords = useMemo(
    () =>
      popupRecordIds
        .map((id) => records.find((r) => r.id === id))
        .filter((r): r is SeatRecord => Boolean(r)),
    [popupRecordIds, records]
  );

  const categoryColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of categories) {
      map[c.id] = c.colorHex;
    }
    return map;
  }, [categories]);

  // Active query responds immediately to typing AND explicit Enter submission
  const activeQuery = inputValue.trim() || submittedQuery.trim();

  const searchResult = useMemo(() => {
    const qNorm = normalizeQuery(activeQuery);
    const qCompact = compactQuery(activeQuery);

    if (!qNorm) {
      return { exactMatches: [] as SeatRecord[], partialMatches: [] as SeatRecord[] };
    }

    // 1. Primary exact match on normalized table number
    const exactMatches = records.filter(
      (r) =>
        r.normalizedTableNumber === qNorm ||
        (qCompact.length >= 2 && r.compactTableNumber === qCompact)
    );

    // 2. Secondary matches
    const exactIds = new Set(exactMatches.map((r) => r.id));
    const partialMatches = records.filter(
      (r) =>
        !exactIds.has(r.id) &&
        (r.normalizedTableNumber.includes(qNorm) ||
          (qCompact.length >= 2 && r.compactTableNumber.includes(qCompact)))
    );

    return { exactMatches, partialMatches };
  }, [records, activeQuery]);

  // Automatically open popup when user finishes typing an exact table number
  useEffect(() => {
    if (!activeQuery.trim()) {
      setPopupRecordIds([]);
      setPopupNotFoundQuery(null);
      return;
    }

    if (searchResult.exactMatches.length > 0) {
      const timer = window.setTimeout(() => {
        setPopupRecordIds(searchResult.exactMatches.map((r) => r.id));
        setPopupNotFoundQuery(null);
      }, 350);
      return () => window.clearTimeout(timer);
    }
  }, [activeQuery, searchResult.exactMatches]);

  const handleOpenAddModal = (categoryId?: string, prefillTableNo = '') => {
    let resolvedCatId = categoryId;
    if (!resolvedCatId && prefillTableNo) {
      const upper = prefillTableNo.toUpperCase();
      const matchedCat = categories.find(
        (c) =>
          upper.startsWith(c.name.toUpperCase()) ||
          upper.startsWith(c.id.toUpperCase())
      );
      if (matchedCat) {
        resolvedCatId = matchedCat.id;
      }
    }
    setAddModalCategoryId(resolvedCatId || categories[0]?.id);
    setAddModalPrefillTableNo(prefillTableNo);
    setIsAddModalOpen(true);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputValue.trim();
    setSubmittedQuery(trimmed);
    if (!trimmed) return;

    if (searchResult.exactMatches.length > 0) {
      setPopupRecordIds(searchResult.exactMatches.map((r) => r.id));
      setPopupNotFoundQuery(null);
    } else if (searchResult.partialMatches.length === 1) {
      setPopupRecordIds([searchResult.partialMatches[0].id]);
      setPopupNotFoundQuery(null);
    } else if (searchResult.partialMatches.length === 0) {
      setPopupRecordIds([]);
      setPopupNotFoundQuery(trimmed);
    }
  };

  const handleClear = () => {
    setInputValue('');
    setSubmittedQuery('');
    setPopupRecordIds([]);
    setPopupNotFoundQuery(null);
  };

  const handleQuickSelectTable = (tableNumber: string) => {
    setInputValue(tableNumber);
    setSubmittedQuery(tableNumber);
    const qNorm = normalizeQuery(tableNumber);
    const qCompact = compactQuery(tableNumber);
    const matched = records.filter(
      (r) =>
        r.normalizedTableNumber === qNorm ||
        (qCompact.length >= 2 && r.compactTableNumber === qCompact)
    );
    if (matched.length > 0) {
      setPopupRecordIds(matched.map((r) => r.id));
      setPopupNotFoundQuery(null);
    }
  };

  // Sample real table numbers from each category for instant one-click testing
  const quickSampleTables = useMemo(() => {
    const samples: Array<{ tableNumber: string; categoryName: string; colorHex: string }> = [];
    for (const cat of categories) {
      const catRecords = records.filter((r) => r.categoryId === cat.id && r.isBooked);
      const source =
        catRecords.length > 0 ? catRecords : records.filter((r) => r.categoryId === cat.id);
      for (const item of source.slice(0, 4)) {
        samples.push({
          tableNumber: item.tableNumber,
          categoryName: cat.name,
          colorHex: cat.colorHex,
        });
      }
    }
    return samples.slice(0, 10);
  }, [records, categories]);

  const hasDuplicateAcrossCategories = useMemo(() => {
    if (searchResult.exactMatches.length <= 1) return false;
    const uniqueCats = new Set(searchResult.exactMatches.map((r) => r.categoryId));
    return uniqueCats.size > 1;
  }, [searchResult.exactMatches]);

  return (
    <div className="space-y-8">
      {/* Hero Prominent Single Search Box */}
      <section className="bg-white border-[3px] border-slate-300 rounded-2xl p-6 sm:p-8 shadow-xs">
        <div className="max-w-3xl mx-auto space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
                ค้นหาข้อมูลการจองโต๊ะ
              </h1>
              <p className="text-sm text-slate-500 mt-1">
                กรอกเลขโต๊ะเพื่อแสดงป๊อปอัปข้อมูลการจองแยกตามสีโซน{' '}
                {categories.map((c) => c.name).join(' และ ')} ทันที
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              {lastSyncedAt && (
                <span className="font-mono tabular-nums">
                  อัปเดตล่าสุด: {new Date(lastSyncedAt).toLocaleTimeString('th-TH')}
                </span>
              )}
              {onAddRecord && (
                <button
                  type="button"
                  onClick={() => handleOpenAddModal()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-2xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  เพิ่มโต๊ะใหม่
                </button>
              )}
              <button
                type="button"
                onClick={onRefresh}
                disabled={isLoading}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                รีเฟรชข้อมูล
              </button>
            </div>
          </div>

          {/* Single Prominent Search Input */}
          <form onSubmit={handleFormSubmit} className="relative">
            <div className="relative flex items-center">
              <Search className="w-6 h-6 text-slate-400 absolute left-5 pointer-events-none" />
              <input
                type="text"
                value={inputValue}
                onChange={(e) => {
                  setInputValue(e.target.value);
                  setSubmittedQuery(e.target.value);
                  setPopupNotFoundQuery(null);
                }}
                placeholder="พิมพ์เลขโต๊ะ เช่น A01, VIP-01, 15 แล้วกด Enter เพื่อเปิด Popup..."
                autoFocus
                className="w-full pl-14 pr-36 py-4 sm:py-5 text-lg sm:text-xl font-mono tabular-nums font-semibold text-slate-900 bg-slate-50 border-[3px] border-slate-400 rounded-xl focus:bg-white focus:border-slate-900 focus:outline-none transition-colors placeholder:font-sans placeholder:font-normal placeholder:text-slate-400"
              />
              {inputValue && (
                <button
                  type="button"
                  onClick={handleClear}
                  aria-label="ล้างคำค้นหา"
                  className="absolute right-28 p-2 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
              <button
                type="submit"
                className="absolute right-2.5 px-5 py-3 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                ค้นหา
              </button>
            </div>
          </form>

          {/* Quick Sample Table Selector from Real Sheet Data */}
          {quickSampleTables.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-xs text-slate-400">คลิกเลขโต๊ะเพื่อดูป๊อปอัป:</span>
              {quickSampleTables.map((item, idx) => (
                <button
                  key={`${item.categoryName}-${item.tableNumber}-${idx}`}
                  type="button"
                  onClick={() => handleQuickSelectTable(item.tableNumber)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono tabular-nums font-semibold text-white rounded-md transition-opacity hover:opacity-90 whitespace-nowrap shrink-0 cursor-pointer shadow-2xs"
                  style={{ backgroundColor: item.colorHex }}
                >
                  <span>{item.tableNumber}</span>
                  <span className="text-[11px] font-sans text-white/90">
                    ({item.categoryName})
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Loading Skeleton State */}
      {isLoading && (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="bg-white border border-slate-200 rounded-xl p-6 animate-pulse space-y-4"
            >
              <div className="h-6 bg-slate-200 rounded w-1/4" />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="h-20 bg-slate-100 rounded-lg" />
                <div className="h-20 bg-slate-100 rounded-lg" />
                <div className="h-20 bg-slate-100 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Search Results Area */}
      {!isLoading && activeQuery && (
        <section className="space-y-6">
          {/* Duplicate Table Notice when found across multiple sheets */}
          {hasDuplicateAcrossCategories && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3.5 flex items-center gap-3 text-sm text-amber-900">
              <Layers className="w-5 h-5 text-amber-600 shrink-0" />
              <div>
                <span className="font-semibold">
                  พบเลขโต๊ะ &ldquo;{activeQuery.trim().toUpperCase()}&rdquo; ซ้ำในหลายแผ่นงาน (
                  {searchResult.exactMatches.length} รายการ)
                </span>{' '}
                — แสดงผลทุกรายการพร้อมพื้นหลังแยกตามสีโซน
              </div>
            </div>
          )}

          {/* Exact Match Results */}
          {searchResult.exactMatches.length > 0 ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-base font-bold text-slate-900">
                  ผลการค้นหาเลขโต๊ะ &ldquo;{activeQuery.trim()}&rdquo; (
                  {searchResult.exactMatches.length} รายการ)
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    setPopupRecordIds(searchResult.exactMatches.map((r) => r.id));
                    setPopupNotFoundQuery(null);
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold text-white rounded-xl shadow-xs transition-opacity hover:opacity-90 cursor-pointer"
                  style={{
                    backgroundColor:
                      categoryColorMap[searchResult.exactMatches[0].categoryId] || '#0F172A',
                  }}
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                  แสดงป๊อปอัปข้อมูลโต๊ะ
                </button>
              </div>

              <div className="space-y-4">
                {searchResult.exactMatches.map((record) => (
                  <div
                    key={record.id}
                    onClick={() => {
                      setPopupRecordIds([record.id]);
                      setPopupNotFoundQuery(null);
                    }}
                    className="cursor-pointer transition-transform hover:scale-[1.005]"
                  >
                    <BookingCard
                      record={record}
                      categoryColor={categoryColorMap[record.categoryId] || '#2563EB'}
                      onUpdateRecord={onUpdateRecord}
                      onDeleteRecord={onDeleteRecord}
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* Not Found Message + Instant Add Table Button */
            <div className="bg-white border-[2.5px] border-slate-300 rounded-2xl p-10 text-center space-y-4 shadow-xs">
              <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center mx-auto">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-slate-900">ไม่พบข้อมูลการจอง</h3>
                <p className="text-sm text-slate-500 max-w-md mx-auto">
                  ไม่พบเลขโต๊ะที่ตรงกับ &ldquo;
                  <span className="font-mono font-semibold text-slate-800">
                    {activeQuery.trim()}
                  </span>
                  &rdquo; ในแผ่นงาน {categories.map((c) => c.name).join(' หรือ ')}
                </p>
              </div>
              {onAddRecord && (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => handleOpenAddModal(undefined, activeQuery.trim())}
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-xs sm:text-sm font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl shadow-xs transition-colors cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    เพิ่มโต๊ะ &ldquo;{activeQuery.trim().toUpperCase()}&rdquo; เข้าสู่ระบบทันที
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Partial / Similar Table Matches (if any) */}
          {searchResult.partialMatches.length > 0 && (
            <div className="space-y-4 pt-4 border-t border-slate-200">
              <h3 className="text-sm font-semibold text-slate-600">
                เลขโต๊ะที่ใกล้เคียง ({searchResult.partialMatches.length} รายการ — คลิกเพื่อเปิดป๊อปอัป)
              </h3>
              <div className="space-y-4">
                {searchResult.partialMatches.slice(0, 10).map((record) => (
                  <div
                    key={record.id}
                    onClick={() => {
                      setPopupRecordIds([record.id]);
                      setPopupNotFoundQuery(null);
                    }}
                    className="cursor-pointer transition-transform hover:scale-[1.005]"
                  >
                    <BookingCard
                      record={record}
                      categoryColor={categoryColorMap[record.categoryId] || '#2563EB'}
                      onUpdateRecord={onUpdateRecord}
                      onDeleteRecord={onDeleteRecord}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Default Overview Legend when search input is empty */}
      {!isLoading && !activeQuery && (
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {categories.map((cat) => {
            const catRecords = records.filter((r) => r.categoryId === cat.id);
            const bookedCount = catRecords.filter((r) => r.isBooked).length;
            const paidCount = catRecords.filter((r) => r.isPaid).length;
            const checkedInCount = catRecords.filter((r) => r.isCheckedIn).length;
            const ticketCollectedCount = catRecords.filter(
              (r) => r.isTicketCollected
            ).length;
            return (
              <div
                key={cat.id}
                className="rounded-2xl p-5 flex items-center justify-between text-white border-[3px] border-white/40 ring-2 ring-slate-900/15 shadow-md"
                style={{ backgroundColor: cat.colorHex }}
              >
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-md text-xs font-extrabold bg-white/20 border-2 border-white/40">
                      โซน {cat.name} ({formatPercent(catRecords.length, records.length)} ของทั้งหมด)
                    </span>
                    <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-violet-600/95 text-white border-2 border-white/40 font-mono tabular-nums">
                      รับบัตรแล้ว {ticketCollectedCount} / {catRecords.length} ({formatPercent(ticketCollectedCount, catRecords.length)})
                    </span>
                    <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-sky-500/90 text-white border-2 border-white/40 font-mono tabular-nums">
                      เช็คอินแล้ว {checkedInCount} / {catRecords.length} ({formatPercent(checkedInCount, catRecords.length)})
                    </span>
                    {onAddRecord && (
                      <button
                        type="button"
                        onClick={() => handleOpenAddModal(cat.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-bold bg-white text-slate-900 hover:bg-slate-100 border-2 border-white transition-colors cursor-pointer shadow-2xs"
                      >
                        <Plus className="w-3 h-3" />
                        เพิ่มโต๊ะโซนนี้
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-white/90 font-mono tabular-nums">
                    จองแล้ว {bookedCount} โต๊ะ ({formatPercent(bookedCount, catRecords.length)}) · ชำระแล้ว {paidCount} โต๊ะ ({formatPercent(paidCount, catRecords.length)})
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-3xl font-extrabold font-mono tabular-nums text-white block">
                    {catRecords.length}
                  </span>
                  <span className="text-[11px] font-mono font-bold text-white/85">
                    {formatPercent(catRecords.length, records.length)}
                  </span>
                </div>
              </div>
            );
          })}

          <div className="bg-white border-[2.5px] border-slate-300 rounded-2xl p-5 flex flex-col justify-center space-y-2 shadow-xs">
            <p className="text-xs font-semibold text-slate-500">
              สัญลักษณ์สถานะการชำระเงิน การรับบัตร &amp; การเช็คอิน
            </p>
            <div className="flex flex-wrap items-center gap-3 text-xs font-medium">
              <span className="inline-flex items-center gap-1.5 text-violet-700 font-bold">
                <CheckCircle2 className="w-4 h-4 text-violet-600" />
                สีม่วง = รับบัตรแล้ว
              </span>
              <span className="inline-flex items-center gap-1.5 text-sky-700 font-bold">
                <CheckCircle2 className="w-4 h-4 text-sky-600" />
                สีฟ้า = เช็คอินแล้ว
              </span>
              <span className="inline-flex items-center gap-1.5 text-emerald-700">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                สีเขียว = ชำระแล้ว
              </span>
              <span className="inline-flex items-center gap-1.5 text-red-600">
                <XCircle className="w-4 h-4 text-red-600" />
                สีแดง = ยังไม่ชำระ
              </span>
            </div>
          </div>
        </section>
      )}

      {/* Zone-Colored Popup Modal for Search Result */}
      <SeatDetailModal
        records={popupRecords}
        categoryColorMap={categoryColorMap}
        searchQuery={popupNotFoundQuery || activeQuery.trim()}
        showNotFound={Boolean(popupNotFoundQuery)}
        categoryNames={categories.map((c) => c.name)}
        onUpdateRecord={onUpdateRecord}
        onDeleteRecord={onDeleteRecord}
        onRequestAddTable={
          onAddRecord
            ? (prefillNo) => handleOpenAddModal(undefined, prefillNo || '')
            : undefined
        }
        onClose={() => {
          setPopupRecordIds([]);
          setPopupNotFoundQuery(null);
        }}
      />

      {/* Add Table Modal */}
      {onAddRecord && (
        <AddTableModal
          isOpen={isAddModalOpen}
          categories={categories}
          existingRecords={records}
          initialCategoryId={addModalCategoryId}
          initialTableNumber={addModalPrefillTableNo}
          onAddRecord={(catId, rec) => {
            onAddRecord(catId, rec);
            // Automatically display the newly created table in the search popup!
            setInputValue(rec.tableNumber);
            setSubmittedQuery(rec.tableNumber);
            setPopupRecordIds([rec.id]);
            setPopupNotFoundQuery(null);
          }}
          onAddMultipleRecords={onAddMultipleRecords}
          onClose={() => setIsAddModalOpen(false)}
        />
      )}
    </div>
  );
};
