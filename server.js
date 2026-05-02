#!/usr/bin/env node
"use strict";

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");

const { searchWiki } = require("./tools/search");
const { lintConnections, markSkipped, updateLintTimestamp } = require("./tools/lint");
const { handleBuildStore, handleUpdateStore } = require("./tools/store");
const { listDecisions, createDecision, resolveDecision, correctDecision } = require("./tools/decisions");
const { validateConfig } = require("./lib/embed");

function formatError(message) {
  return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
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
  { name: "Obsidian-YOLO-llm-wiki-mcp", version: "1.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_wiki",
      description: "Search the LLM-Wiki knowledge base using three parallel retrieval channels (Grep, Page embeddings, YOLO PGlite chunks). Returns top 5-8 matching wiki page paths.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query in natural language" },
        },
        required: ["query"],
      },
    },
    {
      name: "lint_connections",
      description: "Find candidate page pairs with high semantic similarity but no existing wikilinks. Results should be reviewed by LLM to determine if connections are meaningful.",
      inputSchema: {
        type: "object",
        properties: {
          top: { type: "number", description: "Max candidate pairs to return (default: 30)" },
          minScore: { type: "number", description: "Minimum cosine similarity threshold (default: 0.5)" },
        },
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
        },
        required: ["slugA", "slugB"],
      },
    },
    {
      name: "build_page_store",
      description: "Build or rebuild the page embedding store. Embeds all wiki pages and saves vectors to .source-tracker/page_embeddings.json. Requires EMBED_API_URL and EMBED_API_KEY in env.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "list_decisions",
      description: "List pending and/or resolved decisions from wiki/decisions.md. Returns structured decision entries with options and their checked status.",
      inputSchema: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["pending", "resolved"], description: "Filter by status. Omit to return both." },
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
        },
        required: ["filePath"],
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
      const result = await searchWiki(query);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    case "lint_connections": {
      const result = lintConnections({
        top: args.top || 30,
        minScore: args.minScore || 0.5,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    case "mark_skipped_connection": {
      if (!args.slugA || !args.slugB) {
        return formatError("mark_skipped_connection requires slugA and slugB");
      }
      const result = markSkipped(args.slugA, args.slugB);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }

    case "build_page_store": {
      const configError = validateConfig();
      if (configError) return formatError(configError);
      const result = await handleBuildStore();
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }

    case "update_page_store": {
      if (!args.filePath) {
        return formatError("update_page_store requires a filePath");
      }
      const result = await handleUpdateStore({ filePath: args.filePath });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }

    case "list_decisions": {
      const result = listDecisions({ status: args.status });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    case "create_decision": {
      if (!args.situation || !args.options || !args.options.length) {
        return formatError("create_decision requires situation and at least one option");
      }
      const result = createDecision({
        id: args.id,
        situation: args.situation,
        options: args.options,
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }

    case "resolve_decision": {
      if (!args.id) {
        return formatError("resolve_decision requires an id");
      }
      if (!args.option && !args.customText) {
        return formatError("resolve_decision requires either option or customText");
      }
      const result = resolveDecision({
        id: args.id,
        option: args.option,
        customText: args.customText,
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }

    case "correct_decision": {
      if (!args.id || !args.originalDecision || !args.correctionReason || !args.options) {
        return formatError("correct_decision requires id, originalDecision, correctionReason, and options");
      }
      const result = correctDecision({
        id: args.id,
        originalDecision: args.originalDecision,
        correctionReason: args.correctionReason,
        options: args.options,
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
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
  console.error("Fatal:", err.message);
  process.exit(1);
});
