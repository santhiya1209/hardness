export default function CameraPage() {
  return (
    <div style={{ padding: "30px" }}>
      <h2>Live Camera</h2>

      <div style={{ background: "#000", height: "500px" }}>
        <p style={{ color: "white", textAlign: "center", paddingTop: "230px" }}>
          Camera Stream
        </p>
      </div>

      <h3>Camera Controls</h3>
      <input type="range" /> Exposure
      <input type="range" /> Gain
      <input type="range" /> Zoom
    </div>
  );
}