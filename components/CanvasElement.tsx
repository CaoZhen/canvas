import React from 'react';
import type { Element, PathElement, ImageElement } from '../types';

interface CanvasElementProps {
    element: Element;
    zoom: number;
    isSelected: boolean;
    isPendingSelected?: boolean;
    isEditing: boolean;
    croppingState: { elementId: string; originalElement: ImageElement; cropBox: { x: number; y: number; width: number; height: number; } } | null;
    onEditStart: (id: string, text: string) => void;
}

export const CanvasElement: React.FC<CanvasElementProps> = ({
    element: el,
    zoom,
    isSelected,
    isPendingSelected,
    isEditing,
    croppingState,
    onEditStart
}) => {
    switch (el.type) {
        case 'path': {
            const pathData = el.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
            return <path data-id={el.id} d={pathData} stroke={el.strokeColor} strokeWidth={el.strokeWidth} fill="none" strokeLinecap="round" strokeLinejoin="round" pointerEvents="stroke" strokeOpacity={el.opacity ?? 1} />;
        }
        case 'arrow': {
            const [start, end] = el.points;
            const angle = Math.atan2(end.y - start.y, end.x - start.x);
            const headLength = el.strokeWidth * 4;
            const arrowHeadHeight = headLength * Math.cos(Math.PI / 6);
            const lineEnd = {
                x: end.x - arrowHeadHeight * Math.cos(angle),
                y: end.y - arrowHeadHeight * Math.sin(angle),
            };
            const headPoint1 = { x: end.x - headLength * Math.cos(angle - Math.PI / 6), y: end.y - headLength * Math.sin(angle - Math.PI / 6) };
            const headPoint2 = { x: end.x - headLength * Math.cos(angle + Math.PI / 6), y: end.y - headLength * Math.sin(angle + Math.PI / 6) };
            return (
                <g data-id={el.id}>
                    <line x1={start.x} y1={start.y} x2={lineEnd.x} y2={lineEnd.y} stroke={el.strokeColor} strokeWidth={el.strokeWidth} strokeLinecap="round" />
                    <polygon points={`${end.x},${end.y} ${headPoint1.x},${headPoint1.y} ${headPoint2.x},${headPoint2.y}`} fill={el.strokeColor} />
                </g>
            );
        }
        case 'line': {
            const [start, end] = el.points;
            return <line data-id={el.id} x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={el.strokeColor} strokeWidth={el.strokeWidth} strokeLinecap="round" />;
        }
        case 'text': {
            return !isEditing ? (
                <foreignObject data-id={el.id} x={el.x} y={el.y} width={el.width} height={el.height} style={{ overflow: 'visible' }}>
                    <div style={{ fontSize: el.fontSize, color: el.fontColor, width: '100%', height: '100%', wordBreak: 'break-word' }}>
                        {el.text}
                    </div>
                </foreignObject>
            ) : null;
        }
        case 'shape': {
            let shapeJsx;
            if (el.shapeType === 'rectangle') shapeJsx = <rect width={el.width} height={el.height} rx={el.borderRadius} ry={el.borderRadius} />
            else if (el.shapeType === 'circle') shapeJsx = <ellipse cx={el.width / 2} cy={el.height / 2} rx={el.width / 2} ry={el.height / 2} />
            else if (el.shapeType === 'triangle') shapeJsx = <polygon points={`${el.width / 2},0 0,${el.height} ${el.width},${el.height}`} />
            return (
                <g data-id={el.id} transform={`translate(${el.x}, ${el.y})`} opacity={el.opacity ?? 1}>
                    {shapeJsx && React.cloneElement(shapeJsx, { fill: el.fillColor, stroke: el.strokeColor, strokeWidth: el.strokeWidth, strokeDasharray: el.strokeDashArray ? el.strokeDashArray.join(' ') : 'none' })}
                </g>
            );
        }
        case 'image': {
            const clipPath = (el.borderRadius && el.borderRadius > 0) ? `url(#clip-${el.id})` : undefined;
            return (
                <image
                    data-id={el.id}
                    x={el.x} y={el.y}
                    href={el.href}
                    width={el.width} height={el.height}
                    opacity={el.opacity ?? 1}
                    clipPath={clipPath}
                    className={croppingState && croppingState.elementId !== el.id ? 'opacity-30' : ''}
                    pointerEvents="all"
                    // Prevent browser extensions (like Video Downloaders) from crashing when clicking SVG images.
                    // These extensions often assume e.target.href is a string, which is false for SVG images.
                    onClick={(e) => e.stopPropagation()}
                    // Prevent native browser drag behavior from interfering with our custom canvas dragging
                    onDragStart={(e) => e.preventDefault()}
                />
            );
        }
        case 'video': {
            return (
                <foreignObject data-id={el.id} x={el.x} y={el.y} width={el.width} height={el.height}>
                    <video src={el.href} controls style={{ width: '100%', height: '100%', borderRadius: '8px' }} className={croppingState ? 'opacity-30' : ''}></video>
                </foreignObject>
            );
        }
        case 'frame': {
            return (
                <g data-id={el.id}>
                    <rect x={el.x} y={el.y} width={el.width} height={el.height} fill={el.backgroundColor || 'rgba(100,100,100,0.1)'} stroke="rgba(255, 255, 255, 0.5)" strokeWidth={2 / zoom} strokeDasharray={`${8 / zoom} ${4 / zoom}`} pointerEvents="all" />
                    {!isEditing && (
                        <text x={el.x + (8 / zoom)} y={el.y - (8 / zoom)} fill="white" fontSize={16 / zoom} onDoubleClick={(e) => { e.stopPropagation(); onEditStart(el.id, el.name) }} className="cursor-pointer select-none">
                            {el.name}
                        </text>
                    )}
                </g>
            );
        }
        default: return null;
    }
};
