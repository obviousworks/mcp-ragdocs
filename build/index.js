import express from 'express';
const app = express();
app.use(express.json());
app.get('/', (_req, res) => {
    res.send('MCP RagDocs TypeScript server is running!');
});
app.post('/test', (req, res) => {
    res.json({ status: 'ok', echo: req.body });
});
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
app.listen(PORT, () => {
    console.log(`MCP RagDocs TypeScript server listening at http://localhost:${PORT}`);
});
