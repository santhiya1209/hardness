import "./CalibrationPage.css";

export default function CalibrationPage() {
  return (
    <div className="calibration-app">

      {/* HEADER */}
      <div className="calibration-header">
        <h2>CALIBRATION</h2>
        <p>Pixel to mm scaling & hardness correction</p>
      </div>

      {/* MAIN CONTENT */}
      <div className="calibration-content">

        {/* LEFT PANEL */}
        <div className="calibration-left">

          {/* CAMERA / IMAGE */}
          <div className="calibration-camera">
            <p>Calibration Image / Camera View</p>
          </div>

          {/* BUTTONS */}
          <div className="calibration-buttons">
            <button>Capture Image</button>
            <button>Load Image</button>
            <button>Reset</button>
          </div>

        </div>

        {/* RIGHT PANEL */}
        <div className="calibration-right">

          {/* SCALE CALIBRATION */}
          <div className="panel-box">
            <h3>PIXEL TO MM CALIBRATION</h3>

            <label>Measured Pixels</label>
            <input type="number" placeholder="Enter pixel value" />

            <label>Actual Length (mm)</label>
            <input type="number" placeholder="Enter real length" />

            <button className="primary-btn">Calculate px/mm</button>

            <p className="result">Result: px/mm = -</p>
          </div>

          {/* HV OFFSET */}
          <div className="panel-box">
            <h3>HV OFFSET CALIBRATION</h3>

            <label>Measured HV</label>
            <input type="number" placeholder="Measured value" />

            <label>Reference HV</label>
            <input type="number" placeholder="Reference block value" />

            <button className="primary-btn">Calculate Offset</button>

            <p className="result">Offset: -</p>
          </div>

          {/* ACTIONS */}
          <div className="panel-box actions">
            <button className="save-btn">Save Calibration</button>
            <button className="apply-btn">Apply</button>
          </div>

        </div>
      </div>
    </div>
  );
}