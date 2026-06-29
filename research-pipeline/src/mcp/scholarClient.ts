import path from "node:path";
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { config } from "../config.js";
import type { ScholarSearchResult } from "../types.js";

const require = createRequire(import.meta.url);

interface ScholarSearchResponse {
  query: string;
  total_results_text?: string;
  next_page_start?: number;
  results: ScholarSearchResult[];
}

/**
 * Manages the ScholarMCP child-process lifecycle and exposes only the
 * discovery-related tools we actually use (search + author lookup).
 * Deliberately does NOT wrap ingest_paper_fulltext/get_ingestion_status/
 * extract_granular_paper_details — full text goes through our own
 * deterministic chain (see fulltext/resolveFullText.ts) instead of
 * ScholarMCP's bundled ingestion, by explicit design decision.
 */
export class ScholarClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;

  async connect(): Promise<void> {
    if (this.client) return;

    const scholarMcpEntry = require.resolve("scholar-mcp/dist/index.js");

    this.transport = new StdioClientTransport({
      command: process.execPath,
      args: [scholarMcpEntry, "--transport=stdio"],
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([, v]) => typeof v === "string"),
        ) as Record<string, string>,
        SCHOLAR_MCP_TRANSPORT: "stdio",
        SCHOLAR_REQUEST_DELAY_MS: String(config.scholarRequestDelayMs),
      },
      cwd: path.dirname(scholarMcpEntry),
    });

    this.client = new Client({ name: "checklisthub-research-pipeline", version: "0.1.0" });
    await this.client.connect(this.transport);
  }

  async close(): Promise<void> {
    await this.client?.close();
    this.client = null;
    this.transport = null;
  }

  private async callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    if (!this.client) throw new Error("ScholarClient not connected — call connect() first.");
    const result = await this.client.callTool({ name, arguments: args });
    if (result.isError) {
      const text = Array.isArray(result.content) ? result.content[0]?.text : undefined;
      throw new Error(`ScholarMCP tool "${name}" failed: ${text ?? "unknown error"}`);
    }
    return result.structuredContent as T;
  }

  /**
   * Keyword search on Google Scholar — primary discovery (Phase A).
   * ScholarMCP caps a single call at 20 results (its own input schema), so
   * getting more than that for one query template requires pagination via
   * `start` (the offset Scholar itself uses, 0/10/20/...) — see
   * discovery/scholarSearch.ts's `searchScholar`, which loops this.
   */
  async searchKeywordsPage(
    query: string,
    numResults = 10,
    start = 0,
  ): Promise<{ results: ScholarSearchResult[]; nextPageStart?: number }> {
    const response = await this.callTool<ScholarSearchResponse>("search_google_scholar_key_words", {
      query,
      num_results: Math.min(numResults, 20),
      start,
    });
    return { results: response.results ?? [], nextPageStart: response.next_page_start };
  }

  /** Single-page convenience wrapper, kept for the `discover` CLI command's simple case. */
  async searchKeywords(query: string, numResults = 10): Promise<ScholarSearchResult[]> {
    return (await this.searchKeywordsPage(query, numResults)).results;
  }

  /** Advanced Scholar search with year-range/author/phrase filters. */
  async searchAdvanced(params: {
    query: string;
    author?: string;
    yearRange?: [number, number];
    exactPhrase?: string;
    excludeWords?: string;
    titleOnly?: boolean;
    numResults?: number;
  }): Promise<ScholarSearchResult[]> {
    const response = await this.callTool<ScholarSearchResponse>("search_google_scholar_advanced", {
      query: params.query,
      author: params.author,
      year_range: params.yearRange,
      exact_phrase: params.exactPhrase,
      exclude_words: params.excludeWords,
      title_only: params.titleOnly ?? false,
      num_results: Math.min(params.numResults ?? 10, 20),
    });
    return response.results ?? [];
  }

  /** Author profile lookup — feeds the wiki's authors page. */
  async getAuthorInfo(authorName: string, maxPublications = 5): Promise<unknown> {
    return this.callTool("get_author_info", { author_name: authorName, max_publications: maxPublications });
  }
}
