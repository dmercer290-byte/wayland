/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import classNames from 'classnames';
import styles from '../panes/Panes.module.css';

export type WcSwitchProps = {
  /** Whether the switch is on. */
  checked: boolean;
  /** Toggle handler; receives the next checked value. */
  onChange: (next: boolean) => void;
  /** Render the smaller `xs` size used in the tool grid. */
  size?: 'md' | 'xs';
  /** Accessible label for screen readers. */
  label: string;
  /** Disable interaction (e.g. while persisting). */
  disabled?: boolean;
};

/**
 * Bespoke toggle switch reproducing the mockup-v3 `.switch` visual. Rendered as
 * a real `role="switch"` control (keyboard + a11y) rather than a raw checkbox so
 * it matches the approved comp pixel-for-pixel while staying accessible.
 */
const WcSwitch: React.FC<WcSwitchProps> = ({ checked, onChange, size = 'md', label, disabled = false }) => {
  const toggle = (): void => {
    if (!disabled) onChange(!checked);
  };
  return (
    <div
      role='switch'
      aria-checked={checked}
      aria-label={label}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      }}
      className={classNames(styles.switch, {
        [styles.on]: checked,
        [styles.xs]: size === 'xs',
      })}
    />
  );
};

export default WcSwitch;
