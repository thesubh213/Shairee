/**
 * Shairee — Formatters for file sizes, speeds, durations
 */

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const idx = Math.min(i, SIZE_UNITS.length - 1);
  const val = bytes / Math.pow(1024, idx);
  return `${val < 10 ? val.toFixed(2) : val < 100 ? val.toFixed(1) : val.toFixed(0)} ${SIZE_UNITS[idx]}`;
}

export function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond <= 0) return '—';
  if (bytesPerSecond < 1024) return `${bytesPerSecond.toFixed(0)} B/s`;
  if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  if (bytesPerSecond < 1024 * 1024 * 1024) return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
  return `${(bytesPerSecond / (1024 * 1024 * 1024)).toFixed(2)} GB/s`;
}

export function formatETA(remainingBytes: number, speedBps: number): string {
  if (speedBps <= 0) return '∞';
  const seconds = Math.ceil(remainingBytes / speedBps);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export function formatTimestamp(ts: string | number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();

  if (diffMs < 60_000) return 'Just now';
  if (diffMs < 3600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86400_000) return `${Math.floor(diffMs / 3600_000)}h ago`;

  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function formatPercent(current: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((current / total) * 100));
}

export function getFileIcon(fileName: string, mimeType?: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';

  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'ico', 'tiff'];
  const videoExts = ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v'];
  const audioExts = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a', 'opus'];
  const archiveExts = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'];
  const docExts = ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt'];
  const codeExts = ['js', 'ts', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'html', 'css', 'json', 'xml', 'yaml', 'toml'];
  const sheetExts = ['xls', 'xlsx', 'csv', 'ods'];
  const slideExts = ['ppt', 'pptx', 'odp'];
  const apkExts = ['apk', 'xapk', 'aab'];

  if (mimeType?.startsWith('image/') || imageExts.includes(ext)) return '📷';
  if (mimeType?.startsWith('video/') || videoExts.includes(ext)) return '🎬';
  if (mimeType?.startsWith('audio/') || audioExts.includes(ext)) return '🎵';
  if (archiveExts.includes(ext)) return '📦';
  if (docExts.includes(ext)) return '📝';
  if (codeExts.includes(ext)) return '💻';
  if (sheetExts.includes(ext)) return '📊';
  if (slideExts.includes(ext)) return '📽️';
  if (apkExts.includes(ext)) return '📱';
  if (ext === 'exe' || ext === 'msi') return '⚙️';
  if (ext === 'iso' || ext === 'img') return '💿';

  return '📄';
}

export function getExtension(fileName: string): string {
  const parts = fileName.split('.');
  if (parts.length < 2) return '';
  return parts.pop()?.toUpperCase() ?? '';
}

export function truncateFilename(name: string, maxLen: number = 32): string {
  if (name.length <= maxLen) return name;
  const ext = name.split('.').pop() ?? '';
  const base = name.slice(0, name.length - ext.length - 1);
  const keep = maxLen - ext.length - 4; // 4 = "…." + ext dot
  if (keep < 4) return name.slice(0, maxLen - 1) + '…';
  return base.slice(0, keep) + '….' + ext;
}
