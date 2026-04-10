// pages/DashboardPage.tsx
import '../styles/global.css';
import '../styles/layout.css';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../hooks/useToast';
import './DashboardPage.css';

const mainCards = [
  { title:'Measure',      desc:'Start Vickers HV test with live camera feed and auto diagonal detection', path:'/measurement', primary:true, tagIcon:'fa-bolt',       tagLabel:'Start here', icon:'fa-crosshairs'     },
  { title:'Live Camera',  desc:'Full-screen live feed with exposure, gain and zoom controls',              path:'/live',        tagIcon:'fa-camera',     tagLabel:'Stream',     icon:'fa-video'          },
  { title:'Calibration',  desc:'Set px/mm scale factor and HV offset using a reference block',             path:'/calibration', tagIcon:'fa-sliders',    tagLabel:'Setup',      icon:'fa-ruler-combined' },
  { title:'HV Converter', desc:'Bidirectional HV ↔ HRC / HRB / HB with full ASTM E140 table',            path:'/converter',   tagIcon:'fa-calculator', tagLabel:'Tool',       icon:'fa-arrows-rotate'  },
];

const systemCards = [
  { title:'Reports',  desc:'Statistical analysis, trend chart, distribution and CSV / JSON export', path:'/reports',  tagIcon:'fa-file-export', tagLabel:'Export', icon:'fa-chart-line'        },
  { title:'History',  desc:'Search, sort and filter the complete measurement log',                   path:'/history',  tagIcon:'fa-database',    tagLabel:'Log',    icon:'fa-clock-rotate-left' },
  { title:'Settings', desc:'Camera parameters, detection algorithm tuning and spec limits',          path:'/settings', tagIcon:'fa-wrench',      tagLabel:'Config', icon:'fa-gear'              },
  { title:'Help',     desc:'User manual, HV formulas, keyboard shortcuts and quick reference',       path:'/help',     tagIcon:'fa-book',        tagLabel:'Docs',   icon:'fa-circle-question'   },
];

function NavCard({ card, index, onClick }: { card: typeof mainCards[0]; index: number; onClick: () => void }) {
  return (
    <div
      className={`nc${(card as any).primary ? ' primary' : ''}`}
      onClick={onClick}
      style={{ cursor: 'pointer', animationDelay: `${index * 0.06}s` }}
    >
      <div className="nc-icon"><i className={`fa-solid ${card.icon}`} /></div>
      <div className="nc-title">{card.title}</div>
      <div className="nc-desc">{card.desc}</div>
      <div className="nc-foot">
        <span className="nc-tag"><i className={`fa ${card.tagIcon}`} /> {card.tagLabel}</span>
        <div className="nc-arrow"><i className="fa fa-arrow-right" /></div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { toasts } = useToast();
  const [clock,   setClock]   = useState('--:--:--');
  const [version, setVersion] = useState('v1.0.0');

  useEffect(() => {
    const tick = () => setClock(new Date().toTimeString().slice(0, 8));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    (async () => {
      try { const v = await window.api?.appVer(); if (v) setVersion(`v${v}`); } catch {}
    })();
  }, []);

  return (
    <>
      {/* TITLEBAR */}
      <div className="titlebar-home">
        <div className="tb-brand">
          <div className="tb-logo"><i className="fa-solid fa-diamond" /></div>
          <span className="tb-title">Hardness <span>Tester</span> Pro</span>
        </div>
        <div className="tb-clock">{clock}</div>
        <div className="tb-controls">
          <button onClick={() => window.api?.minimize()}><i className="fa fa-minus" /></button>
          <button onClick={() => window.api?.maximize()}><i className="fa fa-square" /></button>
          <button className="tb-x" onClick={() => window.api?.close()}><i className="fa fa-xmark" /></button>
        </div>
      </div>

      <div className="dash-page">

        {/* HERO */}
        <div className="hero">
          <div className="hero-title">Hardness <span>Tester</span> Pro</div>
          <div className="hero-line">
            <div className="hero-line-bar short" /><div className="hero-line-bar" />
            <div className="hero-line-dot" />
            <div className="hero-line-bar" /><div className="hero-line-bar short" />
          </div>
          <div className="hero-sub">Automated indentation measurement &amp; analysis system</div>
        </div>

        {/* CARDS */}
        <div className="cards-area">
          <div className="row-head">
            <div className="row-head-num">1</div>
            <div className="row-head-label">Main functions</div>
            <div className="row-head-line" />
          </div>
          <div className="card-grid">
            {mainCards.map((card, i) => (
              <NavCard key={card.path} card={card} index={i} onClick={() => navigate(card.path)} />
            ))}
          </div>

          <div className="row-head">
            <div className="row-head-num">2</div>
            <div className="row-head-label">Analysis &amp; system</div>
            <div className="row-head-line" />
          </div>
          <div className="card-grid">
            {systemCards.map((card, i) => (
              <NavCard key={card.path} card={card as any} index={i + 4} onClick={() => navigate(card.path)} />
            ))}
          </div>
        </div>

        <div className="dash-footer">
          Hardness Tester Pro &nbsp;·&nbsp; HikRobot SDK &nbsp;·&nbsp;
          ISO 6507 / ASTM E92 &nbsp;·&nbsp; <span>{version}</span>
        </div>
      </div>

      <div id="toasts">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.type}`}>{t.msg}</div>
        ))}
      </div>
    </>
  );
}
