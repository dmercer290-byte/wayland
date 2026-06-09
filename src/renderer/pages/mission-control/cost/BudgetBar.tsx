/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 *
 * A simple presentational progress bar used for both the cost breakdown rows
 * (fraction of the largest bucket) and budget rows (spend vs limit). Hand-rolled
 * - no chart library.
 */

import React from 'react';
import type { BudgetSeverity } from './costChart';
import styles from './Cost.module.css';

const SEVERITY_CLASS: Record<BudgetSeverity, string> = {
  ok: styles.barOk,
  warn: styles.barWarn,
  over: styles.barOver,
};

export type BudgetBarProps = {
  /** Fill fraction in [0, 1]. Values outside the range are clamped. */
  fraction: number;
  /** Color tier. Omit to use the default brand accent. */
  severity?: BudgetSeverity;
};

export const BudgetBar: React.FC<BudgetBarProps> = ({ fraction, severity }) => {
  const clamped = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
  const severityClass = severity ? SEVERITY_CLASS[severity] : '';
  return (
    <div className={styles.bar}>
      <div className={`${styles.barFill} ${severityClass}`} style={{ width: `${clamped * 100}%` }} />
    </div>
  );
};
