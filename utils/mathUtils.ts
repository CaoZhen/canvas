import { Point } from '../types';

export const rotatePoint = (point: Point, center: Point, angleDegrees: number): Point => {
    const angleRad = (angleDegrees * Math.PI) / 180;
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);
    const translatedX = point.x - center.x;
    const translatedY = point.y - center.y;
    const rotatedX = translatedX * cos - translatedY * sin;
    const rotatedY = translatedX * sin + translatedY * cos;
    return { x: rotatedX + center.x, y: rotatedY + center.y };
};

// Ray-casting algorithm to check if a point is inside a polygon
export const isPointInPolygon = (point: Point, polygon: Point[]): boolean => {
    let isInside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x, yi = polygon[i].y;
        const xj = polygon[j].x, yj = polygon[j].y;
        const intersect = ((yi > point.y) !== (yj > point.y)) &&
            (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
        if (intersect) isInside = !isInside;
    }
    return isInside;
};

export const getCanvasPoint = (
    clientX: number,
    clientY: number,
    svgRect: DOMRect,
    panOffset: Point,
    zoom: number
): Point => {
    return {
        x: (clientX - svgRect.left - panOffset.x) / zoom,
        y: (clientY - svgRect.top - panOffset.y) / zoom,
    };
};
