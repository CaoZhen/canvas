import { ImageElement, Rect } from '../types';

export const cropImageFromElement = (
    element: ImageElement,
    cropRect: Rect
): Promise<{ url: string; width: number; height: number }> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                reject(new Error('Failed to get canvas context'));
                return;
            }

            // Calculate ratios
            // element.width is the current logical width on canvas
            // img.naturalWidth is the real image width
            const scaleX = img.naturalWidth / element.width;
            const scaleY = img.naturalHeight / element.height;

            const realX = (cropRect.x - element.x) * scaleX;
            const realY = (cropRect.y - element.y) * scaleY;
            const realW = cropRect.width * scaleX;
            const realH = cropRect.height * scaleY;

            canvas.width = realW;
            canvas.height = realH;

            // Enforce minimum dimension (e.g. for AI models requiring >= 384px)
            const MIN_DIM = 512;
            if (realW < MIN_DIM || realH < MIN_DIM) {
                const scale = Math.max(MIN_DIM / realW, MIN_DIM / realH);
                canvas.width = realW * scale;
                canvas.height = realH * scale;
            }

            // Draw
            ctx.drawImage(img, realX, realY, realW, realH, 0, 0, canvas.width, canvas.height);
            resolve({
                url: canvas.toDataURL(element.mimeType || 'image/png'),
                width: canvas.width,
                height: canvas.height
            });
        };
        img.onerror = (e) => reject(e);
        img.src = element.href;
    });
};
