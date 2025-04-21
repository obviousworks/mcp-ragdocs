# PDF Ingestion Support Implementation Plan

## Goal
Enable the MCP RagDocs server to fetch, parse, chunk, embed, and index PDF documents (from URLs, and eventually local files) as first-class citizens alongside HTML/text sources.

## Design Principles
- Simplicity First ([SF])
- Dependency Minimalism ([DM])
- Readability Priority ([RP])
- Clean Architecture ([CA])
- Robust Error Handling ([REH])
- Performance Awareness ([PA])
- Input Validation ([IV])
- Constants Over Magic Values ([CMV])
- Test-Driven Thinking ([TDT])

## Implementation Progress
- [x] Design PDF ingestion workflow
- [x] Integrate `pdf-parse` and implement PDF text extraction
- [x] Add chunking logic for PDFs
- [x] Store PDF metadata in Qdrant
- [x] Update tool descriptions and README
- [x] Add tests for PDF ingestion and error cases

## Workflow (Step-by-Step)

1. **Detect PDF Source**
   - If `add_documentation` receives a URL ending with `.pdf` or with a PDF Content-Type, treat as PDF.
   - Otherwise, use the existing HTML/text pipeline.

2. **Download PDF**
   - Use `axios` (with `{ responseType: 'arraybuffer' }`) to fetch the PDF as a buffer.
   - Validate file size (e.g., max 20MB) and type.

3. **Parse PDF**
   - Use `pdf-parse` to extract text and metadata (title, author, page count).
   - Structure output as pages for chunking.

4. **Chunk PDF Text**
   - Chunk text by page, then by max token/character count (e.g., 1000 chars).
   - Each chunk includes source URL, PDF metadata, and page number.

5. **Embed and Store**
   - Generate embeddings for each chunk (existing embedding pipeline).
   - Upsert into Qdrant with metadata (URL, title, page, etc.).

6. **Error Handling**
   - If download/parsing fails, return a clear error message.
   - Log errors with context (URL, error type).

7. **Tool/UX Changes**
   - Update tool descriptions to mention PDF support.
   - Optionally, return summary of PDF ingestion (pages, chunks, metadata).

## Main Function Signatures

- `async fetchAndProcessUrlOrFile(url: string): Promise<DocumentChunk[]>`
- `async downloadPdf(url: string): Promise<Buffer>`
- `async parsePdf(buffer: Buffer): Promise<{ text: string; meta: PdfMeta; pages: string[] }>`
- `function chunkPdfText(pages: string[], meta: PdfMeta, chunkSize: number): DocumentChunk[]`

## Architectural Points
- PDF logic is modular and can be extended for other file types.
- Only one PDF parsing library is used (`pdf-parse`).
- All new code is covered by unit/integration tests.
- Constants used for file size, chunk size, etc.

## Current Limitations
- Only PDF URLs supported (no local file upload)
- Max PDF size: 20MB
- Chunking is by page only

## Next Steps
- Add support for local PDF file uploads
- Implement advanced chunking for very large pages
- Expand test coverage for edge cases

## Tasks/TODOs
- [ ] Add support for local PDF file uploads
- [ ] Implement advanced chunking for very large pages
- [ ] Expand test coverage for edge cases

## Notes
- Consider future support for DOCX, Markdown, etc. by abstracting ingestion logic.
- Use only one PDF parsing library, prefer `pdf-parse` for simplicity.
- Ensure all new code is testable and follows project coding standards.
- See [README.md] for user-facing usage and limitations.

---
[SF][RP][DM][CA][SD][REH][PA][IV][CMV][DRY][TR][CDiP][TDT]
