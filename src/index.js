// Minimal MCP-like test server (local only)
import express from 'express';

const app = express();
app.use(express.json());

app.post('/test', (req, res) => {
  res.json({ status: 'ok', echo: req.body });
});

app.get('/', (req, res) => {
  res.send('MCP test server running!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Test MCP server listening on http://localhost:${PORT}`);
});
