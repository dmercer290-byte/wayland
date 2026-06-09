/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import classNames from 'classnames';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import LibraryPageHeader from '@/renderer/components/layout/library/LibraryPageHeader';
import styles from './PageShell.module.css';

export type PageShellProps = {
  title: string;
  /** Lucide icon at size 20. Shell applies brand color + glow via LibraryPageHeader. */
  icon?: React.ReactNode;
  /** Inline muted count next to the title (e.g. "176 workflows"). */
  countLabel?: string;
  /** Test id for the count element (forwarded to the header). */
  countTestId?: string;
  /** One-line muted description rendered under the title. */
  subtitle?: string;
  /** Right-aligned header buttons. */
  actions?: React.ReactNode;
  /** Optional sticky left rail (LibraryFilterRail or bespoke). Triggers the side-by-side body. */
  filterRail?: React.ReactNode;
  /** Optional row between the header and the body (e.g. Mission Control Tabs). */
  toolbar?: React.ReactNode;
  /** Content column cap. narrow=800px, standard=1120px (default), full=no cap. */
  width?: 'narrow' | 'standard' | 'full';
  contentClassName?: string;
  testId?: string;
  children: React.ReactNode;
};

const WIDTH_CLASS: Record<NonNullable<PageShellProps['width']>, string> = {
  narrow: styles.widthNarrow,
  standard: styles.widthStandard,
  full: styles.widthFull,
};

const PageShell: React.FC<PageShellProps> = ({
  title,
  icon,
  countLabel,
  countTestId,
  subtitle,
  actions,
  filterRail,
  toolbar,
  width = 'standard',
  contentClassName,
  testId,
  children,
}) => {
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;

  const body = filterRail ? (
    <div className={styles.body}>
      <div className={styles.rail}>{filterRail}</div>
      <div className={styles.railBody}>{children}</div>
    </div>
  ) : (
    children
  );

  return (
    <div
      className={classNames(styles.shell, isMobile ? styles.paddingMobile : styles.paddingDesktop)}
      data-testid={testId}
    >
      <div className={classNames(styles.content, WIDTH_CLASS[width], contentClassName)}>
        <LibraryPageHeader title={title} icon={icon} countLabel={countLabel} countTestId={countTestId}>
          {actions}
        </LibraryPageHeader>
        {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
        {toolbar ? <div className={styles.toolbar}>{toolbar}</div> : null}
        {body}
      </div>
    </div>
  );
};

export default PageShell;
