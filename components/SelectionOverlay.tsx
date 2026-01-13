import React from 'react';
import { Element, Point } from '../types';
import { getElementBounds, rasterizeElement } from '../utils/elementUtils';
import { rotatePoint } from '../utils/mathUtils';

interface SelectionOverlayProps {
    elements: Element[];
    selectedElementIds: string[];
    zoom: number;
    showHandles: boolean;
    onRotationHandleYChange: (val: number, x: number) => void;
}

export const SelectionOverlay: React.FC<SelectionOverlayProps> = ({
    elements,
    selectedElementIds,
    zoom,
    showHandles
}) => {
    if (selectedElementIds.length === 0) return null;

    let selectionComponent = null;
    const isMultiSelect = selectedElementIds.length > 1;

    // Helper to get bounds for single or multiple selection
    const getSelectionBounds = (ids: string[], allElements: Element[]) => {
        if (ids.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        ids.forEach(id => {
            const el = allElements.find(e => e.id === id);
            if (el) {
                const bounds = getElementBounds(el, allElements);
                minX = Math.min(minX, bounds.x);
                minY = Math.min(minY, bounds.y);
                maxX = Math.max(maxX, bounds.x + bounds.width);
                maxY = Math.max(maxY, bounds.y + bounds.height);
            }
        });
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    };

    if (isMultiSelect) {
        const bounds = getSelectionBounds(selectedElementIds, elements);
        selectionComponent = (
            <>
                <rect
                    x={bounds.x}
                    y={bounds.y}
                    width={bounds.width}
                    height={bounds.height}
                    fill="none"
                    stroke="rgb(59 130 246)"
                    strokeWidth={1 / zoom}
                    strokeDasharray={`${6 / zoom} ${4 / zoom}`}
                    pointerEvents="none"
                    opacity={0.5}
                />
                {selectedElementIds.map(id => {
                    const el = elements.find(e => e.id === id);
                    if (!el) return null;
                    const b = getElementBounds(el, elements);
                    return (
                        <rect
                            key={id}
                            x={b.x}
                            y={b.y}
                            width={b.width}
                            height={b.height}
                            fill="none"
                            stroke="rgb(59 130 246)"
                            strokeWidth={2 / zoom}
                            pointerEvents="none"
                        />
                    );
                })}
            </>
        );
    } else {
        const id = selectedElementIds[0];
        const el = elements.find(e => e.id === id);
        if (el) {
            const bounds = getElementBounds(el, elements);
            const { x, y, width, height } = bounds;

            if (width > 0 || height > 0) {
                const handleSize = 8 / zoom;
                const handles = [
                    { name: 'tl', x: x, y: y, cursor: 'nwse-resize' }, { name: 'tm', x: x + width / 2, y: y, cursor: 'ns-resize' }, { name: 'tr', x: x + width, y: y, cursor: 'nesw-resize' },
                    { name: 'ml', x: x, y: y + height / 2, cursor: 'ew-resize' }, { name: 'mr', x: x + width, y: y + height / 2, cursor: 'ew-resize' },
                    { name: 'bl', x: x, y: y + height, cursor: 'nesw-resize' }, { name: 'bm', x: x + width / 2, y: y + height, cursor: 'ns-resize' }, { name: 'br', x: x + width, y: y + height, cursor: 'nwse-resize' },
                ];

                const rotationHandleDistance = 20 / zoom;
                const rotationHandleX = x + width / 2;
                const rotationHandleY = y - rotationHandleDistance;

                selectionComponent = (
                    <g data-id={id} pointerEvents="none">
                        <rect x={x} y={y} width={width} height={height} fill="none" stroke="rgb(59 130 246)" strokeWidth={2 / zoom} pointerEvents="none" />
                        {showHandles && (
                            <>
                                {handles.map(h => <rect key={h.name} data-handle={h.name} data-id={id} x={h.x - handleSize / 2} y={h.y - handleSize / 2} width={handleSize} height={handleSize} fill="white" stroke="#3b82f6" strokeWidth={1 / zoom} style={{ cursor: h.cursor }} pointerEvents="auto" />)}
                                <line x1={rotationHandleX} y1={y} x2={rotationHandleX} y2={rotationHandleY} stroke="#3b82f6" strokeWidth={1 / zoom} pointerEvents="none" />
                                <circle data-handle="rotate" data-id={id} cx={rotationHandleX} cy={rotationHandleY} r={handleSize / 1.5} fill="white" stroke="#3b82f6" strokeWidth={1 / zoom} style={{ cursor: 'grab' }} pointerEvents="auto" />
                                {el.type === 'image' && (
                                    <g transform={`translate(${x + width}, ${y - 10 / zoom})`} style={{ pointerEvents: 'none' }}>
                                        {(() => {
                                            const text = el.naturalWidth && el.naturalHeight
                                                ? `${Math.round(el.naturalWidth)} x ${Math.round(el.naturalHeight)}`
                                                : `${Math.round(width)} x ${Math.round(height)}`;
                                            const w = (text.length * 8 + 16) / zoom;
                                            const h = 24 / zoom;
                                            return (
                                                <>
                                                    <rect x={-w} y={-h} width={w} height={h} fill="rgba(0,0,0,0.6)" rx={4 / zoom} />
                                                    <text x={-w / 2} y={-h / 2 + (4 / zoom)} fill="white" fontSize={12 / zoom} textAnchor="middle" fontFamily="monospace">
                                                        {text}
                                                    </text>
                                                </>
                                            );
                                        })()}
                                    </g>
                                )}
                            </>
                        )}
                    </g>
                );
            }
        }
    }

    return selectionComponent;
};
