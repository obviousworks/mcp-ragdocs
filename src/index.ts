#!/usr/bin/env node
// import './tools';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { QdrantClient } from '@qdrant/js-client-rest';
import { chromium } from 'playwright';
import * as cheerio from 'cheerio';
import axios from 'axios';
import crypto from 'crypto';
import { EmbeddingService } from './embeddings.js';
import pdfParse from 'pdf-parse';

// Environment variables for configuration
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
// Force using IP address to avoid hostname resolution issues
const QDRANT_URL = 'http://127.0.0.1:6333';
const COLLECTION_NAME = 'documentation';
const EMBEDDING_PROVIDER = process.env.EMBEDDING_PROVIDER || 'ollama';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

interface QdrantCollectionConfig {
  params: {
    vectors: {
      size: number;
      distance: string;
    };
  };
}

interface QdrantCollectionInfo {
  config: QdrantCollectionConfig;
}

interface DocumentChunk {
  text: string;
  url: string;
  title: string;
  timestamp: string;
  page?: number;
  pageCount?: number;
  author?: string;
  _pdf?: boolean;
}

interface DocumentPayload extends DocumentChunk {
  _type: 'DocumentChunk';
  [key: string]: unknown;
}

function isDocumentPayload(payload: unknown): payload is DocumentPayload {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Partial<DocumentPayload>;
  return (
    p._type === 'DocumentChunk' &&
    typeof p.text === 'string' &&
    typeof p.url === 'string' &&
    typeof p.title === 'string' &&
    typeof p.timestamp === 'string'
  );
}

// Utility: Detect if URL is a PDF (by extension or Content-Type)
async function isPdfUrlOrContentType(url: string): Promise<boolean> {
  try {
    if (url.toLowerCase().endsWith('.pdf')) return true;
    // Try HEAD request for Content-Type
    const resp = await axios.head(url, { timeout: 5000 });
    const ct = resp.headers['content-type'] || '';
    return ct.includes('application/pdf');
  } catch (e) {
    // If HEAD fails, fallback to extension check only
    return url.toLowerCase().endsWith('.pdf');
  }
}

const MAX_PDF_SIZE_BYTES = 20 * 1024 * 1024; // 20MB

// Download PDF as Buffer
async function downloadPdf(url: string): Promise<Buffer> {
  const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
  const buf = Buffer.from(resp.data);
  if (buf.length > MAX_PDF_SIZE_BYTES) {
    throw new McpError(ErrorCode.InvalidParams, `PDF too large (${(buf.length / 1024 / 1024).toFixed(2)}MB). Max allowed is 20MB.`);
  }
  return buf;
}

// Parse PDF buffer to extract text, metadata, and pages
async function parsePdf(buffer: Buffer): Promise<{ text: string; meta: any; pages: string[] }> {
  const data = await pdfParse(buffer);
  // Split by page breaks (pdf-parse provides text per page)
  const pages = data.text.split(/\f|\n\s*\n/).map((p: string) => p.trim()).filter(Boolean);
  return {
    text: data.text,
    meta: {
      title: data.info?.Title || '',
      author: data.info?.Author || '',
      pageCount: data.numpages || pages.length,
    },
    pages
  };
}

class RagDocsServer {
  private server: Server;
  private qdrantClient!: QdrantClient;
  private browser: any;
  private embeddingService!: EmbeddingService;

  private async testQdrantConnection() {
    try {
      const response = await this.qdrantClient.getCollections();
      console.error('Successfully connected to Qdrant. Collections:', response.collections);
    } catch (error) {
      console.error('Failed initial Qdrant connection test:', error);
      if (error instanceof Error) {
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to establish initial connection to Qdrant server: ${error.message}`
        );
      }
      throw new McpError(
        ErrorCode.InternalError,
        'Failed to establish initial connection to Qdrant server: Unknown error'
      );
    }
  }

  private async init() {
    // Test connection with direct axios call
    const axiosInstance = axios.create({
      baseURL: 'http://127.0.0.1:6333',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    // Test connection
    try {
      const response = await axiosInstance.get('/collections');
      console.error('Successfully connected to Qdrant:', response.data);
    } catch (error) {
      console.error('Failed to connect to Qdrant:', error);
      throw new McpError(
        ErrorCode.InternalError,
        'Failed to establish initial connection to Qdrant server'
      );
    }

    // Initialize Qdrant client with minimal configuration
    this.qdrantClient = new QdrantClient({
      url: 'http://127.0.0.1:6333'
    });

    // Initialize embedding service from environment configuration
    this.embeddingService = EmbeddingService.createFromConfig({
      provider: EMBEDDING_PROVIDER as 'ollama' | 'openai',
      model: EMBEDDING_MODEL,
      apiKey: OPENAI_API_KEY
    });

    this.setupToolHandlers();
  }

  constructor() {
    this.server = new Server(
      {
        name: 'mcp-ragdocs',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Error handling
    this.server.onerror = (error: Error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.cleanup();
      process.exit(0);
    });
  }

  private async cleanup() {
    if (this.browser) {
      await this.browser.close();
    }
    await this.server.close();
  }

  private async initBrowser() {
    if (!this.browser) {
      this.browser = await chromium.launch();
    }
  }

  private async getEmbeddings(text: string): Promise<number[]> {
    return this.embeddingService.generateEmbeddings(text);
  }

  private async initCollection() {
    try {
      // First ensure we can connect to Qdrant
      await this.testQdrantConnection();

      const requiredVectorSize = this.embeddingService.getVectorSize();

      try {
        // Check if collection exists
        const collections = await this.qdrantClient.getCollections();
        const collection = collections.collections.find(c => c.name === COLLECTION_NAME);

        if (!collection) {
          console.error(`Creating new collection with vector size ${requiredVectorSize}`);
          await this.qdrantClient.createCollection(COLLECTION_NAME, {
            vectors: {
              size: requiredVectorSize,
              distance: 'Cosine',
            },
          });
          return;
        }

        // Get collection info to check vector size
        const collectionInfo = await this.qdrantClient.getCollection(COLLECTION_NAME) as QdrantCollectionInfo;
        const currentVectorSize = collectionInfo.config?.params?.vectors?.size;

        if (!currentVectorSize) {
          console.error('Could not determine current vector size, recreating collection...');
          await this.recreateCollection(requiredVectorSize);
          return;
        }

        if (currentVectorSize !== requiredVectorSize) {
          console.error(`Vector size mismatch: collection=${currentVectorSize}, required=${requiredVectorSize}`);
          await this.recreateCollection(requiredVectorSize);
        }
      } catch (error) {
        console.error('Failed to initialize collection:', error);
        throw new McpError(
          ErrorCode.InternalError,
          'Failed to initialize Qdrant collection. Please check server logs for details.'
        );
      }
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Unexpected error initializing Qdrant: ${error}`
      );
    }
  }

  private async recreateCollection(vectorSize: number) {
    try {
      console.error('Recreating collection with new vector size...');
      await this.qdrantClient.deleteCollection(COLLECTION_NAME);
      await this.qdrantClient.createCollection(COLLECTION_NAME, {
        vectors: {
          size: vectorSize,
          distance: 'Cosine',
        },
      });
      console.error(`Collection recreated with new vector size ${vectorSize}`);
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to recreate collection: ${error}`
      );
    }
  }

  private async fetchAndProcessUrl(url: string): Promise<DocumentChunk[]> {
    if (await isPdfUrlOrContentType(url)) {
      // PDF ingestion path
      console.log(`[fetchAndProcessUrl] PDF detected: ${url}`);
      const pdfBuffer = await downloadPdf(url);
      const { text, meta, pages } = await parsePdf(pdfBuffer);
      // Chunk by page (future: further chunk if page > 1000 chars)
      const title = meta.title || url;
      const timestamp = new Date().toISOString();
      return pages.map((page, i) => ({
        text: page,
        url,
        title,
        timestamp,
        page: i + 1,
        pageCount: meta.pageCount,
        author: meta.author,
        _pdf: true
      }));
    }
    // HTML/text flow (unchanged)
    await this.initBrowser();
    const page = await this.browser.newPage();
    try {
      await page.goto(url, { waitUntil: 'networkidle' });
      const content = await page.content();
      const $ = cheerio.load(content);
      $('script').remove();
      $('style').remove();
      $('noscript').remove();
      const title = $('title').text() || url;
      const mainContent = $('main, article, .content, .documentation, body').text();
      const chunks = this.chunkText(mainContent, 1000);
      return chunks.map(chunk => ({
        text: chunk,
        url,
        title,
        timestamp: new Date().toISOString(),
      }));
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to fetch URL ${url}: ${error}`
      );
    } finally {
      await page.close();
    }
  }

  private chunkText(text: string, maxChunkSize: number): string[] {
    const words = text.split(/\s+/);
    const chunks: string[] = [];
    let currentChunk: string[] = [];

    for (const word of words) {
      currentChunk.push(word);
      const currentLength = currentChunk.join(' ').length;

      if (currentLength >= maxChunkSize) {
        chunks.push(currentChunk.join(' '));
        currentChunk = [];
      }
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join(' '));
    }

    return chunks;
  }

  private generatePointId(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'add_documentation',
          description: 'Add documentation from a URL to the RAG database',
          inputSchema: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'URL of the documentation to fetch',
              },
            },
            required: ['url'],
          },
        },
        {
          name: 'search_documentation',
          description: 'Search through stored documentation',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search query',
              },
              limit: {
                type: 'number',
                description: 'Maximum number of results to return',
                default: 5,
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'list_sources',
          description: 'List all documentation sources currently stored',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'test_ollama',
          description: 'Test embeddings functionality',
          inputSchema: {
            type: 'object',
            properties: {
              text: {
                type: 'string',
                description: 'Text to generate embeddings for',
              },
              provider: {
                type: 'string',
                description: 'Embedding provider to use (ollama or openai)',
                enum: ['ollama', 'openai'],
                default: 'ollama',
              },
              apiKey: {
                type: 'string',
                description: 'OpenAI API key (required if provider is openai)',
              },
              model: {
                type: 'string',
                description: 'Model to use for embeddings',
              },
            },
            required: ['text'],
          },
        },
      ],
    }));

    // Unified handler for both legacy and tools/call schema
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      // Claude/Roo: { method: 'tools/call', params: { name, arguments } }
      // Legacy: { method: 'add_documentation', params: { url } }
      let toolName, args;
      if (request.method === 'tools/call' && request.params && request.params.name) {
        toolName = request.params.name;
        args = request.params.arguments || {};
      } else if (request.method && typeof request.method === 'string' && request.params) {
        toolName = request.method;
        args = request.params;
      } else {
        throw new McpError(ErrorCode.InvalidParams, 'Malformed tool request');
      }

      // For core tools, always ensure collection is ready
      if ([
        'add_documentation',
        'search_documentation',
        'list_sources',
      ].includes(toolName)) {
        await this.initCollection();
      }

      switch (toolName) {
        case 'add_documentation':
          return this.handleAddDocumentation(args);
        case 'search_documentation':
          return this.handleSearchDocumentation(args);
        case 'list_sources':
          return this.handleListSources();
        case 'test_ollama':
          return this.handleTestEmbeddings(args);
        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${toolName}`
          );
      }
    });
  }

  private async handleTestEmbeddings(args: any) {
    if (!args.text || typeof args.text !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'Text is required');
    }

    try {
      // Create a new embedding service instance with the requested configuration
      const tempEmbeddingService = EmbeddingService.createFromConfig({
        provider: args.provider || 'ollama',
        apiKey: args.apiKey,
        model: args.model
      });

      const embedding = await tempEmbeddingService.generateEmbeddings(args.text);
      const provider = args.provider || 'ollama';
      const model = args.model || (provider === 'ollama' ? 'nomic-embed-text' : 'text-embedding-3-small');

      // If test is successful, update the server's embedding service
      this.embeddingService = tempEmbeddingService;

      // Reinitialize collection with new vector size
      await this.initCollection();

      return {
        content: [
          {
            type: 'text',
            text: `Successfully configured ${provider} embeddings (${model}).\nVector size: ${embedding.length}\nQdrant collection updated to match new vector size.`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to test embeddings: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleAddDocumentation(args: any) {
    console.log('[handleAddDocumentation] Start', { url: args.url });
    if (!args.url || typeof args.url !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'URL is required');
    }
    // Log PDF detection result
    const isPdf = await isPdfUrlOrContentType(args.url);
    console.log(`[handleAddDocumentation] PDF detected: ${isPdf}`);
    try {
      console.log('[handleAddDocumentation] Fetching and processing URL...');
      const chunks = await this.fetchAndProcessUrl(args.url);
      console.log(`[handleAddDocumentation] Fetched ${chunks.length} chunks.`);
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        console.log(`[handleAddDocumentation] Processing chunk ${i + 1}/${chunks.length}...`);
        console.log(`[handleAddDocumentation] Getting embedding for chunk ${i + 1}...`);
        const embedding = await this.getEmbeddings(chunk.text);
        console.log(`[handleAddDocumentation] Got embedding for chunk ${i + 1}. Size: ${embedding.length}`);
        const payload = {
          ...chunk,
          _type: 'DocumentChunk' as const,
        };
        console.log(`[handleAddDocumentation] Upserting chunk ${i + 1} to Qdrant...`);
        await this.qdrantClient.upsert(COLLECTION_NAME, {
          wait: true,
          points: [
            {
              id: this.generatePointId(),
              vector: embedding,
              payload: payload as Record<string, unknown>,
            },
          ],
        });
        console.log(`[handleAddDocumentation] Upserted chunk ${i + 1} to Qdrant.`);
      }
      console.log('[handleAddDocumentation] Successfully processed all chunks.');
      // PDF ingestion summary
      if (chunks.length > 0 && chunks[0]._pdf) {
        const meta = {
          pages: chunks.length,
          pageCount: chunks[0].pageCount,
          title: chunks[0].title,
          author: chunks[0].author,
        };
        return {
          content: [
            {
              type: 'text',
              text: `Successfully added PDF from ${args.url}\nTitle: ${meta.title}\nAuthor: ${meta.author}\nPages: ${meta.pages}\nChunks: ${chunks.length}`,
            },
          ],
        };
      }
      // HTML/text summary (unchanged)
      return {
        content: [
          {
            type: 'text',
            text: `Successfully added documentation from ${args.url} (${chunks.length} chunks processed)`,
          },
        ],
      };
    } catch (error) {
      console.error('[handleAddDocumentation] Error:', error);
      return {
        content: [
          {
            type: 'text',
            text: `Failed to add documentation: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleSearchDocumentation(args: any) {
    if (!args.query || typeof args.query !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'Query is required');
    }

    const limit = args.limit || 5;

    try {
      const queryEmbedding = await this.getEmbeddings(args.query);

      const searchResults = await this.qdrantClient.search(COLLECTION_NAME, {
        vector: queryEmbedding,
        limit,
        with_payload: true,
      });

      const formattedResults = searchResults.map(result => {
        if (!isDocumentPayload(result.payload)) {
          throw new Error('Invalid payload type');
        }
        return `[${result.payload.title}](${result.payload.url})\nScore: ${result.score}\nContent: ${result.payload.text}\n`;
      }).join('\n---\n');

      return {
        content: [
          {
            type: 'text',
            text: formattedResults || 'No results found.',
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Search failed: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleListSources() {
    try {
      const scroll = await this.qdrantClient.scroll(COLLECTION_NAME, {
        with_payload: true,
      });

      const sources = new Set<string>();
      for (const point of scroll.points) {
        if (isDocumentPayload(point.payload)) {
          sources.add(`${point.payload.title} (${point.payload.url})`);
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: Array.from(sources).join('\n') || 'No documentation sources found.',
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to list sources: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }

  async run() {
    try {
      await this.init();
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      console.error('RAG Docs MCP server running on stdio');
    } catch (error) {
      console.error('Failed to initialize server:', error);
      process.exit(1);
    }
  }
}

const server = new RagDocsServer();
server.run().catch(console.error);
