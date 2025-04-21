# MCP RagDocs Server (@obviousworks/mcp-server-ragdocs)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A [Model Context Protocol (MCP)](https://github.com/modelcontextprotocol/specification) server for fetching documentation from URLs, generating embeddings, storing them in a [Qdrant](https://qdrant.tech/) vector database, and enabling semantic search. This allows you to augment LLMs like Claude with relevant context from your own documentation sources, including PDF files.

## Features

*   **Add Documentation:** Fetch content from a URL (HTML or PDF), chunk it, generate embeddings, and store it in Qdrant.
*   **Search Documentation:** Perform semantic search over the stored documentation using a query string.
*   **List Sources:** View the base URLs of the documentation sources currently indexed.
*   **Configurable Embeddings:** Supports [Ollama](https://ollama.com/) (local) and [OpenAI](https://openai.com/) (cloud) for embedding generation.
*   **MCP Compliant:** Integrates with MCP-compatible clients like Claude Desktop via stdio.

## Prerequisites

*   **Node.js:** v18.x or later ([Download](https://nodejs.org/))
*   **npm:** Comes with Node.js
*   **Qdrant:** A running instance (v1.8.0 or later recommended). See [Qdrant Installation Docs](https://qdrant.tech/documentation/guides/installation/). (Docker is often the easiest way).
*   **Ollama (Optional):** A running instance if using Ollama for embeddings. See [Ollama Website](https://ollama.com/). Make sure your desired embedding model (e.g., `nomic-embed-text`) is pulled: `ollama pull nomic-embed-text`.
*   **OpenAI API Key (Optional):** Required if using OpenAI for embeddings.

## Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/obviousworks/mcp-ragdocs.git
    cd mcp-ragdocs
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    ```

## Configuration

1.  **Create Environment File:** Copy the example environment file:
    ```bash
    cp .env.example .env
    ```
2.  **Edit `.env`:** Open the `.env` file in a text editor and configure the variables according to your setup:
    *   `QDRANT_URL`: Set the correct URL for your Qdrant instance.
    *   `EMBEDDING_PROVIDER`: Choose `ollama` or `openai`.
    *   `OLLAMA_URL` / `OLLAMA_EMBED_MODEL`: Configure if using Ollama.
    *   `OPENAI_API_KEY` / `OPENAI_EMBED_MODEL`: Configure if using OpenAI.
    *   Ensure the necessary service (Qdrant, Ollama) is running.

## Build

Compile the TypeScript source code to JavaScript:

```bash
npm run build
```
This will create the compiled output in the `build/` directory.

## Running the Server

### Option 1: Standalone (for testing/debugging)

You can run the server directly. This is useful for direct testing but not for connecting to Claude Desktop via stdio.

```bash
npm start
```
The server will attempt to connect to Qdrant and listen for MCP requests (though it doesn't set up an HTTP listener by default).

### Option 2: Using the Inspector (for testing tools)

The MCP Inspector provides a web UI to test tool calls.

```bash
npm run inspector
```
Open your browser to `http://127.0.0.1:6274` (or the address shown in the terminal).

### Option 3: Background Service with PM2

For persistent running, use a process manager like `pm2`.

1.  Install `pm2` globally (if you haven't already):
    ```bash
    npm install pm2 -g
    ```
2.  Start the server:
    ```bash
    pm2 start build/index.js --name mcp-ragdocs
    ```
3.  Manage the process:
    *   Check status: `pm2 status`
    *   View logs: `pm2 logs mcp-ragdocs`
    *   Stop: `pm2 stop mcp-ragdocs`
    *   Restart: `pm2 restart mcp-ragdocs`
    *   Delete: `pm2 delete mcp-ragdocs`

### Option 4: Connecting to Claude Desktop (via Stdio)

Claude Desktop uses the stdio transport to communicate with local MCP servers.

1.  **Open Claude Desktop Settings:** Navigate to the MCP server/tools management section.
2.  **Add Custom MCP:** Choose the option to add a new server.
3.  **Configure Stdio:**
    *   **Transport Type:** Select `stdio`.
    *   **Command:** Provide the **absolute path** to Node.js and the server's entry script. For example:
        ```
        node /Users/your_user/path/to/mcp-server-ragdocs/build/index.js
        ```
        *(Replace `/Users/your_user/path/to/` with the actual absolute path to the cloned project directory).*
    *   **Name:** Give it a descriptive name (e.g., "Local RAG Docs").
    *   Save the configuration.

## Usage (Tools)

Once connected to an MCP client (like Claude via stdio or the Inspector), you can use the following tools:

*   **`add_documentation`**: Adds content from a URL (HTML or PDF).
    *   **Parameters:**
        *   `url` (string, required): The URL of the documentation page to ingest.
    *   **Example:** `add_documentation(url="https://example.com/manual.pdf")`
    *   **Note:** PDF files are parsed, chunked by page, and indexed (max size: 20MB). Only public URLs are supported for PDF ingestion.

*   **`search_documentation`**: Searches the indexed documentation.
    *   **Parameters:**
        *   `query` (string, required): The search term or question.
        *   `limit` (number, optional, default: 5): Maximum number of results.
    *   **Example:** `search_documentation(query="how to configure qdrant", limit=3)`

*   **`list_sources`**: Lists the unique base URLs of indexed documents.
    *   **Parameters:** None.
    *   **Example:** `list_sources()`

*   **`test_ollama` / `test_openai`** (Available via `test_ollama` tool name, uses `provider` parameter): Tests embedding generation. Can be used to switch the active embedding provider and model *for the current server instance*.
    *   **Parameters:**
        *   `text` (string, required): Sample text to embed.
        *   `provider` (string, optional, default: `ollama`): `ollama` or `openai`.
        *   `apiKey` (string, optional): OpenAI key if `provider=openai`.
        *   `model` (string, optional): Specific model name for the provider.
    *   **Example:** `test_ollama(text="test embedding", provider="ollama", model="nomic-embed-text")`

## Limitations

*   PDF ingestion only supports URLs (no local upload yet)
*   PDF files must be under 20MB
*   Each PDF page is a chunk; very large pages are not further split (yet)

## Contributing

Contributions are welcome! Please feel free to open an issue or submit a pull request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
