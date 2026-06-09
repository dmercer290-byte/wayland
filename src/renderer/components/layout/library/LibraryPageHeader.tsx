/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import styles from './LibraryPageHeader.module.css';

export type LibraryPageHeaderProps = {
  title: string;
  /** Section icon shown before the title, matching the sidebar nav icon. */
  icon?: React.ReactNode;
  countLabel?: string;
  testId?: string;
  countTestId?: string;
  children?: React.ReactNode;
};

const LibraryPageHeader: React.FC<LibraryPageHeaderProps> = ({
  title,
  icon,
  countLabel,
  testId,
  countTestId,
  children,
}) => (
  <header className={styles.header} data-testid={testId}>
    <h1 className={styles.title}>
      {icon ? (
        <span
          className={styles.titleIcon}
          style={{ filter: 'drop-shadow(0 0 10px rgba(255, 107, 53, 0.4))' }}
          aria-hidden='true'
        >
          {icon}
        </span>
      ) : null}
      <span className={styles.titleText}>{title}</span>
      {countLabel ? (
        <span className={styles.count} data-testid={countTestId}>
          {countLabel}
        </span>
      ) : null}
    </h1>
    {children ? <div className={styles.actions}>{children}</div> : null}
  </header>
);

export default LibraryPageHeader;
