/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import classNames from 'classnames';
import styles from '../panes/Panes.module.css';

export type WcSegmentedOption = {
  /** Stable value persisted to config. */
  value: string;
  /** Display label (already translated). */
  label: string;
};

export type WcSegmentedProps = {
  options: readonly WcSegmentedOption[];
  /** Currently-selected value. */
  value: string;
  onChange: (value: string) => void;
  /** Accessible group label. */
  label: string;
};

/**
 * Bespoke segmented control reproducing the mockup-v3 `.segmented` visual. The
 * buttons here are genuine option toggles in a `radiogroup`; we use styled
 * `role="radio"` elements (not raw `<button>`/`<select>`) per the repo's no-raw-
 * interactive-HTML rule, keeping the comp fidelity while staying accessible.
 */
const WcSegmented: React.FC<WcSegmentedProps> = ({ options, value, onChange, label }) => {
  return (
    <div className={styles.segmented} role='radiogroup' aria-label={label}>
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <div
            key={opt.value}
            role='radio'
            aria-checked={selected}
            tabIndex={0}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onChange(opt.value);
              }
            }}
            className={classNames({ [styles.active]: selected })}
          >
            {opt.label}
          </div>
        );
      })}
    </div>
  );
};

export default WcSegmented;
