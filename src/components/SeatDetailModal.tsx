import React, { useEffect } from 'react';
import { X, Layers, AlertCircle, Plus } from 'lucide-react';
import { SeatRecord } from '../types/booking';
import { BookingCard } from './BookingCard';

interface SeatDetailModalProps {
  record?: SeatRecord | null;
  records?: SeatRecord[];
  categoryColor?: string;
  categoryColorMap?: Record<string, string>;
  searchQuery?: string;
  showNotFound?: boolean;
  categoryNames?: string[];
  onUpdateRecord?: (updated: SeatRecord) => void;
  onDeleteRecord?: (recordId: string) => void;
  onRequestAddTable?: (prefillTableNumber?: string) => void;
  defaultEditing?: boolean;
  onClose: () => void;
}

export const SeatDetailModal: React.FC<SeatDetailModalProps> = ({
  record,
  records,
  categoryColor = '#2563EB',
  categoryColorMap = {},
  searchQuery = '',
  showNotFound = false,
  categoryNames = [],
  onUpdateRecord,
  onDeleteRecord,
  onRequestAddTable,
  defaultEditing = false,
  onClose,
}) => {
  const activeRecords: SeatRecord[] =
    records && records.length > 0 ? records : record ? [record] : [];

  const isOpen = activeRecords.length > 0 || showNotFound;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const primaryRecord = activeRecords[0] || null;
  const primaryZoneColor = primaryRecord
    ? categoryColorMap[primaryRecord.categoryId] || categoryColor
    : '#1E293B';

  const hasMultipleZones =
    activeRecords.length > 1 &&
    new Set(activeRecords.map((r) => r.categoryId)).size > 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/65 backdrop-blur-xs overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl rounded-3xl shadow-2xl border-[3px] border-white/60 ring-4 ring-slate-950/30 overflow-hidden my-auto flex flex-col max-h-[90vh] transition-colors duration-200"
        style={{
          backgroundColor: primaryZoneColor,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Popup Header on Zone Color Background */}
        <div className="px-5 py-3.5 bg-black/15 border-b-2 border-white/30 flex items-center justify-between gap-3 text-white shrink-0">
          <div className="flex flex-wrap items-center gap-2.5 min-w-0">
            {primaryRecord ? (
              <>
                <span className="px-3 py-1 rounded-lg text-xs font-extrabold uppercase tracking-wider bg-white text-slate-900 shadow-xs shrink-0">
                  โซน {primaryRecord.categoryName}
                </span>
                <div className="min-w-0">
                  <h2 className="text-base sm:text-lg font-extrabold tracking-tight text-white truncate">
                    ข้อมูลการจองโต๊ะ {primaryRecord.tableNumber}
                    {activeRecords.length > 1 ? ` (พบ ${activeRecords.length} รายการ)` : ''}
                  </h2>
                  <p className="text-[11px] text-white/85 truncate">
                    แผ่นงาน {primaryRecord.sheetName} · แถวที่ {primaryRecord.rowNumber}
                  </p>
                </div>
              </>
            ) : (
              <div>
                <h2 className="text-base sm:text-lg font-bold text-white">
                  ผลการค้นหาเลขโต๊ะ &ldquo;{searchQuery}&rdquo;
                </h2>
                <p className="text-xs text-white/80">ไม่พบข้อมูลการจองในตาราง</p>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="ปิดหน้าต่าง"
            className="p-1.5 text-white/90 hover:text-white bg-white/15 hover:bg-white/25 border-2 border-white/30 rounded-xl transition-colors cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Popup Body on Zone Color Background */}
        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1">
          {hasMultipleZones && (
            <div className="bg-white/95 text-amber-950 rounded-xl px-4 py-2.5 flex items-center gap-2.5 text-xs sm:text-sm font-medium shadow-xs">
              <Layers className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                พบเลขโต๊ะ <strong>&ldquo;{searchQuery || primaryRecord?.tableNumber}&rdquo;</strong> ซ้ำในหลายโซน ({activeRecords.length} รายการ) แสดงพื้นหลังแยกตามสีโซนด้านล่าง
              </span>
            </div>
          )}

          {activeRecords.length > 0 ? (
            <div className="space-y-4">
              {activeRecords.map((item) => {
                const itemColor =
                  categoryColorMap[item.categoryId] || categoryColor || '#2563EB';
                const isSingle = activeRecords.length === 1;
                return (
                  <div
                    key={item.id}
                    className={
                      !isSingle
                        ? 'rounded-2xl ring-2 ring-white/40 shadow-md overflow-hidden'
                        : ''
                    }
                  >
                    <BookingCard
                      record={item}
                      categoryColor={itemColor}
                      onUpdateRecord={onUpdateRecord}
                      onDeleteRecord={
                        onDeleteRecord
                          ? (id) => {
                              onDeleteRecord(id);
                              if (activeRecords.length <= 1) onClose();
                            }
                          : undefined
                      }
                      defaultEditing={defaultEditing}
                      embedded={isSingle}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="bg-white rounded-2xl p-6 sm:p-8 text-center space-y-4 text-slate-900">
              <div className="w-12 h-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center mx-auto">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-lg font-bold text-slate-900">ไม่พบข้อมูลการจอง</h3>
                <p className="text-sm text-slate-500 max-w-md mx-auto">
                  ไม่พบเลขโต๊ะที่ตรงกับ &ldquo;
                  <span className="font-mono font-bold text-slate-800">{searchQuery}</span>
                  &rdquo;
                  {categoryNames.length > 0
                    ? ` ในโซน ${categoryNames.join(' หรือ ')}`
                    : ''}
                </p>
              </div>
              {onRequestAddTable && (
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      const targetNo = searchQuery.trim();
                      onClose();
                      onRequestAddTable(targetNo);
                    }}
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-xs sm:text-sm font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl shadow-xs transition-colors cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    เพิ่มโต๊ะ &ldquo;{searchQuery.trim()}&rdquo; เข้าสู่ระบบทันที
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Popup Footer on Zone Color Background */}
        <div className="px-5 py-3 bg-black/15 border-t-2 border-white/30 flex items-center justify-between gap-3 shrink-0">
          <span className="text-xs text-white/85">
            กดปุ่ม ESC หรือคลิกพื้นที่ด้านนอกเพื่อปิดหน้าต่าง
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-1.5 text-xs font-bold text-slate-900 bg-white hover:bg-slate-100 rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            ปิดหน้าต่าง
          </button>
        </div>
      </div>
    </div>
  );
};
