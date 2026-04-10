// components/MenuBar.tsx
// Shared application menu bar — used across ALL pages
// Menus: File | Device | Data | Tools | Configuration
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
export interface MenuBarProps {
  // Callbacks — pages wire these up to their own handlers
  onOpenImage?:         () => void;
  onSaveImage?:         () => void;
  onSaveOriginalImage?: () => void;
  onOpenCamera?:        () => void;
  onCloseCamera?:       () => void;
  onSampleInfo?:        () => void;
  onAutoMeasure?:       () => void;
  onManualMeasure?:     () => void;
  onPointer?:           () => void;
  onMeasureLength?:     () => void;
  onMeasureAngle?:      () => void;
  onMagnifier?:         () => void;
  onResumeImage?:       () => void;
  onClearGraphics?:     () => void;
  onTrimMeasure?:       () => void;
  onCenterCrossLine?:   () => void;
  onPanoramicScan?:     () => void;
  onAutoSearchEdge?:    () => void;
  onLineColorSetting?:  () => void;
  onCalibration?:       () => void;
  onAutoMeasureSetting?:() => void;
  onCameraSetting?:     () => void;
  onSerialPortSetting?: () => void;
  onXYPlatformSetting?: () => void;
  onZAxisSetting?:      () => void;
  onGenericSetting?:    () => void;
  onOtherSetting?:      () => void;
  onRestoreFactory?:    () => void;
  // Current tool highlight
  activeTool?: string;
}

interface MenuDef {
  label: string;
  items: (MenuItemDef | 'sep')[];
}

interface MenuItemDef {
  label:    string;
  icon?:    string;
  shortcut?: string;
  key:      string;
  disabled?: boolean;
}

// ─────────────────────────────────────────────────────────────
// Menu definitions
// ─────────────────────────────────────────────────────────────
const MENUS: MenuDef[] = [
  {
    label: 'File',
    items: [
      { label: 'Open Image',          icon: 'fa-folder-open',    shortcut: 'Ctrl+O', key: 'openImage' },
      { label: 'Save Image',          icon: 'fa-floppy-disk',    shortcut: 'Ctrl+S', key: 'saveImage' },
      { label: 'Save Original Image', icon: 'fa-file-image',     shortcut: 'Ctrl+Shift+S', key: 'saveOriginalImage' },
      'sep',
      { label: 'Exit',                icon: 'fa-right-from-bracket', shortcut: 'Alt+F4', key: 'exit' },
    ],
  },
  {
    label: 'Device',
    items: [
      { label: 'Open Camera',  icon: 'fa-video',      shortcut: 'F5', key: 'openCamera' },
      { label: 'Close Camera', icon: 'fa-video-slash',shortcut: 'F6', key: 'closeCamera' },
    ],
  },
  {
    label: 'Data',
    items: [
      { label: 'Sample Info', icon: 'fa-circle-info', key: 'sampleInfo' },
    ],
  },
  {
    label: 'Tools',
    items: [
      { label: 'Auto Measure',     icon: 'fa-robot',           shortcut: 'F1', key: 'autoMeasure' },
      { label: 'Manual Measure',   icon: 'fa-hand-pointer',    shortcut: 'F2', key: 'manualMeasure' },
      { label: 'Pointer',          icon: 'fa-arrow-pointer',   shortcut: 'F3', key: 'pointer' },
      'sep',
      { label: 'Measure Length',   icon: 'fa-ruler',           key: 'measureLength' },
      { label: 'Measure Angle',    icon: 'fa-drafting-compass', key: 'measureAngle' },
      { label: 'Magnifier',        icon: 'fa-magnifying-glass-plus', key: 'magnifier' },
      'sep',
      { label: 'Resume Image',     icon: 'fa-rotate-left',     key: 'resumeImage' },
      { label: 'Clear Graphics',   icon: 'fa-eraser',          key: 'clearGraphics' },
      { label: 'Trim Measure',     icon: 'fa-scissors',        key: 'trimMeasure' },
      'sep',
      { label: 'Center Cross Line',icon: 'fa-crosshairs',      key: 'centerCrossLine' },
      { label: 'Panoramic Scan',   icon: 'fa-panorama',        key: 'panoramicScan' },
      { label: 'Auto Search Edge', icon: 'fa-wand-magic-sparkles', key: 'autoSearchEdge' },
    ],
  },
  {
    label: 'Configuration',
    items: [
      { label: 'Line Color Setting',     icon: 'fa-palette',        key: 'lineColorSetting' },
      { label: 'Calibration',            icon: 'fa-ruler-combined', key: 'calibration' },
      { label: 'Auto Measure Setting',   icon: 'fa-sliders',        key: 'autoMeasureSetting' },
      { label: 'Camera Setting',         icon: 'fa-camera',         key: 'cameraSetting' },
      'sep',
      { label: 'Serial Port Setting',    icon: 'fa-plug',           key: 'serialPortSetting' },
      { label: 'XY Platform Setting',    icon: 'fa-up-down-left-right', key: 'xyPlatformSetting' },
      { label: 'Z Axis Setting',         icon: 'fa-elevator',       key: 'zAxisSetting' },
      'sep',
      { label: 'Generic Setting',        icon: 'fa-gear',           key: 'genericSetting' },
      { label: 'Other Setting',          icon: 'fa-ellipsis',       key: 'otherSetting' },
      'sep',
      { label: 'Restore Factory Setting',icon: 'fa-arrow-rotate-left', key: 'restoreFactory' },
    ],
  },
];

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────
export default function MenuBar(props: MenuBarProps) {
  const navigate = useNavigate();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node))
        setOpenMenu(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenMenu(null); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const handleItem = useCallback((key: string) => {
    setOpenMenu(null);
    const p = props;
    const callbackMap: Record<string, (() => void) | undefined> = {
      openImage:           p.onOpenImage,
      saveImage:           p.onSaveImage,
      saveOriginalImage:   p.onSaveOriginalImage,
      exit:                () => (window as any).api?.close?.(),
      openCamera:          p.onOpenCamera,
      closeCamera:         p.onCloseCamera,
      sampleInfo:          p.onSampleInfo,
      autoMeasure:         p.onAutoMeasure,
      manualMeasure:       p.onManualMeasure,
      pointer:             p.onPointer,
      measureLength:       p.onMeasureLength,
      measureAngle:        p.onMeasureAngle,
      magnifier:           p.onMagnifier,
      resumeImage:         p.onResumeImage,
      clearGraphics:       p.onClearGraphics,
      trimMeasure:         p.onTrimMeasure,
      centerCrossLine:     p.onCenterCrossLine,
      panoramicScan:       p.onPanoramicScan,
      autoSearchEdge:      p.onAutoSearchEdge,
      lineColorSetting:    p.onLineColorSetting,
      calibration:         p.onCalibration ?? (() => navigate('/calibration')),
      autoMeasureSetting:  p.onAutoMeasureSetting,
      cameraSetting:       p.onCameraSetting ?? (() => navigate('/live')),
      serialPortSetting:   p.onSerialPortSetting,
      xyPlatformSetting:   p.onXYPlatformSetting,
      zAxisSetting:        p.onZAxisSetting,
      genericSetting:      p.onGenericSetting,
      otherSetting:        p.onOtherSetting,
      restoreFactory:      p.onRestoreFactory,
    };
    callbackMap[key]?.();
  }, [props, navigate]);

  const toggleMenu = (label: string) =>
    setOpenMenu(prev => prev === label ? null : label);

  return (
    <div className="menubar" ref={barRef}>
      {MENUS.map(menu => (
        <div
          key={menu.label}
          className={`menubar-item${openMenu === menu.label ? ' open' : ''}`}
          onMouseEnter={() => openMenu && setOpenMenu(menu.label)}
        >
          <button
            className="menubar-btn"
            onClick={() => toggleMenu(menu.label)}
            onMouseDown={e => e.preventDefault()}
          >
            {menu.label}
          </button>

          {openMenu === menu.label && (
            <div className="menubar-dropdown" style={{
              left: (() => {
                // Position dropdown under the clicked button
                if (!barRef.current) return 0;
                const item = barRef.current.querySelector(`.menubar-item:nth-child(${MENUS.indexOf(menu) + 1})`);
                const rect = item?.getBoundingClientRect();
                return rect ? rect.left : 0;
              })()
            }}>
              {menu.items.map((item, i) =>
                item === 'sep'
                  ? <div key={`sep-${i}`} className="menubar-sep" />
                  : (
                    <button
                      key={item.key}
                      className={`menubar-dd-item${props.activeTool === item.key ? ' active' : ''}`}
                      onClick={() => handleItem(item.key)}
                      disabled={item.disabled}
                    >
                      <span className="menubar-dd-icon">
                        {item.icon && <i className={`fa-solid ${item.icon}`} />}
                      </span>
                      <span className="menubar-dd-label">{item.label}</span>
                      {item.shortcut && (
                        <span className="menubar-dd-shortcut">{item.shortcut}</span>
                      )}
                    </button>
                  )
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}