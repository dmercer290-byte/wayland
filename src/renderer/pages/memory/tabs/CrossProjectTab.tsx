/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Wave 4 stub for the Memory Cross-project tab. Wave 5 fills the content
 * (memories shared across brain scopes, project-to-project rollup).
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

const CrossProjectTab: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div
      data-testid='memory-tab-cross-project'
      className='flex flex-col items-center justify-center p-24px text-14px text-t-secondary'
    >
      {t('memory.panel.tab_cross_project')} stub. Wave 5 will fill this.
    </div>
  );
};

export default CrossProjectTab;
