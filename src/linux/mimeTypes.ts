const EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
};

export function mimeForExt(ext: string): string {
  return EXT_MIME[ext.toLowerCase()] ?? 'application/octet-stream';
}
