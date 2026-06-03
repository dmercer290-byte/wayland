/**
 * Sanitize a JSON-schema so Google's Gemini function-calling validator accepts it.
 *
 * Gemini's function-declaration schema is a strict subset of OpenAPI 3.0. Unlike
 * OpenAI/Anthropic it rejects:
 *   - union `type` arrays (e.g. `['object','boolean']`) — must be a single string type
 *   - the structural keywords `oneOf` / `anyOf` / `allOf` / `not`
 *   - `$ref` / `$defs` / `definitions` / `$schema` / `additionalProperties` / `patternProperties`
 *
 * MCP servers (e.g. Notion's `notion-create-pages`) routinely emit these, so every
 * Gemini request 400s with `Invalid schema for function '<tool>'` while that MCP is
 * connected. The OpenAI-compatible path already normalizes types
 * (openaiContentGenerator.convertGeminiParametersToOpenAI); this is the equivalent for
 * the Gemini-native path.
 *
 * Stripped keywords loosen validation at the Gemini layer only — the MCP server still
 * validates the actual tool-call arguments. A hard 400 on every request is the
 * alternative, so this is the correct trade-off.
 */

// Keywords Gemini's function-calling schema does not support. Removed wholesale.
const UNSUPPORTED_KEYWORDS = new Set([
  'oneOf',
  'anyOf',
  'allOf',
  'not',
  '$ref',
  '$defs',
  '$schema',
  'definitions',
  'additionalProperties',
  'patternProperties',
]);

function collapseTypeArray(value: unknown[]): string {
  const primary = value.find((t) => typeof t === 'string' && t.toLowerCase() !== 'null');
  return primary ? String(primary).toLowerCase() : 'object';
}

function sanitize(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(sanitize);
  }
  if (typeof node !== 'object' || node === null) {
    return node;
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (UNSUPPORTED_KEYWORDS.has(key)) {
      continue;
    }
    if (key === 'type') {
      if (Array.isArray(value)) {
        result[key] = collapseTypeArray(value);
      } else if (value === null || value === undefined) {
        result[key] = 'object';
      } else if (typeof value === 'string') {
        result[key] = value.toLowerCase();
      } else {
        result[key] = value;
      }
      continue;
    }
    result[key] = typeof value === 'object' && value !== null ? sanitize(value) : value;
  }
  // A schema with properties but no (or an invalid) type is still 'object' to Gemini.
  if (result.properties && (result.type === undefined || Array.isArray(result.type))) {
    result.type = 'object';
  }
  return result;
}

/**
 * Deep-clone and normalize a tool parameter schema for the Gemini backend.
 * Returns a fresh object — never mutates the input. Non-object input yields a
 * minimal valid object schema (matching the library's OpenAI-path behaviour).
 */
export function sanitizeGeminiSchema(schema: unknown): unknown {
  if (typeof schema !== 'object' || schema === null) {
    return { type: 'object', properties: {} };
  }
  return sanitize(JSON.parse(JSON.stringify(schema)));
}
