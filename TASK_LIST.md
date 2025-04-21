# TASK_LIST.md

## [Claude/Roo Tools Compatibility Patch for mcp-ragdocs]

### Tasks

- [x] Analyze codebase for tool registration and handler logic
- [x] Identify and document all tool handler functions
- [x] Ensure all core methods (add_documentation, search_documentation, list_sources) are registered and handled via tools/call
- [x] Patch request handler to support tools/call schema and arguments
- [x] Ensure backward compatibility for direct method calls
- [x] Document patch in TASK_LIST.md
- [ ] Test MCP server with Claude/Roo and legacy clients

### TODOs
- [x] Create comprehensive README.md for external users #task
- [x] Create .env.example file #task
- [ ] Add more tests for edge cases (invalid params, unknown tool, etc.)
- [ ] Refactor if tool registry expands beyond current scope

## [PDF Ingestion Support]

### Tasks
- [ ] Design and document PDF ingestion workflow ([PDF_INGESTION_PLAN.md])
- [ ] Detect PDF URLs/content-type in ingestion pipeline
- [ ] Integrate pdf-parse and implement PDF text extraction
- [ ] Chunk and embed PDF text
- [ ] Store PDF metadata in Qdrant
- [ ] Update tool descriptions and README
- [ ] Add tests for PDF ingestion and error cases

---

> This file is auto-generated and updated as part of the Claude/Roo tools compatibility patch ([SF][RP][CDiP][AC][TR]).
npm install