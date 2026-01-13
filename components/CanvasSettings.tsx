import React, { useState, useEffect, useRef } from 'react';
import type { WheelAction, Hotkey, PresentationHotkeys } from '../types';

interface CanvasSettingsProps {
    isOpen: boolean;
    onClose: () => void;
    canvasBackgroundColor: string;
    onCanvasBackgroundColorChange: (color: string) => void;
    onCanvasBackgroundImageChange: (file: File) => void;
    language: 'en' | 'zho';
    setLanguage: (lang: 'en' | 'zho') => void;
    uiTheme: { color: string; opacity: number };
    setUiTheme: (theme: { color: string; opacity: number }) => void;
    buttonTheme: { color: string; opacity: number };
    setButtonTheme: (theme: { color: string; opacity: number }) => void;
    wheelAction: WheelAction;
    setWheelAction: (action: WheelAction) => void;
    toolbarPosition: 'left' | 'right';
    setToolbarPosition: (position: 'left' | 'right') => void;
    generateHotkey: Hotkey;
    setGenerateHotkey: (hotkey: Hotkey) => void;
    presentationHotkeys: PresentationHotkeys;
    setPresentationHotkeys: (hotkeys: PresentationHotkeys) => void;
    t: (key: string) => string;
}

export const CanvasSettings: React.FC<CanvasSettingsProps> = ({
    isOpen,
    onClose,
    canvasBackgroundColor,
    onCanvasBackgroundColorChange,
    onCanvasBackgroundImageChange,
    language,
    setLanguage,
    uiTheme,
    setUiTheme,
    buttonTheme,
    setButtonTheme,
    wheelAction,
    setWheelAction,
    toolbarPosition,
    setToolbarPosition,
    generateHotkey,
    setGenerateHotkey,
    presentationHotkeys,
    setPresentationHotkeys,
    t
}) => {
    type HotkeyName = keyof PresentationHotkeys | 'generate';
    const [recordingKey, setRecordingKey] = useState<HotkeyName | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleSetHotkey = (keyName: HotkeyName) => {
        setRecordingKey(keyName);
    };

    useEffect(() => {
        if (!recordingKey) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            e.preventDefault();
            e.stopPropagation();

            if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

            const newHotkey: Hotkey = {
                key: e.key,
                metaOrCtrlKey: e.metaKey || e.ctrlKey,
                shiftKey: e.shiftKey,
                altKey: e.altKey,
            };

            if (recordingKey === 'generate') {
                setGenerateHotkey(newHotkey);
            } else {
                setPresentationHotkeys({
                    ...presentationHotkeys,
                    [recordingKey]: newHotkey,
                });
            }
            setRecordingKey(null);
        };

        window.addEventListener('keydown', handleKeyDown, true);

        return () => {
            window.removeEventListener('keydown', handleKeyDown, true);
        };
    }, [recordingKey, setGenerateHotkey, presentationHotkeys, setPresentationHotkeys]);

    const handleUploadClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            onCanvasBackgroundImageChange(e.target.files[0]);
            e.target.value = ''; // Reset file input
        }
    };


    const formatHotkey = (hotkey: Hotkey): string => {
        if (!hotkey) return '';
        const parts = [];
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        if (hotkey.metaOrCtrlKey) {
            parts.push(isMac ? '⌘' : 'Ctrl');
        }
        if (hotkey.altKey) {
            parts.push(isMac ? '⌥' : 'Alt');
        }
        if (hotkey.shiftKey) {
            parts.push('⇧');
        }
        let keyName = hotkey.key;
        if (keyName === ' ') keyName = 'Space';
        else if (keyName.length === 1) keyName = keyName.toUpperCase();

        parts.push(keyName);
        return parts.join(' + ');
    };

    const presentationHotkeyMap: { key: keyof PresentationHotkeys; labelKey: string }[] = [
        { key: 'nextSmooth', labelKey: 'settings.nextSmooth' },
        { key: 'prevSmooth', labelKey: 'settings.prevSmooth' },
        { key: 'nextDirect', labelKey: 'settings.nextDirect' },
        { key: 'prevDirect', labelKey: 'settings.prevDirect' },
    ];

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="relative p-6 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl flex flex-col space-y-4 w-96 text-white"
                style={{ backgroundColor: 'var(--ui-bg-color)' }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex justify-between items-center">
                    <h3 className="text-lg font-semibold">{t('settings.title')}</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-white p-1 rounded-full">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>

                <div className="border-t border-white/10 -mx-6"></div>

                {/* Language Settings */}
                <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-300">{t('settings.language')}</label>
                    <div className="flex items-center gap-2 p-1 bg-black/20 rounded-md">
                        <button
                            onClick={() => setLanguage('en')}
                            className={`flex-1 py-1.5 text-sm rounded ${language === 'en' ? 'bg-blue-500 text-white' : 'hover:bg-white/10'}`}
                        >
                            English
                        </button>
                        <button
                            onClick={() => setLanguage('zho')}
                            className={`flex-1 py-1.5 text-sm rounded ${language === 'zho' ? 'bg-blue-500 text-white' : 'hover:bg-white/10'}`}
                        >
                            中文
                        </button>
                    </div>
                </div>

                {/* Toolbar Position */}
                <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-300">{t('settings.toolbarPosition')}</label>
                    <div className="flex items-center gap-2 p-1 bg-black/20 rounded-md">
                        <button
                            onClick={() => setToolbarPosition('left')}
                            className={`flex-1 py-1.5 text-sm rounded ${toolbarPosition === 'left' ? 'bg-blue-500 text-white' : 'hover:bg-white/10'}`}
                        >
                            {t('settings.left')}
                        </button>
                        <button
                            onClick={() => setToolbarPosition('right')}
                            className={`flex-1 py-1.5 text-sm rounded ${toolbarPosition === 'right' ? 'bg-blue-500 text-white' : 'hover:bg-white/10'}`}
                        >
                            {t('settings.right')}
                        </button>
                    </div>
                </div>

                {/* UI Theme */}
                <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-300">{t('settings.uiTheme')}</label>
                    <div className="flex items-center justify-between p-1 pl-3 bg-black/20 rounded-md">
                        <span className="text-sm">{t('settings.color')}</span>
                        <div className="relative w-8 h-8 rounded" style={{ backgroundColor: uiTheme.color }}>
                            <input id="ui-color-input" name="ui-color" type="color" value={uiTheme.color} onChange={e => setUiTheme({ ...uiTheme, color: e.target.value })} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                        </div>
                    </div>
                </div>

                {/* Action Buttons Theme */}
                <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-300">{t('settings.actionButtonsTheme')}</label>
                    <div className="flex items-center justify-between p-1 pl-3 bg-black/20 rounded-md">
                        <span className="text-sm">{t('settings.color')}</span>
                        <div className="relative w-8 h-8 rounded" style={{ backgroundColor: buttonTheme.color }}>
                            <input id="button-color-input" name="button-color" type="color" value={buttonTheme.color} onChange={e => setButtonTheme({ ...buttonTheme, color: e.target.value })} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                        </div>
                    </div>
                </div>

                {/* Mouse Wheel */}
                <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-300">{t('settings.mouseWheel')}</label>
                    <div className="flex items-center gap-2 p-1 bg-black/20 rounded-md">
                        <button
                            onClick={() => setWheelAction('zoom')}
                            className={`flex-1 py-1.5 text-sm rounded ${wheelAction === 'zoom' ? 'bg-blue-500 text-white' : 'hover:bg-white/10'}`}
                        >
                            {t('settings.zoom')}
                        </button>
                        <button
                            onClick={() => setWheelAction('pan')}
                            className={`flex-1 py-1.5 text-sm rounded ${wheelAction === 'pan' ? 'bg-blue-500 text-white' : 'hover:bg-white/10'}`}
                        >
                            {t('settings.scroll')}
                        </button>
                    </div>
                </div>

                {/* Generate Hotkey */}
                <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-300">{t('settings.generateHotkey')}</label>
                    <div className="flex items-center justify-between p-1 pl-3 bg-black/20 rounded-md">
                        <span className="text-sm font-mono text-gray-300">{formatHotkey(generateHotkey)}</span>
                        <button onClick={() => handleSetHotkey('generate')} className="px-3 py-1 text-sm bg-white/10 rounded hover:bg-white/20">
                            {recordingKey === 'generate' ? t('settings.pressKey') : t('settings.setHotkey')}
                        </button>
                    </div>
                </div>

                {/* Presentation Hotkeys */}
                <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-300">{t('settings.presentationHotkeys')}</label>
                    {presentationHotkeyMap.map(({ key, labelKey }) => (
                        <div key={key} className="flex items-center justify-between p-1 pl-3 bg-black/20 rounded-md">
                            <span className="text-sm text-gray-300">{t(labelKey)}</span>
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-mono text-gray-300 w-28 text-right">{formatHotkey(presentationHotkeys[key])}</span>
                                <button onClick={() => handleSetHotkey(key)} className="px-3 py-1 text-sm bg-white/10 rounded hover:bg-white/20 w-24 text-center">
                                    {recordingKey === key ? t('settings.pressKey') : t('settings.setHotkey')}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Canvas Settings */}
                <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-300">{t('settings.canvas')}</label>
                    <div className="flex items-center justify-between p-1 pl-3 bg-black/20 rounded-md">
                        <span className="text-sm">{t('settings.backgroundColor')}</span>
                        <div className="relative w-8 h-8 rounded" style={{ backgroundColor: canvasBackgroundColor.startsWith('url') ? '#000' : canvasBackgroundColor }}>
                            <input id="canvas-bg-color-input" name="canvas-bg-color" type="color" value={canvasBackgroundColor.startsWith('url') ? '#111827' : canvasBackgroundColor} onChange={e => onCanvasBackgroundColorChange(e.target.value)} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                        </div>
                    </div>
                    <div className="flex items-center justify-between p-1 pl-3 bg-black/20 rounded-md">
                        <span className="text-sm">{t('settings.uploadBackground')}</span>
                        <input id="settings-file-input" name="settings-file" type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" className="hidden" />
                        <button onClick={handleUploadClick} className="px-3 py-1 text-sm bg-white/10 rounded hover:bg-white/20">
                            {t('settings.upload')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};