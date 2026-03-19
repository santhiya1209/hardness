import "./MeasurePage.css";

export default function MeasurePage() {
  return (
    <div className="measure-app">

      {/* HEADER */}
      <div className="measure-header">
        <div>
          <h2>
            VICKERS <span>MEASUREMENT</span>
          </h2>
          <p className="sub-text">
            AUTO HV · LIVE CAMERA · INDENTATION ANALYSIS
          </p>
        </div>

        <div className="header-actions">
          <select>
            <option>HV 10</option>
            <option>HV 30</option>
            <option>HV 50</option>
          </select>

          <button className="stream-btn">▶ Stream</button>
          <button className="measure-btn">Measure</button>
        </div>
      </div>

      {/* STEPS */}
      <div className="steps">
        <div className="step active">1 CAPTURE</div>
        <div className="step">2 DETECT</div>
        <div className="step">3 MEASURE</div>
        <div className="step">4 CALCULATE</div>
      </div>

      {/* MAIN LAYOUT */}
      <div className="measure-content">

        {/* LEFT: CAMERA */}
        <div className="camera-section">

          {/* TOOLBAR */}
          <div className="camera-toolbar">
            <button title="Start">▶</button>
            <button title="Zoom In">＋</button>
            <button title="Zoom Out">－</button>
            <button title="Fullscreen">⤢</button>
            <button title="Capture">⤓</button>
          </div>

          {/* CAMERA VIEW */}
          <div className="camera-view">
            <div className="no-signal">
              <p>NO SIGNAL</p>
              <span>Click Stream → then Measure</span>
            </div>
          </div>

          {/* FOOTER */}
          <div className="camera-footer">
            <span>RES -</span>
            <span>px/mm 4579.17</span>
            <span>FPS -</span>
            <span>EXP -</span>
          </div>
        </div>

        {/* RIGHT: CONTROL PANEL */}
        <div className="right-panel">

          {/* RESULT */}
          <div className="result-box">
            <h3>HV</h3>
            <p>Awaiting measurement</p>
          </div>

          {/* DIAGONALS */}
          <div className="panel-box">
            <h4>INDENTATION DIAGONALS</h4>

            <div className="input-row">
              <input type="number" placeholder="D1 (mm)" />
              <input type="number" placeholder="D2 (mm)" />
            </div>

            <p className="avg">Avg diagonal: -</p>

            <button className="calc-btn">Calculate manually</button>
          </div>

          {/* CONVERSION */}
          <div className="panel-box">
            <h4>SCALE CONVERSIONS</h4>

            <div className="grid2">
              <div>HRC -</div>
              <div>HRB -</div>
              <div>HB -</div>
              <div>HRA -</div>
              <div className="full">EST. UTS -</div>
            </div>
          </div>

          {/* LIMITS */}
          <div className="panel-box">
            <h4>ACCEPTANCE LIMITS</h4>

            <div className="input-row">
              <input type="number" placeholder="MIN HV" />
              <input type="number" placeholder="MAX HV" defaultValue="9999" />
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}