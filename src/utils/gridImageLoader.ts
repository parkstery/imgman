/**
 * 그리드 이미지 로더 — 파일을 캔버스에 넣을 수 있는 이미지 데이터로 변환한다.
 * (데이터 URL + 원본 픽셀 크기)
 */

/** 이미지 파일로 볼 수 있는 확장자 / MIME 타입 */
export function isImageFile(file: File): boolean {
  return (
    file.type.startsWith('image/') ||
    /\.(png|jpe?g|webp|gif|svg|bmp|ico|avif)$/i.test(file.name)
  );
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('파일 읽기 실패'));
    reader.readAsDataURL(file);
  });
}

export function loadNaturalSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () =>
      resolve({
        width: img.naturalWidth || img.width || 1,
        height: img.naturalHeight || img.height || 1,
      });
    img.onerror = () => reject(new Error('이미지 해석 실패'));
    img.src = src;
  });
}

export interface LoadedGridImage {
  id: string;
  name: string;
  src: string;
  naturalWidth: number;
  naturalHeight: number;
}

let imageSeq = 0;

/** 파일 → 데이터 URL + 원본 크기를 가진 이미지 설명 */
export async function readImageFile(file: File): Promise<LoadedGridImage> {
  const src = await readFileAsDataUrl(file);
  const size = await loadNaturalSize(src);
  imageSeq += 1;
  return {
    id: `gridimg-${Date.now()}-${imageSeq}`,
    name: file.name || '이미지',
    src,
    naturalWidth: size.width,
    naturalHeight: size.height,
  };
}

/** 여러 파일을 순서대로 읽어 이미지 목록으로 만든다 (실패한 파일은 건너뛴다). */
export async function readImageFiles(files: File[]): Promise<LoadedGridImage[]> {
  const loaded: LoadedGridImage[] = [];
  for (const file of files.filter(isImageFile)) {
    try {
      loaded.push(await readImageFile(file));
    } catch {
      /* 개별 파일 실패는 건너뛴다 */
    }
  }
  return loaded;
}
