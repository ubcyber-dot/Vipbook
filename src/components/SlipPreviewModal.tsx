import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  ZoomIn,
  ZoomOut,
  RotateCw,
  RotateCcw,
  ExternalLink,
  Download,
  CheckCircle2,
  XCircle,
  Image as ImageIcon,
  Upload,
  AlertCircle,
  Eye,
} from 'lucide-react';
import { compressImageFileToDataUrl, sanitizeSafeUrl } from '../utils/media';

export interface SlipPreviewData {
  slipUrl: string;
  title: string;
  subtitle?: string;
  badgeText?: string;
  accentColor?: string;
  amountText?: string;
  dateText?: string;
  isPaid?: boolean;
  onTogglePaid?: () => void;
  onReplaceSlipUrl?: (newSlipDataUrl: string) => void;
}

interface SlipPreviewModalProps {
  preview: SlipPreviewData | null;
  onClose: () => void;
}

/**
 * Extract Google Drive file ID if the URL is from drive.google.com / docs.google.com
 */
export function extractGoogleDriveFileId(rawUrl: string): string | null {
  if (!rawUrl) return null;
  const trimmed = rawUrl.trim();
  if (!/drive\.google\.com|docs\.google\.com/i.test(trimmed)) {
    return null;
  }

  // Pattern 1: /file/d/{FILE_ID} or /d/{FILE_ID}
  const pathMatch = trimmed.match(/\/(?:file\/)?d\/([a-zA-Z0-9_-]{10,})/);
  if (pathMatch?.[1]) {
    return pathMatch[1];
  }

  // Pattern 2: ?id={FILE_ID} or &id={FILE_ID}
  try {
    const urlObj = new URL(trimmed);
    const idParam = urlObj.searchParams.get('id');
    if (idParam && /^[a-zA-Z0-9_-]{10,}$/.test(idParam)) {
      return idParam;
    }
  } catch {
    const queryMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
    if (queryMatch?.[1]) {
      return queryMatch[1];
    }
  }

  return null;
}

/**
 * Resolve candidate image URLs so Google Drive links and direct image links render inside <img>
 */
export function resolveSlipImageCandidates(rawUrl: string): {
  primaryImgUrl: string;
  fallbackImgUrl: string | null;
  drivePreviewEmbedUrl: string | null;
  driveFileId: string | null;
} {
  const cleaned = (rawUrl || '').trim();
  const driveFileId = extractGoogleDriveFileId(cleaned);

  if (driveFileId) {
    return {
      primaryImgUrl: `https://lh3.googleusercontent.com/d/${driveFileId}=w1600`,
      fallbackImgUrl: `https://drive.google.com/thumbnail?id=${driveFileId}&sz=w1600`,
      drivePreviewEmbedUrl: `https://drive.google.com/file/d/${driveFileId}/preview`,
      driveFileId,
    };
  }

  return {
    primaryImgUrl: cleaned,
    fallbackImgUrl: null,
    drivePreviewEmbedUrl: null,
    driveFileId: null,
  };
}

export const SlipPreviewModal: React.FC<SlipPreviewModalProps> = ({
  preview,
  onClose,
}) => {
  const [zoom, setZoom] = useState<number>(1);
  const [rotation, setRotation] = useState<number>(0);
  const [imgStage, setImgStage] = useState<'primary' | 'fallback' | 'iframe' | 'error'>('primary');

  const safeSlipUrl = useMemo(
    () => sanitizeSafeUrl(preview?.slipUrl || ''),
    [preview?.slipUrl]
  );

  const candidates = useMemo(
    () => resolveSlipImageCandidates(safeSlipUrl),
    [safeSlipUrl]
  );

  useEffect(() => {
    setZoom(1);
    setRotation(0);
    setImgStage('primary');
  }, [safeSlipUrl]);

  useEffect(() => {
    if (!preview) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [preview, onClose]);

  if (!preview || !safeSlipUrl) return null;

  const accentColor = preview.accentColor || '#1E293B';
  const currentImgSrc =
    imgStage === 'fallback' && candidates.fallbackImgUrl
      ? candidates.fallbackImgUrl
      : candidates.primaryImgUrl;

  const handleImageError = () => {
    if (imgStage === 'primary' && candidates.fallbackImgUrl) {
      setImgStage('fallback');
    } else if (candidates.drivePreviewEmbedUrl) {
      setImgStage('iframe');
    } else {
      setImgStage('error');
    }
  };

  const handleUploadReplacement = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !preview.onReplaceSlipUrl) return;
    try {
      const dataUrl = await compressImageFileToDataUrl(file);
      preview.onReplaceSlipUrl(dataUrl);
    } catch (err) {
      console.error('Failed to process replacement slip image:', err);
    } finally {
      e.target.value = '';
    }
  };

  const isDataUrl = safeSlipUrl.startsWith('data:image/');

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-xs overflow-y-auto"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        className="w-full max-w-3xl rounded-3xl shadow-2xl border-2 border-white/30 overflow-hidden my-auto flex flex-col max-h-[92vh]"
        style={{ backgroundColor: accentColor }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header */}
        <div className="px-5 sm:px-6 py-4 bg-black/20 border-b border-white/20 flex flex-wrap items-center justify-between gap-3 text-white">
          <div className="flex flex-wrap items-center gap-3 min-w-0">
            {preview.badgeText && (
              <span className="px-3 py-1 rounded-lg text-xs font-extrabold uppercase tracking-wider bg-white text-slate-900 shadow-2xs shrink-0">
                {preview.badgeText}
              </span>
            )}
            <div className="min-w-0">
              <h3 className="text-base sm:text-lg font-extrabold tracking-tight text-white truncate flex items-center gap-2">
                <ImageIcon className="w-4 h-4 shrink-0" />
                {preview.title}
              </h3>
              {preview.subtitle && (
                <p className="text-xs text-white/85 truncate">{preview.subtitle}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {typeof preview.isPaid === 'boolean' && (
              <button
                type="button"
                onClick={preview.onTogglePaid}
                disabled={!preview.onTogglePaid}
                title={
                  preview.onTogglePaid
                    ? 'คลิกเพื่อสลับสถานะการชำระเงินทันที'
                    : undefined
                }
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold border-2 border-white shadow-xs transition-colors ${
                  preview.isPaid
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    : 'bg-red-600 hover:bg-red-700 text-white'
                } ${preview.onTogglePaid ? 'cursor-pointer' : 'cursor-default'}`}
              >
                {preview.isPaid ? (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    ชำระแล้ว
                  </>
                ) : (
                  <>
                    <XCircle className="w-4 h-4" />
                    ยังไม่ชำระ (คลิกยืนยัน)
                  </>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              aria-label="ปิดหน้าต่างดูสลิป"
              className="p-2 text-white/90 hover:text-white bg-white/15 hover:bg-white/25 rounded-xl transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Summary Bar + Zoom/Rotate Controls */}
        <div className="px-5 sm:px-6 py-2.5 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-700">
          <div className="flex flex-wrap items-center gap-3">
            {preview.amountText && (
              <span className="font-bold text-slate-900">
                ยอดเงิน:{' '}
                <span
                  className="font-mono text-sm font-extrabold"
                  style={{ color: accentColor }}
                >
                  {preview.amountText}
                </span>
              </span>
            )}
            {preview.dateText && (
              <span className="text-slate-500 font-mono">
                วันที่/เวลา: <strong className="text-slate-800">{preview.dateText}</strong>
              </span>
            )}
          </div>

          {/* Image Manipulation Controls */}
          <div className="flex flex-wrap items-center gap-1.5">
            {imgStage !== 'iframe' && imgStage !== 'error' && (
              <>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
                  title="ย่อรูป"
                  className="p-1.5 text-slate-700 hover:bg-slate-100 border border-slate-200 rounded-lg cursor-pointer"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <span className="px-2 font-mono font-bold text-slate-700 min-w-[48px] text-center">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(3, Number((z + 0.25).toFixed(2))))}
                  title="ขยายรูป"
                  className="p-1.5 text-slate-700 hover:bg-slate-100 border border-slate-200 rounded-lg cursor-pointer"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setRotation((r) => (r + 90) % 360)}
                  title="หมุนรูป 90 องศา"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-slate-700 hover:bg-slate-100 border border-slate-200 rounded-lg font-semibold cursor-pointer"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  หมุนรูป
                </button>
                {(zoom !== 1 || rotation !== 0) && (
                  <button
                    type="button"
                    onClick={() => {
                      setZoom(1);
                      setRotation(0);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-slate-600 hover:bg-slate-100 border border-slate-200 rounded-lg cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    รีเซ็ต
                  </button>
                )}
              </>
            )}

            {candidates.drivePreviewEmbedUrl && (
              <button
                type="button"
                onClick={() =>
                  setImgStage((prev) => (prev === 'iframe' ? 'primary' : 'iframe'))
                }
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg font-semibold cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5" />
                {imgStage === 'iframe' ? 'สลับเป็นโหมดรูปภาพ' : 'สลับโหมด Google Drive'}
              </button>
            )}
          </div>
        </div>

        {/* Main Image Viewport */}
        <div className="flex-1 bg-slate-900/95 overflow-auto flex items-center justify-center p-4 sm:p-6 min-h-[340px] max-h-[65vh]">
          {imgStage === 'iframe' && candidates.drivePreviewEmbedUrl ? (
            <iframe
              src={candidates.drivePreviewEmbedUrl}
              title={preview.title}
              className="w-full h-[55vh] rounded-xl bg-white border border-slate-700"
              allow="autoplay"
            />
          ) : imgStage === 'error' ? (
            <div className="bg-white text-slate-900 rounded-2xl p-6 sm:p-8 max-w-md w-full text-center space-y-4 shadow-lg">
              <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mx-auto">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h4 className="text-base font-bold text-slate-900">
                  ไม่สามารถแสดงตัวอย่างรูปสลิปโดยตรงได้
                </h4>
                <p className="text-xs text-slate-500 break-all">
                  ลิงก์อาจตั้งค่าความเป็นส่วนตัวไว้ หรือไม่ใช่ไฟล์รูปภาพโดยตรง คุณสามารถกดปุ่มด้านล่างเพื่อเปิดดูลิงก์ต้นฉบับ หรือแนบรูปสลิปใหม่ได้ทันที
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                {!isDataUrl && (
                  <a
                    href={safeSlipUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold text-white rounded-xl shadow-xs hover:opacity-90"
                    style={{ backgroundColor: accentColor }}
                  >
                    <ExternalLink className="w-4 h-4" />
                    เปิดลิงก์สลิปในแท็บใหม่
                  </a>
                )}
                {preview.onReplaceSlipUrl && (
                  <label className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-xl cursor-pointer">
                    <Upload className="w-4 h-4" />
                    อัปโหลดรูปสลิปใหม่
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleUploadReplacement}
                      className="hidden"
                    />
                  </label>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center overflow-auto max-w-full max-h-full">
              <img
                src={currentImgSrc}
                alt={preview.title}
                onError={handleImageError}
                style={{
                  transform: `scale(${zoom}) rotate(${rotation}deg)`,
                  transformOrigin: 'center center',
                }}
                className="max-h-[58vh] w-auto object-contain rounded-xl shadow-2xl border border-white/15 transition-transform duration-150 bg-white"
              />
            </div>
          )}
        </div>

        {/* Popup Footer */}
        <div className="px-5 sm:px-6 py-3.5 bg-black/20 border-t border-white/20 flex flex-wrap items-center justify-between gap-3 text-white">
          <div className="flex flex-wrap items-center gap-2">
            {preview.onReplaceSlipUrl && (
              <label className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-white/15 hover:bg-white/25 border border-white/25 rounded-xl cursor-pointer transition-colors">
                <Upload className="w-3.5 h-3.5" />
                เปลี่ยน/อัปโหลดรูปสลิปใหม่
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleUploadReplacement}
                  className="hidden"
                />
              </label>
            )}

            {isDataUrl ? (
              <a
                href={safeSlipUrl}
                download={`slip-${preview.title.replace(/\s+/g, '_')}.jpg`}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-white/15 hover:bg-white/25 border border-white/25 rounded-xl transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                ดาวน์โหลดรูปสลิป
              </a>
            ) : (
              <a
                href={safeSlipUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-white/15 hover:bg-white/25 border border-white/25 rounded-xl transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                เปิดลิงก์ต้นฉบับ
              </a>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 text-xs font-bold text-slate-900 bg-white hover:bg-slate-100 rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            ปิดหน้าต่างดูสลิป
          </button>
        </div>
      </div>
    </div>
  );
};
