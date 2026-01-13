

import { GoogleGenAI, Modality, GenerateContentResponse, GenerateVideosOperation } from "@google/genai";
import type { ImageAspectRatio } from '../types';

const getApiKey = () => {
    const key = process.env.API_KEY;
    if (!key) {
        throw new Error("API_KEY is not set in environment variables. Please configure GEMINI_API_KEY.");
    }
    return key;
};

const getAi = () => new GoogleGenAI({ apiKey: getApiKey() });

const dataUrlToPart = (dataUrl: string, mimeType: string) => {
    const base64Data = dataUrl.split(',')[1];
    return {
        inlineData: {
            data: base64Data,
            mimeType,
        },
    };
};

export const generateImageFromText = async (
    prompt: string,
    aspectRatio: ImageAspectRatio,
    numberOfImages: number,
    negativePrompt?: string
): Promise<{ newImages?: { base64: string; mimeType: 'image/png' }[], textResponse?: string }> => {
    try {
        const ai = getAi();
        const response = await ai.models.generateImages({
            model: 'imagen-4.0-generate-001',
            prompt,
            config: {
                numberOfImages,
                outputMimeType: 'image/png',
                aspectRatio,
                negativePrompt,
            },
        });

        if (response.generatedImages && response.generatedImages.length > 0) {
            const newImages = response.generatedImages.map(img => ({
                base64: img.image.imageBytes,
                mimeType: 'image/png' as const,
            }));
            return { newImages };
        }
        return { textResponse: "No images were generated." };
    } catch (error) {
        console.error("Error generating image from text:", error);
        throw error;
    }
};

export const editImage = async (
    images: { href: string; mimeType: string }[],
    prompt: string,
    mask?: { href: string; mimeType: string },
    negativePrompt?: string
): Promise<{ newImageBase64?: string; newImageMimeType?: string; textResponse?: string }> => {
    try {
        const imageParts = images.map(img => dataUrlToPart(img.href, img.mimeType));
        const parts: any[] = [...imageParts, { text: prompt }];

        if (mask) {
            parts.push(dataUrlToPart(mask.href, mask.mimeType));
        }

        const ai = getAi();
        const response: GenerateContentResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: { parts },
            config: {
                responseModalities: [Modality.IMAGE, Modality.TEXT],
            },
        });

        for (const part of response.candidates[0].content.parts) {
            if (part.inlineData) {
                return {
                    newImageBase64: part.inlineData.data,
                    newImageMimeType: part.inlineData.mimeType,
                };
            }
        }

        const textResponse = response.text;
        return { textResponse: textResponse || "No image was generated." };

    } catch (error) {
        console.error("Error editing image:", error);
        throw error;
    }
};

export const generateVideo = async (
    prompt: string,
    aspectRatio: '16:9' | '9:16',
    numberOfVideos: number,
    onProgress: (message: string) => void,
    image?: { href: string; mimeType: string }
): Promise<{ videoBlob: Blob, mimeType: string }[]> => {
    try {
        onProgress('Sending request to generate video...');

        let imagePart;
        if (image) {
            const base64Data = image.href.split(',')[1];
            imagePart = {
                imageBytes: base64Data,
                mimeType: image.mimeType,
            };
        }

        const ai = getAi();
        let operation: GenerateVideosOperation = await ai.models.generateVideos({
            model: 'veo-2.0-generate-001',
            prompt,
            image: imagePart,
            config: {
                numberOfVideos,
            }
        });

        onProgress('Video generation in progress... this may take a few minutes.');
        let checkCount = 0;
        while (!operation.done) {
            checkCount++;
            await new Promise(resolve => setTimeout(resolve, 10000));
            onProgress(`Checking status... (${checkCount * 10}s elapsed)`);
            operation = await ai.operations.getVideosOperation({ operation: operation });
        }

        onProgress('Video generation complete. Downloading...');

        if (operation.response?.generatedVideos) {
            const videoPromises = operation.response.generatedVideos.map(async (videoInfo) => {
                const downloadLink = videoInfo.video?.uri;
                if (!downloadLink) {
                    throw new Error('Video generation succeeded but no download link was provided.');
                }
                const response = await fetch(`${downloadLink}&key=${getApiKey()}`);
                if (!response.ok) {
                    throw new Error(`Failed to download video: ${response.statusText}`);
                }
                const videoBlob = await response.blob();
                return { videoBlob, mimeType: 'video/mp4' };
            });

            return Promise.all(videoPromises);
        }

        throw new Error('Video generation finished but no videos were returned.');

    } catch (error) {
        console.error("Error generating video:", error);
        throw error;
    }
};

export const getPromptFromImage = async (
    image: { href: string; mimeType: string }
): Promise<string> => {
    try {
        const imagePart = dataUrlToPart(image.href, image.mimeType);
        const textPart = {
            text: "Describe this image in detail. Provide a descriptive prompt that could be used to generate a similar image with an AI image generator. Focus on visual elements, style, composition, colors, and lighting. The description should be professional and concise."
        };

        const ai = getAi();
        const response: GenerateContentResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: { parts: [imagePart, textPart] },
        });

        if (!response.text) {
            throw new Error("API returned an empty prompt.");
        }

        return response.text;

    } catch (error) {
        console.error("Error getting prompt from image:", error);
        throw error;
    }
};