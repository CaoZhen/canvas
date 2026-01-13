export type Tool = 'select' | 'pan' | 'draw' | 'erase' | 'rectangle' | 'circle' | 'triangle' | 'text' | 'arrow' | 'highlighter' | 'lasso' | 'line' | 'frame';

export type WheelAction = 'zoom' | 'pan';

export type GenerationMode = 'image' | 'video';

export type ImageAspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4';

export interface Point {
  x: number;
  y: number;
}

interface CanvasElementBase {
  id: string;
  x: number;
  y: number;
  name?: string;
  isVisible?: boolean;
  isLocked?: boolean;
  parentId?: string;
  flipX?: boolean;
  flipY?: boolean;
}

export interface ImageElement extends CanvasElementBase {
  type: 'image';
  href: string;
  width: number;
  height: number;
  naturalWidth?: number;
  naturalHeight?: number;
  mimeType: string;
  opacity?: number;
  rotation?: number; // degrees
  borderRadius?: number;
}

export interface VideoElement extends CanvasElementBase {
  type: 'video';
  href: string; // Blob URL
  width: number;
  height: number;
  mimeType: string;
  rotation?: number; // degrees
  opacity?: number;
}

export interface PathElement extends CanvasElementBase {
  type: 'path';
  points: Point[];
  strokeColor: string;
  strokeWidth: number;
  opacity?: number;
  rotation?: number; // degrees
}

export interface ShapeElement extends CanvasElementBase {
  type: 'shape';
  shapeType: 'rectangle' | 'circle' | 'triangle';
  width: number;
  height: number;
  strokeColor: string;
  strokeWidth: number;
  fillColor: string;
  strokeDashArray?: [number, number];
  opacity?: number;
  rotation?: number; // degrees
  borderRadius?: number;
}

export interface TextElement extends CanvasElementBase {
  type: 'text';
  text: string;
  fontSize: number;
  fontColor: string;
  width: number;
  height: number;
  rotation?: number; // degrees
}

export interface ArrowElement extends CanvasElementBase {
  type: 'arrow';
  points: [Point, Point];
  strokeColor: string;
  strokeWidth: number;
  rotation?: number; // degrees
}

export interface LineElement extends CanvasElementBase {
  type: 'line';
  points: [Point, Point];
  strokeColor: string;
  strokeWidth: number;
  rotation?: number; // degrees
}

export interface GroupElement extends CanvasElementBase {
  type: 'group';
  width: number;
  height: number;
  rotation?: number; // degrees
}

export interface FrameElement extends CanvasElementBase {
  type: 'frame';
  name: string;
  width: number;
  height: number;
  backgroundColor?: string;
}


export type Element = ImageElement | PathElement | ShapeElement | TextElement | ArrowElement | LineElement | GroupElement | VideoElement | FrameElement;

export interface UserEffect {
  id: string;
  name: string;
  value: string;
}

export interface Hotkey {
  key: string;
  metaOrCtrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export interface PresentationHotkeys {
  nextSmooth: Hotkey;
  prevSmooth: Hotkey;
  nextDirect: Hotkey;
  prevDirect: Hotkey;
}

export interface Board {
  id: string;
  name: string;
  elements: Element[];
  history: Element[][];
  historyIndex: number;
  panOffset: Point;
  zoom: number;
  canvasBackgroundColor: string;
}

export type Rect = { x: number; y: number; width: number; height: number };
export type Guide = { type: 'v' | 'h'; position: number; start: number; end: number };

export interface AICameraState {
  element: ImageElement;
  center: Point;
  currentValue: number; // angle for rotation, distance for others
  dragDirection: 'h' | 'v' | 'd' | null; // d for diagonal/dolly
  mode: 'subject' | 'camera';
  movementType: 'rotate' | 'dolly' | 'translate' | 'roll' | 'arc';
}

export interface RefSelectionState {
  isActive: boolean;
  elementId: string;
  box: Rect | null;
  startPoint: Point | null;
  activeHandle?: string | null;
}