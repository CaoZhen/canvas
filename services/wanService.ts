import { ImageAspectRatio } from '../types';

const API_KEY = process.env.DASHSCOPE_API_KEY;

export const getAdjustedSize = (width: number, height: number): { width: number; height: number } => {
    let w = Math.round(width);
    let h = Math.round(height);
    const MIN_PIXELS = 589824;
    const MAX_PIXELS = 1638400;

    let pixels = w * h;

    if (pixels < MIN_PIXELS) {
        const scale = Math.sqrt(MIN_PIXELS / pixels) * 1.01;
        w = Math.ceil(width * scale);
        h = Math.ceil(height * scale);
    } else if (pixels > MAX_PIXELS) {
        const scale = Math.sqrt(MAX_PIXELS / pixels) * 0.99;
        w = Math.floor(width * scale);
        h = Math.floor(height * scale);
    }

    // Ensure even dimensions
    w = Math.round(w / 2) * 2;
    h = Math.round(h / 2) * 2;

    // Final safety iterations to guarantee the limit
    while (w * h > MAX_PIXELS && (w > 2 && h > 2)) {
        if (w >= h) w -= 2;
        else h -= 2;
    }
    while (w * h < MIN_PIXELS) {
        if (w <= h) w += 2;
        else h += 2;
    }

    return { width: w, height: h };
};

interface WanTaskResponse {
    output: {
        task_id: string;
        task_status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED' | 'UNKNOWN';
        choices?: Array<{
            message: {
                content: Array<{
                    image?: string;
                    text?: string;
                    type: string;
                }>;
            };
        }>;
    };
    message?: string;
    code?: string;
}

export const editImageWan = async (
    images: { href: string; mimeType: string }[],
    prompt: string,
    onProgress?: (status: string) => void,
    targetSize?: { width: number; height: number },
    negativePrompt?: string,
    n: number = 1,
    strength: number = 0.6,
    guidanceScale: number = 9
): Promise<{ newImages?: { base64: string; mimeType: 'image/png' }[]; textResponse?: string }> => {
    if (!API_KEY) {
        throw new Error("DASHSCOPE_API_KEY is not set in environment variables.");
    }

    if (images.length === 0 || images.length > 4) {
        throw new Error("Wan 2.6 Image Edit requires between 1 and 4 input images.");
    }

    // 1. Submit Async Task
    const submitUrl = '/wan-api/v1/services/aigc/image-generation/generation';

    const content: any[] = [{ text: prompt }];

    // Add all images to the content array
    images.forEach(img => {
        content.push({ image: img.href });
    });

    // Ensure size constraints are met
    let finalSize = targetSize ? getAdjustedSize(targetSize.width, targetSize.height) : { width: 1280, height: 720 };

    const payload = {
        model: "wan2.6-image",
        input: {
            messages: [
                {
                    role: "user",
                    content: content
                }
            ]
        },
        parameters: {
            enable_interleave: false,
            n,
            size: `${finalSize.width}*${finalSize.height}`,
            prompt_extend: true,
            negative_prompt: negativePrompt,
            strength,
            guidance_scale: guidanceScale
        }
    };

    try {
        const response = await fetch(submitUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`,
                'X-DashScope-Async': 'enable'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Wan API Error: ${errorData.message || response.statusText}`);
        }

        const data: WanTaskResponse = await response.json();
        const taskId = data.output.task_id;

        if (onProgress) onProgress('Task submitted. Waiting for generation...');

        // 2. Poll for Results
        return await pollForResults(taskId, onProgress);

    } catch (error) {
        console.error("Error generating image with Wan 2.6:", error);
        throw error;
    }
};

const pollForResults = async (taskId: string, onProgress?: (status: string) => void): Promise<{ newImages?: { base64: string; mimeType: 'image/png' }[]; textResponse?: string }> => {
    const pollUrl = `/wan-api/v1/tasks/${taskId}`;
    const maxRetries = 60; // 5 minutes (assuming 5s interval)
    let retryCount = 0;

    while (retryCount < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 5000)); // Poll every 5 seconds
        retryCount++;

        const response = await fetch(pollUrl, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`
            }
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Wan Polling Error: ${errorData.message || response.statusText}`);
        }

        const data: WanTaskResponse = await response.json();
        const status = data.output.task_status;

        if (status === 'SUCCEEDED') {
            const choices = data.output.choices || [];
            const results: { base64: string; mimeType: 'image/png' }[] = [];

            for (const choice of choices) {
                const imageUrl = choice?.message.content.find(c => c.type === 'image')?.image;
                if (imageUrl) {
                    const imageRes = await fetch(imageUrl);
                    const blob = await imageRes.blob();
                    const base64 = await new Promise<string>((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onloadend = () => {
                            const readerResult = reader.result as string;
                            const base64Data = readerResult.split(',')[1];
                            resolve(base64Data);
                        };
                        reader.onerror = reject;
                        reader.readAsDataURL(blob);
                    });
                    results.push({
                        base64: base64,
                        mimeType: 'image/png'
                    });
                }
            }

            if (results.length > 0) {
                return { newImages: results };
            }
            return { textResponse: "Generation succeeded but no images found." };
        } else if (status === 'FAILED' || status === 'CANCELED') {
            console.error("Wan Task Failed Detail:", data);
            const detailChoice = data.output?.choices?.[0];
            const detailMessage = detailChoice?.message?.content?.find(c => c.type === 'text')?.text || data.message || status;
            throw new Error(`Wan Task Failed (${status}): ${detailMessage}`);
        } else {
            if (onProgress) onProgress(`Generating... (${status})`);
        }
    }

    throw new Error("Wan Task Timed Out");
};

export const generateImageWan = async (
    prompt: string,
    aspectRatio: ImageAspectRatio = '1:1',
    numberOfImages: number = 1,
    negativePrompt?: string,
    onProgress?: (status: string) => void
): Promise<{ newImages?: { base64: string; mimeType: 'image/png' }[]; textResponse?: string }> => {
    if (!API_KEY) {
        throw new Error("DASHSCOPE_API_KEY is not set in environment variables.");
    }

    const submitUrl = '/wan-api/v1/services/aigc/image-generation/generation';

    // Calculate size from ratio
    let width = 1024;
    let height = 1024;
    switch (aspectRatio) {
        case '16:9': width = 1280; height = 720; break;
        case '9:16': width = 720; height = 1280; break;
        case '4:3': width = 1024; height = 768; break;
        case '3:4': width = 768; height = 1024; break;
        case '1:1': default: width = 1024; height = 1024; break;
    }

    // Ensure valid size for Wan
    const adjusted = getAdjustedSize(width, height);
    const sizeStr = `${adjusted.width}*${adjusted.height}`;

    const payload = {
        model: "wan2.6-image",
        input: {
            messages: [
                {
                    role: "user",
                    content: [{ text: prompt }]
                }
            ]
        },
        parameters: {
            enable_interleave: false,
            n: numberOfImages,
            size: sizeStr,
            prompt_extend: true,
            negative_prompt: negativePrompt,
            strength: 1.0,
            guidance_scale: 9
        }
    };

    try {
        const response = await fetch(submitUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`,
                'X-DashScope-Async': 'enable'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Wan API Error: ${errorData.message || response.statusText}`);
        }

        const data: WanTaskResponse = await response.json();
        const taskId = data.output.task_id;

        if (onProgress) onProgress('Task submitted. Waiting for generation...');

        const result = await pollForResults(taskId, onProgress);

        if (result.newImages) {
            return {
                newImages: result.newImages
            };
        }
        return { textResponse: result.textResponse };

    } catch (error) {
        console.error("Error generating image with Wan 2.6:", error);
        throw error;
    }
};
