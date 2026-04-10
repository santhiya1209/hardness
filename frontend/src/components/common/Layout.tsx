import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

interface Toast {
  id: number;
  msg: string;
  type: string;
}

interface LayoutProps {
  children: ReactNode;
  toasts?: Toast[];
  version?: string;
  showSidebar?: boolean;
  camOnline?: boolean;
  streamOnline?: boolean;
  camLabel?: string;
  streamLabel?: string;
}

const NAV_ITEMS = [
  { section: 'Main', items: [
    { label: 'Dashboard',    path: '/',            icon: 'fa-solid fa-gauge-high'        },
    { label: 'Measurement',  path: '/measurement', icon: 'fa-solid fa-crosshairs'        },
    { label: 'Live Camera',  path: '/live',        icon: 'fa-solid fa-video'             },
  ]},
  { section: 'Analysis', items: [
    { label: 'Reports',      path: '/reports',     icon: 'fa-solid fa-chart-line'        },
    { label: 'History',      path: '/history',     icon: 'fa-solid fa-clock-rotate-left' },
    { label: 'HV Converter', path: '/converter',   icon: 'fa-solid fa-arrows-rotate'     },
  ]},
  { section: 'System', items: [
    { label: 'Calibration',  path: '/calibration', icon: 'fa-solid fa-ruler-combined'    },
    { label: 'Settings',     path: '/settings',    icon: 'fa-solid fa-gear'              },
    { label: 'Help',         path: '/help',        icon: 'fa-solid fa-circle-question'   },
  ]},
];

export default function Layout({
  children,
  toasts = [],
  version = 'v1.0.0',
  showSidebar = true,
  camOnline = false,
  streamOnline = false,
  camLabel = 'Camera offline',
  streamLabel = 'Stream off',
}: LayoutProps) {
  const navigate  = useNavigate();
  const location  = useLocation();
  const [clock, setClock] = useState('--:--:--');

  useEffect(() => {
    const tick = () => setClock(new Date().toTimeString().slice(0, 8));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="app-shell">
      {/* TITLEBAR */}
      <div className="titlebar">
        <div className="tb-brand">
          <div className="tb-logo">
            <i className="fa-solid fa-diamond" />
          </div>
          <span className="tb-title">
            Hardness <span>Tester</span> Pro
          </span>
        </div>
        <div className="tb-clock">{clock}</div>
        <div className="tb-controls">
          <button onClick={() => (window as any).api?.minimize()}>
            <i className="fa fa-minus" />
          </button>
          <button onClick={() => (window as any).api?.maximize()}>
            <i className="fa fa-square" />
          </button>
          <button className="tb-x" onClick={() => (window as any).api?.close()}>
            <i className="fa fa-xmark" />
          </button>
        </div>
      </div>

      {/* BODY */}
      <div className="app-body">

        {/* SIDEBAR */}
        {showSidebar && (
          <nav className="sidebar">
            <div className="sb-logo-block">
              <div className="sb-logo-icon">
                <i className="fa-solid fa-diamond" />
              </div>
              <div className="sb-app-name">HT <span>Pro</span></div>
              <div className="sb-ver">{version}</div>
            </div>

            <div className="sb-nav">
              {NAV_ITEMS.map(group => (
                <div key={group.section}>
                  <div className="sb-section-label">{group.section}</div>
                  {group.items.map(item => (
                    <div
                      key={item.path}
                      className={`nav-item${location.pathname === item.path ? ' active' : ''}`}
                      style={{ cursor: 'pointer' }}
                      onClick={() => navigate(item.path)}
                    >
                      <i className={item.icon} />
                      {item.label}
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <div className="sb-status">
              <div className="status-row">
                <div className={`dot${camOnline ? ' on' : ' off'}`} />
                <span className="status-label">{camLabel}</span>
              </div>
              <div className="status-row">
                <div className={`dot${streamOnline ? ' on' : ' off'}`} />
                <span className="status-label">{streamLabel}</span>
              </div>
            </div>
          </nav>
        )}

        {/* MAIN CONTENT */}
        <div className="main">
          {children}
        </div>
      </div>

      {/* TOASTS */}
      <div id="toasts">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            <i className={`fa ${
              t.type === 'success' ? 'fa-circle-check'          :
              t.type === 'error'   ? 'fa-circle-xmark'          :
              t.type === 'warn'    ? 'fa-triangle-exclamation'  :
                                     'fa-circle-info'
            }`} />
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
