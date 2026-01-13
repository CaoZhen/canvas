import React, { useRef, useCallback, MouseEvent, WheelEvent, useEffect } from 'react';
import { Element, Point, Tool, Rect, Guide, AICameraState, FrameElement, TextElement, PathElement, ShapeElement, ArrowElement, LineElement, ImageElement } from '../types';
import { generateId } from '@/utils/idUtils';
import { getElementBounds, rasterizeElement, getImageContentBounds } from '@/utils/elementUtils';
import { rotatePoint } from '@/utils/mathUtils';
import { getSelectableElement, getDescendants } from '@/utils/selectionUtils';

interface CanvasInteractionProps {
    svgRef: React.RefObject<SVGSVGElement>;
    elements: Element[];
    elementsRef: React.MutableRefObject<Element[]>;
    activeTool: Tool;
    setActiveTool: (tool: Tool) => void;
    selectedElementIds: string[];
    setSelectedElementIds: React.Dispatch<React.SetStateAction<string[]>>;
    panOffset: Point;
    setPanOffset: (offset: Point) => void;
    zoom: number;
    setZoom: (zoom: number) => void;
    drawingOptions: { strokeColor: string; strokeWidth: number; opacity: number };
    editingElement: { id: string; text: string; } | null;
    setEditingElement: (el: { id: string; text: string; } | null) => void;
    contextMenu: { x: number; y: number; elementId: string | null } | null;
    setContextMenu: (menu: { x: number; y: number; elementId: string | null } | null) => void;
    aiRotationState: AICameraState | null;
    setAiRotationState: React.Dispatch<React.SetStateAction<AICameraState | null>>;
    croppingState: { elementId: string; originalElement: ImageElement; cropBox: Rect } | null;
    setCroppingState: React.Dispatch<React.SetStateAction<{ elementId: string; originalElement: ImageElement; cropBox: Rect } | null>>;
    setRotationDialPoint: (point: Point | null) => void;
    setLassoPath: React.Dispatch<React.SetStateAction<Point[] | null>>;
    setAlignmentGuides: (guides: Guide[]) => void;
    setSelectionBox: (box: Rect | null) => void;
    setPendingSelectedIds: React.Dispatch<React.SetStateAction<string[]>>;

    // References managed by App.tsx
    interactionMode: React.MutableRefObject<string | null>;
    startPoint: React.MutableRefObject<Point>;
    currentDrawingElementId: React.MutableRefObject<string | null>;
    resizeStartInfo: React.MutableRefObject<{ originalElement: Element; startCanvasPoint: Point; handle: string; } | null>;
    rotateStartInfo: React.MutableRefObject<{ originalElement: Element; center: Point; startCanvasPoint: Point; } | null>;
    cropStartInfo: React.MutableRefObject<{ originalCropBox: Rect, startCanvasPoint: Point } | null>;
    dragStartElementPositions: React.MutableRefObject<Map<string, { x: number, y: number } | Point[]>>;

    // Actions
    setElements: (updater: (prev: Element[]) => Element[], commit?: boolean) => void;
    addElementsWithParenting: (elements: Element[]) => void;
    commitAction: (updater: (prev: Element[]) => Element[]) => void;
    updateActiveBoard: any;

    // AI & Feedback
    isLoading: boolean;
    setIsLoading: (loading: boolean) => void;
    setError: (error: string | null) => void;
    setProgressMessage: (message: string) => void;
    negativePrompt: string;
    editImage: (images: { href: string; mimeType: string }[], prompt: string, targetSize?: { width: number; height: number }, negativePrompt?: string, strength?: number, guidanceScale?: number) => Promise<any>;
    onDoubleClickCanvas?: (point: Point) => void;
}

export const useCanvasInteractions = ({
    svgRef,
    elements,
    elementsRef,
    activeTool,
    setActiveTool,
    selectedElementIds,
    setSelectedElementIds,
    panOffset,
    setPanOffset,
    zoom,
    setZoom,
    drawingOptions,
    editingElement,
    setEditingElement,
    contextMenu,
    setContextMenu,
    aiRotationState,
    setAiRotationState,
    croppingState,
    setCroppingState,
    setRotationDialPoint,
    setLassoPath,
    setAlignmentGuides,
    setSelectionBox,
    setPendingSelectedIds,
    // Refs
    interactionMode,
    startPoint,
    currentDrawingElementId,
    resizeStartInfo,
    rotateStartInfo,
    cropStartInfo,
    dragStartElementPositions,
    // Actions
    setElements,
    addElementsWithParenting,
    commitAction,
    updateActiveBoard,
    // AI & Feedback
    setIsLoading,
    setError,
    setProgressMessage,
    negativePrompt,
    editImage,
    onDoubleClickCanvas
}: CanvasInteractionProps) => {
    const zoomRef = useRef(zoom);
    zoomRef.current = zoom;
    const panOffsetRef = useRef(panOffset);
    panOffsetRef.current = panOffset;
    const updateActiveBoardRef = useRef(updateActiveBoard);
    updateActiveBoardRef.current = updateActiveBoard;

    // Helper functions
    const getCanvasPoint = (clientX: number, clientY: number): Point => {
        if (!svgRef.current) return { x: 0, y: 0 };
        const svgRect = svgRef.current.getBoundingClientRect();
        const currentZoom = zoomRef.current;
        const currentPan = panOffsetRef.current;
        return {
            x: (clientX - svgRect.left - currentPan.x) / currentZoom,
            y: (clientY - svgRect.top - currentPan.y) / currentZoom,
        };
    };

    const handleAIGenerateCameraMovement = async (state: AICameraState) => {
        const { element, currentValue, dragDirection, mode, movementType } = state;
        if (!dragDirection) return;

        let sceneLock = '';
        let movement = '';
        let expectedResult = '';

        if (movementType === 'rotate') {
            const angle = Math.round(Math.abs(currentValue));
            if (mode === 'subject') {
                sceneLock = `Camera position, background, lighting, and environment must remain ABSOLUTELY STATIC. Only the subject rotates.`;
                if (dragDirection === 'h') {
                    const direction = currentValue > 0 ? 'right' : 'left';
                    movement = `The subject rotates ${angle} degrees to their ${direction}. The camera remains fixed.`;
                    expectedResult = `The subject is now facing ${angle} degrees more to the ${direction}. Identity preserved.`;
                } else {
                    const direction = currentValue > 0 ? 'down' : 'up';
                    movement = `The subject tilts their head/body ${angle} degrees ${direction}. The camera remains fixed.`;
                    expectedResult = `The subject looks ${angle} degrees ${direction}.`;
                }
            } else { // Camera mode
                sceneLock = `Maintain perfect consistency with the provided image.`;
                if (dragDirection === 'h') {
                    // Pan: Observer turns head
                    const direction = currentValue > 0 ? 'left' : 'right';
                    movement = `Observer rotates view ${angle} degrees to the ${direction}. (Pan ${direction})`;
                    expectedResult = `The view pans ${direction}. Objects shift horizontally.`;
                } else {
                    // Tilt: Observer looks up/down
                    const direction = currentValue > 0 ? 'down' : 'up'; // Drag Down -> Look Down

                    let angleDesc = '';
                    if (direction === 'down') {
                        angleDesc = 'towards the lower part of the subject (High Angle)';
                    } else {
                        angleDesc = 'towards the upper part/sky (Low Angle)';
                    }

                    movement = `Observer looks ${direction} by ${angle} degrees ${angleDesc}. The observer stands in place and tilts the camera.`;
                    expectedResult = `The view tilts ${direction}, focusing on the ${direction === 'down' ? 'lower' : 'upper'} area. Vertical perspective shifts.`;
                }
            }
        } else if (movementType === 'arc') {
            sceneLock = `Maintain the subject's identity. Background shifts as observer moves.`;
            const angle = Math.round(Math.abs(currentValue));
            if (dragDirection === 'h') {
                const direction = currentValue > 0 ? 'right' : 'left';
                movement = `Observer orbits ${angle} degrees to the ${direction} around the subject.`;
                expectedResult = `Camera moves ${direction} around the subject. Background parallax visible.`;
            } else {
                // Vertical Arc: Move Up (Look Down) or Move Down (Look Up)
                const moveDirection = currentValue > 0 ? 'up' : 'down';

                let desc = '';
                if (moveDirection === 'down') {
                    desc = `Observer moves down to a low position and looks up at the subject from an extremely low angle.`;
                } else {
                    desc = `Observer moves up to a high position and looks down at the subject from a high angle.`;
                }

                movement = `${desc} (Orbit ${moveDirection})`;
                expectedResult = `Camera moves ${moveDirection}. Perspective enters ${moveDirection === 'down' ? 'low' : 'high'} angle.`;
            }
        } else if (movementType === 'roll') {
            sceneLock = `Maintain perfect consistency.`;
            const angle = Math.round(Math.abs(currentValue));
            movement = `Observer tilts their head ${angle} degrees. (Camera Roll)`;
            expectedResult = `The image rotates ${angle} degrees around the center.`;
        } else if (movementType === 'dolly') {
            sceneLock = `Maintain perfect consistency.`;
            const amount = Math.round(Math.abs(currentValue));
            const direction = currentValue > 0 ? 'forward' : 'backward';
            movement = `Observer moves ${direction} by ${amount}%. (Dolly ${direction})`;
            expectedResult = `Observer moves ${direction}. Scale changes.`;
        } else if (movementType === 'translate') {
            sceneLock = `Maintain perfect consistency.`;
            const amount = Math.round(Math.abs(currentValue));
            if (dragDirection === 'h') {
                const direction = currentValue > 0 ? 'right' : 'left';
                movement = `Observer moves ${amount}% to the ${direction}. (Truck ${direction})`;
                expectedResult = `Camera moves ${direction}. Parallax shift.`;
            } else { // 'v'
                // Drag Up (Positive) -> Move Up
                const direction = currentValue > 0 ? 'up' : 'down';
                const action = direction === 'up' ? 'raises' : 'lowers';
                movement = `Observer ${action} their height by ${amount}% (Pedestal ${direction}, changing eye level). Observer looks straight ahead.`;
                expectedResult = `Camera moves ${direction}. Vertical perspective shift.`;
            }
        }

        const prompt = `
[SCENE LOCK] ${sceneLock}

[${mode === 'subject' ? 'SUBJECT MOVEMENT' : 'CAMERA MOVEMENT'}] ${movement}

[EXPECTED RESULT] ${expectedResult}
`.trim();

        console.log('AI Camera Movement Prompt:', prompt);

        setIsLoading(true);
        setError(null);
        setProgressMessage('Applying AI camera movement...');

        // Calculate target size based on natural resolution to prevent quality loss
        // Load image to get natural dimensions
        const img = new Image();
        img.src = element.href;
        await new Promise((resolve) => {
            if (img.complete) resolve(true);
            img.onload = () => resolve(true);
            img.onerror = () => resolve(false);
        });

        const naturalWidth = img.naturalWidth || element.width;
        const naturalHeight = img.naturalHeight || element.height;

        // Cap max dimension at 1280px (common AI limit) while maintaining aspect ratio
        // This ensures consistent high quality even if the element is resized small on canvas
        const MAX_DIMENSION = 1280;
        let targetWidth = naturalWidth;
        let targetHeight = naturalHeight;

        if (targetWidth > MAX_DIMENSION || targetHeight > MAX_DIMENSION) {
            const ratio = Math.min(MAX_DIMENSION / targetWidth, MAX_DIMENSION / targetHeight);
            targetWidth = Math.round(targetWidth * ratio);
            targetHeight = Math.round(targetHeight * ratio);
        }

        // Ensure even dimensions
        targetWidth = Math.round(targetWidth / 2) * 2;
        targetHeight = Math.round(targetHeight / 2) * 2;

        try {
            const result = await editImage(
                [{ href: element.href, mimeType: element.mimeType }],
                prompt,
                { width: targetWidth, height: targetHeight },
                undefined,
                0.6,
                9
            );

            if (result.newImageBase64 && result.newImageMimeType) {
                const { newImageBase64, newImageMimeType } = result;
                const img = new Image();
                img.onload = () => {
                    const PADDING = 20 / zoom;

                    // Calculate tight content bounds (in natural pixels)
                    const contentBounds = getImageContentBounds(img);

                    // Scale factor between display size and natural size
                    const scaleX = element.width / img.width;
                    const scaleY = element.height / img.height;

                    const tightWidth = contentBounds.width * scaleX;
                    const tightHeight = contentBounds.height * scaleY;

                    const newImage: ImageElement = {
                        id: generateId(),
                        type: 'image',
                        name: `${element.name || 'Image'} (shifted)`,
                        x: element.x + element.width + PADDING,
                        y: element.y + (element.height / 2) - (tightHeight / 2),
                        width: tightWidth,
                        height: tightHeight,
                        href: `data:${newImageMimeType};base64,${newImageBase64}`,
                        mimeType: newImageMimeType,
                        parentId: element.parentId,
                        rotation: 0,
                        borderRadius: 0,
                    };
                    addElementsWithParenting([newImage]);
                    setSelectedElementIds([newImage.id]);
                };
                img.src = `data:${result.newImageMimeType};base64,${result.newImageBase64}`;
            } else {
                setError(result.textResponse || 'AI operation failed to produce an image.');
            }
        } catch (err) {
            const error = err as Error;
            setError(`Failed to perform AI operation: ${error.message}`);
            console.error(err);
        } finally {
            setIsLoading(false);
            setProgressMessage('');
        }
    };

    const handleMouseDown = (e: MouseEvent<SVGSVGElement>) => {
        if (editingElement) return;
        if (contextMenu) setContextMenu(null);

        startPoint.current = { x: e.clientX, y: e.clientY };
        const canvasStartPoint = getCanvasPoint(e.clientX, e.clientY);
        const target = e.target as SVGElement;
        const handleName = target.getAttribute('data-handle');

        if (handleName === 'ai-rotate') {
            interactionMode.current = 'ai-rotate';
            setAiRotationState(prev => prev ? ({ ...prev, currentValue: 0, dragDirection: null, mode: prev.mode }) : null);
            e.stopPropagation();
            return;
        }

        if (aiRotationState) {
            setAiRotationState(null);
        }

        if (e.button === 1) { // Middle mouse button for panning
            interactionMode.current = 'pan';
            e.preventDefault();
            return;
        }

        if (croppingState) {
            if (handleName) {
                interactionMode.current = `crop-${handleName}`;
                cropStartInfo.current = { originalCropBox: { ...croppingState.cropBox }, startCanvasPoint: canvasStartPoint };
            }
            return;
        }
        if (activeTool === 'text') {
            const newText: TextElement = {
                id: generateId(), type: 'text', name: 'Text',
                x: canvasStartPoint.x, y: canvasStartPoint.y,
                width: 150, height: 40,
                text: "Text", fontSize: 24, fontColor: drawingOptions.strokeColor,
                rotation: 0,
            };
            addElementsWithParenting([newText]);
            setSelectedElementIds([newText.id]);
            setEditingElement({ id: newText.id, text: newText.text });
            setActiveTool('select');
            return;
        }

        if (activeTool === 'pan') {
            interactionMode.current = 'pan';
            return;
        }

        if (handleName && activeTool === 'select' && selectedElementIds.length === 1) {
            const element = elements.find(el => el.id === selectedElementIds[0]);
            if (!element) return;

            if (handleName === 'rotate') {
                interactionMode.current = 'rotate';
                const bounds = getElementBounds(element, elements);
                const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
                rotateStartInfo.current = {
                    originalElement: { ...element },
                    center,
                    startCanvasPoint: canvasStartPoint,
                };
            } else {
                interactionMode.current = `resize-${handleName}`;
                resizeStartInfo.current = {
                    originalElement: { ...element },
                    startCanvasPoint: canvasStartPoint,
                    handle: handleName,
                };
            }
            return;
        }

        if (activeTool === 'draw' || activeTool === 'highlighter') {
            interactionMode.current = 'draw';
            const newPath: PathElement = {
                id: generateId(),
                type: 'path', name: 'Path',
                points: [canvasStartPoint],
                strokeColor: drawingOptions.strokeColor,
                strokeWidth: drawingOptions.strokeWidth,
                opacity: drawingOptions.opacity,
                rotation: 0,
                x: 0, y: 0
            };
            currentDrawingElementId.current = newPath.id;
            setElements(prev => [...prev, newPath], false);
        } else if (activeTool === 'rectangle' || activeTool === 'circle' || activeTool === 'triangle') {
            interactionMode.current = 'drawShape';
            const newShape: ShapeElement = {
                id: generateId(),
                type: 'shape', name: activeTool.charAt(0).toUpperCase() + activeTool.slice(1),
                shapeType: activeTool,
                x: canvasStartPoint.x,
                y: canvasStartPoint.y,
                width: 0,
                height: 0,
                strokeColor: drawingOptions.strokeColor,
                strokeWidth: drawingOptions.strokeWidth,
                fillColor: 'transparent',
                opacity: drawingOptions.opacity,
                rotation: 0,
                borderRadius: 0,
            }
            currentDrawingElementId.current = newShape.id;
            setElements(prev => [...prev, newShape], false);
        } else if (activeTool === 'frame') {
            interactionMode.current = 'drawFrame';
            const frameCount = elements.filter(el => el.type === 'frame').length;
            const newFrame: FrameElement = {
                id: generateId(),
                type: 'frame',
                name: `Frame ${frameCount + 1}`,
                x: canvasStartPoint.x,
                y: canvasStartPoint.y,
                width: 0,
                height: 0,
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
            };
            currentDrawingElementId.current = newFrame.id;
            setElements(prev => [newFrame, ...prev], false);
        } else if (activeTool === 'arrow') {
            interactionMode.current = 'drawArrow';
            const newArrow: ArrowElement = {
                id: generateId(), type: 'arrow', name: 'Arrow',
                x: canvasStartPoint.x, y: canvasStartPoint.y,
                points: [canvasStartPoint, canvasStartPoint],
                strokeColor: drawingOptions.strokeColor, strokeWidth: drawingOptions.strokeWidth,
                rotation: 0,
            };
            currentDrawingElementId.current = newArrow.id;
            setElements(prev => [...prev, newArrow], false);
        } else if (activeTool === 'line') {
            interactionMode.current = 'drawLine';
            const newLine: LineElement = {
                id: generateId(), type: 'line', name: 'Line',
                x: canvasStartPoint.x, y: canvasStartPoint.y,
                points: [canvasStartPoint, canvasStartPoint],
                strokeColor: drawingOptions.strokeColor, strokeWidth: drawingOptions.strokeWidth,
                rotation: 0,
            };
            currentDrawingElementId.current = newLine.id;
            setElements(prev => [...prev, newLine], false);
        } else if (activeTool === 'erase') {
            interactionMode.current = 'erase';
        } else if (activeTool === 'lasso') {
            interactionMode.current = 'lasso';
            setLassoPath([canvasStartPoint]);
        } else if (activeTool === 'select') {
            const clickedElementId = target.closest('[data-id]')?.getAttribute('data-id');
            const selectableElement = clickedElementId ? getSelectableElement(clickedElementId, elementsRef.current) : null;
            const selectableElementId = selectableElement?.id;

            if (selectableElementId) {
                const element = elements.find(el => el.id === selectableElementId);
                if (e.detail === 2 && (element?.type === 'text' || element?.type === 'frame')) {
                    const el = element as TextElement | FrameElement;
                    setEditingElement({ id: el.id, text: el.type === 'text' ? el.text : el.name });
                    return;
                }
                if (!e.shiftKey && !selectedElementIds.includes(selectableElementId)) {
                    setSelectedElementIds([selectableElementId]);
                } else if (e.shiftKey) {
                    setSelectedElementIds(prev =>
                        prev.includes(selectableElementId) ? prev.filter(id => id !== selectableElementId) : [...prev, selectableElementId]
                    );
                }
                interactionMode.current = 'dragElements';
                const idsToDrag = new Set<string>();
                if (selectedElementIds.includes(selectableElementId)) {
                    selectedElementIds.forEach(id => {
                        const el = elementsRef.current.find(e => e.id === id);
                        if (el) {
                            idsToDrag.add(id);
                            if (el.type === 'group' || el.type === 'frame') {
                                getDescendants(id, elementsRef.current).forEach(desc => idsToDrag.add(desc.id));
                            }
                        }
                    });
                } else {
                    idsToDrag.add(selectableElementId);
                    if (selectableElement.type === 'group' || selectableElement.type === 'frame') {
                        getDescendants(selectableElementId, elementsRef.current).forEach(desc => idsToDrag.add(desc.id));
                    }
                }

                const initialPositions = new Map<string, { x: number, y: number } | Point[]>();
                elementsRef.current.forEach(el => {
                    if (idsToDrag.has(el.id)) {
                        if (el.type !== 'path' && el.type !== 'arrow' && el.type !== 'line') {
                            initialPositions.set(el.id, { x: el.x, y: el.y });
                        } else {
                            initialPositions.set(el.id, (el as PathElement).points);
                        }
                    }
                });
                dragStartElementPositions.current = initialPositions;

            } else {
                if (e.detail === 2 && onDoubleClickCanvas) {
                    onDoubleClickCanvas(canvasStartPoint);
                    return;
                }
                setSelectedElementIds([]);
                interactionMode.current = 'selectBox';
                setSelectionBox({ x: canvasStartPoint.x, y: canvasStartPoint.y, width: 0, height: 0 });
            }
        }
    };

    const handleMouseMove = (e: MouseEvent<SVGSVGElement>) => {
        if (!interactionMode.current) return;
        const point = getCanvasPoint(e.clientX, e.clientY);
        const startCanvasPoint = getCanvasPoint(startPoint.current.x, startPoint.current.y);

        if (interactionMode.current === 'ai-rotate') {
            if (!aiRotationState) return;
            const { center } = aiRotationState;
            const dx = point.x - center.x;
            const dy = point.y - center.y;

            let newValue = 0;
            let dragDirection: 'h' | 'v' | 'd' = 'h';

            if (aiRotationState.movementType === 'rotate') {
                if (aiRotationState.mode === 'subject') {
                    // For subject, restrict to horizontal rotation only (turn left/right)
                    dragDirection = 'h';
                    const distance = dx;
                    const maxDistance = 150 / zoom;
                    const cappedDistance = Math.max(-maxDistance, Math.min(maxDistance, distance));
                    newValue = (cappedDistance / maxDistance) * 90;
                } else {
                    // For camera (Pan/Tilt), allow both axes
                    dragDirection = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
                    const distance = dragDirection === 'h' ? dx : -dy;
                    const maxDistance = 150 / zoom;
                    const cappedDistance = Math.max(-maxDistance, Math.min(maxDistance, distance));
                    newValue = (cappedDistance / maxDistance) * 90;
                }
                newValue = Math.round(newValue / 15) * 15;
            } else if (aiRotationState.movementType === 'dolly') {
                dragDirection = 'd';
                const maxDist = 200 / zoom;
                // Use vertical drag for dolly: up = in (+), down = out (-)
                newValue = Math.max(-100, Math.min(100, (-dy / maxDist) * 100));
            } else if (aiRotationState.movementType === 'arc') {
                dragDirection = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
                const distance = dragDirection === 'h' ? dx : -dy;
                const maxDistance = 150 / zoom;
                const cappedDistance = Math.max(-maxDistance, Math.min(maxDistance, distance));
                newValue = (cappedDistance / maxDistance) * 90;
                newValue = Math.round(newValue / 15) * 15;
            } else if (aiRotationState.movementType === 'roll') {
                dragDirection = 'h';
                const maxDistance = 150 / zoom;
                const cappedDistance = Math.max(-maxDistance, Math.min(maxDistance, dx));
                newValue = (cappedDistance / maxDistance) * 45;
                newValue = Math.round(newValue / 5) * 5;
            } else if (aiRotationState.movementType === 'translate') {
                dragDirection = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
                const maxTranslate = 200 / zoom;
                const distance = dragDirection === 'h' ? dx : -dy;
                newValue = Math.max(-100, Math.min(100, (distance / maxTranslate) * 100));
            }

            setAiRotationState(prev => prev ? ({
                ...prev,
                currentValue: newValue,
                dragDirection
            }) : null);
            return;
        }

        if (interactionMode.current === 'rotate') {
            if (!rotateStartInfo.current) return;
            setRotationDialPoint(point);
            const { originalElement, center, startCanvasPoint: rotateStartPoint } = rotateStartInfo.current;

            const startAngle = Math.atan2(rotateStartPoint.y - center.y, rotateStartPoint.x - center.x);
            const currentAngle = Math.atan2(point.y - center.y, point.x - center.x);

            const angleDiff = (currentAngle - startAngle) * (180 / Math.PI);
            let newRotation = (('rotation' in originalElement && originalElement.rotation) || 0) + angleDiff;

            if (e.shiftKey) {
                newRotation = Math.round(newRotation / 15) * 15;
            }

            setElements(prev => prev.map(el => {
                if (el.id === originalElement.id) {
                    return { ...el, rotation: newRotation };
                }
                return el;
            }), false);
            return;
        }

        if (interactionMode.current === 'erase') {
            const eraseRadius = drawingOptions.strokeWidth / zoom;
            const idsToDelete = new Set<string>();

            elements.forEach(el => {
                if (el.type === 'path') {
                    for (let i = 0; i < el.points.length - 1; i++) {
                        const distance = Math.hypot(point.x - el.points[i].x, point.y - el.points[i].y);
                        if (distance < eraseRadius) {
                            idsToDelete.add(el.id);
                            return;
                        }
                    }
                }
            });

            if (idsToDelete.size > 0) {
                setElements(prev => prev.filter(el => !idsToDelete.has(el.id)), false);
            }
            return;
        }

        if (interactionMode.current.startsWith('resize-')) {
            if (!resizeStartInfo.current) return;
            const { originalElement, handle, startCanvasPoint: resizeStartPoint } = resizeStartInfo.current;

            const rotation = ('rotation' in originalElement && originalElement.rotation) || 0;
            const dx = point.x - resizeStartPoint.x;
            const dy = point.y - resizeStartPoint.y;

            const angleRad = (rotation * Math.PI) / 180;
            const cos = Math.cos(angleRad);
            const sin = Math.sin(angleRad);
            const dx_local = dx * cos + dy * sin;
            const dy_local = -dx * sin + dy * cos;

            const originalBounds = getElementBounds(originalElement, []);
            if (originalBounds.width === 0 && originalBounds.height === 0 && (dx_local === 0 || dy_local === 0)) return;

            let { x: newX, y: newY, width: newWidth, height: newHeight } = originalBounds;

            const isProportional = originalElement.type === 'image' || (e.shiftKey && originalElement.type !== 'text');

            if (handle.includes('r')) { newWidth = originalBounds.width + dx_local; }
            if (handle.includes('l')) { newWidth = originalBounds.width - dx_local; }
            if (handle.includes('b')) { newHeight = originalBounds.height + dy_local; }
            if (handle.includes('t')) { newHeight = originalBounds.height - dy_local; }

            if (isProportional && originalBounds.width > 0 && originalBounds.height > 0) {
                const aspectRatio = originalBounds.width / originalBounds.height;
                if ((handle.includes('r') || handle.includes('l'))) {
                    newHeight = newWidth / aspectRatio;
                } else {
                    newWidth = newHeight * aspectRatio;
                }
            }

            if (newWidth < 1) newWidth = 1;
            if (newHeight < 1) newHeight = 1;

            const originalCenter = { x: originalBounds.x + originalBounds.width / 2, y: originalBounds.y + originalBounds.height / 2 };

            let pivot_local: Point = { x: 0, y: 0 };
            if (handle.includes('t')) { pivot_local.y = originalBounds.y + originalBounds.height; } else if (handle.includes('b')) { pivot_local.y = originalBounds.y; } else { pivot_local.y = originalCenter.y; }
            if (handle.includes('l')) { pivot_local.x = originalBounds.x + originalBounds.width; } else if (handle.includes('r')) { pivot_local.x = originalBounds.x; } else { pivot_local.x = originalCenter.x; }

            const pivot_world = rotatePoint(pivot_local, originalCenter, rotation);

            let tempX = originalBounds.x;
            let tempY = originalBounds.y;
            if (handle.includes('l')) { tempX = originalBounds.x + originalBounds.width - newWidth; }
            if (handle.includes('t')) { tempY = originalBounds.y + originalBounds.height - newHeight; }

            const temp_center = { x: tempX + newWidth / 2, y: tempY + newHeight / 2 };

            let new_pivot_local: Point = { x: 0, y: 0 };
            if (handle.includes('t')) { new_pivot_local.y = tempY + newHeight; } else if (handle.includes('b')) { new_pivot_local.y = tempY; } else { new_pivot_local.y = temp_center.y; }
            if (handle.includes('l')) { new_pivot_local.x = tempX + newWidth; } else if (handle.includes('r')) { new_pivot_local.x = tempX; } else { new_pivot_local.x = temp_center.x; }

            const new_pivot_world = rotatePoint(new_pivot_local, temp_center, rotation);

            const dx_world = pivot_world.x - new_pivot_world.x;
            const dy_world = pivot_world.y - new_pivot_world.y;

            const finalX = tempX + dx_world;
            const finalY = tempY + dy_world;

            const scaleX = originalBounds.width > 0 ? newWidth / originalBounds.width : 1;
            const scaleY = originalBounds.height > 0 ? newHeight / originalBounds.height : 1;

            setElements(prev => prev.map(el => {
                if (el.id !== originalElement.id) return el;

                switch (el.type) {
                    case 'image':
                    case 'shape':
                    case 'text':
                    case 'video':
                    case 'frame':
                        return { ...el, x: finalX, y: finalY, width: newWidth, height: newHeight };

                    case 'path': {
                        const originalPathElement = originalElement as PathElement;
                        const newPoints = originalPathElement.points.map(p => ({
                            x: finalX + (p.x - originalBounds.x) * scaleX,
                            y: finalY + (p.y - originalBounds.y) * scaleY
                        }));
                        return { ...el, points: newPoints };
                    }
                    case 'arrow':
                    case 'line': {
                        const originalLineElement = originalElement as ArrowElement | LineElement;
                        const newEndpoints: [Point, Point] = [
                            {
                                x: finalX + (originalLineElement.points[0].x - originalBounds.x) * scaleX,
                                y: finalY + (originalLineElement.points[0].y - originalBounds.y) * scaleY
                            },
                            {
                                x: finalX + (originalLineElement.points[1].x - originalBounds.x) * scaleX,
                                y: finalY + (originalLineElement.points[1].y - originalBounds.y) * scaleY
                            }
                        ];
                        return { ...el, points: newEndpoints };
                    }
                }
                return el;
            }), false);
            return;
        }


        if (interactionMode.current.startsWith('crop-')) {
            if (!croppingState || !cropStartInfo.current) return;
            const handle = interactionMode.current.split('-')[1];
            const { originalCropBox, startCanvasPoint: cropStartPoint } = cropStartInfo.current;
            let { x, y, width, height } = { ...originalCropBox };
            const { originalElement } = croppingState;
            const dx = point.x - cropStartPoint.x;
            const dy = point.y - cropStartPoint.y;

            if (handle.includes('r')) { width = originalCropBox.width + dx; }
            if (handle.includes('l')) { width = originalCropBox.width - dx; x = originalCropBox.x + dx; }
            if (handle.includes('b')) { height = originalCropBox.height + dy; }
            if (handle.includes('t')) { height = originalCropBox.height - dy; y = originalCropBox.y + dy; }

            if (x < originalElement.x) {
                width += x - originalElement.x;
                x = originalElement.x;
            }
            if (y < originalElement.y) {
                height += y - originalElement.y;
                y = originalElement.y;
            }
            if (x + width > originalElement.x + originalElement.width) {
                width = originalElement.x + originalElement.width - x;
            }
            if (y + height > originalElement.y + originalElement.height) {
                height = originalElement.y + originalElement.height - y;
            }

            if (width < 1) {
                width = 1;
                if (handle.includes('l')) { x = originalCropBox.x + originalCropBox.width - 1; }
            }
            if (height < 1) {
                height = 1;
                if (handle.includes('t')) { y = originalCropBox.y + originalCropBox.height - 1; }
            }

            setCroppingState(currentCroppingState => {
                if (!currentCroppingState) {
                    return null;
                }
                const newCropBox: Rect = { x, y, width, height };
                return {
                    ...currentCroppingState,
                    cropBox: newCropBox,
                };
            });
            return;
        }


        switch (interactionMode.current) {
            case 'pan': {
                const dx = e.clientX - startPoint.current.x;
                const dy = e.clientY - startPoint.current.y;
                setPanOffset({ x: panOffset.x + dx, y: panOffset.y + dy });
                startPoint.current = { x: e.clientX, y: e.clientY };
                break;
            }
            case 'draw': {
                if (currentDrawingElementId.current) {
                    setElements(prev => prev.map(el => {
                        if (el.id === currentDrawingElementId.current && el.type === 'path') {
                            return { ...el, points: [...el.points, point] };
                        }
                        return el;
                    }), false);
                }
                break;
            }
            case 'lasso': {
                setLassoPath(prev => (prev ? [...prev, point] : [point]));
                break;
            }
            case 'drawShape':
            case 'drawFrame': {
                if (currentDrawingElementId.current) {
                    setElements(prev => prev.map(el => {
                        if (el.id === currentDrawingElementId.current && (el.type === 'shape' || el.type === 'frame')) {
                            let newWidth = Math.abs(point.x - startCanvasPoint.x);
                            let newHeight = Math.abs(point.y - startCanvasPoint.y);
                            let newX = Math.min(point.x, startCanvasPoint.x);
                            let newY = Math.min(point.y, startCanvasPoint.y);

                            if (e.shiftKey && el.type === 'shape') {
                                if (el.shapeType === 'rectangle' || el.shapeType === 'circle') {
                                    const side = Math.max(newWidth, newHeight);
                                    newWidth = side;
                                    newHeight = side;
                                } else if (el.shapeType === 'triangle') {
                                    newHeight = newWidth * (Math.sqrt(3) / 2);
                                }

                                if (point.x < startCanvasPoint.x) newX = startCanvasPoint.x - newWidth;
                                if (point.y < startCanvasPoint.y) newY = startCanvasPoint.y - newHeight;
                            }

                            return { ...el, x: newX, y: newY, width: newWidth, height: newHeight };
                        }
                        return el;
                    }), false);
                }
                break;
            }
            case 'drawArrow': {
                if (currentDrawingElementId.current) {
                    setElements(prev => prev.map(el => {
                        if (el.id === currentDrawingElementId.current && el.type === 'arrow') {
                            return { ...el, points: [el.points[0], point] };
                        }
                        return el;
                    }), false);
                }
                break;
            }
            case 'drawLine': {
                if (currentDrawingElementId.current) {
                    setElements(prev => prev.map(el => {
                        if (el.id === currentDrawingElementId.current && el.type === 'line') {
                            return { ...el, points: [el.points[0], point] };
                        }
                        return el;
                    }), false);
                }
                break;
            }
            case 'dragElements': {
                const dx = point.x - startCanvasPoint.x;
                const dy = point.y - startCanvasPoint.y;

                const movingElementIds = Array.from(dragStartElementPositions.current.keys());
                const movingElements = elements.filter(el => movingElementIds.includes(el.id));
                const otherElements = elements.filter(el => !movingElementIds.includes(el.id));
                const SNAP_THRESHOLD = 5; // pixels in screen space

                const snapThresholdCanvas = SNAP_THRESHOLD / zoom;

                let finalDx = dx;
                let finalDy = dy;
                let activeGuides: Guide[] = [];

                // Alignment Snapping
                const getSnapPoints = (bounds: Rect) => ({
                    v: [bounds.x, bounds.x + bounds.width / 2, bounds.x + bounds.width],
                    h: [bounds.y, bounds.y + bounds.height / 2, bounds.y + bounds.height],
                });

                const staticSnapPoints = { v: new Set<number>(), h: new Set<number>() };
                otherElements.forEach(el => {
                    const bounds = getElementBounds(el);
                    getSnapPoints(bounds).v.forEach(p => staticSnapPoints.v.add(p));
                    getSnapPoints(bounds).h.forEach(p => staticSnapPoints.h.add(p));
                });

                let bestSnapX = { dist: Infinity, val: finalDx, guide: null as Guide | null };
                let bestSnapY = { dist: Infinity, val: finalDy, guide: null as Guide | null };

                movingElements.forEach(movingEl => {
                    const startPos = dragStartElementPositions.current.get(movingEl.id);
                    if (!startPos) return;

                    let movingBounds: Rect;
                    if (movingEl.type !== 'path' && movingEl.type !== 'arrow' && movingEl.type !== 'line') {
                        movingBounds = getElementBounds({ ...movingEl, x: (startPos as Point).x, y: (startPos as Point).y });
                    } else { // path or arrow or line
                        if (movingEl.type === 'arrow' || movingEl.type === 'line') {
                            movingBounds = getElementBounds({ ...movingEl, points: startPos as [Point, Point] });
                        } else {
                            movingBounds = getElementBounds({ ...movingEl, points: startPos as Point[] });
                        }
                    }

                    const movingSnapPoints = getSnapPoints(movingBounds);

                    movingSnapPoints.v.forEach(p => {
                        staticSnapPoints.v.forEach(staticP => {
                            const dist = Math.abs((p + finalDx) - staticP);
                            if (dist < snapThresholdCanvas && dist < bestSnapX.dist) {
                                bestSnapX = { dist, val: staticP - p, guide: { type: 'v', position: staticP, start: movingBounds.y, end: movingBounds.y + movingBounds.height } };
                            }
                        });
                    });
                    movingSnapPoints.h.forEach(p => {
                        staticSnapPoints.h.forEach(staticP => {
                            const dist = Math.abs((p + finalDy) - staticP);
                            if (dist < snapThresholdCanvas && dist < bestSnapY.dist) {
                                bestSnapY = { dist, val: staticP - p, guide: { type: 'h', position: staticP, start: movingBounds.x, end: movingBounds.x + movingBounds.width } };
                            }
                        });
                    });
                });

                if (bestSnapX.guide) { finalDx = bestSnapX.val; activeGuides.push(bestSnapX.guide); }
                if (bestSnapY.guide) { finalDy = bestSnapY.val; activeGuides.push(bestSnapY.guide); }

                setAlignmentGuides(activeGuides);

                setElements(prev => prev.map(el => {
                    if (movingElementIds.includes(el.id)) {
                        const startPos = dragStartElementPositions.current.get(el.id);
                        if (!startPos) return el;

                        switch (el.type) {
                            case 'image':
                            case 'shape':
                            case 'text':
                            case 'group':
                            case 'video':
                            case 'frame': {
                                const initialPos = startPos as Point;
                                return { ...el, x: initialPos.x + finalDx, y: initialPos.y + finalDy };
                            }
                            case 'path': {
                                const initialPoints = startPos as Point[];
                                const newPoints = initialPoints.map(p => ({ x: p.x + finalDx, y: p.y + finalDy }));
                                return { ...el, points: newPoints };
                            }
                            case 'arrow':
                            case 'line': {
                                const initialPoints = startPos as [Point, Point];
                                const newPoints: [Point, Point] = [
                                    { x: initialPoints[0].x + finalDx, y: initialPoints[0].y + finalDy },
                                    { x: initialPoints[1].x + finalDx, y: initialPoints[1].y + finalDy },
                                ];
                                return { ...el, points: newPoints };
                            }
                            default:
                                return el;
                        }
                    }
                    return el;
                }), false);
                break;
            }
            case 'selectBox': {
                const newX = Math.min(point.x, startCanvasPoint.x);
                const newY = Math.min(point.y, startCanvasPoint.y);
                const newWidth = Math.abs(point.x - startCanvasPoint.x);
                const newHeight = Math.abs(point.y - startCanvasPoint.y);
                const selectionRect = { x: newX, y: newY, width: newWidth, height: newHeight };
                setSelectionBox(selectionRect);

                const pendingIds = elements
                    .filter(el => {
                        const bounds = getElementBounds(el, elements);
                        return (
                            bounds.x < selectionRect.x + selectionRect.width &&
                            bounds.x + bounds.width > selectionRect.x &&
                            bounds.y < selectionRect.y + selectionRect.height &&
                            bounds.y + bounds.height > selectionRect.y
                        );
                    })
                    .map(el => el.id);
                setPendingSelectedIds(pendingIds);
                break;
            }
        }
    };

    const handleMouseUp = (e: MouseEvent | React.MouseEvent) => {
        const commitAndParent = (drawnElementId: string | null) => {
            if (!drawnElementId) {
                commitAction(els => els); // Just commit the current state
                return;
            };

            commitAction(els => {
                const newElement = els.find(e => e.id === drawnElementId);
                if (!newElement) return els;

                const frames = els.filter(e => e.type === 'frame') as FrameElement[];
                if (frames.length === 0) return els;

                const newElBounds = getElementBounds(newElement, els);
                // Find the smallest frame that completely contains the new element
                const containingFrame = frames
                    .filter(frame =>
                        newElBounds.x >= frame.x &&
                        newElBounds.y >= frame.y &&
                        newElBounds.x + newElBounds.width <= frame.x + frame.width &&
                        newElBounds.y + newElBounds.height <= frame.y + frame.height
                    )
                    .sort((a, b) => (a.width * a.height) - (b.width * a.height))[0];

                if (containingFrame && newElement.id !== containingFrame.id) {
                    return els.map(el => el.id === newElement.id ? { ...el, parentId: containingFrame.id } : el);
                }

                return els;
            });
        };

        if (interactionMode.current === 'ai-rotate') {
            if (aiRotationState && Math.abs(aiRotationState.currentValue) > 1) {
                handleAIGenerateCameraMovement(aiRotationState);
            }
            setAiRotationState(null);
        } else if (interactionMode.current) {
            if (interactionMode.current === 'dragElements') {
                commitAction(els => {
                    const movingElementIds = new Set(dragStartElementPositions.current.keys());
                    const frames = els.filter(e => e.type === 'frame') as FrameElement[];

                    return els.map(el => {
                        if (!movingElementIds.has(el.id) || el.type === 'frame') return el;

                        // This element was moved, re-evaluate its parent
                        const elBounds = getElementBounds(el, els);

                        const containingFrame = frames
                            .filter(frame =>
                                elBounds.x >= frame.x &&
                                elBounds.y >= frame.y &&
                                elBounds.x + elBounds.width <= frame.x + frame.width &&
                                elBounds.y + elBounds.height <= frame.y + frame.height
                            )
                            .sort((a, b) => (a.width * a.height) - (b.width * a.height))[0];

                        const newParentId = containingFrame ? containingFrame.id : undefined;

                        if (el.parentId !== newParentId) {
                            return { ...el, parentId: newParentId };
                        }

                        return el;
                    });
                });
            } else if (interactionMode.current === 'selectBox') {
                const startCanvas = getCanvasPoint(startPoint.current.x, startPoint.current.y);
                const endCanvas = getCanvasPoint(e.clientX, e.clientY);
                const selectionRect: Rect = {
                    x: Math.min(startCanvas.x, endCanvas.x),
                    y: Math.min(startCanvas.y, endCanvas.y),
                    width: Math.abs(endCanvas.x - startCanvas.x),
                    height: Math.abs(endCanvas.y - startCanvas.y)
                };

                // Select elements intersecting the selection box
                const selectedIds = elements
                    .filter(el => {
                        const bounds = getElementBounds(el, elements);
                        return (
                            bounds.x < selectionRect.x + selectionRect.width &&
                            bounds.x + bounds.width > selectionRect.x &&
                            bounds.y < selectionRect.y + selectionRect.height &&
                            bounds.y + bounds.height > selectionRect.y
                        );
                    })
                    .map(el => el.id);

                setSelectedElementIds(selectedIds);
            } else if (interactionMode.current === 'lasso' && (point => { return true; })) { // Placeholder
                // Lasso logic...
            } else if (['draw', 'drawShape', 'drawArrow', 'drawLine', 'drawFrame'].includes(interactionMode.current)) {
                commitAndParent(currentDrawingElementId.current);
                if (interactionMode.current !== 'draw') {
                    setActiveTool('select');
                }
            } else if (interactionMode.current === 'rotate' || interactionMode.current?.startsWith('resize-') || interactionMode.current?.startsWith('crop-')) {
                commitAction(els => els);
            }
        }

        interactionMode.current = null;
        startPoint.current = { x: 0, y: 0 };
        currentDrawingElementId.current = null;
        resizeStartInfo.current = null;
        rotateStartInfo.current = null;
        cropStartInfo.current = null;
        dragStartElementPositions.current.clear();
        setLassoPath(null);
        setAlignmentGuides([]);
        setRotationDialPoint(null);
        setSelectionBox(null);
        setPendingSelectedIds([]);
    };

    useEffect(() => {
        const svgElement = svgRef.current;
        if (!svgElement) return;

        const onWheel = (e: globalThis.WheelEvent) => {
            e.preventDefault();
            const currentZoom = zoomRef.current;
            const currentPan = panOffsetRef.current;

            if (e.ctrlKey || e.metaKey) {
                const zoomSensitivity = 0.001;
                const delta = -e.deltaY * zoomSensitivity;
                const newZoom = Math.max(0.1, Math.min(currentZoom * (1 + delta), 10));

                const svgBounds = (e.currentTarget as unknown as HTMLElement).getBoundingClientRect();
                const mouseX = e.clientX - svgBounds.left;
                const mouseY = e.clientY - svgBounds.top;

                const canvasX = (mouseX - currentPan.x) / currentZoom;
                const canvasY = (mouseY - currentPan.y) / currentZoom;

                const newPanX = mouseX - canvasX * newZoom;
                const newPanY = mouseY - canvasY * newZoom;

                updateActiveBoardRef.current((b: any) => ({ ...b, zoom: newZoom, panOffset: { x: newPanX, y: newPanY } }));
            } else {
                updateActiveBoardRef.current((b: any) => ({ ...b, panOffset: { x: b.panOffset.x - e.deltaX, y: b.panOffset.y - e.deltaY } }));
            }
        };

        svgElement.addEventListener('wheel', onWheel, { passive: false });

        return () => {
            svgElement.removeEventListener('wheel', onWheel);
        };
    }, []);

    return {
        handleMouseDown,
        handleMouseMove,
        handleMouseUp,
        getCanvasPoint
    };
};
