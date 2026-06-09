/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/// <reference types="@testing-library/jest-dom/vitest" />

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// Identity-map the layout CSS module so width-class assertions are deterministic
// (vitest does not process CSS modules by default; imports would be undefined).
vi.mock('./PageShell.module.css', () => ({
  default: {
    shell: 'shell',
    paddingDesktop: 'paddingDesktop',
    paddingMobile: 'paddingMobile',
    subtitle: 'subtitle',
    toolbar: 'toolbar',
    content: 'content',
    widthNarrow: 'widthNarrow',
    widthStandard: 'widthStandard',
    widthFull: 'widthFull',
    body: 'body',
    rail: 'rail',
    railBody: 'railBody',
  },
}));

// Default to desktop (non-mobile) for the padding/layout assertions.
let mockIsMobile = false;
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: mockIsMobile, siderCollapsed: false, setSiderCollapsed: () => {} }),
}));

import PageShell from './PageShell';

describe('PageShell', () => {
  it('renders the title', () => {
    render(<PageShell title='Workflows'>body</PageShell>);
    expect(screen.getByText('Workflows')).toBeInTheDocument();
  });

  it('renders the icon when passed', () => {
    render(
      <PageShell title='Workflows' icon={<svg data-testid='shell-icon' />}>
        body
      </PageShell>
    );
    expect(screen.getByTestId('shell-icon')).toBeInTheDocument();
  });

  it('renders subtitle, countLabel and actions', () => {
    render(
      <PageShell
        title='Workflows'
        subtitle='Automate your work'
        countLabel='176 workflows'
        actions={<span data-testid='shell-action'>Import</span>}
      >
        body
      </PageShell>
    );
    expect(screen.getByText('Automate your work')).toBeInTheDocument();
    expect(screen.getByText('176 workflows')).toBeInTheDocument();
    expect(screen.getByTestId('shell-action')).toBeInTheDocument();
  });

  it('renders children', () => {
    render(
      <PageShell title='Workflows'>
        <div data-testid='shell-child'>content</div>
      </PageShell>
    );
    expect(screen.getByTestId('shell-child')).toBeInTheDocument();
  });

  it('renders the filterRail side-by-side with children', () => {
    const { container } = render(
      <PageShell title='Workflows' filterRail={<div data-testid='shell-rail'>rail</div>}>
        <div data-testid='shell-child'>content</div>
      </PageShell>
    );
    expect(screen.getByTestId('shell-rail')).toBeInTheDocument();
    expect(screen.getByTestId('shell-child')).toBeInTheDocument();
    // Rail and content live in a flex-row body, child sits in the flex-1 column.
    const body = container.querySelector('.body');
    expect(body).not.toBeNull();
    expect(body?.querySelector('.rail [data-testid="shell-rail"]')).not.toBeNull();
    expect(body?.querySelector('.railBody [data-testid="shell-child"]')).not.toBeNull();
  });

  it('renders the toolbar between header and body', () => {
    render(
      <PageShell title='Mission Control' toolbar={<div data-testid='shell-toolbar'>tabs</div>}>
        body
      </PageShell>
    );
    expect(screen.getByTestId('shell-toolbar')).toBeInTheDocument();
  });

  it('defaults to the standard width class', () => {
    const { container } = render(<PageShell title='Default'>body</PageShell>);
    expect(container.querySelector('.content.widthStandard')).not.toBeNull();
  });

  it('maps width="narrow" to the narrow class', () => {
    const { container } = render(
      <PageShell title='Narrow' width='narrow'>
        body
      </PageShell>
    );
    expect(container.querySelector('.content.widthNarrow')).not.toBeNull();
  });

  it('maps width="full" to the full class', () => {
    const { container } = render(
      <PageShell title='Full' width='full'>
        body
      </PageShell>
    );
    expect(container.querySelector('.content.widthFull')).not.toBeNull();
  });

  it('applies the testId to the shell root', () => {
    render(
      <PageShell title='Tagged' testId='page-shell-root'>
        body
      </PageShell>
    );
    expect(screen.getByTestId('page-shell-root')).toBeInTheDocument();
  });
});
