import React, { useState, useCallback } from 'react';
import { Element, ImageElement, VideoElement, FrameElement, GroupElement, PathElement, ShapeElement, Point, ImageAspectRatio, Rect } from '../types';
import { editImage, generateImageFromText, generateVideo, getPromptFromImage } from '../services/geminiService';
import { editImageWan, getAdjustedSize, generateImageWan } from '../services/wanService';
import { getElementBounds, rasterizeElement, rasterizeMask, rasterizeElements, getImageContentBounds } from '../utils/elementUtils';
import { getSelectionBounds, getFlattenedSelection } from '../utils/selectionUtils';
import { generateId } from '../utils/idUtils';
import { getCanvasPoint } from '../utils/mathUtils';

const getRawImageSize = (url: string): Promise<{ width: number; height: number }> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.width, height: img.height });
        img.onerror = () => reject(new Error("Failed to load image to get raw size"));
        img.src = url;
    });
};

const getDefaultDimensions = (ratio: ImageAspectRatio): { width: number; height: number } => {
    switch (ratio) {
        case '16:9': return { width: 1280, height: 720 };
        case '9:16': return { width: 720, height: 1280 };
        case '4:3': return { width: 1024, height: 768 };
        case '3:4': return { width: 768, height: 1024 };
        default: return { width: 1024, height: 1024 };
    }
};

const createPlaceholderDataUrl = (width: number, height: number, text: string = 'Generating...'): string => {
    const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#374151" stroke="#4b5563" stroke-width="2"/>
        <text x="50%" y="50%" font-family="sans-serif" font-size="${Math.max(24, Math.min(width, height) / 10)}" text-anchor="middle" dominant-baseline="middle" fill="#9ca3af">${text}</text>
    </svg>`;
    return `data:image/svg+xml;base64,${btoa(svg)}`;
};

interface UseAIGenerationProps {
    elements: Element[];
    selectedElementIds: string[];
    zoom: number;
    panOffset: Point;
    prompt: string;
    setPrompt: (p: string) => void;
    negativePrompt: string;
    setNegativePrompt: (p: string) => void;
    imageAspectRatio: ImageAspectRatio;
    numberOfImages: number;
    videoAspectRatio: '16:9' | '9:16';
    numberOfVideos: number;
    generationMode: 'image' | 'video';
    modelProvider?: 'gemini' | 'wan';
    setIsLoading: (v: boolean) => void;
    setError: (v: string | null) => void;
    setProgressMessage: (v: string) => void;
    addElementsWithParenting: (els: Element[]) => void;
    setSelectedElementIds: (ids: string[]) => void;
    svgRef: React.RefObject<SVGSVGElement>;
}

export const useAIGeneration = ({
    elements, selectedElementIds, zoom, panOffset, prompt, setPrompt,
    negativePrompt, setNegativePrompt,
    imageAspectRatio, numberOfImages, videoAspectRatio, numberOfVideos, generationMode, modelProvider = 'gemini',
    setIsLoading, setError, setProgressMessage, addElementsWithParenting, setSelectedElementIds, svgRef
}: UseAIGenerationProps) => {

    const handleGetPromptFromImage = useCallback(async (element: ImageElement) => {
        if (!element) return;

        setIsLoading(true);
        setError(null);
        setProgressMessage('Analyzing image...');

        try {
            const generatedPrompt = await getPromptFromImage({
                href: element.href,
                mimeType: element.mimeType,
            });
            setPrompt(generatedPrompt);
        } catch (err) {
            const error = err as Error;
            setError(`Failed to get prompt from image: ${error.message}`);
            console.error(err);
        } finally {
            setIsLoading(false);
            setProgressMessage('');
        }
    }, [setIsLoading, setError, setProgressMessage, setPrompt]);

    const handleRemoveBackground = useCallback(async () => {
        if (selectedElementIds.length !== 1) return;
        const element = elements.find(el => el.id === selectedElementIds[0]);
        if (!element || element.type !== 'image') return;

        setIsLoading(true);
        setError(null);
        setProgressMessage('Removing background...');

        try {
            const rawSize = await getRawImageSize(element.href);
            let result: { newImages?: { base64: string; mimeType: 'image/png' }[]; textResponse?: string };
            const rbPrompt = "Please remove the background of this image. The output should only contain the main subject with a transparent background.";
            console.log('AI Remove Background Prompt:', rbPrompt);

            if (modelProvider === 'wan') {
                result = await editImageWan(
                    [{ href: element.href, mimeType: element.mimeType }],
                    rbPrompt,
                    setProgressMessage,
                    rawSize,
                    "low quality, blurry, low resolution"
                );
            } else {
                result = await editImage(
                    [{ href: element.href, mimeType: element.mimeType }],
                    rbPrompt
                );
            }

            if (result.newImages && result.newImages.length > 0) {
                const { base64, mimeType } = result.newImages[0];

                const img = new Image();
                img.onload = () => {
                    const PADDING = 20 / zoom;

                    // Calculate tight content bounds (in natural pixels)
                    const contentBounds = getImageContentBounds(img);

                    // Scale to display dimensions
                    const scaleX = element.width / img.width;
                    const scaleY = element.height / img.height;

                    const tightWidth = contentBounds.width * scaleX;
                    const tightHeight = contentBounds.height * scaleY;

                    const newImage: ImageElement = {
                        id: generateId(),
                        type: 'image',
                        name: `${element.name || 'Image'} (no bg)`,
                        x: element.x + element.width + PADDING,
                        y: element.y + (element.height / 2) - (tightHeight / 2),
                        width: tightWidth,
                        height: tightHeight,
                        href: `data:${mimeType};base64,${base64}`,
                        mimeType,
                        parentId: element.parentId,
                        rotation: 0,
                    };

                    addElementsWithParenting([newImage]);
                    setSelectedElementIds([newImage.id]);
                };
                img.onerror = () => setError('Failed to load the background-removed image.');
                img.src = `data:${mimeType};base64,${base64}`;
            } else {
                setError(result.textResponse || 'Background removal failed to produce an image.');
            }

        } catch (err) {
            const error = err as Error;
            setError(`Failed to remove background: ${error.message}`);
            console.error(err);
        } finally {
            setIsLoading(false);
            setProgressMessage('');
        }
    }, [zoom, addElementsWithParenting, setSelectedElementIds, setIsLoading, setError, setProgressMessage, modelProvider, elements, selectedElementIds]);

    const handleAutoCombine = useCallback(async () => {
        if (selectedElementIds.length < 2) return;

        setIsLoading(true);
        setError(null);
        setProgressMessage('Combining elements...');

        try {
            const flattenedSelection = getFlattenedSelection(selectedElementIds, elements);
            const elementsToProcess = flattenedSelection.filter(
                el => !['video', 'frame', 'group'].includes(el.type)
            );

            const imagePromises = elementsToProcess.map(el => {
                if (el.type === 'image') return Promise.resolve({ href: el.href, mimeType: el.mimeType });
                return rasterizeElement(el as Exclude<Element, ImageElement | VideoElement | FrameElement | GroupElement>);
            });

            const imagesToProcess = await Promise.all(imagePromises);

            let result: { newImages?: { base64: string; mimeType: string }[]; textResponse?: string };
            if (modelProvider === 'wan') {
                const selectedImages = elementsToProcess.filter(el => el.type === 'image') as ImageElement[];
                let targetSize;

                if (selectedImages.length > 0) {
                    // Use the dimensions of the largest image in the selection
                    const largestImage = selectedImages.reduce((prev, curr) =>
                        (prev.width * prev.height > curr.width * curr.height) ? prev : curr
                    );
                    targetSize = { width: largestImage.width, height: largestImage.height };
                } else {
                    const selectionBounds = getSelectionBounds(selectedElementIds, elements);
                    targetSize = { width: selectionBounds.width, height: selectionBounds.height };
                }

                result = await editImageWan(
                    imagesToProcess,
                    'Combine these elements into a single cohesive, realistic image.',
                    setProgressMessage,
                    targetSize,
                    negativePrompt
                );
            } else {
                const geminiResult = await editImage(imagesToProcess, 'Combine these elements into a single cohesive, realistic image.', undefined, negativePrompt);
                result = {
                    newImages: geminiResult.newImageBase64 ? [{ base64: geminiResult.newImageBase64, mimeType: (geminiResult.newImageMimeType as 'image/png') || 'image/png' }] : undefined,
                    textResponse: geminiResult.textResponse
                };
            }

            if (result.newImages && result.newImages.length > 0) {
                const { base64, mimeType } = result.newImages[0];

                const img = new Image();
                img.onload = () => {
                    const selectionBounds = getSelectionBounds(selectedElementIds, elements);
                    const PADDING = 20 / zoom;

                    // Calculate tight content bounds (in natural pixels)
                    const contentBounds = getImageContentBounds(img);

                    // Scale factor between selection area and natural size
                    const scaleX = selectionBounds.width / img.width;
                    const scaleY = selectionBounds.height / img.height;

                    const tightWidth = contentBounds.width * scaleX;
                    const tightHeight = contentBounds.height * scaleY;

                    const newImage: ImageElement = {
                        id: generateId(),
                        type: 'image',
                        name: 'Combined Image',
                        x: selectionBounds.x + selectionBounds.width + PADDING,
                        y: (selectionBounds.y + selectionBounds.height / 2) - (tightHeight / 2),
                        width: tightWidth,
                        height: tightHeight,
                        href: `data:${mimeType};base64,${base64}`,
                        mimeType,
                        parentId: undefined, // Top level
                        rotation: 0,
                    };

                    addElementsWithParenting([newImage]);
                    setSelectedElementIds([newImage.id]);
                };
                img.src = `data:${mimeType};base64,${base64}`;
            } else {
                setError(result.textResponse || 'Failed to combine elements.');
            }
        } catch (err) {
            const error = err as Error;
            setError(`Failed to combine: ${error.message}`);
            console.error(err);
        } finally {
            setIsLoading(false);
            setProgressMessage('');
        }
    }, [selectedElementIds, elements, zoom, addElementsWithParenting, setSelectedElementIds, setIsLoading, setError, setProgressMessage]);


    const handleGenerate = useCallback(async () => {
        if (!prompt.trim()) {
            setError('Please enter a prompt.');
            return;
        }

        console.log('AI Generation Prompt:', prompt);
        console.log('Negative Prompt:', negativePrompt);

        setIsLoading(true);
        setError(null);
        setProgressMessage('Starting generation...');

        if (generationMode === 'video') {
            try {
                const selectedElements = elements.filter(el => selectedElementIds.includes(el.id) && el.type !== 'frame');
                const imageElement = selectedElements.find(el => el.type === 'image') as ImageElement | undefined;

                if (selectedElementIds.length > 1 || (selectedElementIds.length === 1 && !imageElement)) {
                    setError('For video generation, please select a single image or no elements.');
                    setIsLoading(false);
                    return;
                }

                const videoResults = await generateVideo(
                    prompt,
                    videoAspectRatio,
                    numberOfVideos,
                    (message) => setProgressMessage(message),
                    imageElement ? { href: imageElement.href, mimeType: imageElement.mimeType } : undefined
                );

                setProgressMessage('Processing video(s)...');

                const videoPromises = videoResults.map(result => {
                    return new Promise<{ video: HTMLVideoElement; url: string; mimeType: string }>((resolve, reject) => {
                        const videoUrl = URL.createObjectURL(result.videoBlob);
                        const video = document.createElement('video');

                        video.onloadedmetadata = () => {
                            resolve({ video, url: videoUrl, mimeType: result.mimeType });
                        };

                        video.onerror = (err) => {
                            URL.revokeObjectURL(videoUrl);
                            reject(err);
                        };

                        video.src = videoUrl;
                    });
                });

                const loadedVideos = await Promise.all(videoPromises);

                if (!svgRef.current) return;
                const svgBounds = svgRef.current.getBoundingClientRect();
                const canvasPoint = getCanvasPoint(
                    svgBounds.left + svgBounds.width / 2,
                    svgBounds.top + svgBounds.height / 2,
                    svgBounds,
                    panOffset,
                    zoom
                );


                const PADDING = 20 / zoom;
                const totalWidth = loadedVideos.reduce((sum, { video }) => {
                    let newWidth = video.videoWidth;
                    let newHeight = video.videoHeight;
                    const MAX_DIM = 800;
                    if (newWidth > MAX_DIM || newHeight > MAX_DIM) {
                        const ratio = newWidth / newHeight;
                        if (ratio > 1) { newWidth = MAX_DIM; } else { newWidth = MAX_DIM * ratio; }
                    }
                    return sum + newWidth;
                }, 0) + (loadedVideos.length - 1) * PADDING;

                let currentX = canvasPoint.x - totalWidth / 2;

                const newVideoElements: VideoElement[] = [];
                const newVideoIds: string[] = [];

                for (const { video, url, mimeType } of loadedVideos) {
                    let newWidth = video.videoWidth;
                    let newHeight = video.videoHeight;
                    const MAX_DIM = 800;
                    if (newWidth > MAX_DIM || newHeight > MAX_DIM) {
                        const ratio = newWidth / newHeight;
                        if (ratio > 1) { // landscape
                            newWidth = MAX_DIM;
                            newHeight = MAX_DIM / ratio;
                        } else { // portrait or square
                            newHeight = MAX_DIM;
                            newWidth = MAX_DIM * ratio;
                        }
                    }

                    const y = canvasPoint.y - (newHeight / 2);

                    const newVideoElement: VideoElement = {
                        id: generateId(), type: 'video', name: 'Generated Video',
                        x: currentX, y,
                        width: newWidth,
                        height: newHeight,
                        href: url,
                        mimeType,
                        rotation: 0,
                    };

                    newVideoElements.push(newVideoElement);
                    newVideoIds.push(newVideoElement.id);
                    currentX += newWidth + PADDING;
                }

                addElementsWithParenting(newVideoElements);
                setSelectedElementIds(newVideoIds);
                setIsLoading(false);

            } catch (err) {
                const error = err as Error;
                setError(`Video generation failed: ${error.message}`);
                console.error("Video generation failed:", error);
                setIsLoading(false);
            }
            return;
        }


        // IMAGE GENERATION LOGIC
        try {
            const isEditing = selectedElementIds.length > 0;

            if (isEditing) {
                const flattenedSelection = getFlattenedSelection(selectedElementIds, elements);
                const selectedElements = flattenedSelection.filter(el => !['frame'].includes(el.type));
                const imageElements = selectedElements.filter(el => el.type === 'image') as ImageElement[];
                const maskPaths = selectedElements.filter(el => el.type === 'path' && el.opacity && el.opacity < 1) as PathElement[];

                // Inpainting logic
                if (imageElements.length === 1 && maskPaths.length > 0 && selectedElements.length === (1 + maskPaths.length)) {
                    const baseImage = imageElements[0];
                    const maskData = await rasterizeMask(maskPaths, baseImage);
                    const result = await editImage(
                        [{ href: baseImage.href, mimeType: baseImage.mimeType }],
                        prompt,
                        { href: maskData.href, mimeType: maskData.mimeType }
                    );

                    if (result.newImageBase64 && result.newImageMimeType) {
                        const { newImageBase64, newImageMimeType } = result;

                        const img = new Image();
                        img.onload = () => {
                            const PADDING = 20 / zoom;
                            const newImage: ImageElement = {
                                id: generateId(),
                                type: 'image',
                                name: `${baseImage.name || 'Image'} (inpainted)`,
                                x: baseImage.x + baseImage.width + PADDING,
                                y: baseImage.y + (baseImage.height / 2) - (img.height / 2),
                                width: img.width,
                                height: img.height,
                                href: `data:${newImageMimeType};base64,${newImageBase64}`,
                                mimeType: newImageMimeType,
                                parentId: baseImage.parentId,
                                rotation: 0,
                            };

                            addElementsWithParenting([newImage]);
                            setSelectedElementIds([newImage.id]);
                        };
                        img.onerror = () => setError('Failed to load the generated image.');
                        img.src = `data:${newImageMimeType};base64,${newImageBase64}`;
                    } else {
                        setError(result.textResponse || 'Inpainting failed to produce an image.');
                    }
                    return; // End execution for inpainting path
                }

                // Regular edit/combine logic
                const imagePromises = selectedElements
                    .filter(el => el.type !== 'group')
                    .map(el => {
                        if (el.type === 'image') return Promise.resolve({ href: el.href, mimeType: el.mimeType });
                        if (el.type === 'video' || el.type === 'frame') return Promise.reject(new Error("Cannot use video or frame elements in image generation."));
                        return rasterizeElement(el as Exclude<Element, ImageElement | VideoElement | FrameElement | GroupElement>);
                    });
                const imagesToProcess = await Promise.all(imagePromises);

                // Identify the reference element for sizing (largest image by area or first element)
                let referenceElement: any = imageElements.length > 0 ? imageElements[0] : selectedElements[0];

                if (imageElements.length > 1) {
                    for (let i = 1; i < imageElements.length; i++) {
                        if (imageElements[i].width * imageElements[i].height > referenceElement.width * referenceElement.height) {
                            referenceElement = imageElements[i];
                        }
                    }
                }

                let targetSizeForWan: { width: number; height: number } | undefined;
                if (modelProvider === 'wan' && referenceElement) {
                    if (referenceElement.type === 'image') {
                        try {
                            targetSizeForWan = await getRawImageSize(referenceElement.href);
                        } catch (e) {
                            console.error("Failed to get raw size, falling back to display size", e);
                            targetSizeForWan = { width: referenceElement.width, height: referenceElement.height };
                        }
                    } else if (referenceElement.width && referenceElement.height) {
                        targetSizeForWan = { width: referenceElement.width, height: referenceElement.height };
                    }

                    if (modelProvider === 'wan' && targetSizeForWan) {
                        targetSizeForWan = getAdjustedSize(targetSizeForWan.width, targetSizeForWan.height);
                    }
                }

                let results: { newImages?: { base64: string; mimeType: 'image/png' }[]; textResponse?: string }[];

                if (modelProvider === 'wan' && imagesToProcess.length > 0) {
                    setProgressMessage(`Generating ${numberOfImages} image(s) with Wan 2.6...`);
                    const batchResult = await editImageWan(imagesToProcess, prompt, setProgressMessage, targetSizeForWan, negativePrompt, numberOfImages);
                    results = [batchResult];
                } else {
                    const generationPromises = Array.from({ length: numberOfImages }).map((_, i) => {
                        setProgressMessage(`Generating image ${i + 1} of ${numberOfImages}...`);
                        return editImage(imagesToProcess, prompt, undefined, negativePrompt);
                    });
                    const geminiResults = await Promise.all(generationPromises);
                    results = geminiResults.map(r => ({
                        newImages: r.newImageBase64 ? [{ base64: r.newImageBase64, mimeType: (r.newImageMimeType as 'image/png') || 'image/png' }] : undefined,
                        textResponse: r.textResponse
                    }));
                }

                const successfulImages = results.flatMap(r => r.newImages || []);

                if (successfulImages.length > 0) {
                    const resultImagePromises = successfulImages.map(imgData => {
                        return new Promise<{ img: HTMLImageElement, data: { base64: string, mimeType: string } }>((resolve, reject) => {
                            const img = new Image();
                            img.onload = () => resolve({ img, data: imgData });
                            img.onerror = (err) => reject(err);
                            img.src = `data:${imgData.mimeType};base64,${imgData.base64}`;
                        });
                    });

                    const loadedImages = await Promise.all(resultImagePromises);
                    const selectionBounds = getSelectionBounds(selectedElementIds, elements);
                    const PADDING = 20 / zoom;
                    let currentX = selectionBounds.x + selectionBounds.width + PADDING;
                    const selectionCenterY = selectionBounds.y + selectionBounds.height / 2;

                    const newImageElements: ImageElement[] = [];
                    const newImageIds: string[] = [];

                    const displayWidth = referenceElement?.width || selectionBounds.width;
                    const displayHeight = referenceElement?.height || selectionBounds.height;

                    for (const { img, data } of loadedImages) {
                        // Calculate tight content bounds (in natural pixels)
                        const contentBounds = getImageContentBounds(img);

                        // Scale to display dimensions based on the referenceElement's target size
                        const scaleX = displayWidth / img.width;
                        const scaleY = displayHeight / img.height;

                        const tightWidth = contentBounds.width * scaleX;
                        const tightHeight = contentBounds.height * scaleY;

                        const y = selectionCenterY - (tightHeight / 2);
                        const newImage: ImageElement = {
                            id: generateId(), type: 'image', x: currentX, y, name: 'Generated Image',
                            width: tightWidth, height: tightHeight,
                            href: `data:${data.mimeType};base64,${data.base64}`, mimeType: data.mimeType,
                            rotation: 0,
                        };
                        newImageElements.push(newImage);
                        newImageIds.push(newImage.id);
                        currentX += tightWidth + PADDING;
                    }

                    addElementsWithParenting(newImageElements);
                    setSelectedElementIds(newImageIds);
                } else {
                    const firstError = results.find(r => r.textResponse)?.textResponse;
                    setError(firstError || 'Generation failed to produce any images.');
                }
            } else {
                // Generate from scratch: Use Placeholders
                if (!svgRef.current) return;

                const svgBounds = svgRef.current.getBoundingClientRect();
                const PADDING = 20 / zoom;
                let dims = getDefaultDimensions(imageAspectRatio);

                if (modelProvider === 'wan') {
                    dims = getAdjustedSize(dims.width, dims.height);
                }

                const canvasPoint = getCanvasPoint(
                    svgBounds.left + svgBounds.width / 2,
                    svgBounds.top + svgBounds.height / 2,
                    svgBounds,
                    panOffset,
                    zoom
                );

                const totalWidth = (dims.width * numberOfImages) + ((numberOfImages - 1) * PADDING);
                let currentX = canvasPoint.x - totalWidth / 2;
                const currentY = canvasPoint.y - dims.height / 2;

                const placeholders: ImageElement[] = [];
                const placeholderIds: string[] = [];

                for (let i = 0; i < numberOfImages; i++) {
                    const id = generateId();
                    const ph: ImageElement = {
                        id,
                        type: 'image',
                        name: 'Generating...',
                        x: currentX,
                        y: currentY,
                        width: dims.width,
                        height: dims.height,
                        href: createPlaceholderDataUrl(dims.width, dims.height, `Generating ${i + 1}...`),
                        mimeType: 'image/svg+xml',
                        rotation: 0
                    };
                    placeholders.push(ph);
                    placeholderIds.push(id);
                    currentX += dims.width + PADDING;
                }

                addElementsWithParenting(placeholders);
                setSelectedElementIds(placeholderIds);

                let result;
                if (modelProvider === 'wan') {
                    result = await generateImageWan(prompt, imageAspectRatio, numberOfImages, negativePrompt, setProgressMessage);
                } else {
                    result = await generateImageFromText(prompt, imageAspectRatio, numberOfImages, negativePrompt);
                }

                if (result.newImages && result.newImages.length > 0) {
                    const imagePromises = result.newImages.map((imgData, i) => {
                        if (i >= placeholders.length) return Promise.resolve(null);

                        const targetId = placeholderIds[i];
                        const originalPh = placeholders[i];

                        return new Promise<ImageElement | null>((resolve) => {
                            const img = new Image();
                            img.onload = () => {
                                const centerX = originalPh.x + originalPh.width / 2;
                                const centerY = originalPh.y + originalPh.height / 2;

                                const newX = centerX - img.width / 2;
                                const newY = centerY - img.height / 2;

                                const replacement: ImageElement = {
                                    ...originalPh,
                                    name: 'Generated Image',
                                    x: newX,
                                    y: newY,
                                    width: img.width,
                                    height: img.height,
                                    naturalWidth: img.width,
                                    naturalHeight: img.height,
                                    href: `data:${imgData.mimeType};base64,${imgData.base64}`,
                                    mimeType: imgData.mimeType
                                };
                                resolve(replacement);
                            };
                            img.onerror = () => {
                                console.error(`Failed to load generated image ${i}`);
                                resolve(null);
                            };
                            img.src = `data:${imgData.mimeType};base64,${imgData.base64}`;
                        });
                    });

                    const resolvedElements = await Promise.all(imagePromises);
                    const validReplacements = resolvedElements.filter(e => e !== null) as ImageElement[];

                    if (validReplacements.length > 0) {
                        addElementsWithParenting(validReplacements);
                    }
                } else {
                    const errorPlaceholders = placeholders.map(ph => ({
                        ...ph,
                        href: createPlaceholderDataUrl(ph.width, ph.height, "Failed"),
                        name: "Generation Failed"
                    }));
                    addElementsWithParenting(errorPlaceholders);
                    setError(result.textResponse || 'Generation failed to produce an image.');
                }
            }
        } catch (err) {
            const error = err as Error;
            let friendlyMessage = `An error occurred during generation: ${error.message}`;

            if (error.message && (error.message.includes('429') || error.message.toUpperCase().includes('RESOURCE_EXHAUSTED'))) {
                friendlyMessage = "API quota exceeded. Please check your Google AI Studio plan and billing details, or try again later.";
            }

            setError(friendlyMessage);
            console.error("Generation failed:", error);
        } finally {
            setIsLoading(false);
            setProgressMessage('');
        }
    }, [prompt, generationMode, elements, selectedElementIds, videoAspectRatio, numberOfVideos, imageAspectRatio, numberOfImages, zoom, panOffset, addElementsWithParenting, setSelectedElementIds, setIsLoading, setError, setProgressMessage, svgRef, modelProvider, negativePrompt]);


    return {
        handleGetPromptFromImage,
        handleRemoveBackground,
        handleAutoCombine,
        handleGenerate
    };
};
