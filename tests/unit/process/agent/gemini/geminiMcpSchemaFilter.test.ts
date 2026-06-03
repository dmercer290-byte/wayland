import { describe, it, expect } from 'vitest';
import { sanitizeGeminiSchema } from '@process/agent/gemini/cli/utils/geminiSchemaFilter';

describe('sanitizeGeminiSchema', () => {
  it('collapses a union type array to its primary non-null type', () => {
    const out = sanitizeGeminiSchema({ type: ['object', 'boolean'], properties: {} }) as Record<string, unknown>;
    expect(out.type).toBe('object');
    expect(out.properties).toEqual({});
  });

  it('drops the null variant from a [type, null] union', () => {
    const out = sanitizeGeminiSchema({ type: ['string', 'null'] }) as Record<string, unknown>;
    expect(out.type).toBe('string');
  });

  it('strips anyOf/oneOf/allOf/$ref/$defs/additionalProperties that Gemini rejects', () => {
    const out = sanitizeGeminiSchema({
      type: 'object',
      anyOf: [{ type: 'string' }],
      oneOf: [{ type: 'number' }],
      allOf: [{ type: 'boolean' }],
      $ref: '#/$defs/Foo',
      $defs: { Foo: { type: 'string' } },
      additionalProperties: false,
      properties: {},
    }) as Record<string, unknown>;
    expect(out).not.toHaveProperty('anyOf');
    expect(out).not.toHaveProperty('oneOf');
    expect(out).not.toHaveProperty('allOf');
    expect(out).not.toHaveProperty('$ref');
    expect(out).not.toHaveProperty('$defs');
    expect(out).not.toHaveProperty('additionalProperties');
    expect(out.type).toBe('object');
  });

  it('recurses into nested properties and collapses their union types', () => {
    const out = sanitizeGeminiSchema({
      type: 'object',
      properties: { body: { type: ['object', 'boolean'] } },
    }) as { properties: { body: { type: unknown } } };
    expect(out.properties.body.type).toBe('object');
  });

  it('recurses into array items', () => {
    const out = sanitizeGeminiSchema({
      type: 'array',
      items: { type: ['string', 'null'], $ref: '#/x' },
    }) as { items: Record<string, unknown> };
    expect(out.items.type).toBe('string');
    expect(out.items).not.toHaveProperty('$ref');
  });

  it('falls back to object when a union has no usable non-null type', () => {
    const out = sanitizeGeminiSchema({ type: ['null'] }) as Record<string, unknown>;
    expect(out.type).toBe('object');
  });

  it('passes a clean single-type schema through unchanged in shape', () => {
    const input = {
      type: 'object',
      properties: { name: { type: 'string', description: 'a name' } },
      required: ['name'],
    };
    const out = sanitizeGeminiSchema(input);
    expect(out).toEqual(input);
  });

  it('does not mutate the input schema', () => {
    const input = { type: ['object', 'null'], properties: { a: { type: ['string', 'null'] } } };
    const snapshot = JSON.parse(JSON.stringify(input));
    sanitizeGeminiSchema(input);
    expect(input).toEqual(snapshot);
  });

  it('returns a minimal object schema for non-object input', () => {
    expect(sanitizeGeminiSchema(null)).toEqual({ type: 'object', properties: {} });
    expect(sanitizeGeminiSchema(undefined)).toEqual({ type: 'object', properties: {} });
  });
});
