import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import OrbitGlyph from '@/renderer/components/chat/observability/OrbitGlyph';

describe('OrbitGlyph', () => {
  it('renders an svg with 2 paths and 3 circles', () => {
    const { container } = render(<OrbitGlyph />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelectorAll('path')).toHaveLength(2);
    expect(container.querySelectorAll('circle')).toHaveLength(3);
  });

  it('respects a passed size', () => {
    const { container } = render(<OrbitGlyph size={40} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('40');
    expect(svg?.getAttribute('height')).toBe('40');
  });

  it('defaults size to 22', () => {
    const { container } = render(<OrbitGlyph />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('22');
    expect(svg?.getAttribute('height')).toBe('22');
  });

  it('applies a passed className', () => {
    const { container } = render(<OrbitGlyph className='extra' />);
    const svg = container.querySelector('svg');
    expect(svg?.classList.contains('extra')).toBe(true);
  });
});
