export default function SettingsPage() {
  return (
    <div style={{ padding: "30px" }}>
      <h2>Settings</h2>

      <label>Exposure</label>
      <input type="range" />

      <label>Threshold</label>
      <input type="range" />

      <label>Pixel to mm</label>
      <input type="number" />
    </div>
  );
}