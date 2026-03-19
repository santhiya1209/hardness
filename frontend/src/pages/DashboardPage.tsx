import "./DashboardPage.css";
import { useNavigate } from "react-router-dom";

const menuItems = ["File", "Device", "Data", "Tools", "Configurations"];

export default function DashboardPage() {
  const navigate = useNavigate();

  const cards = [
    {
      title: "MEASURE",
      desc: "Start Vickers HV test with live camera feed and auto diagonal detection",
      path: "/measure",
      primary: true,
    },
    {
      title: "LIVE CAMERA",
      desc: "Full-screen live feed with exposure, gain and zoom controls",
      path: "/camera",
    },
    {
      title: "CALIBRATION",
      desc: "Set px/mm scale factor and HV offset using a reference block",
      path: "/calibration",
    },
    {
      title: "HV CONVERTER",
      desc: "Bidirectional HV ↔ HRC / HRB / HB",
      path: "/converter",
    },
    {
      title: "REPORTS",
      desc: "Statistical analysis, trend chart and export",
      path: "/reports",
    },
    {
      title: "HISTORY",
      desc: "Search, sort and filter measurement log",
      path: "/history",
    },
    {
      title: "SETTINGS",
      desc: "Camera parameters and tuning",
      path: "/settings",
    },
    {
      title: "HELP",
      desc: "User manual and quick reference",
      path: "/help",
    },
  ];

  return (
    <div className="app">

      {/* TITLE BAR */}
      <div className="title-bar">
        <div className="logo">◆</div>
        <h2>HARDNESS TESTER PRO</h2>
        <div className="window-controls">
          <span>-</span>
          <span>□</span>
          <span>×</span>
        </div>
      </div>

      {/* MENU BAR */}
      <div className="menu-bar">
        {menuItems.map((item, i) => (
          <div key={i} className="menu-item">
            {item} ▾
          </div>
        ))}
      </div>

      {/* CONTENT */}
      <div className="dashboard">

        {/* SECTION 1 */}
        <div className="section">
          <span className="section-number">1</span>
          <span className="section-title">MAIN FUNCTIONS</span>
        </div>

        <div className="grid">
          {cards.slice(0, 4).map((card, i) => (
            <div
              key={i}
              className={`card ${card.primary ? "primary" : ""}`}
            >
              <h3>{card.title}</h3>
              <p>{card.desc}</p>
              <button onClick={() => navigate(card.path)}>→</button>
            </div>
          ))}
        </div>

        {/* SECTION 2 */}
        <div className="section">
          <span className="section-number">2</span>
          <span className="section-title">ANALYSIS & SYSTEM</span>
        </div>

        <div className="grid">
          {cards.slice(4).map((card, i) => (
            <div key={i} className="card">
              <h3>{card.title}</h3>
              <p>{card.desc}</p>
              <button onClick={() => navigate(card.path)}>→</button>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}