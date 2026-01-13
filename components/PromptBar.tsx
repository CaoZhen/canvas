

import React from 'react';
import { QuickPrompts } from './QuickPrompts';
import type { UserEffect, GenerationMode, ImageAspectRatio, Hotkey } from '../types';

interface PromptBarProps {
    t: (key: string, ...args: any[]) => string;
    prompt: string;
    setPrompt: (prompt: string) => void;
    onGenerate: () => void;
    isLoading: boolean;
    isSelectionActive: boolean;
    selectedElementCount: number;
    userEffects: UserEffect[];
    onAddUserEffect: (effect: UserEffect) => void;
    onDeleteUserEffect: (id: string) => void;
    generationMode: GenerationMode;
    setGenerationMode: (mode: GenerationMode) => void;
    videoAspectRatio: '16:9' | '9:16';
    setVideoAspectRatio: (ratio: '16:9' | '9:16') => void;
    imageAspectRatio: ImageAspectRatio;
    setImageAspectRatio: (ratio: ImageAspectRatio) => void;
    numberOfImages: number;
    setNumberOfImages: (num: number) => void;
    numberOfVideos: number;
    setNumberOfVideos: (num: number) => void;
    generateHotkey: Hotkey;
    modelProvider: 'gemini' | 'wan';
    setModelProvider: (provider: 'gemini' | 'wan') => void;
    negativePrompt: string;
    setNegativePrompt: (prompt: string) => void;
}

export const PromptBar: React.FC<PromptBarProps> = ({
    t,
    prompt,
    setPrompt,
    onGenerate,
    isLoading,
    isSelectionActive,
    selectedElementCount,
    userEffects,
    onAddUserEffect,
    onDeleteUserEffect,
    generationMode,
    setGenerationMode,
    videoAspectRatio,
    setVideoAspectRatio,
    imageAspectRatio,
    setImageAspectRatio,
    numberOfImages,
    setNumberOfImages,
    numberOfVideos,
    setNumberOfVideos,
    generateHotkey,
    modelProvider,
    setModelProvider,
    negativePrompt,
    setNegativePrompt,
}) => {
    const textareaRef = React.useRef<HTMLTextAreaElement>(null);
    const [isAspectRatioMenuOpen, setIsAspectRatioMenuOpen] = React.useState(false);
    const [isNumberMenuOpen, setIsNumberMenuOpen] = React.useState(false);
    const [isModelMenuOpen, setIsModelMenuOpen] = React.useState(false);
    const [isVidAspectRatioMenuOpen, setIsVidAspectRatioMenuOpen] = React.useState(false);
    const [isVidNumberMenuOpen, setIsVidNumberMenuOpen] = React.useState(false);
    const [showNegativePrompt, setShowNegativePrompt] = React.useState(false);

    const aspectRatioRef = React.useRef<HTMLDivElement>(null);
    const numberRef = React.useRef<HTMLDivElement>(null);
    const modelRef = React.useRef<HTMLDivElement>(null);
    const vidAspectRatioRef = React.useRef<HTMLDivElement>(null);
    const vidNumberRef = React.useRef<HTMLDivElement>(null);


    React.useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto'; // Reset height
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
        }
    }, [prompt]);

    React.useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (aspectRatioRef.current && !aspectRatioRef.current.contains(event.target as Node)) {
                setIsAspectRatioMenuOpen(false);
            }
            if (numberRef.current && !numberRef.current.contains(event.target as Node)) {
                setIsNumberMenuOpen(false);
            }
            if (vidAspectRatioRef.current && !vidAspectRatioRef.current.contains(event.target as Node)) {
                setIsVidAspectRatioMenuOpen(false);
            }
            if (vidNumberRef.current && !vidNumberRef.current.contains(event.target as Node)) {
                setIsVidNumberMenuOpen(false);
            }
            if (modelRef.current && !modelRef.current.contains(event.target as Node)) {
                setIsModelMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const getPlaceholderText = () => {
        if (!isSelectionActive) {
            return generationMode === 'video' ? t('promptBar.placeholderDefaultVideo') : t('promptBar.placeholderDefault');
        }
        if (selectedElementCount === 1) {
            return t('promptBar.placeholderSingle');
        }
        return t('promptBar.placeholderMultiple', selectedElementCount);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (!generateHotkey) return;
        const { key, metaOrCtrlKey, shiftKey, altKey } = generateHotkey;

        if (
            e.key.toLowerCase() === key.toLowerCase() &&
            (e.metaKey || e.ctrlKey) === metaOrCtrlKey &&
            e.shiftKey === shiftKey &&
            e.altKey === altKey
        ) {
            e.preventDefault();
            if (!isLoading && prompt.trim()) {
                onGenerate();
            }
        }
    };

    const handleSaveEffect = () => {
        const name = window.prompt(t('myEffects.saveEffectPrompt'), t('myEffects.defaultName'));
        if (name && prompt.trim()) {
            onAddUserEffect({ id: `user_${Date.now()}`, name, value: prompt });
        }
    };

    const containerStyle: React.CSSProperties = {
        backgroundColor: `var(--ui-bg-color)`,
    };

    const aspectRatios: { value: ImageAspectRatio; label: string; icon: React.ReactNode }[] = [
        { value: '1:1', label: t('promptBar.aspectRatioSquare'), icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg> },
        { value: '16:9', label: t('promptBar.aspectRatioLandscapeW'), icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="10" rx="2" ry="2"></rect></svg> },
        { value: '9:16', label: t('promptBar.aspectRatioPortraitT'), icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="2" width="10" height="20" rx="2" ry="2"></rect></svg> },
        { value: '4:3', label: t('promptBar.aspectRatioLandscape'), icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" ry="2"></rect></svg> },
        { value: '3:4', label: t('promptBar.aspectRatioPortrait'), icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="3" width="14" height="18" rx="2" ry="2"></rect></svg> },
    ];

    const videoAspectRatios: { value: '16:9' | '9:16'; label: string; icon: React.ReactNode }[] = [
        { value: '16:9', label: t('promptBar.aspectRatioHorizontal'), icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="10" rx="2" ry="2"></rect></svg> },
        { value: '9:16', label: t('promptBar.aspectRatioVertical'), icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="2" width="10" height="20" rx="2" ry="2"></rect></svg> },
    ];

    return (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 w-full max-w-4xl px-4 flex flex-col items-center gap-2">
            <div className="flex items-center justify-center gap-3 w-full">
                <div
                    style={containerStyle}
                    className="flex-shrink-0 flex items-center p-2 gap-2 backdrop-blur-xl border border-white/10 rounded-full shadow-2xl text-white"
                >
                    {generationMode === 'image' ? (
                        <>
                            {/* Model Selector Dropdown */}
                            <div ref={modelRef} className="relative">
                                <button
                                    onClick={() => setIsModelMenuOpen(p => !p)}
                                    title="Select AI Model"
                                    className="h-10 px-3 flex items-center justify-center rounded-full bg-black/20 hover:bg-white/10 transition-colors gap-2 select-none"
                                >
                                    <span className="font-semibold text-sm">{modelProvider === 'gemini' ? 'Gemini 2.0' : 'Wan 2.6'}</span>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${isModelMenuOpen ? 'rotate-180' : ''}`}><path d="m6 9 6 6 6-6" /></svg>
                                </button>
                                {isModelMenuOpen && (
                                    <div className="absolute bottom-full mb-2 p-1 bg-neutral-800/90 backdrop-blur-xl border border-white/10 rounded-lg shadow-2xl flex flex-col gap-1 w-32">
                                        <button
                                            onClick={() => {
                                                setModelProvider('gemini');
                                                setIsModelMenuOpen(false);
                                            }}
                                            className={`px-3 py-2 text-left text-sm rounded-md transition-colors font-semibold ${modelProvider === 'gemini' ? 'bg-blue-500' : 'hover:bg-white/10'}`}
                                        >
                                            Gemini 2.0
                                        </button>
                                        <button
                                            onClick={() => {
                                                setModelProvider('wan');
                                                setIsModelMenuOpen(false);
                                            }}
                                            className={`px-3 py-2 text-left text-sm rounded-md transition-colors font-semibold ${modelProvider === 'wan' ? 'bg-blue-500' : 'hover:bg-white/10'}`}
                                        >
                                            Wan 2.6
                                        </button>
                                    </div>
                                )}
                            </div>

                            <div className="w-px h-8 bg-white/20"></div>

                            {/* Number of Images Dropdown */}
                            <div ref={numberRef} className="relative">
                                <button
                                    onClick={() => setIsNumberMenuOpen(p => !p)}
                                    title={t('promptBar.numberOfImages')}
                                    className="w-10 h-10 flex items-center justify-center rounded-full bg-black/20 hover:bg-white/10 transition-colors"
                                >
                                    <span className="font-semibold">{numberOfImages}</span>
                                </button>
                                {isNumberMenuOpen && (
                                    <div className="absolute bottom-full mb-2 p-1 bg-neutral-800/90 backdrop-blur-xl border border-white/10 rounded-lg shadow-2xl flex flex-col gap-1">
                                        {[1, 2, 3, 4].map(num => (
                                            <button
                                                key={num}
                                                onClick={() => {
                                                    setNumberOfImages(num);
                                                    setIsNumberMenuOpen(false);
                                                }}
                                                className={`w-10 h-10 flex items-center justify-center text-sm rounded-md transition-colors font-semibold ${numberOfImages === num ? 'bg-blue-500' : 'hover:bg-white/10'}`}
                                            >
                                                {num}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="w-px h-8 bg-white/20"></div>

                            {/* Image Aspect Ratio Dropdown */}
                            <div ref={aspectRatioRef} className="relative">
                                <button
                                    onClick={() => setIsAspectRatioMenuOpen(p => !p)}
                                    title={t('promptBar.aspectRatio')}
                                    disabled={isSelectionActive}
                                    className={`w-10 h-10 flex items-center justify-center rounded-full bg-black/20 transition-colors ${isSelectionActive ? 'opacity-50 cursor-not-allowed' : 'hover:bg-white/10'
                                        }`}
                                >
                                    {aspectRatios.find(r => r.value === imageAspectRatio)?.icon}
                                </button>
                                {isAspectRatioMenuOpen && (
                                    <div className="absolute bottom-full mb-2 p-1 bg-neutral-800/90 backdrop-blur-xl border border-white/10 rounded-lg shadow-2xl flex flex-col gap-1">
                                        {aspectRatios.map(ratio => (
                                            <button
                                                key={ratio.value}
                                                onClick={() => {
                                                    setImageAspectRatio(ratio.value);
                                                    setIsAspectRatioMenuOpen(false);
                                                }}
                                                title={ratio.label}
                                                className={`p-1.5 rounded-md transition-colors w-full flex items-center justify-center ${imageAspectRatio === ratio.value ? 'bg-blue-500' : 'hover:bg-white/10'}`}
                                            >
                                                {ratio.icon}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </>
                    ) : (
                        <>
                            {/* Number of Videos Dropdown */}
                            <div ref={vidNumberRef} className="relative">
                                <button
                                    onClick={() => setIsVidNumberMenuOpen(p => !p)}
                                    title={t('promptBar.numberOfVideos')}
                                    className="w-10 h-10 flex items-center justify-center rounded-full bg-black/20 hover:bg-white/10 transition-colors"
                                >
                                    <span className="font-semibold">{numberOfVideos}</span>
                                </button>
                                {isVidNumberMenuOpen && (
                                    <div className="absolute bottom-full mb-2 p-1 bg-neutral-800/90 backdrop-blur-xl border border-white/10 rounded-lg shadow-2xl flex flex-col gap-1">
                                        {[1, 2].map(num => (
                                            <button
                                                key={num}
                                                onClick={() => {
                                                    setNumberOfVideos(num);
                                                    setIsVidNumberMenuOpen(false);
                                                }}
                                                className={`w-10 h-10 flex items-center justify-center text-sm rounded-md transition-colors font-semibold ${numberOfVideos === num ? 'bg-blue-500' : 'hover:bg-white/10'}`}
                                            >
                                                {num}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div className="w-px h-8 bg-white/20"></div>
                            {/* Video Aspect Ratio Dropdown */}
                            <div ref={vidAspectRatioRef} className="relative">
                                <button
                                    onClick={() => setIsVidAspectRatioMenuOpen(p => !p)}
                                    title={t('promptBar.aspectRatio')}
                                    className="w-10 h-10 flex items-center justify-center rounded-full bg-black/20 hover:bg-white/10 transition-colors"
                                >
                                    {videoAspectRatios.find(r => r.value === videoAspectRatio)?.icon}
                                </button>
                                {isVidAspectRatioMenuOpen && (
                                    <div className="absolute bottom-full mb-2 p-1 bg-neutral-800/90 backdrop-blur-xl border border-white/10 rounded-lg shadow-2xl flex flex-col gap-1">
                                        {videoAspectRatios.map(ratio => (
                                            <button
                                                key={ratio.value}
                                                onClick={() => {
                                                    setVideoAspectRatio(ratio.value);
                                                    setIsVidAspectRatioMenuOpen(false);
                                                }}
                                                title={ratio.label}
                                                className={`p-1.5 rounded-md transition-colors w-full flex items-center justify-center ${videoAspectRatio === ratio.value ? 'bg-blue-500' : 'hover:bg-white/10'}`}
                                            >
                                                {ratio.icon}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>

                <button
                    onClick={() => setGenerationMode(generationMode === 'image' ? 'video' : 'image')}
                    title={generationMode === 'image' ? t('promptBar.switchToVideo') : t('promptBar.switchToImage')}
                    className="flex-shrink-0 w-12 h-12 flex items-center justify-center text-white rounded-full transition-all duration-200 hover:brightness-110"
                    style={{ backgroundColor: 'var(--button-bg-color)' }}
                >
                    {generationMode === 'image'
                        ? <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                        : <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 8-6 4 6 4V8Z" /><rect x="2" y="6" width="14" height="12" rx="2" ry="2" /></svg>
                    }
                </button>

                <div
                    style={containerStyle}
                    className="flex-grow flex items-center gap-2 p-2 backdrop-blur-xl border border-white/10 rounded-full shadow-2xl"
                >
                    <QuickPrompts
                        t={t}
                        setPrompt={setPrompt}
                        disabled={!isSelectionActive || isLoading}
                        userEffects={userEffects}
                        onDeleteUserEffect={onDeleteUserEffect}
                    />
                    <textarea
                        id="prompt-input"
                        name="prompt"
                        ref={textareaRef}
                        rows={1}
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={getPlaceholderText()}
                        className="flex-grow bg-transparent text-white placeholder-neutral-400 focus:outline-none px-2 py-2 leading-normal resize-none overflow-y-auto max-h-32"
                        disabled={isLoading}
                    />
                    <button
                        onClick={() => setShowNegativePrompt(p => !p)}
                        className={`p-1.5 rounded-md transition-colors ${showNegativePrompt ? 'bg-blue-500/20 text-blue-400' : 'text-neutral-400 hover:bg-white/10'}`}
                        title="Toggle Negative Prompt"
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 9v4M12 17h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
                        </svg>
                    </button>
                    {prompt.trim() && !isLoading && (
                        <button
                            onClick={handleSaveEffect}
                            title={t('myEffects.saveEffectTooltip')}
                            className="flex-shrink-0 w-11 h-11 flex items-center justify-center text-white rounded-full hover:bg-neutral-600 transition-colors duration-200 disabled:text-neutral-400 disabled:cursor-not-allowed"
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" /></svg>
                        </button>
                    )}
                    <button
                        onClick={onGenerate}
                        disabled={isLoading || !prompt.trim()}
                        aria-label={t('promptBar.generate')}
                        title={t('promptBar.generate')}
                        className="flex-shrink-0 w-11 h-11 flex items-center justify-center text-white rounded-full disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-110 transition-all duration-200"
                        style={{ backgroundColor: 'var(--button-bg-color)' }}
                    >
                        {isLoading ? (
                            <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                        ) : (
                            generationMode === 'image'
                                ? <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
                                : <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 8-6 4 6 4V8Z" /><rect x="2" y="6" width="14" height="12" rx="2" ry="2" /></svg>
                        )}
                    </button>
                </div>
            </div>

            {showNegativePrompt && (
                <div className="w-full max-w-2xl bg-neutral-900/80 backdrop-blur-xl border border-white/10 rounded-2xl p-3 shadow-2xl animate-in slide-in-from-bottom-2 duration-300">
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase font-bold text-red-400/80 px-2 py-0.5 bg-red-400/10 rounded-md">Negative Prompt</span>
                        <input
                            id="negative-prompt-input"
                            name="negative-prompt"
                            type="text"
                            value={negativePrompt}
                            onChange={(e) => setNegativePrompt(e.target.value)}
                            placeholder="Avoid: blurry, distorted, low quality, bad anatomy..."
                            className="flex-grow bg-transparent text-sm text-white placeholder-neutral-500 focus:outline-none py-1"
                        />
                    </div>
                </div>
            )}
        </div>
    );
};