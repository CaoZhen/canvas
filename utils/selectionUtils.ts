import { Element, Rect, Point } from '../types';
import { getElementBounds } from './elementUtils';
import { rotatePoint } from './mathUtils';

export const getSelectableElement = (elementId: string, allElements: Element[]): Element | null => {
    const element = allElements.find(el => el.id === elementId);
    if (!element) return null;
    if (element.isLocked) return null;

    let current = element;
    while (current.parentId) {
        const parent = allElements.find(el => el.id === current.parentId);
        if (!parent) return current; // Orphaned, treat as top-level
        if (parent.isLocked) return null; // Parent is locked, nothing inside is selectable
        if (parent.type === 'frame') break; // Can select items inside a frame
        current = parent;
    }
    return current;
};

export const getDescendants = (elementId: string, allElements: Element[]): Element[] => {
    const descendants: Element[] = [];
    const children = allElements.filter(el => el.parentId === elementId);
    for (const child of children) {
        descendants.push(child);
        if (child.type === 'group' || child.type === 'frame') {
            descendants.push(...getDescendants(child.id, allElements));
        }
    }
    return descendants;
};

export const getFlattenedSelection = (selectionIds: string[], allElements: Element[]): Element[] => {
    const selectedElements = allElements.filter(el => selectionIds.includes(el.id));
    const elementSet = new Set<Element>();

    selectedElements.forEach(el => {
        elementSet.add(el);
        if (el.type === 'group') {
            getDescendants(el.id, allElements).forEach(desc => elementSet.add(desc));
        }
    });

    return Array.from(elementSet);
};

export const getSelectionBounds = (selectionIds: string[], allElements: Element[]): Rect => {
    const selectedElements = allElements.filter(el => selectionIds.includes(el.id));
    if (selectedElements.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    selectedElements.forEach(el => {
        const unrotatedBounds = getElementBounds(el, allElements);
        if (unrotatedBounds.width === 0 && unrotatedBounds.height === 0) return;

        const center = { x: unrotatedBounds.x + unrotatedBounds.width / 2, y: unrotatedBounds.y + unrotatedBounds.height / 2 };
        const rotation = ('rotation' in el && el.rotation) ? el.rotation : 0;

        const corners: Point[] = [
            { x: unrotatedBounds.x, y: unrotatedBounds.y },
            { x: unrotatedBounds.x + unrotatedBounds.width, y: unrotatedBounds.y },
            { x: unrotatedBounds.x + unrotatedBounds.width, y: unrotatedBounds.y + unrotatedBounds.height },
            { x: unrotatedBounds.x, y: unrotatedBounds.y + unrotatedBounds.height },
        ];

        const rotatedCorners = rotation === 0 ? corners : corners.map(c => rotatePoint(c, center, rotation));

        rotatedCorners.forEach(corner => {
            minX = Math.min(minX, corner.x);
            minY = Math.min(minY, corner.y);
            maxX = Math.max(maxX, corner.x);
            maxY = Math.max(maxY, corner.y);
        });
    });

    if (minX === Infinity) return { x: 0, y: 0, width: 0, height: 0 };

    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};
