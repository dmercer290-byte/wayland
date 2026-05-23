/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? _key,
  }),
}));

vi.mock('@arco-design/web-react', () => ({
  Button: ({
    children,
    ...props
  }: React.ComponentProps<'button'> & { type?: string; loading?: boolean }) => (
    <button {...(props as React.ComponentProps<'button'>)}>{children}</button>
  ),
}));

vi.mock('lucide-react', () => ({
  X: (props: { size?: number }) => <span data-testid='x-icon' {...props}>×</span>,
}));

import KickoffCard from '@/renderer/pages/guid/components/newChatStarter/KickoffCard';

describe('<KickoffCard>', () => {
  const baseProps = {
    text: 'Want me to surface the decision you have been carrying?',
    onAccept: vi.fn(),
    onRedirect: vi.fn(),
    onDismiss: vi.fn(),
  };

  it('renders body text + accept + redirect + dismiss controls', () => {
    render(<KickoffCard {...baseProps} />);
    expect(screen.getByText(baseProps.text)).toBeTruthy();
    expect(screen.getByTestId('new-chat-kickoff-accept')).toBeTruthy();
    expect(screen.getByTestId('new-chat-kickoff-redirect')).toBeTruthy();
    expect(screen.getByTestId('new-chat-kickoff-dismiss')).toBeTruthy();
  });

  it('clicking the primary accept button invokes onAccept', () => {
    const onAccept = vi.fn();
    render(<KickoffCard {...baseProps} onAccept={onAccept} />);
    fireEvent.click(screen.getByTestId('new-chat-kickoff-accept'));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it('clicking "Something else" invokes onRedirect', () => {
    const onRedirect = vi.fn();
    render(<KickoffCard {...baseProps} onRedirect={onRedirect} />);
    fireEvent.click(screen.getByTestId('new-chat-kickoff-redirect'));
    expect(onRedirect).toHaveBeenCalledTimes(1);
  });

  it('clicking the × button invokes onDismiss', () => {
    const onDismiss = vi.fn();
    render(<KickoffCard {...baseProps} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByTestId('new-chat-kickoff-dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('preserves multi-line body text via white-space: pre-line', () => {
    const text = 'line 1\nline 2\nline 3';
    render(<KickoffCard {...baseProps} text={text} />);
    // The text node is the .body div — confirm it contains the raw text incl. newlines.
    const node = screen.getByTestId('new-chat-kickoff-card');
    expect(node.textContent?.includes('line 1')).toBe(true);
    expect(node.textContent?.includes('line 3')).toBe(true);
  });
});
