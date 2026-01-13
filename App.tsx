import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import JSZip from 'jszip';
import { Toolbar } from './components/Toolbar';
import { PromptBar } from './components/PromptBar';
import { Loader } from './components/Loader';
import { CanvasSettings } from './components/CanvasSettings';
import { LayerPanel } from './components/LayerPanel';
import { BoardPanel } from './components/BoardPanel';
import { PresentationUI } from './components/PresentationUI';
import { SmartToolbar } from './components/SmartToolbar';
import { CanvasElement } from './components/CanvasElement';
import { SelectionOverlay } from './components/SelectionOverlay';
import { useCanvasInteractions } from './hooks/useCanvasInteractions';
import { generateId } from './utils/idUtils';
import { getSelectableElement, getDescendants, getFlattenedSelection, getSelectionBounds } from './utils/selectionUtils';
import { useAIGeneration } from './hooks/useAIGeneration';
import type { Tool, WheelAction, GroupElement, Board, PresentationHotkeys, Guide } from './types';
import {
    Element, ImageElement, PathElement, ShapeElement, TextElement, Point, Rect,
    ArrowElement, LineElement, VideoElement, FrameElement,
    UserEffect, GenerationMode, ImageAspectRatio, Hotkey, AICameraState, RefSelectionState
} from './types';
import { fileToDataUrl } from './utils/fileUtils';
import { cropImageFromElement } from './utils/imageProcessing';
import { editImage } from './services/geminiService';
import { editImageWan } from './services/wanService';
import { translations } from './translations';
import { rotatePoint, isPointInPolygon, getCanvasPoint } from './utils/mathUtils';
import { getElementBounds, rasterizeElement, rasterizeElements } from './utils/elementUtils';

const createNewBoard = (name: string): Board => {
    const id = generateId();
    return {
        id,
        name,
        elements: [],
        history: [[]],
        historyIndex: 0,
        panOffset: { x: 0, y: 0 },
        zoom: 1,
        canvasBackgroundColor: '#111827',
    };
};

interface AIRotationState {
    element: ImageElement;
    center: Point;
    currentAngle: number;
    dragDirection: 'h' | 'v' | null;
    mode: 'subject' | 'camera';
}

const App: React.FC = () => {
    const [boards, setBoards] = useState<Board[]>(() => {
        // TODO: Load from localStorage
        return [createNewBoard('Board 1')];
    });
    const [activeBoardId, setActiveBoardId] = useState<string>(boards[0].id);

    const activeBoard = useMemo(() => boards.find(b => b.id === activeBoardId), [boards, activeBoardId]);

    const { elements: boardElements = [], history = [[]], historyIndex = 0, panOffset: boardPanOffset = { x: 0, y: 0 }, zoom: boardZoom = 1, canvasBackgroundColor = '#111827' } = activeBoard || {};

    const [activeTool, setActiveTool] = useState<Tool>('select');
    const [drawingOptions, setDrawingOptions] = useState({ strokeColor: '#FFFFFF', strokeWidth: 5, opacity: 1 });
    const [selectedElementIds, setSelectedElementIds] = useState<string[]>([]);
    const [elements, setElements] = useState<Element[]>(boardElements); // Initialize with board elements
    const [panOffset, setPanOffset] = useState<Point>(boardPanOffset); // Initialize with board panOffset
    const [zoom, setZoom] = useState<number>(boardZoom); // Initialize with board zoom
    const drawingFileInputRef = useRef<HTMLInputElement>(null);
    const lastClickPositionRef = useRef<{ x: number, y: number } | null>(null);
    const [selectionBox, setSelectionBox] = useState<Rect | null>(null);
    const [pendingSelectedIds, setPendingSelectedIds] = useState<string[]>([]);
    const [prompt, setPrompt] = useState('');
    const [negativePrompt, setNegativePrompt] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isSettingsPanelOpen, setIsSettingsPanelOpen] = useState(false);
    const [isBoardPanelOpen, setIsBoardPanelOpen] = useState(false);
    const [sidePanel, setSidePanel] = useState({ isOpen: false, tab: 'layers' as 'layers' | 'frames' });
    const [wheelAction, setWheelAction] = useState<WheelAction>('zoom');
    const [croppingState, setCroppingState] = useState<{ elementId: string; originalElement: ImageElement; cropBox: Rect } | null>(null);
    const [alignmentGuides, setAlignmentGuides] = useState<Guide[]>([]);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; elementId: string | null } | null>(null);
    const [editingElement, setEditingElement] = useState<{ id: string; text: string; } | null>(null);
    const [lassoPath, setLassoPath] = useState<Point[] | null>(null);
    const [presentationState, setPresentationState] = useState<{ isActive: boolean; currentFrameIndex: number; transition: 'direct' | 'smooth' } | null>(null);
    const [aiRotationState, setAiRotationState] = useState<AIRotationState | null>(null);
    const [rotateDialPoint, setRotateDialPoint] = useState<Point | null>(null);

    const [language, setLanguage] = useState<'en' | 'zho'>('en');
    const [uiTheme, setUiTheme] = useState({ color: '#171717', opacity: 0.7 });
    const [buttonTheme, setButtonTheme] = useState({ color: '#374151', opacity: 0.8 });
    const [toolbarPosition, setToolbarPosition] = useState<'left' | 'right'>('left');

    const [userEffects, setUserEffects] = useState<UserEffect[]>(() => {
        try {
            const saved = localStorage.getItem('userEffects');
            return saved ? JSON.parse(saved) : [];
        } catch (e) {
            console.error("Failed to parse user effects from localStorage", e);
            return [];
        }
    });

    const [generationMode, setGenerationMode] = useState<'image' | 'video'>('image');
    const [videoAspectRatio, setVideoAspectRatio] = useState<'16:9' | '9:16'>('16:9');
    const [imageAspectRatio, setImageAspectRatio] = useState<ImageAspectRatio>('1:1');
    const [numberOfImages, setNumberOfImages] = useState<number>(1);
    const [numberOfVideos, setNumberOfVideos] = useState<number>(1);
    const [modelProvider, setModelProvider] = useState<'gemini' | 'wan'>('wan');
    const [progressMessage, setProgressMessage] = useState<string>('');

    const [generateHotkey, setGenerateHotkey] = useState<Hotkey>({
        key: 'Enter',
        metaOrCtrlKey: true,
        shiftKey: false,
        altKey: false,
    });

    const [presentationHotkeys, setPresentationHotkeys] = useState<PresentationHotkeys>({
        nextSmooth: { key: 'ArrowDown', metaOrCtrlKey: false, shiftKey: false, altKey: false },
        prevSmooth: { key: 'ArrowUp', metaOrCtrlKey: false, shiftKey: false, altKey: false },
        nextDirect: { key: 'ArrowRight', metaOrCtrlKey: false, shiftKey: false, altKey: false },
        prevDirect: { key: 'ArrowLeft', metaOrCtrlKey: false, shiftKey: false, altKey: false },
    });

    const [smartToolbarState, setSmartToolbarState] = useState<{
        top: number;
        left: number;
        show: boolean;
        selectionType: 'single-image' | 'multi-image' | 'none';
    }>({ top: 0, left: 0, show: false, selectionType: 'none' });


    const [refSelectionState, setRefSelectionState] = useState<RefSelectionState | null>(null);
    const latestRefSelectionState = useRef<RefSelectionState | null>(null);
    latestRefSelectionState.current = refSelectionState;
    const refSelectionInteraction = useRef<{ activeHandle: string | null; startPoint: Point | null }>({ activeHandle: null, startPoint: null });

    const interactionMode = useRef<string | null>(null);
    const startPoint = useRef<Point>({ x: 0, y: 0 });
    const currentDrawingElementId = useRef<string | null>(null);
    const resizeStartInfo = useRef<{ originalElement: Element; startCanvasPoint: Point; handle: string; } | null>(null);
    const rotateStartInfo = useRef<{ originalElement: Element; center: Point; startCanvasPoint: Point; } | null>(null);
    const cropStartInfo = useRef<{ originalCropBox: Rect, startCanvasPoint: Point } | null>(null);
    const dragStartElementPositions = useRef<Map<string, { x: number, y: number } | Point[]>>(new Map());
    const elementsRef = useRef(elements);
    const svgRef = useRef<SVGSVGElement>(null);
    const editingTextareaRef = useRef<HTMLTextAreaElement>(null);
    const editingInputRef = useRef<HTMLInputElement>(null);
    const previousToolRef = useRef<Tool>('select');
    const spacebarDownTime = useRef<number | null>(null);
    const animationFrameId = useRef<number | null>(null);
    const shiftEraseOriginalTool = useRef<Tool | null>(null);
    const selectedElementIdsRef = useRef(selectedElementIds);
    selectedElementIdsRef.current = selectedElementIds;
    elementsRef.current = elements;

    const prevActiveBoardId = useRef(activeBoardId);

    // Synchronize local states ONLY when activeBoardId changes (switching boards)
    useEffect(() => {
        if (activeBoardId !== prevActiveBoardId.current) {
            prevActiveBoardId.current = activeBoardId;
            if (activeBoard) {
                setElements(activeBoard.elements);
                setPanOffset(activeBoard.panOffset);
                setZoom(activeBoard.zoom);
            }
            setSelectedElementIds([]);
            setEditingElement(null);
            setCroppingState(null);
            setSelectionBox(null);
            setPrompt('');
            setAiRotationState(null);
        }
    }, [activeBoardId, activeBoard]);

    useEffect(() => {
        try {
            localStorage.setItem('userEffects', JSON.stringify(userEffects));
        } catch (e) {
            console.error("Failed to save user effects to localStorage", e);
        }
    }, [userEffects]);

    useEffect(() => {
        try {
            const savedHotkey = localStorage.getItem('generateHotkey');
            if (savedHotkey) setGenerateHotkey(JSON.parse(savedHotkey));

            const savedPresHotkeys = localStorage.getItem('presentationHotkeys');
            if (savedPresHotkeys) setPresentationHotkeys(JSON.parse(savedPresHotkeys));

        } catch (e) {
            console.error("Failed to load hotkeys from localStorage", e);
        }
    }, []);

    useEffect(() => {
        try {
            localStorage.setItem('generateHotkey', JSON.stringify(generateHotkey));
        } catch (e) {
            console.error("Failed to save generate hotkey to localStorage", e);
        }
    }, [generateHotkey]);

    useEffect(() => {
        try {
            localStorage.setItem('presentationHotkeys', JSON.stringify(presentationHotkeys));
        } catch (e) {
            console.error("Failed to save presentation hotkeys to localStorage", e);
        }
    }, [presentationHotkeys]);

    const handleAddUserEffect = useCallback((effect: UserEffect) => {
        setUserEffects(prev => [...prev, effect]);
    }, []);

    const handleDeleteUserEffect = useCallback((id: string) => {
        setUserEffects(prev => prev.filter(effect => effect.id !== id));
    }, []);

    const t = useCallback((key: string, ...args: any[]): any => {
        const keys = key.split('.');
        let result: any = translations[language];
        for (const k of keys) {
            result = result?.[k];
        }
        if (typeof result === 'function') {
            return result(...args);
        }
        return result || key;
    }, [language]);

    useEffect(() => {
        const root = document.documentElement;
        const hex = uiTheme.color.replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        root.style.setProperty('--ui-bg-color', `rgba(${r}, ${g}, ${b}, ${uiTheme.opacity})`);

        const btnHex = buttonTheme.color.replace('#', '');
        const btnR = parseInt(btnHex.substring(0, 2), 16);
        const btnG = parseInt(btnHex.substring(2, 4), 16);
        const btnB = parseInt(btnHex.substring(4, 6), 16);
        root.style.setProperty('--button-bg-color', `rgba(${btnR}, ${btnG}, ${btnB}, ${buttonTheme.opacity})`);
    }, [uiTheme, buttonTheme]);

    const updateActiveBoard = useCallback((updater: (board: Board) => Board, commit: boolean = false) => {
        setBoards(prevBoards => {
            const nextBoards = prevBoards.map(board => {
                if (board.id !== activeBoardId) return board;

                const updatedBoard = updater(board);

                // Keep local states in sync SYNCHRONOUSLY to avoid extra renders or stale state
                // Use a slight timeout or schedule it to avoid React warning about multiple state updates in one call,
                // but actually React 18 handles this fine if called from an event handler.
                // However, for pure stability and to avoid the "sync ping-pong" loop:
                if (updatedBoard.elements !== board.elements) setElements(updatedBoard.elements);
                if (updatedBoard.panOffset !== board.panOffset) setPanOffset(updatedBoard.panOffset);
                if (updatedBoard.zoom !== board.zoom) setZoom(updatedBoard.zoom);

                if (commit) {
                    const newHistory = [...board.history.slice(0, board.historyIndex + 1), updatedBoard.elements];
                    return {
                        ...updatedBoard,
                        history: newHistory,
                        historyIndex: newHistory.length - 1,
                    };
                }
                return updatedBoard;
            });
            return nextBoards;
        });
    }, [activeBoardId]);

    const setElementsAndCommit = useCallback((updater: (prev: Element[]) => Element[], commit: boolean = true) => {
        updateActiveBoard(board => {
            const newElements = updater(board.elements);
            if (commit) {
                return {
                    ...board,
                    elements: newElements,
                };
            } else {
                const tempHistory = [...board.history];
                tempHistory[board.historyIndex] = newElements;
                return { ...board, elements: newElements, history: tempHistory };
            }
        }, commit);
    }, [updateActiveBoard]);

    const commitAction = useCallback((updater: (prev: Element[]) => Element[]) => {
        updateActiveBoard(board => {
            const newElements = updater(board.elements);
            return {
                ...board,
                elements: newElements,
            };
        }, true);
    }, [updateActiveBoard]);

    const handleUndo = useCallback(() => {
        updateActiveBoard(board => {
            if (board.historyIndex > 0) {
                return { ...board, historyIndex: board.historyIndex - 1, elements: board.history[board.historyIndex - 1] };
            }
            return board;
        });
    }, [activeBoardId]);

    const handleRedo = useCallback(() => {
        updateActiveBoard(board => {
            if (board.historyIndex < board.history.length - 1) {
                return { ...board, historyIndex: board.historyIndex + 1, elements: board.history[board.historyIndex + 1] };
            }
            return board;
        });
    }, [activeBoardId]);

    const addElementsWithParenting = useCallback((elementsToAdd: Element[], commit = true) => {
        const updater = (prev: Element[]): Element[] => {
            const frames = prev.filter(el => el.type === 'frame') as FrameElement[];

            const processedElementsToAdd = elementsToAdd.map(newEl => {
                if (newEl.parentId) return newEl; // Already has a parent
                if (frames.length === 0) return newEl; // No frames to check

                const newElBounds = getElementBounds(newEl, [...prev, ...elementsToAdd]);
                // Find the smallest frame that completely contains the new element
                const containingFrame = frames
                    .filter(frame =>
                        newElBounds.x >= frame.x &&
                        newElBounds.y >= frame.y &&
                        newElBounds.x + newElBounds.width <= frame.x + frame.width &&
                        newElBounds.y + newElBounds.height <= frame.y + frame.height
                    )
                    .sort((a, b) => (a.width * a.height) - (b.width * a.height))[0];

                if (containingFrame) {
                    return { ...newEl, parentId: containingFrame.id };
                }
                return newEl;
            });

            // Upsert logic: Update existing elements or add new ones
            const nextElements = [...prev];
            processedElementsToAdd.forEach(el => {
                const index = nextElements.findIndex(e => e.id === el.id);
                if (index !== -1) {
                    nextElements[index] = el;
                } else {
                    nextElements.push(el);
                }
            });

            return nextElements;
        };

        if (commit) {
            commitAction(updater);
        } else {
            setElementsAndCommit(updater, false);
        }
    }, [commitAction, setElementsAndCommit]);

    const handleStopEditing = useCallback(() => {
        if (!editingElement) return;
        commitAction(prev => prev.map(el => {
            if (el.id === editingElement.id) {
                if (el.type === 'text') {
                    return { ...el, text: editingElement.text };
                }
                if (el.type === 'frame') {
                    return { ...el, name: editingElement.text || 'Frame' };
                }
            }
            return el;
        }));
        setEditingElement(null);
    }, [commitAction, editingElement]);

    const isHotkeyMatch = useCallback((e: KeyboardEvent, hotkey: Hotkey): boolean => {
        if (!hotkey || !hotkey.key) return false;

        let eventKey = e.key;
        if (eventKey === ' ') eventKey = 'Space';

        let hotkeyKey = hotkey.key;
        if (hotkeyKey === ' ') hotkeyKey = 'Space';

        return eventKey.toLowerCase() === hotkeyKey.toLowerCase() &&
            (e.metaKey || e.ctrlKey) === hotkey.metaOrCtrlKey &&
            e.shiftKey === hotkey.shiftKey &&
            e.altKey === hotkey.altKey;
    }, []);

    const zoomToFrame = useCallback((frameId: string, options: { animated?: boolean } = {}) => {
        if (animationFrameId.current) {
            cancelAnimationFrame(animationFrameId.current);
        }

        const frame = elementsRef.current.find(el => el.id === frameId && el.type === 'frame') as FrameElement;
        if (!frame || !svgRef.current) return;

        const svgBounds = svgRef.current.getBoundingClientRect();
        const padding = 50;
        const frameWidth = frame.width;
        const frameHeight = frame.height;
        const viewportWidth = svgBounds.width - padding * 2;
        const viewportHeight = svgBounds.height - padding * 2;

        const newZoom = Math.min(viewportWidth / frameWidth, viewportHeight / frameHeight);
        const clampedZoom = Math.max(0.1, Math.min(newZoom, 10));

        const frameCanvasCenterX = frame.x + frame.width / 2;
        const frameCanvasCenterY = frame.y + frame.height / 2;

        const newPanX = (svgBounds.width / 2) - (frameCanvasCenterX * clampedZoom);
        const newPanY = (svgBounds.height / 2) - (frameCanvasCenterY * clampedZoom);

        if (!options.animated) {
            updateActiveBoard(b => ({ ...b, zoom: clampedZoom, panOffset: { x: newPanX, y: newPanY } }));
            return;
        }

        const startZoom = zoom;
        const startPan = panOffset;
        const duration = 600;
        let startTime: number | null = null;

        const easeInOutCubic = (t: number) => t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;

        const animate = (timestamp: number) => {
            if (!startTime) startTime = timestamp;
            const elapsed = timestamp - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const easedProgress = easeInOutCubic(progress);

            const currentZoom = startZoom + (clampedZoom - startZoom) * easedProgress;
            const currentPanX = startPan.x + (newPanX - startPan.x) * easedProgress;
            const currentPanY = startPan.y + (newPanY - startPan.y) * easedProgress;

            updateActiveBoard(b => ({ ...b, zoom: currentZoom, panOffset: { x: currentPanX, y: currentPanY } }));

            if (progress < 1) {
                animationFrameId.current = requestAnimationFrame(animate);
            } else {
                animationFrameId.current = null;
            }
        };

        animationFrameId.current = requestAnimationFrame(animate);

    }, [zoom, panOffset, activeBoardId, setBoards]);

    const frames = useMemo(() => (elements.filter(el => el.type === 'frame') as FrameElement[]).reverse(), [elements]);


    const handleNavigateWithTransition = useCallback((direction: 'next' | 'prev', transition: 'smooth' | 'direct') => {
        if (!presentationState || frames.length < 2) return;
        const newIndex = direction === 'next'
            ? (presentationState.currentFrameIndex + 1) % frames.length
            : (presentationState.currentFrameIndex - 1 + frames.length) % frames.length;
        setPresentationState(prev => ({ ...prev!, currentFrameIndex: newIndex }));
        zoomToFrame(frames[newIndex].id, { animated: transition === 'smooth' });
    }, [presentationState, frames, zoomToFrame]);


    const handleExitPresentation = useCallback(() => {
        setPresentationState(null);
    }, []);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (presentationState?.isActive) {
                if (isHotkeyMatch(e, presentationHotkeys.nextSmooth)) {
                    e.preventDefault();
                    handleNavigateWithTransition('next', 'smooth');
                } else if (isHotkeyMatch(e, presentationHotkeys.prevSmooth)) {
                    e.preventDefault();
                    handleNavigateWithTransition('prev', 'smooth');
                } else if (isHotkeyMatch(e, presentationHotkeys.nextDirect)) {
                    e.preventDefault();
                    handleNavigateWithTransition('next', 'direct');
                } else if (isHotkeyMatch(e, presentationHotkeys.prevDirect)) {
                    e.preventDefault();
                    handleNavigateWithTransition('prev', 'direct');
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    handleExitPresentation();
                }
                return;
            }

            if (e.key === 'Escape') {
                if (aiRotationState) {
                    setAiRotationState(null);
                    return;
                }
            }

            if (editingElement) {
                if (e.key === 'Escape') handleStopEditing();
                return;
            }

            const target = e.target as HTMLElement;
            const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

            if (e.key === 'Shift' && !e.repeat && !isTyping && (activeTool === 'draw' || activeTool === 'highlighter')) {
                shiftEraseOriginalTool.current = activeTool;
                setActiveTool('erase');
                return;
            }

            if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); handleUndo(); return; }
            if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); handleRedo(); return; }

            if (!isTyping && (e.key === 'Delete' || e.key === 'Backspace')) {
                const currentSelectedIds = selectedElementIdsRef.current;
                if (currentSelectedIds.length > 0) {
                    const currentElements = elementsRef.current;
                    // Filter selection to only include images/videos
                    const imageIdsToDelete = currentElements
                        .filter(el => currentSelectedIds.includes(el.id) && (el.type === 'image' || el.type === 'video'))
                        .map(el => el.id);

                    if (imageIdsToDelete.length > 0) {
                        e.preventDefault();
                        commitAction(prev => {
                            const idsToDelete = new Set(imageIdsToDelete);
                            imageIdsToDelete.forEach(id => {
                                getDescendants(id, prev).forEach(desc => idsToDelete.add(desc.id));
                            });
                            return prev.filter(el => !idsToDelete.has(el.id));
                        });
                        setSelectedElementIds(prev => prev.filter(id => !imageIdsToDelete.includes(id)));
                    }
                }
                return;
            }

            if (e.key === ' ' && !isTyping) {
                e.preventDefault();
                if (spacebarDownTime.current === null) {
                    spacebarDownTime.current = Date.now();
                    previousToolRef.current = activeTool;
                    setActiveTool('pan');
                }
            }
        };

        const handleKeyUp = (e: KeyboardEvent) => {
            if (e.key === 'Shift' && shiftEraseOriginalTool.current) {
                if (activeTool === 'erase') {
                    setActiveTool(shiftEraseOriginalTool.current);
                }
                shiftEraseOriginalTool.current = null;
                return;
            }

            if (e.key === ' ' && !editingElement) {
                const target = e.target as HTMLElement;
                const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
                if (isTyping || spacebarDownTime.current === null) return;

                e.preventDefault();

                const duration = Date.now() - spacebarDownTime.current;
                spacebarDownTime.current = null;

                const toolBeforePan = previousToolRef.current;

                if (duration < 200) { // Tap
                    if (toolBeforePan === 'pan') {
                        setActiveTool('select');
                    } else if (toolBeforePan === 'select') {
                        setActiveTool('pan');
                    } else {
                        setActiveTool('select');
                    }
                } else { // Hold
                    setActiveTool(toolBeforePan);
                }
            }
        };


        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, [handleUndo, handleRedo, selectedElementIds, editingElement, activeTool, commitAction, getDescendants, handleStopEditing, presentationState, presentationHotkeys, handleNavigateWithTransition, isHotkeyMatch, handleExitPresentation, aiRotationState]);

    const handleEditImage = useCallback(async (images: { href: string; mimeType: string }[], prompt: string, targetSize?: { width: number; height: number }, negativePrompt?: string, strength?: number, guidanceScale?: number) => {
        if (modelProvider === 'wan') {
            return editImageWan(images, prompt, setProgressMessage, targetSize, negativePrompt, strength, guidanceScale);
        }
        return editImage(images, prompt, undefined, negativePrompt);
    }, [modelProvider]);

    const {
        handleMouseDown,
        handleMouseMove,
        handleMouseUp,
        getCanvasPoint
    } = useCanvasInteractions({
        svgRef,
        elements,
        elementsRef,
        activeTool,
        setActiveTool,
        selectedElementIds,
        setSelectedElementIds,
        panOffset,
        setPanOffset: (offset) => updateActiveBoard(b => ({ ...b, panOffset: offset })),
        zoom,
        setZoom: (z) => updateActiveBoard(b => ({ ...b, zoom: z })),
        drawingOptions,
        editingElement,
        setEditingElement,
        contextMenu,
        setContextMenu,
        aiRotationState,
        setAiRotationState,
        croppingState,
        setCroppingState,
        setRotationDialPoint: setRotateDialPoint,
        setLassoPath,
        setAlignmentGuides,
        setSelectionBox,
        setPendingSelectedIds,
        interactionMode,
        startPoint,
        currentDrawingElementId,
        resizeStartInfo,
        rotateStartInfo,
        cropStartInfo,
        dragStartElementPositions,
        setElements: setElementsAndCommit,
        addElementsWithParenting,
        commitAction,
        updateActiveBoard,
        isLoading,
        setIsLoading,
        setError,
        setProgressMessage,
        negativePrompt,
        editImage: handleEditImage,
        onDoubleClickCanvas: (point: Point) => {
            lastClickPositionRef.current = point;
            drawingFileInputRef.current?.click();
        }
    });

    const {
        handleGetPromptFromImage,
        handleRemoveBackground,
        handleAutoCombine,
        handleGenerate
    } = useAIGeneration({
        elements, selectedElementIds, zoom, panOffset, prompt, setPrompt,
        negativePrompt, setNegativePrompt,
        imageAspectRatio, numberOfImages, videoAspectRatio, numberOfVideos, generationMode,
        setIsLoading, setError, setProgressMessage, addElementsWithParenting,
        setSelectedElementIds,
        svgRef,
        modelProvider
    });


    const handleAddImageElement = useCallback(async (file: File) => {
        if (!file.type.startsWith('image/')) {
            setError('Only image files are supported.');
            return;
        }
        setError(null);
        try {
            const { dataUrl, mimeType } = await fileToDataUrl(file);
            const img = new Image();
            img.onload = () => {
                let insertPoint;
                if (lastClickPositionRef.current) {
                    insertPoint = lastClickPositionRef.current;
                    lastClickPositionRef.current = null; // Clear it
                } else {
                    if (!svgRef.current) return;
                    const svgBounds = svgRef.current.getBoundingClientRect();
                    const screenCenter = { x: svgBounds.left + svgBounds.width / 2, y: svgBounds.top + svgBounds.height / 2 };
                    insertPoint = getCanvasPoint(screenCenter.x, screenCenter.y);
                }

                const newImage: ImageElement = {
                    id: generateId(),
                    type: 'image',
                    name: file.name,
                    x: insertPoint.x - (img.width / 2),
                    y: insertPoint.y - (img.height / 2),
                    width: img.width,
                    height: img.height,
                    href: dataUrl,
                    mimeType: mimeType,
                    opacity: 1,
                    rotation: 0,
                    borderRadius: 0,
                };
                addElementsWithParenting([newImage]);
                setSelectedElementIds([newImage.id]);
                setActiveTool('select');
            };
            img.src = dataUrl;
        } catch (err) {
            setError('Failed to load image.');
            console.error(err);
        }
    }, [getCanvasPoint, addElementsWithParenting]);








    const handleDeleteElement = (id: string) => {
        commitAction(prev => {
            const idsToDelete = new Set([id]);
            getDescendants(id, prev).forEach(desc => idsToDelete.add(desc.id));
            return prev.filter(el => !idsToDelete.has(el.id));
        });
        setSelectedElementIds(prev => prev.filter(selId => selId !== id));
    };

    const handleDeleteSelection = useCallback(() => {
        if (selectedElementIds.length === 0) return;
        commitAction(prev => {
            const idsToDelete = new Set(selectedElementIds);
            selectedElementIds.forEach(id => {
                getDescendants(id, prev).forEach(desc => idsToDelete.add(desc.id));
            });
            return prev.filter(el => !idsToDelete.has(el.id));
        });
        setSelectedElementIds([]);
    }, [selectedElementIds, commitAction]);

    const handleCopyElement = (elementToCopy: Element) => {
        commitAction(prev => {
            const elementsToCopy = [elementToCopy, ...getDescendants(elementToCopy.id, prev)];
            const idMap = new Map<string, string>();

            const newElements: Element[] = elementsToCopy.map((el: Element): Element => {
                const newId = generateId();
                idMap.set(el.id, newId);
                const dx = 20 / zoom;
                const dy = 20 / zoom;

                switch (el.type) {
                    case 'path':
                        return { ...el, id: newId, points: el.points.map(p => ({ x: p.x + dx, y: p.y + dy })) };
                    case 'arrow': {
                        const newPoints: [Point, Point] = [
                            { x: el.points[0].x + dx, y: el.points[0].y + dy },
                            { x: el.points[1].x + dx, y: el.points[1].y + dy }
                        ];
                        return { ...el, id: newId, x: el.x + dx, y: el.y + dy, points: newPoints };
                    }
                    case 'line': {
                        const newPoints: [Point, Point] = [
                            { x: el.points[0].x + dx, y: el.points[0].y + dy },
                            { x: el.points[1].x + dx, y: el.points[1].y + dy }
                        ];
                        return { ...el, id: newId, x: el.x + dx, y: el.y + dy, points: newPoints };
                    }
                    case 'image':
                        return { ...el, id: newId, x: el.x + dx, y: el.y + dy };
                    case 'shape':
                        return { ...el, id: newId, x: el.x + dx, y: el.y + dy };
                    case 'text':
                        return { ...el, id: newId, x: el.x + dx, y: el.y + dy };
                    case 'group':
                        return { ...el, id: newId, x: el.x + dx, y: el.y + dy };
                    case 'video':
                        return { ...el, id: newId, x: el.x + dx, y: el.y + dy };
                    case 'frame':
                        return { ...el, id: newId, x: el.x + dx, y: el.y + dy, name: `${el.name} Copy` };
                }
            });

            const finalNewElements: Element[] = newElements.map((el: Element): Element => {
                const parentId = el.parentId ? idMap.get(el.parentId) : undefined;
                switch (el.type) {
                    case 'image':
                        return { ...el, parentId };
                    case 'path':
                        return { ...el, parentId };
                    case 'shape':
                        return { ...el, parentId };
                    case 'text':
                        return { ...el, parentId };
                    case 'arrow':
                        return { ...el, parentId };
                    case 'line':
                        return { ...el, parentId };
                    case 'group':
                        return { ...el, parentId };
                    case 'video':
                        return { ...el, parentId };
                    case 'frame':
                        return { ...el, parentId };
                }
            });

            setSelectedElementIds([idMap.get(elementToCopy.id)!]);
            return [...prev, ...finalNewElements];
        });
    };

    const handleCopySelection = () => {
        if (selectedElementIds.length === 0) return;

        commitAction(prev => {
            const elementsToCopy: Element[] = [];
            const selectionSet = new Set(selectedElementIds);

            const topLevelSelected = prev.filter(el => selectionSet.has(el.id));
            const allDescendants = topLevelSelected.flatMap(el => getDescendants(el.id, prev));
            elementsToCopy.push(...topLevelSelected, ...allDescendants);

            const idMap = new Map<string, string>();
            const newTopLevelIds: string[] = [];

            const newElementsUnmapped = elementsToCopy.map((el): Element => {
                const newId = generateId();
                idMap.set(el.id, newId);

                if (selectionSet.has(el.id)) {
                    newTopLevelIds.push(newId);
                }

                const dx = 20 / zoom;
                const dy = 20 / zoom;

                switch (el.type) {
                    case 'path':
                        return { ...el, id: newId, points: el.points.map(p => ({ x: p.x + dx, y: p.y + dy })) };
                    case 'arrow':
                    case 'line':
                        return { ...el, id: newId, x: el.x + dx, y: el.y + dy, points: el.points.map(p => ({ x: p.x + dx, y: p.y + dy })) as [Point, Point] };
                    case 'frame':
                        return { ...el, id: newId, x: el.x + dx, y: el.y + dy, name: `${el.name} Copy` };
                    case 'image':
                    case 'shape':
                    case 'text':
                    case 'group':
                    case 'video':
                        return { ...el, id: newId, x: el.x + dx, y: el.y + dy };
                }
            });

            const finalNewElements = newElementsUnmapped.map(el => {
                if (el.parentId && idMap.has(el.parentId)) {
                    const newParentId = idMap.get(el.parentId);
                    switch (el.type) {
                        case 'image': return { ...el, parentId: newParentId };
                        case 'path': return { ...el, parentId: newParentId };
                        case 'shape': return { ...el, parentId: newParentId };
                        case 'text': return { ...el, parentId: newParentId };
                        case 'arrow': return { ...el, parentId: newParentId };
                        case 'line': return { ...el, parentId: newParentId };
                        case 'group': return { ...el, parentId: newParentId };
                        case 'video': return { ...el, parentId: newParentId };
                        case 'frame': return { ...el, parentId: newParentId };
                    }
                }
                return el;
            }) as Element[];

            setSelectedElementIds(newTopLevelIds);
            return [...prev, ...finalNewElements];
        });
    };

    const handleDownloadImage = (element: ImageElement) => {
        const link = document.createElement('a');
        link.href = element.href;
        link.download = `canvas-image-${element.id}.${element.mimeType.split('/')[1] || 'png'}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleDownloadSelection = async () => {
        try {
            const selectedElements = elements.filter(el => selectedElementIds.includes(el.id));
            const downloadableElements = selectedElements.filter(el => (el.type === 'image' || el.type === 'video') && el.href) as (ImageElement | VideoElement)[];

            if (downloadableElements.length === 0) {
                alert("No downloadable elements found (Images/Videos with valid sources).");
                return;
            }

            if (downloadableElements.length === 1) {
                const element = downloadableElements[0];
                const link = document.createElement('a');
                link.href = element.href;
                const ext = element.type === 'image' ? (element.mimeType?.split('/')[1] || 'png') : 'mp4';
                link.download = `${element.type === 'image' ? 'canvas-image' : 'video'}-${element.id}.${ext}`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            } else {
                // Verify JSZip availability
                if (typeof JSZip === 'undefined') throw new Error("JSZip library not loaded. Please restart the application.");

                const zip = new JSZip();

                const promises = downloadableElements.map(async (element) => {
                    const ext = element.type === 'image' ? (element.mimeType?.split('/')[1] || 'png') : 'mp4';
                    const filename = `${element.type === 'image' ? 'canvas-image' : 'video'}-${element.id}.${ext}`;

                    if (element.href.startsWith('data:')) {
                        const base64Data = element.href.split(',')[1];
                        zip.file(filename, base64Data, { base64: true });
                    } else {
                        try {
                            const response = await fetch(element.href);
                            if (!response.ok) throw new Error(`Fetch status: ${response.status}`);
                            const blob = await response.blob();
                            zip.file(filename, blob);
                        } catch (e) {
                            console.error(`Failed to fetch element ${element.id} for zip`, e);
                            zip.file(`${filename}.error.txt`, `Download failed: ${e}`);
                        }
                    }
                });

                await Promise.all(promises);

                const content = await zip.generateAsync({ type: "blob" });
                const link = document.createElement('a');
                link.href = URL.createObjectURL(content);
                link.download = `canvas_export_${Date.now()}.zip`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                setTimeout(() => URL.revokeObjectURL(link.href), 1000);
            }
        } catch (error: any) {
            console.error("Download selection failed:", error);
            alert(`Download failed: ${error.message}`);
        }
    };

    const handleStartCrop = (element: ImageElement) => {
        setActiveTool('select');
        setAiRotationState(null);
        setCroppingState({
            elementId: element.id,
            originalElement: { ...element },
            cropBox: { x: element.x, y: element.y, width: element.width, height: element.height },
        });
    };

    const handleCancelCrop = () => setCroppingState(null);

    const handleConfirmCrop = () => {
        if (!croppingState) return;
        const { elementId, cropBox } = croppingState;
        const elementToCrop = elementsRef.current.find(el => el.id === elementId) as ImageElement;

        if (!elementToCrop) { handleCancelCrop(); return; }

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = cropBox.width;
            canvas.height = cropBox.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) { setError("Failed to create canvas context for cropping."); handleCancelCrop(); return; }
            const sx = cropBox.x - elementToCrop.x;
            const sy = cropBox.y - elementToCrop.y;
            ctx.drawImage(img, sx, sy, cropBox.width, cropBox.height, 0, 0, cropBox.width, cropBox.height);
            const newHref = canvas.toDataURL(elementToCrop.mimeType);

            commitAction(prev => prev.map(el => {
                if (el.id === elementId && el.type === 'image') {
                    const updatedEl: ImageElement = {
                        ...el,
                        href: newHref,
                        x: cropBox.x,
                        y: cropBox.y,
                        width: cropBox.width,
                        height: cropBox.height
                    };
                    return updatedEl;
                }
                return el;
            }));
            handleCancelCrop();
        };
        img.onerror = () => { setError("Failed to load image for cropping."); handleCancelCrop(); }
        img.src = elementToCrop.href;
    };

    useEffect(() => {
        if (editingElement) {
            const element = elementsRef.current.find(el => el.id === editingElement.id);
            setTimeout(() => {
                if (element?.type === 'text' && editingTextareaRef.current) {
                    editingTextareaRef.current.focus();
                    editingTextareaRef.current.select();
                } else if (element?.type === 'frame' && editingInputRef.current) {
                    editingInputRef.current.focus();
                    editingInputRef.current.select();
                }
            }, 0);
        }
    }, [editingElement]);

    useEffect(() => {
        if (editingElement && editingTextareaRef.current) {
            const textarea = editingTextareaRef.current;
            textarea.style.height = 'auto';
            const newHeight = textarea.scrollHeight;
            textarea.style.height = '';

            const currentElement = elementsRef.current.find(el => el.id === editingElement.id);
            if (currentElement && currentElement.type === 'text' && currentElement.height !== newHeight) {
                setElementsAndCommit(prev => prev.map(el =>
                    el.id === editingElement.id && el.type === 'text'
                        ? { ...el, height: newHeight }
                        : el
                ), false);
            }
        }
    }, [editingElement?.text, setElementsAndCommit]);


    const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); }, []);
    const handleDrop = useCallback((e: React.DragEvent) => { e.preventDefault(); if (e.dataTransfer.files && e.dataTransfer.files[0]) { handleAddImageElement(e.dataTransfer.files[0]); } }, [handleAddImageElement]);

    const handlePropertyChange = (elementId: string, updates: Partial<Element>) => {
        commitAction(prev => prev.map(el => {
            if (el.id === elementId) {
                return { ...el, ...updates } as Element;
            }
            return el;
        }));
    };

    const handleSelectionPropertyChange = (updates: { [key: string]: any }) => {
        commitAction(prev => {
            const selectionSet = new Set(selectedElementIds);
            return prev.map((el): Element => {
                if (selectionSet.has(el.id)) {
                    // Refactored to be type-safe. Checks element type before creating a new object.
                    if ('borderRadius' in updates && (el.type === 'image' || (el.type === 'shape' && el.shapeType === 'rectangle'))) {
                        const newEl: ImageElement | ShapeElement = { ...el, borderRadius: updates.borderRadius };
                        return newEl;
                    }
                    // For other properties, you'd add more checks here.
                    // If no valid property for this element type, return original element.
                    return el;
                }
                return el;
            });
        });
    };

    const handleLayerAction = (elementId: string, action: 'front' | 'back' | 'forward' | 'backward') => {
        commitAction(prev => {
            const elementsCopy = [...prev];
            const index = elementsCopy.findIndex(el => el.id === elementId);
            if (index === -1) return elementsCopy;

            const [element] = elementsCopy.splice(index, 1);

            if (action === 'front') {
                elementsCopy.push(element);
            } else if (action === 'back') {
                elementsCopy.unshift(element);
            } else if (action === 'forward') {
                const newIndex = Math.min(elementsCopy.length, index + 1);
                elementsCopy.splice(newIndex, 0, element);
            } else if (action === 'backward') {
                const newIndex = Math.max(0, index - 1);
                elementsCopy.splice(newIndex, 0, element);
            }
            return elementsCopy;
        });
        setContextMenu(null);
    };

    const handleRasterizeSelection = async () => {
        const flattenedSelection = getFlattenedSelection(selectedElementIds, elements);
        const elementsToRasterize = flattenedSelection.filter(
            (el): el is Exclude<Element, ImageElement | VideoElement | FrameElement | GroupElement> => {
                switch (el.type) {
                    case 'image':
                    case 'video':
                    case 'frame':
                    case 'group':
                        return false;
                    default:
                        return true;
                }
            }
        );

        if (elementsToRasterize.length === 0) return;

        setContextMenu(null);
        setIsLoading(true);
        setError(null);

        try {
            let minX = Infinity, minY = Infinity;
            elementsToRasterize.forEach(element => {
                const bounds = getElementBounds(element, elements);
                minX = Math.min(minX, bounds.x);
                minY = Math.min(minY, bounds.y);
            });

            const { href, mimeType, width, height } = await rasterizeElements(elementsToRasterize);

            const newImage: ImageElement = {
                id: generateId(),
                type: 'image', name: 'Rasterized Image',
                x: minX - 10, // Account for padding used during rasterization
                y: minY - 10, // Account for padding
                width,
                height,
                href,
                mimeType,
                rotation: 0,
            };

            const idsToRemove = new Set(elementsToRasterize.map(el => el.id));

            commitAction(prev => {
                const remainingElements = prev.filter(el => !idsToRemove.has(el.id));
                return [...remainingElements, newImage];
            });

            setSelectedElementIds([newImage.id]);

        } catch (err) {
            const error = err as Error;
            setError(`Failed to rasterize selection: ${error.message}`);
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };



    const handleGroup = () => {
        const selectedElements = elements.filter(el => selectedElementIds.includes(el.id));
        if (selectedElements.length < 2) return;

        const bounds = getSelectionBounds(selectedElementIds, elements);
        const newGroupId = generateId();

        const newGroup: GroupElement = {
            id: newGroupId,
            type: 'group',
            name: 'Group',
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            rotation: 0,
        };

        commitAction(prev => {
            const updatedElements = prev.map(el =>
                selectedElementIds.includes(el.id) ? { ...el, parentId: newGroupId } : el
            );
            return [...updatedElements, newGroup];
        });

        setSelectedElementIds([newGroupId]);
        setContextMenu(null);
    };

    const handleUngroup = () => {
        if (selectedElementIds.length !== 1) return;
        const groupId = selectedElementIds[0];
        const group = elements.find(el => el.id === groupId);
        if (!group || group.type !== 'group') return;

        const childrenIds: string[] = [];
        commitAction(prev => {
            return prev.map(el => {
                if (el.parentId === groupId) {
                    childrenIds.push(el.id);
                    const { parentId, ...rest } = el;
                    return rest as Element;
                }
                return el;
            }).filter(el => el.id !== groupId);
        });

        setSelectedElementIds(childrenIds);
        setContextMenu(null);
    };

    const handleMergeGroup = async () => {
        if (selectedElementIds.length !== 1) return;
        const groupId = selectedElementIds[0];
        const group = elements.find(el => el.id === groupId);
        if (!group || group.type !== 'group') return;

        setIsLoading(true);
        setProgressMessage('Merging layers...');
        setError(null);

        try {
            const allElementsMap = new Map<string, { el: Element, index: number }>(elements.map((el, index) => [el.id, { el, index }]));
            const elementsToMerge = getDescendants(groupId, elements).sort((a, b) =>
                (allElementsMap.get(a.id)?.index ?? 0) - (allElementsMap.get(b.id)?.index ?? 0)
            );

            if (elementsToMerge.length === 0) {
                handleDeleteElement(groupId);
                setIsLoading(false);
                return;
            }

            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            elementsToMerge.forEach(el => {
                if (el.type === 'group') return;
                const bounds = getElementBounds(el, elements);
                minX = Math.min(minX, bounds.x);
                minY = Math.min(minY, bounds.y);
                maxX = Math.max(maxX, bounds.x + bounds.width);
                maxY = Math.max(maxY, bounds.y + bounds.height);
            });

            const width = maxX - minX;
            const height = maxY - minY;

            if (width <= 0 || height <= 0) throw new Error('Group content has no dimensions.');

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Could not get canvas context.');

            for (const el of elementsToMerge) {
                if (el.type === 'group' || el.type === 'frame' || el.type === 'video') continue;

                const elBounds = getElementBounds(el, elements);
                if (elBounds.width <= 0 || elBounds.height <= 0) {
                    continue;
                }

                await new Promise<void>((resolve, reject) => {
                    if (el.type === 'image') {
                        const img = new Image();
                        img.crossOrigin = 'anonymous';
                        img.onload = () => {
                            const relativeX = el.x - minX;
                            const relativeY = el.y - minY;
                            ctx.globalAlpha = el.opacity ?? 1;
                            ctx.drawImage(img, relativeX, relativeY, el.width, el.height);
                            ctx.globalAlpha = 1.0;
                            resolve();
                        };
                        img.onerror = reject;
                        img.src = el.href;
                    } else {
                        rasterizeElement(el).then(({ href }) => {
                            const img = new Image();
                            img.crossOrigin = 'anonymous';
                            img.onload = () => {
                                const relativeX = elBounds.x - minX - 10;
                                const relativeY = elBounds.y - minY - 10;
                                ctx.drawImage(img, relativeX, relativeY);
                                resolve();
                            };
                            img.onerror = reject;
                            img.src = href;
                        }).catch(reject);
                    }
                });
            }

            const mergedImageHref = canvas.toDataURL('image/png');

            const newImage: ImageElement = {
                id: generateId(),
                type: 'image',
                name: `${group.name || 'Group'} Merged`,
                x: minX,
                y: minY,
                width,
                height,
                href: mergedImageHref,
                mimeType: 'image/png',
                rotation: 0,
            };

            const idsToRemove = new Set(elementsToMerge.map(e => e.id).concat(groupId));

            commitAction(prev => {
                const remainingElements = prev.filter(el => !idsToRemove.has(el.id));
                return [...remainingElements, newImage];
            });

            setSelectedElementIds([newImage.id]);

        } catch (err) {
            const error = err as Error;
            setError(`Failed to merge group: ${error.message}`);
        } finally {
            setIsLoading(false);
            setProgressMessage('');
        }
    };


    const handleContextMenu = (e: React.MouseEvent<SVGSVGElement>) => {
        e.preventDefault();
        setContextMenu(null);
        const target = e.target as SVGElement;
        const elementId = target.closest('[data-id]')?.getAttribute('data-id');
        setContextMenu({ x: e.clientX, y: e.clientY, elementId: elementId || null });
    };


    useEffect(() => {
        const handlePaste = (e: ClipboardEvent) => { if (e.clipboardData?.files[0]?.type.startsWith("image/")) { e.preventDefault(); handleAddImageElement(e.clipboardData.files[0]); } };
        window.addEventListener('paste', handlePaste);
        return () => window.removeEventListener('paste', handlePaste);
    }, [handleAddImageElement]);

    const handleAlignSelection = (alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => {
        const selectedElements = elementsRef.current.filter(el => selectedElementIds.includes(el.id));
        if (selectedElements.length < 2) return;

        // Fix: Destructuring was split into two lines to resolve a TypeScript inference issue.
        const bounds = getSelectionBounds(selectedElementIds, elementsRef.current);
        // FIX: Provide default values for destructured properties to satisfy TypeScript compiler.
        const { x: minX = 0, y: minY = 0, width = 0, height = 0 } = bounds;
        const maxX = minX + width;
        const maxY = minY + height;

        const selectionCenterX = minX + width / 2;
        const selectionCenterY = minY + height / 2;

        commitAction(prev => {
            const elementsToUpdate = new Map<string, { dx: number; dy: number }>();

            selectedElements.forEach(el => {
                const bounds = getElementBounds(el, prev);
                let dx = 0;
                let dy = 0;

                switch (alignment) {
                    case 'left': dx = minX - bounds.x; break;
                    case 'center': dx = selectionCenterX - (bounds.x + bounds.width / 2); break;
                    case 'right': dx = maxX - (bounds.x + bounds.width); break;
                    case 'top': dy = minY - bounds.y; break;
                    case 'middle': dy = selectionCenterY - (bounds.y + bounds.height / 2); break;
                    case 'bottom': dy = maxY - (bounds.y + bounds.height); break;
                }

                if (dx !== 0 || dy !== 0) {
                    const elementsToMove = [el, ...getDescendants(el.id, prev)];
                    elementsToMove.forEach(elementToMove => {
                        if (!elementsToUpdate.has(elementToMove.id)) {
                            elementsToUpdate.set(elementToMove.id, { dx, dy });
                        }
                    });
                }
            });

            return prev.map((el: Element): Element => {
                const delta = elementsToUpdate.get(el.id);
                if (!delta) {
                    return el;
                }

                const { dx, dy } = delta;

                switch (el.type) {
                    case 'image':
                        return { ...el, x: el.x + dx, y: el.y + dy };
                    case 'shape':
                        return { ...el, x: el.x + dx, y: el.y + dy };
                    case 'text':
                        return { ...el, x: el.x + dx, y: el.y + dy };
                    case 'group':
                        return { ...el, x: el.x + dx, y: el.y + dy };
                    case 'video':
                        return { ...el, x: el.x + dx, y: el.y + dy };
                    case 'frame':
                        return { ...el, x: el.x + dx, y: el.y + dy };
                    case 'arrow':
                    case 'line': {
                        const newPoints: [Point, Point] = [
                            { x: el.points[0].x + dx, y: el.points[0].y + dy },
                            { x: el.points[1].x + dx, y: el.points[1].y + dy }
                        ];
                        return { ...el, points: newPoints };
                    }
                    case 'path': {
                        const newPoints = el.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
                        return { ...el, points: newPoints };
                    }
                }
            });
        });
    };

    const isElementVisible = useCallback((element: Element, allElements: Element[]): boolean => {
        if (element.isVisible === false) return false;
        if (element.parentId) {
            const parent = allElements.find(el => el.id === element.parentId);
            if (parent) {
                return isElementVisible(parent, allElements);
            }
        }
        return true;
    }, []);


    const isSelectionActive = selectedElementIds.length > 0;
    const singleSelectedElement = selectedElementIds.length === 1 ? elements.find(el => el.id === selectedElementIds[0]) : null;

    useEffect(() => {
        if (selectedElementIds.length > 0 && !croppingState && !editingElement && !aiRotationState && !interactionMode.current) {
            const selectionHasImages = elements.some(
                el => selectedElementIds.includes(el.id) && el.type === 'image'
            );

            if (selectionHasImages) {
                const bounds = getSelectionBounds(selectedElementIds, elements);
                if (!svgRef.current) {
                    setSmartToolbarState(prev => ({ ...prev, show: false }));
                    return;
                }

                const svgBounds = svgRef.current.getBoundingClientRect();
                const screenRight = (bounds.x + bounds.width) * zoom + panOffset.x + svgBounds.left;
                const screenCenterY = bounds.y * zoom + panOffset.y + (bounds.height * zoom / 2) + svgBounds.top;

                let type: 'single-image' | 'multi-image' | 'none' = 'none';
                if (selectedElementIds.length === 1 && elements.find(el => el.id === selectedElementIds[0])?.type === 'image') {
                    type = 'single-image';
                } else if (selectedElementIds.length > 1) {
                    type = 'multi-image';
                }

                if (type !== 'none') {
                    setSmartToolbarState({
                        top: screenCenterY,
                        left: screenRight + 10,
                        show: true,
                        selectionType: type,
                    });
                } else {
                    setSmartToolbarState(prev => ({ ...prev, show: false }));
                }
            } else {
                setSmartToolbarState(prev => ({ ...prev, show: false }));
            }
        } else {
            setSmartToolbarState(prev => ({ ...prev, show: false }));
        }
    }, [selectedElementIds, elements, zoom, panOffset, getSelectionBounds, croppingState, editingElement, aiRotationState]);

    let cursor = 'default';
    if (refSelectionState?.isActive) cursor = 'crosshair';
    else if (croppingState) cursor = 'default';
    else if (interactionMode.current === 'ai-rotate') cursor = 'grabbing';
    else if (aiRotationState) cursor = 'grab';
    else if (interactionMode.current === 'pan') cursor = 'grabbing';
    else if (activeTool === 'pan') cursor = 'grab';
    else if (['draw', 'erase', 'rectangle', 'circle', 'triangle', 'arrow', 'line', 'text', 'highlighter', 'lasso', 'frame'].includes(activeTool)) cursor = 'crosshair';

    // Board Management
    const handleAddBoard = () => {
        const newBoard = createNewBoard(`Board ${boards.length + 1}`);
        setBoards(prev => [...prev, newBoard]);
        setActiveBoardId(newBoard.id);
    };

    const handleDuplicateBoard = (boardId: string) => {
        const boardToDuplicate = boards.find(b => b.id === boardId);
        if (!boardToDuplicate) return;
        const newBoard = {
            ...boardToDuplicate,
            id: generateId(),
            name: `${boardToDuplicate.name} Copy`,
            history: [boardToDuplicate.elements],
            historyIndex: 0,
        };
        setBoards(prev => [...prev, newBoard]);
        setActiveBoardId(newBoard.id);
    };

    const handleDeleteBoard = (boardId: string) => {
        if (boards.length <= 1) return; // Can't delete the last board
        setBoards(prev => prev.filter(b => b.id !== boardId));
        if (activeBoardId === boardId) {
            setActiveBoardId(boards.find(b => b.id !== boardId)!.id);
        }
    };

    const handleRenameBoard = (boardId: string, name: string) => {
        setBoards(prev => prev.map(b => b.id === boardId ? { ...b, name } : b));
    };

    const handleCanvasBackgroundColorChange = (color: string) => {
        updateActiveBoard(b => ({ ...b, canvasBackgroundColor: color }));
    };

    const handleCanvasBackgroundImageChange = async (file: File) => {
        if (!file.type.startsWith('image/')) {
            setError('Only image files can be used as a background.');
            return;
        }
        try {
            const { dataUrl } = await fileToDataUrl(file);
            updateActiveBoard(b => ({ ...b, canvasBackgroundColor: `url(${dataUrl})` }));
        } catch (err) {
            setError('Failed to load background image.');
            console.error(err);
        }
    };

    const generateBoardThumbnail = useCallback((elements: Element[], bgColor: string): string => {
        const THUMB_WIDTH = 120;
        const THUMB_HEIGHT = 80;

        if (elements.length === 0) {
            const emptySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${THUMB_WIDTH}" height="${THUMB_HEIGHT}"><rect width="100%" height="100%" fill="${bgColor}" /></svg>`;
            return `data:image/svg+xml;base64,${btoa(emptySvg)}`;
        }

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        elements.forEach(el => {
            const bounds = getElementBounds(el, elements);
            minX = Math.min(minX, bounds.x);
            minY = Math.min(minY, bounds.y);
            maxX = Math.max(maxX, bounds.x + bounds.width);
            maxY = Math.max(maxY, bounds.y + bounds.height);
        });

        const contentWidth = maxX - minX;
        const contentHeight = maxY - minY;

        if (contentWidth <= 0 || contentHeight <= 0) {
            const emptySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${THUMB_WIDTH}" height="${THUMB_HEIGHT}"><rect width="100%" height="100%" fill="${bgColor}" /></svg>`;
            return `data:image/svg+xml;base64,${btoa(emptySvg)}`;
        }

        const scale = Math.min(THUMB_WIDTH / contentWidth, THUMB_HEIGHT / contentHeight) * 0.9;
        const dx = (THUMB_WIDTH - contentWidth * scale) / 2 - minX * scale;
        const dy = (THUMB_HEIGHT - contentHeight * scale) / 2 - minY * scale;

        const svgContent = elements.map(el => {
            if (el.type === 'path') {
                const pathData = el.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
                return `<path d="${pathData}" stroke="${el.strokeColor}" stroke-width="${el.strokeWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="${el.opacity || 1}" />`;
            }
            if (el.type === 'image') {
                return `<image href="${el.href}" x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" opacity="${el.opacity ?? 1}"/>`;
            }
            // Add other element types for more accurate thumbnails if needed
            return '';
        }).join('');

        const fullSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${THUMB_WIDTH}" height="${THUMB_HEIGHT}"><rect width="100%" height="100%" fill="${bgColor}" /><g transform="translate(${dx} ${dy}) scale(${scale})">${svgContent}</g></svg>`;
        return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(fullSvg)))}`;
    }, []);

    const handleStartPresentation = () => {
        if (frames.length === 0) return;
        setSidePanel(prev => ({ ...prev, isOpen: false }));
        setPresentationState({ isActive: true, currentFrameIndex: 0, transition: 'smooth' });
        zoomToFrame(frames[0].id, { animated: true });
    };

    const handleNavigatePresentation = (direction: 'next' | 'prev') => {
        if (!presentationState || frames.length < 2) return;

        const newIndex = direction === 'next'
            ? (presentationState.currentFrameIndex + 1) % frames.length
            : (presentationState.currentFrameIndex - 1 + frames.length) % frames.length;

        setPresentationState(prev => ({ ...prev!, currentFrameIndex: newIndex }));
        zoomToFrame(frames[newIndex].id, { animated: presentationState.transition === 'smooth' });
    };

    const handleToggleSidePanel = (tab: 'layers' | 'frames') => {
        setSidePanel(prev => ({
            tab,
            isOpen: prev.tab === tab ? !prev.isOpen : true
        }));
    };

    const handleReorderElements = (draggedId: string, targetId: string, position: 'before' | 'after') => {
        commitAction(prev => {
            const elementsCopy = [...prev];
            const draggedIndex = elementsCopy.findIndex(el => el.id === draggedId);
            if (draggedIndex === -1) return prev;

            const [element] = elementsCopy.splice(draggedIndex, 1);

            const targetIndex = elementsCopy.findIndex(el => el.id === targetId);
            if (targetIndex === -1) {
                // Fallback: move to end
                elementsCopy.push(element);
                return elementsCopy;
            }

            const finalIndex = position === 'before' ? targetIndex : targetIndex + 1;
            elementsCopy.splice(finalIndex, 0, element);

            return elementsCopy;
        });
    };

    const handleSetActiveTool = useCallback((tool: Tool) => {
        setActiveTool(tool);
        setAiRotationState(null);
        if (tool === 'highlighter') {
            setDrawingOptions(o => ({ ...o, opacity: 0.5 }));
        } else if (tool === 'draw') {
            setDrawingOptions(o => ({ ...o, opacity: 1.0 }));
        }
    }, []);

    const handleFrameAspectRatioChange = (frameId: string, aspectRatio: string) => {
        const frame = elementsRef.current.find(el => el.id === frameId && el.type === 'frame') as FrameElement;
        if (!frame) return;

        const [w, h] = aspectRatio.split(':').map(Number);
        const targetRatio = w / h;

        const currentWidth = frame.width;
        const currentHeight = frame.height;
        const currentRatio = currentWidth / currentHeight;

        const centerX = frame.x + currentWidth / 2;
        const centerY = frame.y + currentHeight / 2;

        let newWidth, newHeight;

        if (currentRatio > targetRatio) {
            newWidth = currentHeight * targetRatio;
            newHeight = currentHeight;
        } else {
            newHeight = currentWidth / targetRatio;
            newWidth = currentWidth;
        }

        const newX = centerX - newWidth / 2;
        const newY = centerY - newHeight / 2;

        commitAction(prev => prev.map(el => {
            if (el.id === frameId && el.type === 'frame') {
                return { ...el, width: newWidth, height: newHeight, x: newX, y: newY };
            }
            return el;
        }));
    };

    const handleStartAIRotate = () => {
        if (singleSelectedElement && singleSelectedElement.type === 'image') {
            const element = singleSelectedElement;
            const bounds = getElementBounds(element, elements);
            setAiRotationState({
                element,
                center: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
                currentValue: 0,
                dragDirection: null,
                mode: 'subject',
                movementType: 'rotate',
            });
            setSelectedElementIds([]); // Deselect to hide standard handles
            setCroppingState(null);
        }
    };

    const handleStartAICameraShift = () => {
        if (singleSelectedElement && singleSelectedElement.type === 'image') {
            const element = singleSelectedElement;
            const bounds = getElementBounds(element, elements);
            setAiRotationState({
                element,
                center: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
                currentValue: 0,
                dragDirection: null,
                mode: 'camera',
                movementType: 'rotate', // Default to rotate/tilt
            });
            setSelectedElementIds([]); // Deselect to hide standard handles
            setCroppingState(null);
        }
    };

    const handleStartRefSelection = () => {
        if (singleSelectedElement && singleSelectedElement.type === 'image') {
            setRefSelectionState({
                isActive: true,
                elementId: singleSelectedElement.id,
                box: null,
                startPoint: null,
            });
            interactionMode.current = 'select-ref';
            setSmartToolbarState(prev => ({ ...prev, show: false }));
        }
    };

    const handleConfirmRefSelection = async () => {
        if (!refSelectionState?.box) return;

        const element = elements.find(el => el.id === refSelectionState.elementId) as ImageElement;
        if (!element) return;

        try {
            const cropResult = await cropImageFromElement(element, refSelectionState.box);

            const newElement: ImageElement = {
                id: generateId(),
                type: 'image',
                name: 'Ref Image',
                x: refSelectionState.box.x,
                y: refSelectionState.box.y,
                width: refSelectionState.box.width,
                height: refSelectionState.box.height,
                href: cropResult.url,
                naturalWidth: cropResult.width,
                naturalHeight: cropResult.height,
                mimeType: 'image/png',
            };

            addElementsWithParenting([newElement]);
            setSelectedElementIds([newElement.id]);
        } catch (error) {
            console.error('Failed to crop reference selection', error);
        } finally {
            setRefSelectionState(null);
            interactionMode.current = null;
        }
    };

    const handleCancelRefSelection = () => {
        setRefSelectionState(null);
        interactionMode.current = null;
    };

    const canvasStyle: React.CSSProperties = {};
    if (presentationState?.isActive) {
        canvasStyle.backgroundColor = '#000';
    } else if (canvasBackgroundColor?.startsWith('url(')) {
        canvasStyle.backgroundImage = canvasBackgroundColor;
        canvasStyle.backgroundSize = 'cover';
        canvasStyle.backgroundPosition = 'center';
        canvasStyle.backgroundColor = '#111827'; // Fallback
    } else {
        canvasStyle.backgroundColor = canvasBackgroundColor;
    }

    const handleRefSelectionPointerDown = (e: React.PointerEvent) => {
        const currentState = latestRefSelectionState.current;
        if (!currentState?.isActive) {
            handleMouseDown(e);
            return;
        }

        e.stopPropagation();
        if (svgRef.current) {
            let pt = getCanvasPoint(e.clientX, e.clientY);

            // Manual Hit Test
            const { box } = currentState;
            let hitHandle = null;

            if (box && box.width > 0) {
                const { x, y, width, height } = box;
                const hitSize = 12 / zoom;

                const handles = [
                    { name: 'tl', hx: x, hy: y },
                    { name: 'tm', hx: x + width / 2, hy: y },
                    { name: 'tr', hx: x + width, hy: y },
                    { name: 'ml', hx: x, hy: y + height / 2 },
                    { name: 'mr', hx: x + width, hy: y + height / 2 },
                    { name: 'bl', hx: x, hy: y + height },
                    { name: 'bm', hx: x + width / 2, hy: y + height },
                    { name: 'br', hx: x + width, hy: y + height }
                ];

                for (const h of handles) {
                    if (Math.abs(pt.x - h.hx) <= hitSize / 2 && Math.abs(pt.y - h.hy) <= hitSize / 2) {
                        hitHandle = h.name;
                        break;
                    }
                }

                if (!hitHandle) {
                    if (pt.x >= x && pt.x <= x + width && pt.y >= y && pt.y <= y + height) {
                        hitHandle = 'move';
                    }
                }
            }

            refSelectionInteraction.current = { activeHandle: hitHandle, startPoint: pt };

            if (hitHandle) {
                setRefSelectionState(prev => prev ? ({ ...prev, activeHandle: hitHandle, startPoint: pt }) : null);
                return;
            }

            const element = elements.find(el => el.id === currentState.elementId);
            if (element && element.type === 'image') {
                pt.x = Math.max(element.x, Math.min(element.x + element.width, pt.x));
                pt.y = Math.max(element.y, Math.min(element.y + element.height, pt.y));
                refSelectionInteraction.current.startPoint = pt;
            }

            setRefSelectionState(prev => prev ? ({ ...prev, startPoint: pt, activeHandle: null, box: { x: pt.x, y: pt.y, width: 0, height: 0 } }) : null);
        }
    };

    const handleRefSelectionPointerMove = (e: React.PointerEvent) => {
        const currentState = latestRefSelectionState.current;
        if (!currentState?.isActive) {
            handleMouseMove(e);
            return;
        }

        if (e.buttons === 0) {
            handleMouseMove(e);
            return;
        }

        if (svgRef.current) {
            e.stopPropagation();
            let pt = getCanvasPoint(e.clientX, e.clientY);
            const element = elements.find(el => el.id === currentState.elementId);

            const { activeHandle, startPoint: refStart } = refSelectionInteraction.current;
            if (!refStart) return;

            if (activeHandle === 'move') {
                const dx = pt.x - refStart.x;
                const dy = pt.y - refStart.y;
                let newBox = { ...currentState.box! };
                newBox.x += dx;
                newBox.y += dy;
                if (element) {
                    if (newBox.x < element.x) newBox.x = element.x;
                    if (newBox.y < element.y) newBox.y = element.y;
                    if (newBox.x + newBox.width > element.x + element.width) newBox.x = element.x + element.width - newBox.width;
                    if (newBox.y + newBox.height > element.y + element.height) newBox.y = element.y + element.height - newBox.height;
                }
                setRefSelectionState(prev => prev ? ({ ...prev, box: newBox, startPoint: pt }) : null);
                refSelectionInteraction.current.startPoint = pt;
                return;
            }

            if (activeHandle) {
                let { x, y, width, height } = currentState.box!;
                let clampedPt = { ...pt };
                if (element) {
                    clampedPt.x = Math.max(element.x, Math.min(element.x + element.width, pt.x));
                    clampedPt.y = Math.max(element.y, Math.min(element.y + element.height, pt.y));
                }
                const h = activeHandle;
                if (h.includes('l')) { const nw = (x + width) - clampedPt.x; if (nw > 0) { width = nw; x = clampedPt.x; } }
                if (h.includes('r')) { width = clampedPt.x - x; }
                if (h.includes('t')) { const nh = (y + height) - clampedPt.y; if (nh > 0) { height = nh; y = clampedPt.y; } }
                if (h.includes('b')) { height = clampedPt.y - y; }

                if (width < 0) { width = Math.abs(width); x -= width; }
                if (height < 0) { height = Math.abs(height); y -= height; }

                setRefSelectionState(prev => prev ? ({ ...prev, box: { x, y, width, height } }) : null);
                return;
            }

            // Create Logic
            let start = refStart;
            if (element && element.type === 'image') {
                pt.x = Math.max(element.x, Math.min(element.x + element.width, pt.x));
                pt.y = Math.max(element.y, Math.min(element.y + element.height, pt.y));
            }
            const x = Math.min(start.x, pt.x);
            const y = Math.min(start.y, pt.y);
            const w = Math.abs(pt.x - start.x);
            const h = Math.abs(pt.y - start.y);
            setRefSelectionState(prev => prev ? ({ ...prev, box: { x, y, width: w, height: h } }) : null);
        }
    };

    const handleRefSelectionPointerUp = (e: React.PointerEvent) => {
        refSelectionInteraction.current = { activeHandle: null, startPoint: null };
        const currentState = latestRefSelectionState.current;

        if (!currentState?.isActive) {
            handleMouseUp(e);
            return;
        }

        if (currentState.startPoint || currentState.activeHandle) {
            e.stopPropagation();
            setRefSelectionState(prev => prev ? ({ ...prev, startPoint: null, activeHandle: null }) : null);
        }
    };

    return (
        <div className="w-screen h-screen flex flex-col font-sans relative" style={canvasStyle} onDragOver={handleDragOver} onDrop={handleDrop}>
            {isLoading && <Loader progressMessage={progressMessage} />}
            <input
                id="drawing-file-input"
                name="drawing-file"
                type="file"
                ref={drawingFileInputRef}
                style={{ display: 'none' }}
                accept="image/*"
                onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                        handleAddImageElement(e.target.files[0]);
                        e.target.value = ''; // Reset input
                    }
                }}
            />
            {error && (
                <div className="fixed bottom-4 left-4 z-50 p-3 bg-red-100 border border-red-400 text-red-700 rounded-md shadow-lg flex items-start max-w-md animate-in slide-in-from-bottom-2 duration-200">
                    <span className="flex-1 mr-3 text-xs break-words whitespace-normal min-w-0 max-h-32 overflow-y-auto pr-1">{error}</span>
                    <button onClick={() => setError(null)} className="p-1 rounded-full hover:bg-red-200 shrink-0 mt-0.5" title={t('common.close')}>
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"></path></svg>
                    </button>
                </div>
            )}
            {!presentationState?.isActive && (
                <>
                    <div className="absolute top-4 left-4 z-20">
                        <button
                            onClick={() => setIsBoardPanelOpen(prev => !prev)}
                            style={{ backgroundColor: 'var(--ui-bg-color)' }}
                            title={t('toolbar.boards')}
                            className="w-12 h-12 flex items-center justify-center backdrop-blur-xl border border-white/10 rounded-full shadow-2xl text-white hover:bg-white/20 transition-colors"
                        >
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
                        </button>
                    </div>

                    <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
                        <div
                            style={{ backgroundColor: 'var(--ui-bg-color)' }}
                            className="flex items-center gap-1 p-1 backdrop-blur-xl border border-white/10 rounded-full shadow-2xl"
                        >
                            <button
                                onClick={handleStartPresentation}
                                title={t('sidePanel.present')}
                                disabled={frames.length === 0}
                                className="p-2 rounded-full text-white hover:bg-white/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                            </button>
                            <div className="w-px h-5 bg-white/20 mx-1"></div>
                            <button onClick={() => handleToggleSidePanel('layers')} title={t('toolbar.layers')} className="p-2 rounded-full text-white hover:bg-white/20 transition-colors"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg></button>
                            <button onClick={() => handleToggleSidePanel('frames')} title={t('toolbar.frames')} className="p-2 rounded-full text-white hover:bg-white/20 transition-colors"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="9" x2="20" y2="9"></line><line x1="4" y1="15" x2="20" y2="15"></line><line x1="9" y1="4" x2="9" y2="20"></line><line x1="15" y1="4" x2="15" y2="20"></line></svg></button>
                            <div className="w-px h-5 bg-white/20 mx-1"></div>
                            <button onClick={() => setIsSettingsPanelOpen(true)} title={t('toolbar.settings')} className="p-2 rounded-full text-white hover:bg-white/20 transition-colors"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06-.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg></button>
                        </div>
                    </div>

                    <BoardPanel
                        isOpen={isBoardPanelOpen}
                        onClose={() => setIsBoardPanelOpen(false)}
                        boards={boards}
                        activeBoardId={activeBoardId}
                        onSwitchBoard={setActiveBoardId}
                        onAddBoard={handleAddBoard}
                        onRenameBoard={handleRenameBoard}
                        onDuplicateBoard={handleDuplicateBoard}
                        onDeleteBoard={handleDeleteBoard}
                        generateBoardThumbnail={(els) => generateBoardThumbnail(els, activeBoard?.canvasBackgroundColor ?? '#111827')}
                    />
                    <CanvasSettings
                        isOpen={isSettingsPanelOpen}
                        onClose={() => setIsSettingsPanelOpen(false)}
                        canvasBackgroundColor={canvasBackgroundColor}
                        onCanvasBackgroundColorChange={handleCanvasBackgroundColorChange}
                        onCanvasBackgroundImageChange={handleCanvasBackgroundImageChange}
                        language={language}
                        setLanguage={setLanguage}
                        uiTheme={uiTheme}
                        setUiTheme={setUiTheme}
                        buttonTheme={buttonTheme}
                        setButtonTheme={setButtonTheme}
                        wheelAction={wheelAction}
                        setWheelAction={setWheelAction}
                        toolbarPosition={toolbarPosition}
                        setToolbarPosition={setToolbarPosition}
                        generateHotkey={generateHotkey}
                        setGenerateHotkey={setGenerateHotkey}
                        presentationHotkeys={presentationHotkeys}
                        setPresentationHotkeys={setPresentationHotkeys}
                        t={t}
                    />
                    <Toolbar
                        t={t}
                        activeTool={activeTool}
                        setActiveTool={handleSetActiveTool}
                        drawingOptions={drawingOptions}
                        setDrawingOptions={setDrawingOptions}
                        onUpload={handleAddImageElement}
                        isCropping={!!croppingState}
                        onConfirmCrop={handleConfirmCrop}
                        onCancelCrop={handleCancelCrop}
                        // FIX: Changed onUndo to handleUndo, which is the correct function name.
                        onUndo={handleUndo}
                        onRedo={handleRedo}
                        canUndo={historyIndex > 0}
                        canRedo={historyIndex < history.length - 1}
                        position={toolbarPosition}
                    />
                    <LayerPanel
                        t={t}
                        isOpen={sidePanel.isOpen}
                        onClose={() => setSidePanel(prev => ({ ...prev, isOpen: false }))}
                        activeTab={sidePanel.tab}
                        setActiveTab={(tab) => setSidePanel(prev => ({ ...prev, tab }))}
                        elements={elements}
                        selectedElementIds={selectedElementIds}
                        onSelectElement={id => setSelectedElementIds(id ? [id] : [])}
                        onToggleVisibility={id => handlePropertyChange(id, { isVisible: !(elements.find(el => el.id === id)?.isVisible ?? true) })}
                        onToggleLock={id => handlePropertyChange(id, { isLocked: !(elements.find(el => el.id === id)?.isLocked ?? false) })}
                        onRenameElement={(id, name) => handlePropertyChange(id, { name })}
                        onReorder={handleReorderElements}
                        frames={frames}
                        onSelectFrame={(id) => zoomToFrame(id, { animated: true })}
                        onDeleteFrame={handleDeleteElement}
                    />
                </>
            )}

            <SmartToolbar
                isVisible={smartToolbarState.show}
                top={smartToolbarState.top}
                left={smartToolbarState.left}
                selectionType={smartToolbarState.selectionType}
                onRemoveBackground={() => handleRemoveBackground(singleSelectedElement as ImageElement)}
                onGetPrompt={() => handleGetPromptFromImage(singleSelectedElement as ImageElement)}
                onAutoCombine={handleAutoCombine}
                onAIRotate={handleStartAIRotate}
                onAICameraShift={handleStartAICameraShift}
                t={t}
            />

            <div className="flex-grow relative overflow-hidden">
                <svg
                    ref={svgRef}
                    className="absolute top-0 left-0 w-full h-full touch-none"
                    onPointerDown={handleRefSelectionPointerDown}
                    onPointerMove={handleRefSelectionPointerMove}
                    onPointerUp={handleRefSelectionPointerUp}
                    onPointerLeave={handleRefSelectionPointerUp}
                    onContextMenu={handleContextMenu}
                    style={{ cursor }}
                >
                    <defs>
                        <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                            <circle cx="1" cy="1" r="1" className="fill-gray-400 opacity-50" />
                        </pattern>
                        {elements.map(el => {
                            if (el.type === 'image' && el.borderRadius && el.borderRadius > 0) {
                                return (
                                    <clipPath key={`clip-${el.id}`} id={`clip-${el.id}`}>
                                        <rect
                                            x={el.x}
                                            y={el.y}
                                            width={el.width}
                                            height={el.height}
                                            rx={el.borderRadius}
                                            ry={el.borderRadius}
                                        />
                                    </clipPath>
                                );
                            }
                            return null;
                        })}
                    </defs>
                    <g transform={`translate(${panOffset.x}, ${panOffset.y}) scale(${zoom})`}>
                        <rect x={-panOffset.x / zoom} y={-panOffset.y / zoom} width={`calc(100% / ${zoom})`} height={`calc(100% / ${zoom})`} fill={presentationState?.isActive ? 'transparent' : 'url(#grid)'} />

                        {elements.map(el => {
                            if (!isElementVisible(el, elements)) return null;

                            const isSelected = selectedElementIds.includes(el.id);
                            const isPendingSelected = pendingSelectedIds.includes(el.id);
                            const bounds = getElementBounds(el, elements);
                            const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
                            const rotation = 'rotation' in el && el.rotation ? el.rotation : 0;
                            const flipX = el.flipX ? -1 : 1;
                            const flipY = el.flipY ? -1 : 1;

                            let transform = '';
                            if (rotation !== 0) transform += `rotate(${rotation} ${center.x} ${center.y}) `;
                            if (el.flipX || el.flipY) {
                                transform += `translate(${center.x} ${center.y}) scale(${flipX} ${flipY}) translate(${-center.x} ${-center.y})`;
                            }

                            return (
                                <g key={el.id} data-id={el.id} transform={transform}>
                                    <CanvasElement
                                        element={el}
                                        zoom={zoom}
                                        isSelected={isSelected}
                                        isPendingSelected={isPendingSelected}
                                        isEditing={editingElement?.id === el.id}
                                        croppingState={croppingState}
                                        onEditStart={(id, text) => setEditingElement({ id, text })}
                                    />
                                </g>
                            );
                        })}

                        {/* Global Selection Overlay */}
                        {!croppingState && !aiRotationState && (
                            <>
                                {selectedElementIds.length > 0 && (
                                    <SelectionOverlay
                                        elements={elements}
                                        selectedElementIds={selectedElementIds}
                                        zoom={zoom}
                                        showHandles={true}
                                        onRotationHandleYChange={() => { }}
                                    />
                                )}
                                {pendingSelectedIds.length > 0 && (
                                    <SelectionOverlay
                                        elements={elements}
                                        selectedElementIds={pendingSelectedIds}
                                        zoom={zoom}
                                        showHandles={false}
                                        onRotationHandleYChange={() => { }}
                                    />
                                )}
                            </>
                        )}

                        {lassoPath && (
                            <path d={lassoPath.map((p, i) => i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`).join(' ')} stroke="rgb(59 130 246)" strokeWidth={1 / zoom} strokeDasharray={`${4 / zoom} ${4 / zoom}`} fill="rgba(59, 130, 246, 0.1)" />
                        )}

                        {alignmentGuides.map((guide, i) => (
                            <line key={i} x1={guide.type === 'v' ? guide.position : guide.start} y1={guide.type === 'h' ? guide.position : guide.start} x2={guide.type === 'v' ? guide.position : guide.end} y2={guide.type === 'h' ? guide.position : guide.end} stroke="red" strokeWidth={1 / zoom} strokeDasharray={`${4 / zoom} ${2 / zoom}`} />
                        ))}

                        {selectedElementIds.length > 0 && !croppingState && !editingElement && !aiRotationState && (() => {
                            if (selectedElementIds.length > 1) {
                                const selectedElements = elements.filter(el => selectedElementIds.includes(el.id));
                                const hasRasterizableElements = selectedElements.some(el => {
                                    switch (el.type) {
                                        case 'image':
                                        case 'video':
                                        case 'group':
                                        case 'frame':
                                            return false;
                                        default:
                                            return true;
                                    }
                                });

                                const hasDownloadableElements = selectedElements.some(el => el.type === 'image' || el.type === 'video');

                                let toolbarScreenWidth = 323 + 112;
                                if (hasRasterizableElements) toolbarScreenWidth += 36;
                                if (hasDownloadableElements) toolbarScreenWidth += 36;

                                const toolbarScreenHeight = 48;

                                const bounds = getSelectionBounds(selectedElementIds, elements);
                                const toolbarCanvasWidth = toolbarScreenWidth / zoom;
                                const toolbarCanvasHeight = toolbarScreenHeight / zoom;

                                const x = bounds.x + bounds.width / 2 - (toolbarCanvasWidth / 2);
                                const y = bounds.y - toolbarCanvasHeight - (10 / zoom);

                                const toolbar = <div
                                    style={{ transform: `scale(${1 / zoom})`, transformOrigin: 'top left', width: `${toolbarScreenWidth}px`, height: `${toolbarScreenHeight}px` }}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    onPointerDown={(e) => e.stopPropagation()}
                                >
                                    <div style={{ backgroundColor: 'var(--ui-bg-color)' }} className="h-full p-1 backdrop-blur-xl border border-white/10 rounded-full shadow-2xl flex items-center justify-center gap-1 text-white">
                                        <button title={t('contextMenu.copy')} onClick={handleCopySelection} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>
                                        <button title={t('contextMenu.group')} onClick={handleGroup} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg></button>
                                        {hasDownloadableElements && (
                                            <button title={t('contextMenu.download')} onClick={handleDownloadSelection} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors flex items-center justify-center">
                                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                                            </button>
                                        )}
                                        {hasRasterizableElements && (
                                            <button title={t('contextMenu.rasterize')} onClick={handleRasterizeSelection} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors">
                                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5" /><path d="M8 3H3v5" /><path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3" /><path d="m3 16 7-7" /><path d="m21 3-7.873 7.873a4 4 0 0 0-1.127 2.828V22" /></svg>
                                            </button>
                                        )}
                                        <div className="h-5 w-px bg-white/20"></div>
                                        <button title={t('contextMenu.alignment.alignLeft')} onClick={() => handleAlignSelection('left')} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="21" x2="4" y2="3"></line><rect x="8" y="6" width="8" height="4" rx="1"></rect><rect x="8" y="14" width="12" height="4" rx="1"></rect></svg></button>
                                        <button title={t('contextMenu.alignment.alignCenter')} onClick={() => handleAlignSelection('center')} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="21" x2="12" y2="3" strokeDasharray="2 2"></line><rect x="7" y="6" width="10" height="4" rx="1"></rect><rect x="4" y="14" width="16" height="4" rx="1"></rect></svg></button>
                                        <button title={t('contextMenu.alignment.alignRight')} onClick={() => handleAlignSelection('right')} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="20" y1="21" x2="20" y2="3"></line><rect x="12" y="6" width="8" height="4" rx="1"></rect><rect x="8" y="14" width="12" height="4" rx="1"></rect></svg></button>
                                        <div className="h-5 w-px bg-white/20"></div>
                                        <button title={t('contextMenu.alignment.alignTop')} onClick={() => handleAlignSelection('top')} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="4" x2="21" y2="4"></line><rect x="6" y="8" width="4" height="8" rx="1"></rect><rect x="14" y="8" width="4" height="12" rx="1"></rect></svg></button>
                                        <button title={t('contextMenu.alignment.alignMiddle')} onClick={() => handleAlignSelection('middle')} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="12" x2="21" y2="12" strokeDasharray="2 2"></line><rect x="6" y="7" width="4" height="10" rx="1"></rect><rect x="14" y="4" width="4" height="16" rx="1"></rect></svg></button>
                                        <button title={t('contextMenu.alignment.alignBottom')} onClick={() => handleAlignSelection('bottom')} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="20" x2="21" y2="20"></line><rect x="6" y="12" width="4" height="8" rx="1"></rect><rect x="14" y="8" width="4" height="12" rx="1"></rect></svg></button>
                                        <div className="h-5 w-px bg-white/20"></div>
                                        <button title={t('contextMenu.flipX')} onClick={() => handleSelectionPropertyChange({ flipX: !selectedElements.every(el => el.flipX) })} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors">
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3H9v18h6V3zM21 8l-6 10M3 8l6 10" /></svg>
                                        </button>
                                        <button title={t('contextMenu.flipY')} onClick={() => handleSelectionPropertyChange({ flipY: !selectedElements.every(el => el.flipY) })} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors">
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="rotate-90"><path d="M15 3H9v18h6V3zM21 8l-6 10M3 8l6 10" /></svg>
                                        </button>
                                        <button title={t('contextMenu.rotate')} onClick={() => {
                                            const firstRotation = (selectedElements[0] as any).rotation || 0;
                                            const nextRotation = (firstRotation + 90) % 360;
                                            handleSelectionPropertyChange({ rotation: nextRotation });
                                        }} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors">
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /><path d="M22 4h-4v4" /></svg>
                                        </button>
                                        <div className="h-5 w-px bg-white/20"></div>
                                        <button title={t('contextMenu.delete')} onClick={handleDeleteSelection} className="p-1.5 rounded-lg hover:bg-red-500/30 transition-colors flex items-center justify-center"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
                                    </div>
                                </div>;
                                return (
                                    <foreignObject x={x} y={y} width={toolbarCanvasWidth} height={toolbarCanvasHeight} style={{ overflow: 'visible' }}>
                                        {toolbar}
                                    </foreignObject>
                                );
                            } else if (singleSelectedElement) {
                                const element = singleSelectedElement;
                                const bounds = getElementBounds(element, elements);
                                let toolbarScreenWidth = 120 + 112; // Default
                                if (element.type === 'shape') {
                                    toolbarScreenWidth = 502 + 37 + 28;
                                } else if (element.type === 'text') {
                                    toolbarScreenWidth = 178 + 37 + 28;
                                } else if (element.type === 'arrow' || element.type === 'line') {
                                    toolbarScreenWidth = 251 + 37 + 28;
                                } else if (element.type === 'image') {
                                    toolbarScreenWidth = 315 + 28;
                                } else if (element.type === 'video') {
                                    toolbarScreenWidth = 115 + 28;
                                } else if (element.type === 'group') {
                                    toolbarScreenWidth = 160 + 28;
                                } else if (element.type === 'path') {
                                    toolbarScreenWidth = 331 + 37 + 28;
                                } else if (element.type === 'frame') {
                                    toolbarScreenWidth = 270 + 28;
                                }

                                const toolbarScreenHeight = 48;

                                const toolbarCanvasWidth = toolbarScreenWidth / zoom;
                                const toolbarCanvasHeight = toolbarScreenHeight / zoom;

                                const x = bounds.x + bounds.width / 2 - (toolbarCanvasWidth / 2);
                                const y = bounds.y - toolbarCanvasHeight - (35 / zoom);

                                const toolbar = <div
                                    style={{ transform: `scale(${1 / zoom})`, transformOrigin: 'top left', width: `${toolbarScreenWidth}px`, height: `${toolbarScreenHeight}px` }}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    onPointerDown={(e) => e.stopPropagation()}
                                >
                                    <div style={{ backgroundColor: 'var(--ui-bg-color)' }} className="h-full p-1 backdrop-blur-xl border border-white/10 rounded-full shadow-2xl flex items-center justify-center gap-1 text-white">
                                        <button title={t('contextMenu.copy')} onClick={() => handleCopyElement(element)} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors flex items-center justify-center"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>
                                        {element.type === 'frame' && (
                                            <>
                                                <div className="h-5 w-px bg-white/20"></div>
                                                {['3:4', '4:3', '1:1', '16:9', '9:16'].map(ratio => {
                                                    const [w, h] = ratio.split(':').map(Number);
                                                    const targetRatio = w / h;
                                                    const isCurrentRatio = Math.abs((element.width / element.height) - targetRatio) < 0.01;
                                                    return (
                                                        <button
                                                            key={ratio}
                                                            onClick={() => handleFrameAspectRatioChange(element.id, ratio)}
                                                            className={`px-2 py-1.5 rounded-lg transition-colors text-xs ${isCurrentRatio ? 'bg-blue-500' : 'hover:bg-white/20'}`}
                                                            title={`Set aspect ratio to ${ratio}`}
                                                        >
                                                            {ratio}
                                                        </button>
                                                    )
                                                })}
                                            </>
                                        )}
                                        {element.type === 'group' && <button title={t('contextMenu.ungroup')} onClick={handleUngroup} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="14" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><path d="M17.5 14 14 17.5" /><path d="M6.5 7 10 3.5" /></svg></button>}
                                        {element.type === 'group' && <button title={t('contextMenu.mergeGroup')} onClick={handleMergeGroup} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5" /><path d="M8 3H3v5" /><path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3" /><path d="m3 16 7-7" /><path d="m21 3-7.873 7.873a4 4 0 0 0-1.127 2.828V22" /></svg></button>}
                                        {element.type === 'image' && <button title={t('contextMenu.download')} onClick={() => handleDownloadImage(element)} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors flex items-center justify-center"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg></button>}
                                        {element.type === 'video' && <a title={t('contextMenu.download')} href={element.href} download={`video-${element.id}.mp4`} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors flex items-center justify-center"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg></a>}
                                        <div className="h-5 w-px bg-white/20"></div>
                                        <button title={t('contextMenu.flipX')} onClick={() => handlePropertyChange(element.id, { flipX: !element.flipX })} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors">
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3H9v18h6V3zM21 8l-6 10M3 8l6 10" /></svg>
                                        </button>
                                        <button title={t('contextMenu.flipY')} onClick={() => handlePropertyChange(element.id, { flipY: !element.flipY })} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors">
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="rotate-90"><path d="M15 3H9v18h6V3zM21 8l-6 10M3 8l6 10" /></svg>
                                        </button>
                                        <button title={t('contextMenu.rotate')} onClick={() => handlePropertyChange(element.id, { rotation: ((('rotation' in element ? element.rotation : 0) || 0) + 90) % 360 })} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors">
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /><path d="M22 4h-4v4" /></svg>
                                        </button>
                                        <div className="h-5 w-px bg-white/20"></div>
                                        {element.type === 'image' && <button title={t('contextMenu.crop')} onClick={() => handleStartCrop(element)} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors flex items-center justify-center"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6.13 1L6 16a2 2 0 0 0 2 2h15"></path><path d="M1 6.13L16 6a2 2 0 0 1 2 2v15"></path></svg></button>}
                                        {element.type === 'image' && <button title="Select Ref Area" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); handleStartRefSelection(); }} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors flex items-center justify-center"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9V5a1 1 0 0 1 1-1h4" /><path d="M16 4h4a1 1 0 0 1 1 1v4" /><path d="M4 15v4a1 1 0 0 0 1 1h4" /><path d="M16 20h4a1 1 0 0 0 1-1v-4" /></svg></button>}
                                        {(['path', 'arrow', 'line', 'shape'].includes(element.type)) && (
                                            <>
                                                <div className="h-5 w-px bg-white/20"></div>
                                                <div title={t('contextMenu.strokeColor')} className="relative p-1.5 rounded-lg hover:bg-white/20 transition-colors flex items-center justify-center">
                                                    <div className="w-4 h-4 rounded-full border border-white/30" style={{ backgroundColor: (element as PathElement).strokeColor }}></div>
                                                    <input type="color" value={(element as PathElement).strokeColor} onChange={e => handlePropertyChange(element.id, { strokeColor: e.target.value })} className="absolute inset-0 opacity-0 cursor-pointer" />
                                                </div>
                                                <div title={t('contextMenu.strokeWidth')} className="flex items-center gap-1 p-1">
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400"><line x1="4" y1="12" x2="20" y2="12"></line></svg>
                                                    <input type="range" min="1" max="50" value={(element as PathElement).strokeWidth} onChange={e => handlePropertyChange(element.id, { strokeWidth: parseInt(e.target.value, 10) })} className="w-12 accent-blue-500" />
                                                    <input type="number" min="1" value={(element as PathElement).strokeWidth} onChange={e => handlePropertyChange(element.id, { strokeWidth: parseInt(e.target.value, 10) || 1 })} className="w-14 p-0.5 text-xs text-center border border-white/20 rounded bg-black/20 text-white" />
                                                </div>
                                            </>
                                        )}
                                        {element.type === 'shape' && (
                                            <>
                                                <div className="h-5 w-px bg-white/20"></div>
                                                <div title={t('contextMenu.fillColor')} className="relative p-1.5 rounded-lg hover:bg-white/20 transition-colors flex items-center justify-center">
                                                    <div className="w-4 h-4 rounded-full border border-white/30" style={{ backgroundColor: element.fillColor }}></div>
                                                    <input type="color" value={element.fillColor} onChange={e => handlePropertyChange(element.id, { fillColor: e.target.value })} className="absolute inset-0 opacity-0 cursor-pointer" />
                                                </div>
                                                <div title={t('contextMenu.strokeStyle')} className="flex items-center">
                                                    <button onClick={() => handlePropertyChange(element.id, { strokeDashArray: undefined })} className={`p-1.5 rounded-l-lg hover:bg-white/20 ${!element.strokeDashArray ? 'bg-blue-500' : 'bg-white/10'}`}><svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12"></line></svg></button>
                                                    <button onClick={() => handlePropertyChange(element.id, { strokeDashArray: [10, 10] })} className={`p-1.5 hover:bg-white/20 ${element.strokeDashArray?.toString() === '10,10' ? 'bg-blue-500' : 'bg-white/10'}`}><svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><line x1="4" y1="12" x2="8" y2="12"></line><line x1="12" y1="12" x2="16" y2="12"></line><line x1="20" y1="12" x2="22" y2="12"></line></svg></button>
                                                    <button onClick={() => handlePropertyChange(element.id, { strokeDashArray: [3, 4] })} className={`p-1.5 rounded-r-lg hover:bg-white/20 ${element.strokeDashArray?.toString() === '3,4' ? 'bg-blue-500' : 'bg-white/10'}`}><svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><line x1="4" y1="12" x2="5" y2="12"></line><line x1="9" y1="12" x2="11" y2="12"></line><line x1="15" y1="12" x2="18" y2="12"></line><line x1="22" y1="12" x2="22" y2="12"></line></svg></button>
                                                </div>
                                            </>
                                        )}
                                        {element.type === 'text' && (
                                            <>
                                                <div className="h-5 w-px bg-white/20"></div>
                                                <div title={t('contextMenu.fontColor')} className="relative p-1.5 rounded-lg hover:bg-white/20 transition-colors flex items-center justify-center">
                                                    <div className="w-4 h-4 rounded-full border border-white/30" style={{ backgroundColor: element.fontColor }}></div>
                                                    <input type="color" value={element.fontColor} onChange={e => handlePropertyChange(element.id, { fontColor: e.target.value })} className="absolute inset-0 opacity-0 cursor-pointer" />
                                                </div>
                                                <div title={t('contextMenu.fontSize')} className="flex items-center gap-1 p-1">
                                                    <input type="range" min="8" max="128" value={element.fontSize} onChange={e => handlePropertyChange(element.id, { fontSize: parseInt(e.target.value, 10) })} className="w-12 accent-blue-500" />
                                                    <input type="number" min="1" value={element.fontSize} onChange={e => handlePropertyChange(element.id, { fontSize: parseInt(e.target.value, 10) || 1 })} className="w-14 p-0.5 text-xs text-center border border-white/20 rounded bg-black/20 text-white" />
                                                </div>
                                            </>
                                        )}
                                        <div className="h-5 w-px bg-white/20"></div>
                                        <button title={t('contextMenu.delete')} onClick={() => handleDeleteElement(element.id)} className="p-1.5 rounded-lg hover:bg-red-500/30 transition-colors flex items-center justify-center"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
                                    </div>
                                </div>;

                                return (
                                    <foreignObject x={x} y={y} width={toolbarCanvasWidth} height={toolbarCanvasHeight} style={{ overflow: 'visible' }}>
                                        {toolbar}
                                    </foreignObject>
                                );
                            }
                            return null;
                        })()}

                        {refSelectionState?.isActive && (
                            <g>
                                {refSelectionState.box && refSelectionState.box.width > 0 && (
                                    <>
                                        <rect
                                            data-selection-box="true"
                                            x={refSelectionState.box.x}
                                            y={refSelectionState.box.y}
                                            width={refSelectionState.box.width}
                                            height={refSelectionState.box.height}
                                            fill="rgba(59, 130, 246, 0.2)"
                                            stroke="#3b82f6"
                                            strokeWidth={2 / zoom}
                                            strokeDasharray={`${4 / zoom} ${2 / zoom}`}
                                            style={{ cursor: 'move', pointerEvents: 'all' }}
                                        />
                                        {(() => {
                                            const { x, y, width, height } = refSelectionState.box!;
                                            const handleSize = 8 / zoom;
                                            const handles = [
                                                { name: 'tl', x, y, cursor: 'nwse-resize' },
                                                { name: 'tm', x: x + width / 2, y, cursor: 'ns-resize' },
                                                { name: 'tr', x: x + width, y, cursor: 'nesw-resize' },
                                                { name: 'ml', x, y: y + height / 2, cursor: 'ew-resize' },
                                                { name: 'mr', x: x + width, y: y + height / 2, cursor: 'ew-resize' },
                                                { name: 'bl', x, y: y + height, cursor: 'nesw-resize' },
                                                { name: 'bm', x: x + width / 2, y: y + height, cursor: 'ns-resize' },
                                                { name: 'br', x: x + width, y: y + height, cursor: 'nwse-resize' },
                                            ];
                                            return handles.map(h => (
                                                <rect
                                                    key={h.name}
                                                    data-selection-handle={h.name}
                                                    x={h.x - handleSize / 2}
                                                    y={h.y - handleSize / 2}
                                                    width={handleSize}
                                                    height={handleSize}
                                                    fill="white"
                                                    stroke="#3b82f6"
                                                    strokeWidth={1 / zoom}
                                                    style={{ cursor: h.cursor, pointerEvents: 'all' }}
                                                />
                                            ));
                                        })()}
                                        {!refSelectionState.startPoint && (
                                            <foreignObject
                                                x={refSelectionState.box.x + refSelectionState.box.width / 2 - (60 / zoom)}
                                                y={refSelectionState.box.y + refSelectionState.box.height + (10 / zoom)}
                                                width={120 / zoom}
                                                height={40 / zoom}
                                                style={{ overflow: 'visible' }}
                                            >
                                                <div className="flex gap-1 justify-center">
                                                    <button
                                                        onPointerDown={(e) => { e.stopPropagation(); handleConfirmRefSelection(); }}
                                                        className="bg-green-500 text-white rounded shadow-lg flex items-center justify-center hover:bg-green-600 transition-colors"
                                                        style={{ width: `${32 / zoom}px`, height: `${32 / zoom}px`, fontSize: `${16 / zoom}px` }}
                                                    >
                                                        ✓
                                                    </button>
                                                    <button
                                                        onPointerDown={(e) => { e.stopPropagation(); handleCancelRefSelection(); }}
                                                        className="bg-red-500 text-white rounded shadow-lg flex items-center justify-center hover:bg-red-600 transition-colors"
                                                        style={{ width: `${32 / zoom}px`, height: `${32 / zoom}px`, fontSize: `${16 / zoom}px` }}
                                                    >
                                                        ✕
                                                    </button>
                                                </div>
                                            </foreignObject>
                                        )}
                                    </>
                                )}
                            </g>
                        )}

                        {croppingState && (
                            <g>
                                <rect
                                    x={-10000} y={-10000} width={20000} height={20000}
                                    fill="black" opacity="0.5"
                                    pointerEvents="all"
                                />
                                <image
                                    x={croppingState.originalElement.x}
                                    y={croppingState.originalElement.y}
                                    width={croppingState.originalElement.width}
                                    height={croppingState.originalElement.height}
                                    href={croppingState.originalElement.href}
                                    clipPath={`url(#crop-clip-${croppingState.elementId})`}
                                />
                                <defs>
                                    <clipPath id={`crop-clip-${croppingState.elementId}`}>
                                        <rect
                                            x={croppingState.cropBox.x}
                                            y={croppingState.cropBox.y}
                                            width={croppingState.cropBox.width}
                                            height={croppingState.cropBox.height}
                                        />
                                    </clipPath>
                                </defs>
                                <rect
                                    x={croppingState.cropBox.x}
                                    y={croppingState.cropBox.y}
                                    width={croppingState.cropBox.width}
                                    height={croppingState.cropBox.height}
                                    fill="none" stroke="white" strokeWidth={2 / zoom}
                                />
                                {(() => {
                                    const { x, y, width, height } = croppingState.cropBox;
                                    const handleSize = 8 / zoom;
                                    const handles = [
                                        { name: 'tl', x, y, cursor: 'nwse-resize' }, { name: 'tm', x: x + width / 2, y, cursor: 'ns-resize' }, { name: 'tr', x: x + width, y, cursor: 'nesw-resize' },
                                        { name: 'ml', x, y: y + height / 2, cursor: 'ew-resize' }, { name: 'mr', x: x + width, y: y + height / 2, cursor: 'ew-resize' },
                                        { name: 'bl', x, y: y + height, cursor: 'nesw-resize' }, { name: 'bm', x: x + width / 2, y: y + height, cursor: 'ns-resize' }, { name: 'br', x: x + width, y: y + height, cursor: 'nwse-resize' },
                                    ];
                                    return handles.map(h => <rect key={h.name} data-handle={h.name} x={h.x - handleSize / 2} y={h.y - handleSize / 2} width={handleSize} height={handleSize} fill="white" stroke="#3b82f6" strokeWidth={1 / zoom} style={{ cursor: h.cursor }} />);
                                })()}
                            </g>
                        )}

                        {editingElement && (() => {
                            const element = elements.find(el => el.id === editingElement.id);
                            if (!element) return null;
                            if (element.type === 'text') {
                                return (
                                    <foreignObject x={element.x - (2 / zoom)} y={element.y - (2 / zoom)} width={element.width + (4 / zoom)} height={element.height + (4 / zoom)} style={{ overflow: 'visible' }}>
                                        <textarea
                                            ref={editingTextareaRef}
                                            value={editingElement.text}
                                            onChange={e => setEditingElement({ ...editingElement, text: e.target.value })}
                                            onBlur={handleStopEditing}
                                            style={{
                                                width: `${element.width}px`,
                                                fontSize: `${element.fontSize}px`,
                                                color: element.fontColor,
                                                lineHeight: 1.2,
                                                border: `${2 / zoom}px solid #3b82f6`,
                                                outline: 'none',
                                                padding: 0,
                                                margin: 0,
                                                background: 'transparent',
                                                resize: 'none',
                                                overflow: 'hidden'
                                            }}
                                        />
                                    </foreignObject>
                                )
                            } else if (element.type === 'frame') {
                                return (
                                    <foreignObject x={element.x + (8 / zoom)} y={element.y - (8 / zoom) - (16 / zoom)} width={200 / zoom} height={24 / zoom} style={{ overflow: 'visible', pointerEvents: 'all' }}>
                                        <input
                                            ref={editingInputRef}
                                            type="text"
                                            value={editingElement.text}
                                            onChange={e => setEditingElement({ ...editingElement, text: e.target.value })}
                                            onBlur={handleStopEditing}
                                            onKeyDown={(e) => e.key === 'Enter' && handleStopEditing()}
                                            style={{
                                                fontSize: `${16 / zoom}px`,
                                                background: '#111827',
                                                color: 'white',
                                                border: `1px solid #3b82f6`,
                                                borderRadius: `${4 / zoom}px`,
                                                padding: `${4 / zoom}px`,
                                                width: '100%',
                                                height: '100%',
                                                outline: 'none',
                                            }}
                                        />
                                    </foreignObject>
                                )
                            }
                            return null;
                        })()}

                        {selectionBox && (
                            <rect
                                x={selectionBox.x} y={selectionBox.y} width={selectionBox.width} height={selectionBox.height}
                                fill="rgba(59, 130, 246, 0.1)"
                                stroke="rgb(59, 130, 246)"
                                strokeWidth={1 / zoom}
                                strokeDasharray={`${4 / zoom} ${4 / zoom}`}
                            />
                        )}

                        {aiRotationState && (
                            <g>
                                {/* Cross-shaped guide lines */}
                                <line
                                    x1={aiRotationState.center.x - 150 / zoom} y1={aiRotationState.center.y}
                                    x2={aiRotationState.center.x + 150 / zoom} y2={aiRotationState.center.y}
                                    stroke="rgba(255, 255, 255, 0.3)" strokeWidth={1 / zoom} strokeDasharray={`${4 / zoom} ${2 / zoom}`}
                                    pointerEvents="none"
                                />
                                <line
                                    x1={aiRotationState.center.x} y1={aiRotationState.center.y - 150 / zoom}
                                    x2={aiRotationState.center.x} y2={aiRotationState.center.y + 150 / zoom}
                                    stroke="rgba(255, 255, 255, 0.3)" strokeWidth={1 / zoom} strokeDasharray={`${4 / zoom} ${2 / zoom}`}
                                    pointerEvents="none"
                                />

                                {/* Draggable Handle Logic */}
                                {(() => {
                                    const handleVisibleRadius = 15 / zoom;
                                    const grabAreaRadius = 20 / zoom;
                                    const center = aiRotationState.center;

                                    // Movement Type Selector Buttons (Inline UI)
                                    const mode = aiRotationState.mode || 'subject';

                                    const buttons = mode === 'subject' ? [
                                        { type: 'rotate', icon: '⟳', label: 'Rotate', x: center.x, y: center.y + 180 / zoom },
                                    ] : [
                                        { type: 'rotate', icon: '⟳', label: 'Pan/Tilt', x: center.x - 80 / zoom, y: center.y + 180 / zoom },
                                        { type: 'arc', icon: '⭯', label: 'Orbit', x: center.x - 40 / zoom, y: center.y + 180 / zoom },
                                        { type: 'dolly', icon: '↕', label: 'Dolly', x: center.x, y: center.y + 180 / zoom },
                                        { type: 'translate', icon: '✢', label: 'Truck', x: center.x + 40 / zoom, y: center.y + 180 / zoom },
                                        { type: 'roll', icon: '↻', label: 'Roll', x: center.x + 80 / zoom, y: center.y + 180 / zoom },
                                    ];

                                    return (
                                        <g style={{ userSelect: 'none' }}>
                                            {/* Sub-mode Selection UI */}
                                            {buttons.map(btn => (
                                                <g
                                                    key={btn.type}
                                                    onMouseDown={(e) => e.stopPropagation()}
                                                    onPointerDown={(e) => e.stopPropagation()}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setAiRotationState(prev => prev ? { ...prev, movementType: btn.type as any, currentValue: 0, dragDirection: null } : null);
                                                    }}
                                                    className="cursor-pointer"
                                                >
                                                    <circle cx={btn.x} cy={btn.y} r={20 / zoom} fill={aiRotationState.movementType === btn.type ? '#3b82f6' : '#374151'} stroke="white" strokeWidth={1 / zoom} />
                                                    <text x={btn.x} y={btn.y} fill="white" fontSize={14 / zoom} textAnchor="middle" dominantBaseline="central" pointerEvents="none">{btn.icon}</text>
                                                    <text x={btn.x} y={btn.y + 30 / zoom} fill="white" fontSize={10 / zoom} textAnchor="middle" pointerEvents="none">{btn.label}</text>
                                                </g>
                                            ))}

                                            {/* Active Drag Area */}
                                            <circle
                                                data-handle="ai-rotate"
                                                cx={center.x}
                                                cy={center.y}
                                                r={grabAreaRadius}
                                                fill="rgba(59, 130, 246, 0.2)"
                                                style={{ cursor: 'grab' }}
                                            />

                                            {/* Visual Feedback Handle */}
                                            {(() => {
                                                let handleCx = center.x;
                                                let handleCy = center.y;
                                                let valueText = '';

                                                if (interactionMode.current === 'ai-rotate' && aiRotationState.dragDirection) {
                                                    const maxH = 150 / zoom;
                                                    const maxV = 150 / zoom;

                                                    if (aiRotationState.movementType === 'rotate') {
                                                        const ratio = aiRotationState.currentValue / 90;
                                                        if (aiRotationState.dragDirection === 'h') handleCx += ratio * maxH;
                                                        else handleCy -= ratio * maxV;
                                                        valueText = `${aiRotationState.currentValue.toFixed(0)}°`;
                                                    } else if (aiRotationState.movementType === 'arc') {
                                                        const ratio = aiRotationState.currentValue / 90;
                                                        if (aiRotationState.dragDirection === 'h') handleCx += ratio * maxH;
                                                        else handleCy -= ratio * maxV;
                                                        valueText = `Arc: ${aiRotationState.currentValue.toFixed(0)}°`;
                                                    } else if (aiRotationState.movementType === 'roll') {
                                                        const ratio = aiRotationState.currentValue / 90;
                                                        handleCx += ratio * maxH;
                                                        valueText = `Roll: ${aiRotationState.currentValue.toFixed(0)}°`;
                                                    } else if (aiRotationState.movementType === 'dolly') {
                                                        const ratio = aiRotationState.currentValue / 100;
                                                        handleCy -= ratio * maxV;
                                                        valueText = `Dolly: ${aiRotationState.currentValue > 0 ? 'In' : 'Out'} ${Math.abs(aiRotationState.currentValue).toFixed(0)}%`;
                                                    } else { // translate
                                                        const ratio = aiRotationState.currentValue / 100;
                                                        if (aiRotationState.dragDirection === 'h') handleCx += ratio * maxH;
                                                        else handleCy -= ratio * maxV;
                                                        valueText = `Shift: ${Math.abs(aiRotationState.currentValue).toFixed(0)}%`;
                                                    }
                                                }

                                                return (
                                                    <g pointerEvents="none">
                                                        <circle cx={handleCx} cy={handleCy} r={handleVisibleRadius} fill="white" stroke="#3b82f6" strokeWidth={2 / zoom} />
                                                        <text x={handleCx} y={handleCy} fill="#3b82f6" fontSize={10 / zoom} textAnchor="middle" dominantBaseline="central" style={{ fontWeight: 'bold' }}>
                                                            {valueText || 'DRAG'}
                                                        </text>
                                                    </g>
                                                );
                                            })()}
                                        </g>
                                    );
                                })()}
                            </g>
                        )}

                        {interactionMode.current === 'rotate' && rotateStartInfo.current && (() => {
                            const rotatingElement = elements.find(el => el.id === rotateStartInfo.current!.originalElement.id);
                            if (!rotatingElement || !('rotation' in rotatingElement) || !rotateDialPoint) return null;

                            const { center } = rotateStartInfo.current!;
                            const bounds = getElementBounds(rotateStartInfo.current!.originalElement, elements);
                            const elementRadius = Math.hypot(bounds.width / 2, bounds.height / 2);
                            const radius = elementRadius + 40 / zoom;

                            const currentRotation = rotatingElement.rotation || 0;
                            const angleToMouseRad = Math.atan2(rotateDialPoint.y - center.y, rotateDialPoint.x - center.x);

                            return (
                                <g pointerEvents="none">
                                    <circle cx={center.x} cy={center.y} r={radius} fill="none" stroke="rgba(255, 255, 255, 0.3)" strokeWidth={1 / zoom} strokeDasharray={`${4 / zoom} ${4 / zoom}`} />
                                    {Array.from({ length: 12 }).map((_, i) => {
                                        const angle = i * 30;
                                        const angleRad = angle * Math.PI / 180;
                                        const isMajorTick = i % 3 === 0;
                                        const tickLength = (isMajorTick ? 10 : 5) / zoom;
                                        const startX = center.x + (radius - tickLength) * Math.cos(angleRad);
                                        const startY = center.y + (radius - tickLength) * Math.sin(angleRad);
                                        const endX = center.x + radius * Math.cos(angleRad);
                                        const endY = center.y + radius * Math.sin(angleRad);
                                        return <line key={i} x1={startX} y1={startY} x2={endX} y2={endY} stroke="rgba(255, 255, 255, 0.5)" strokeWidth={isMajorTick ? 1.5 / zoom : 1 / zoom} />
                                    })}
                                    <line x1={center.x} y1={center.y} x2={center.x + radius * Math.cos(angleToMouseRad)} y2={center.y + radius * Math.sin(angleToMouseRad)} stroke="#3b82f6" strokeWidth={1.5 / zoom} />
                                    <g transform={`translate(${center.x}, ${center.y})`}>
                                        <rect x={-25 / zoom} y={-15 / zoom} width={50 / zoom} height={30 / zoom} fill="rgba(17, 24, 39, 0.8)" rx={4 / zoom} />
                                        <text x={0} y={0} fill="white" fontSize={14 / zoom} textAnchor="middle" dominantBaseline="central" style={{ fontWeight: 'bold' }}>
                                            {`${((currentRotation) % 360).toFixed(0)}°`}
                                        </text>
                                    </g>
                                </g>
                            );
                        })()}
                    </g>
                </svg>
            </div>

            <PromptBar
                t={t}
                prompt={prompt}
                setPrompt={setPrompt}
                negativePrompt={negativePrompt}
                setNegativePrompt={setNegativePrompt}
                onGenerate={handleGenerate}
                isLoading={isLoading}
                isSelectionActive={isSelectionActive}
                selectedElementCount={selectedElementIds.length}
                userEffects={userEffects}
                onAddUserEffect={handleAddUserEffect}
                onDeleteUserEffect={handleDeleteUserEffect}
                generationMode={generationMode}
                setGenerationMode={setGenerationMode}
                videoAspectRatio={videoAspectRatio}
                setVideoAspectRatio={setVideoAspectRatio}
                imageAspectRatio={imageAspectRatio}
                setImageAspectRatio={setImageAspectRatio}
                numberOfImages={numberOfImages}
                setNumberOfImages={setNumberOfImages}
                numberOfVideos={numberOfVideos}
                setNumberOfVideos={setNumberOfVideos}
                modelProvider={modelProvider}
                setModelProvider={setModelProvider}
                generateHotkey={generateHotkey}
            />
            {presentationState?.isActive && (
                <PresentationUI
                    t={t}
                    onPrev={() => handleNavigatePresentation('prev')}
                    onNext={() => handleNavigatePresentation('next')}
                    onExit={handleExitPresentation}
                    onToggleTransition={() => setPresentationState(p => ({ ...p!, transition: p!.transition === 'smooth' ? 'direct' : 'smooth' }))}
                    transition={presentationState.transition}
                    isPrevDisabled={false}
                    isNextDisabled={false}
                />
            )}
            {contextMenu && (
                <div
                    className="fixed z-50 p-1 bg-neutral-800/90 backdrop-blur-xl border border-white/10 rounded-lg shadow-2xl flex flex-col gap-1 text-sm text-white"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                    onContextMenu={(e) => e.preventDefault()}
                >
                    {(() => {
                        const element = contextMenu.elementId ? elements.find(el => el.id === contextMenu.elementId) : null;
                        const selectedElements = elements.filter(el => selectedElementIds.includes(el.id));

                        if (selectedElementIds.length > 1) { // Multi-selection context menu
                            const hasRasterizable = selectedElements.some(el => ['path', 'shape', 'text', 'arrow', 'line'].includes(el.type));
                            return <>
                                <button onClick={handleGroup} className="w-full text-left px-3 py-1.5 hover:bg-white/10 rounded-md">Group</button>
                                {hasRasterizable && <button onClick={handleRasterizeSelection} className="w-full text-left px-3 py-1.5 hover:bg-white/10 rounded-md">Rasterize Selection</button>}
                                <div className="border-t border-white/20 -mx-1 my-1"></div>
                                <button onClick={handleCopySelection} className="w-full text-left px-3 py-1.5 hover:bg-white/10 rounded-md">Copy</button>
                                <button onClick={handleDeleteSelection} className="w-full text-left px-3 py-1.5 hover:bg-red-500/20 text-red-300 rounded-md">Delete</button>
                            </>;
                        }

                        if (!element) return null; // Clicked on empty canvas

                        return <>
                            <button onClick={() => handleLayerAction(element.id, 'forward')} className="w-full text-left px-3 py-1.5 hover:bg-white/10 rounded-md">Bring Forward</button>
                            <button onClick={() => handleLayerAction(element.id, 'backward')} className="w-full text-left px-3 py-1.5 hover:bg-white/10 rounded-md">Send Backward</button>
                            <button onClick={() => handleLayerAction(element.id, 'front')} className="w-full text-left px-3 py-1.5 hover:bg-white/10 rounded-md">Bring to Front</button>
                            <button onClick={() => handleLayerAction(element.id, 'back')} className="w-full text-left px-3 py-1.5 hover:bg-white/10 rounded-md">Send to Back</button>
                            <div className="border-t border-white/20 -mx-1 my-1"></div>
                            {element.type === 'group' && <button onClick={handleUngroup} className="w-full text-left px-3 py-1.5 hover:bg-white/10 rounded-md">Ungroup</button>}
                            {element.type === 'group' && <button onClick={handleMergeGroup} className="w-full text-left px-3 py-1.5 hover:bg-white/10 rounded-md">Merge Group</button>}
                            <button onClick={() => handleCopyElement(element)} className="w-full text-left px-3 py-1.5 hover:bg-white/10 rounded-md">Copy</button>
                            <button onClick={() => handleDeleteElement(element.id)} className="w-full text-left px-3 py-1.5 hover:bg-red-500/20 text-red-300 rounded-md">Delete</button>
                        </>;
                    })()}
                </div>
            )}
        </div>
    );
};
export default App;