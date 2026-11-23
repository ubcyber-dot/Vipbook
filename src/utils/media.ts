/**
 * Media & URL safety helpers:
 * - Compresses uploaded slip/receipt images client-side so localStorage doesn't overflow
 *   and Google Drive JSON backups stay fast and lightweight.
 * - Validates URLs to prevent unsafe schemes (e.g., javascript:, vbscript:).
 */

export function sanitizeSafeUrl(rawUrl: string): string {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return '';

  // Allow safe data:image/* URIs for uploaded slips/receipts
  if (/^data:image\/(png|jpeg|jpg|webp|gif|bmp|avif);base64,/i.test(trimmed)) {
    return trimmed;
  }

  // Allow http:// and https:// URLs only
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch {
    // Handle bare Google Drive links without protocol
    if (/^(drive\.google\.com|docs\.google\.com|lh3\.googleusercontent\.com)\//i.test(trimmed)) {
      return `https://${trimmed}`;
    }
  }

  return '';
}

export function isSafeDisplayUrl(rawUrl: string): boolean {
  return Boolean(sanitizeSafeUrl(rawUrl));
}

/**
 * Compresses an uploaded image File into a compact JPEG/WebP data URL.
 * Falls back to raw FileReader data URL if canvas compression fails.
 */
export function compressImageFileToDataUrl(
  file: File,
  maxDimension = 1280,
  quality = 0.8
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์รูปภาพได้'));
    reader.onload = () => {
      const rawDataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!rawDataUrl) {
        reject(new Error('ข้อมูลรูปภาพไม่ถูกต้อง'));
        return;
      }

      // If image is already small (< 180 KB), keep as-is
      if (file.size <= 180 * 1024) {
        resolve(rawDataUrl);
        return;
      }

      const img = new Image();
      img.onerror = () => resolve(rawDataUrl);
      img.onload = () => {
        try {
          let { width, height } = img;
          if (width > maxDimension || height > maxDimension) {
            const scale = Math.min(maxDimension / width, maxDimension / height);
            width = Math.max(1, Math.round(width * scale));
            height = Math.max(1, Math.round(height * scale));
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(rawDataUrl);
            return;
          }
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);

          const compressed = canvas.toDataURL('image/jpeg', quality);
          // Only use compressed output if it is actually smaller than original
          resolve(compressed.length < rawDataUrl.length ? compressed : rawDataUrl);
        } catch {
          resolve(rawDataUrl);
        }
      };
      img.src = rawDataUrl;
    };
    reader.readAsDataURL(file);
  });
}
