// camera_simulator.js
const SIM_JPEG_B64 =
'/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/...'; // keep full string

let frameCount = 0;

module.exports = {
  getFrame: () => {
    frameCount++;
    return {
      ok: true,
      success: true,
      frame: SIM_JPEG_B64,
      width: 640,
      height: 480,
      frameNum: frameCount,
      timestamp: Date.now()
    };
  },

  startStream: () => ({ success: true }),
  stopStream: () => ({ success: true }),

  getStatus: () => ({
    ok: true,
    cameraOpen: true,
    grabbing: true,
    simulator: true
  })
};