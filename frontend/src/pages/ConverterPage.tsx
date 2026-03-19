import { useState } from "react";
import "./ConverterPage.css";

export default function ConverterPage() {
  const [hv, setHv] = useState("");
  const [results, setResults] = useState({
    hrc: "-",
    hrb: "-",
    hb: "-",
    hra: "-",
    uts: "-",
  });

  // 🔹 Dummy conversion (you can replace with real formula later)
  const convert = () => {
    if (!hv) return;

    const value = parseFloat(hv);

    setResults({
      hrc: (value / 10).toFixed(2),
      hrb: (value / 8).toFixed(2),
      hb: (value / 1.5).toFixed(2),
      hra: (value / 12).toFixed(2),
      uts: (value * 3).toFixed(2),
    });
  };

  const reset = () => {
    setHv("");
    setResults({
      hrc: "-",
      hrb: "-",
      hb: "-",
      hra: "-",
      uts: "-",
    });
  };

  return (
    <div className="converter-app">

      {/* HEADER */}
      <div className="converter-header">
        <h2>HARDNESS CONVERTER</h2>
        <p>Convert HV to HRC, HRB, HB, HRA and UTS</p>
      </div>

      {/* CONTENT */}
      <div className="converter-content">

        {/* INPUT PANEL */}
        <div className="input-panel">
          <h3>INPUT</h3>

          <label>Enter HV Value</label>
          <input
            type="number"
            value={hv}
            onChange={(e) => setHv(e.target.value)}
            placeholder="e.g. 250"
          />

          <div className="buttons">
            <button className="convert-btn" onClick={convert}>
              Convert
            </button>
            <button className="reset-btn" onClick={reset}>
              Reset
            </button>
          </div>
        </div>

        {/* OUTPUT PANEL */}
        <div className="output-panel">
          <h3>RESULTS</h3>

          <div className="grid">
            <div className="card">
              <span>HRC</span>
              <strong>{results.hrc}</strong>
            </div>

            <div className="card">
              <span>HRB</span>
              <strong>{results.hrb}</strong>
            </div>

            <div className="card">
              <span>HB</span>
              <strong>{results.hb}</strong>
            </div>

            <div className="card">
              <span>HRA</span>
              <strong>{results.hra}</strong>
            </div>

            <div className="card full">
              <span>UTS (MPa)</span>
              <strong>{results.uts}</strong>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}