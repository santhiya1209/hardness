// backend/src/server.js
const express = require('express');
const app = express();
const PORT = 3000;

// Example route
app.get('/', (req, res) => {
  res.send('Backend is working!');
});

// Start server
app.listen(PORT, () => {
  console.log(`Backend running at http://localhost:${PORT}`);
});