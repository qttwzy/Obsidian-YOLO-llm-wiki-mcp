#!/usr/bin/env node
"use strict";

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");

const { searchWiki } = require("./tools/search");
const { markSkipped, updateLintTimestamp, lintFull } = require("./tools/lint");
const { handleBuildStore, handleUpdateStore } = require("./tools/store");
const { listDecisions, createDecision, resolveDecision, correctDecision } = require("./tools/decisions");
const { handleBuildGraph, handleUpdateGraph } = require("./tools/graph");
const { handleUpdateEmbedding, handleDeleteEmbedding, handleQueryStatus } = require("./tools/yolo-crud");
const { initWiki } = require("./tools/init-wiki");
const { handleSetInboxFolders, discoverSources } = require("./tools/discover");
const { ingestSource } = require("./tools/ingest");
const { validateConfig } = require("./lib/embed");
const { resolveVaultInfo } = require("./lib/config");

function formatError(message) {
  return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
}

/**
 * Wrap result with vault info for user visibility.
 */
function withVault(result, vaultName) {
  return { _vault: vaultName, ...result };
}

/**
 * Format successful response with vault info.
 * If result contains an error field, formats as error response.
 */
function formatResult(result, vaultName) {
  if (result && result.error) {
    return formatError(result.error);
  }
  return { content: [{ type: "text", text: JSON.stringify(withVault(result, vaultName), null, 2) }] };
}

function safeHandler(fn) {
  return async (request) => {
    try {
      return await fn(request);
    } catch (e) {
      return formatError(e.message);
    }
  };
}

const server = new Server(
  { name: "Obsidian-YOLO-llm-wiki-mcp", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

const vaultParam = { type: "string", description: "Vault name or absolute path (defaults to VAULT_ROOT)" };

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_wiki",
      description: "Search the LLM-Wiki knowledge base using three parallel retrieval channels (Grep, Page embeddings, YOLO PGlite chunks). Returns top 5-8 matching wiki page paths.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query in natural language" },
          vault: vaultParam,
        },
        required: ["query"],
      },
    },
    {
      name: "lint_full",
      description: "Run dual-engine lint: vector cosine similarity + graph topology analysis. Returns categorized candidate pairs (cross_signal, semantic_only, structural_only) and structural insights (isolated nodes, bridge nodes).",
      inputSchema: {
        type: "object",
        properties: {
          top: { type: "number", description: "Max candidates per category (default: 15)" },
          minVectorScore: { type: "number", description: "Minimum cosine similarity threshold (default: 0.5)" },
          minGraphScore: { type: "number", description: "Minimum graph edge weight threshold (default: 1.0)" },
          vault: vaultParam,
        },
      },
    },
    {
      name: "build_wiki_graph",
      description: "Build or rebuild the wiki graph topology. Scans all wiki pages, extracts wikilinks and sources, calculates 4-signal edge weights with dynamic factors. Pure file IO, no API needed.",
      inputSchema: {
        type: "object",
        properties: {
          vault: vaultParam,
        },
      },
    },
    {
      name: "update_wiki_graph",
      description: "Incrementally update the wiki graph after editing a page. Computes structural diff first. If semanticChange is omitted, returns the diff and asks whether the edit changed semantics.",
      inputSchema: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Path relative to vault root (e.g. 'wiki/entities/Claude Code.md')" },
          semanticChange: { type: "boolean", description: "Whether the edit changed the page's meaning. If omitted, returns diff and asks." },
          vault: vaultParam,
        },
        required: ["filePath"],
      },
    },
    {
      name: "mark_skipped_connection",
      description: "Mark a candidate page pair as a false positive so it won't appear in future lint runs.",
      inputSchema: {
        type: "object",
        properties: {
          slugA: { type: "string", description: "Slug of first page (e.g. 'entities/Claude Code')" },
          slugB: { type: "string", description: "Slug of second page" },
          vault: vaultParam,
        },
        required: ["slugA", "slugB"],
      },
    },
    {
      name: "build_page_store",
      description: "Build or rebuild the page embedding store. Embeds all wiki pages and saves vectors to .source-tracker/page_embeddings.json. Requires EMBED_API_URL and EMBED_API_KEY in env.",
      inputSchema: {
        type: "object",
        properties: {
          vault: vaultParam,
        },
      },
    },
    {
      name: "list_decisions",
      description: "List pending and/or resolved decisions from wiki/decisions.md. Returns structured decision entries with options and their checked status.",
      inputSchema: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["pending", "resolved"], description: "Filter by status. Omit to return both." },
          vault: vaultParam,
        },
      },
    },
    {
      name: "create_decision",
      description: "Create a new pending decision entry in wiki/decisions.md with selectable options. Use during Ingest/Lint when a conflict or uncertainty requires user judgment.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Decision ID (e.g. 'DEC-042'). Auto-generated if omitted." },
          situation: { type: "string", description: "Brief description of the conflict or uncertainty, with relevant page/source links." },
          options: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string", description: "Option letter (A, B, C, ...)" },
                action: { type: "string", description: "Action description (what to do)" },
                consequence: { type: "string", description: "What happens if this option is chosen" },
              },
              required: ["label", "action", "consequence"],
            },
            description: "2-4 mutually exclusive action options. At least one should be a conservative no-op.",
          },
          vault: vaultParam,
        },
        required: ["situation", "options"],
      },
    },
    {
      name: "resolve_decision",
      description: "Resolve a pending decision by selecting an option or providing a custom answer. Moves the entry from pending to resolved.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Decision ID to resolve (e.g. 'DEC-042')" },
          option: { type: "string", description: "Option letter to select (A, B, C, ...). Omit if using customText." },
          customText: { type: "string", description: "Custom decision text. Omit if selecting a predefined option." },
          vault: vaultParam,
        },
        required: ["id"],
      },
    },
    {
      name: "correct_decision",
      description: "Add a correction block to a previously resolved decision. Presents new options for the user to choose how to correct it.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Resolved decision ID to correct (e.g. 'DEC-037')" },
          originalDecision: { type: "string", description: "Brief summary of the original decision" },
          correctionReason: { type: "string", description: "Why the user wants to change this decision, with new evidence links if any" },
          options: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string", description: "Option letter (A, B, C, ...)" },
                action: { type: "string", description: "Action description" },
                consequence: { type: "string", description: "What happens if chosen" },
              },
              required: ["label", "action", "consequence"],
            },
            description: "Correction options.",
          },
          vault: vaultParam,
        },
        required: ["id", "originalDecision", "correctionReason", "options"],
      },
    },
    {
      name: "update_page_store",
      description: "Update a single page's embedding in the store. Use after editing or adding a wiki page.",
      inputSchema: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Path relative to vault root (e.g. 'wiki/entities/Foo.md')" },
          vault: vaultParam,
        },
        required: ["filePath"],
      },
    },
    {
      name: "update_pglite_embedding",
      description: "Create or update an embedding record in YOLO's PGlite database. Use after editing a wiki page.",
      inputSchema: {
        type: "object",
        properties: {
          vault: vaultParam,
          path: { type: "string", description: "Page relative path (e.g., 'wiki/entities/Foo.md')" },
          content: { type: "string", description: "Page content to embed" },
          metadata: { type: "object", description: "Additional metadata (optional)" },
        },
        required: ["path", "content"],
      },
    },
    {
      name: "delete_pglite_embedding",
      description: "Delete embedding records for a page from YOLO's PGlite database.",
      inputSchema: {
        type: "object",
        properties: {
          vault: vaultParam,
          path: { type: "string", description: "Page relative path" },
        },
        required: ["path"],
      },
    },
    {
      name: "query_pglite_status",
      description: "Query YOLO PGlite database status and statistics.",
      inputSchema: {
        type: "object",
        properties: {
          vault: vaultParam,
        },
      },
    },
    {
      name: "init_wiki",
      description: "Initialize a vault with the LLM-Wiki skeleton structure. Creates wiki/, index.md, log.md, templates, and embeds Karpathy's design pattern article. Idempotent — safe to run on an already-initialized vault.",
      inputSchema: {
        type: "object",
        properties: {
          vault: vaultParam,
        },
      },
    },
    {
      name: "set_inbox_folders",
      description: "Configure which directories to scan for new sources. Actions: set (overwrite), add (append), remove, list.",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["set", "add", "remove", "list"], description: "set=overwrite, add=append, remove=delete, list=show current" },
          paths: { type: "array", items: { type: "string" }, description: "Folder paths relative to vault root (required for set/add/remove)" },
          vault: vaultParam,
        },
        required: ["action"],
      },
    },
    {
      name: "discover_sources",
      description: "Scan configured inbox folders for new, unprocessed files. Compares against raw/ archive to skip already-ingested sources.",
      inputSchema: {
        type: "object",
        properties: {
          vault: vaultParam,
        },
      },
    },
    {
      name: "ingest_source",
      description: "Ingest a source file into the wiki: create wiki page → update index.md → append log.md → archive to raw/. Atomic four-step operation.",
      inputSchema: {
        type: "object",
        properties: {
          sourceFile: { type: "string", description: "Source file path relative to vault root (e.g. 'Clippings/article.md')" },
          inbox: { type: "string", description: "Inbox folder name (e.g. 'Clippings')" },
          type: { type: "string", enum: ["entity", "concept", "synthesis"], description: "Wiki page type" },
          title: { type: "string", description: "Page title" },
          content: { type: "string", description: "Full page content (Markdown, optionally with frontmatter)" },
          summary: { type: "string", description: "One-line summary for the index" },
          vault: vaultParam,
        },
        required: ["sourceFile", "inbox", "type", "title", "content", "summary"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, safeHandler(async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "search_wiki": {
      const query = args.query || "";
      if (!query.trim()) {
        return formatError("search_wiki requires a non-empty query string");
      }
      const { vaultRoot, vaultName } = resolveVaultInfo(args.vault);
      const result = await searchWiki(query, vaultRoot);
      return formatResult(result, vaultName);
    }

    case "build_wiki_graph": {
      const { vaultRoot, vaultName } = resolveVaultInfo(args.vault);
      const result = handleBuildGraph(vaultRoot);
      return formatResult(result, vaultName);
    }

    case "update_wiki_graph": {
      if (!args.filePath) {
        return formatError("update_wiki_graph requires a filePath");
      }
      const { vaultRoot, vaultName } = resolveVaultInfo(args.vault);
      const result = handleUpdateGraph({
        filePath: args.filePath,
        semanticChange: args.semanticChange,
        vaultRoot,
      });
      return formatResult(result, vaultName);
    }

    case "lint_full": {
      const { vaultRoot, vaultName } = resolveVaultInfo(args.vault);
      const result = lintFull({
        top: args.top,
        minVectorScore: args.minVectorScore,
        minGraphScore: args.minGraphScore,
        vaultRoot,
      });
      if (!result.error) {
        updateLintTimestamp(vaultRoot);
      }
      return formatResult(result, vaultName);
    }

    case "mark_skipped_connection": {
      if (!args.slugA || !args.slugB) {
        return formatError("mark_skipped_connection requires slugA and slugB");
      }
      const { vaultRoot, vaultName } = resolveVaultInfo(args.vault);
      const result = markSkipped(args.slugA, args.slugB, vaultRoot);
      return formatResult(result, vaultName);
    }

    case "build_page_store": {
      const configError = validateConfig();
      if (configError) return formatError(configError);
      const { vaultRoot, vaultName } = resolveVaultInfo(args.vault);
      const result = await handleBuildStore(vaultRoot);
      return formatResult(result, vaultName);
    }

    case "update_page_store": {
      if (!args.filePath) {
        return formatError("update_page_store requires a filePath");
      }
      const { vaultName } = resolveVaultInfo(args.vault);
      const result = await handleUpdateStore({ filePath: args.filePath, vault: args.vault });
      return formatResult(result, vaultName);
    }

    case "update_pglite_embedding": {
      if (!args.path || !args.content) {
        return formatError("update_pglite_embedding requires path and content");
      }
      const { vaultName } = resolveVaultInfo(args.vault);
      const result = await handleUpdateEmbedding(args);
      return formatResult(result, vaultName);
    }

    case "delete_pglite_embedding": {
      if (!args.path) {
        return formatError("delete_pglite_embedding requires path");
      }
      const { vaultName } = resolveVaultInfo(args.vault);
      const result = await handleDeleteEmbedding(args);
      return formatResult(result, vaultName);
    }

    case "query_pglite_status": {
      const { vaultName } = resolveVaultInfo(args.vault);
      const result = handleQueryStatus(args);
      return formatResult(result, vaultName);
    }

    case "init_wiki": {
      const { vaultRoot, vaultName } = resolveVaultInfo(args.vault);
      const result = initWiki(vaultRoot);
      return formatResult(result, vaultName);
    }

    case "set_inbox_folders": {
      if (!args.action) {
        return formatError("set_inbox_folders requires an action (set, add, remove, list)");
      }
      const { vaultName } = resolveVaultInfo(args.vault);
      const result = handleSetInboxFolders(args);
      return formatResult(result, vaultName);
    }

    case "discover_sources": {
      const { vaultRoot, vaultName } = resolveVaultInfo(args.vault);
      const result = discoverSources(vaultRoot);
      return formatResult(result, vaultName);
    }

    case "ingest_source": {
      if (!args.sourceFile || !args.inbox || !args.type || !args.title || !args.content || !args.summary) {
        return formatError("ingest_source requires sourceFile, inbox, type, title, content, and summary");
      }
      const { vaultName } = resolveVaultInfo(args.vault);
      const result = ingestSource(args);
      return formatResult(result, vaultName);
    }

    case "list_decisions": {
      const { vaultRoot, vaultName } = resolveVaultInfo(args.vault);
      const result = listDecisions({ status: args.status, vaultRoot });
      return formatResult(result, vaultName);
    }

    case "create_decision": {
      if (!args.situation || !args.options || !args.options.length) {
        return formatError("create_decision requires situation and at least one option");
      }
      const { vaultRoot, vaultName } = resolveVaultInfo(args.vault);
      const result = createDecision({
        id: args.id,
        situation: args.situation,
        options: args.options,
        vaultRoot,
      });
      return formatResult(result, vaultName);
    }

    case "resolve_decision": {
      if (!args.id) {
        return formatError("resolve_decision requires an id");
      }
      if (!args.option && !args.customText) {
        return formatError("resolve_decision requires either option or customText");
      }
      const { vaultRoot, vaultName } = resolveVaultInfo(args.vault);
      const result = resolveDecision({
        id: args.id,
        option: args.option,
        customText: args.customText,
        vaultRoot,
      });
      return formatResult(result, vaultName);
    }

    case "correct_decision": {
      if (!args.id || !args.originalDecision || !args.correctionReason || !args.options) {
        return formatError("correct_decision requires id, originalDecision, correctionReason, and options");
      }
      const { vaultRoot, vaultName } = resolveVaultInfo(args.vault);
      const result = correctDecision({
        id: args.id,
        originalDecision: args.originalDecision,
        correctionReason: args.correctionReason,
        options: args.options,
        vaultRoot,
      });
      return formatResult(result, vaultName);
    }

    default:
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
}));

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal:", err.message);
  process.exit(1);
});
