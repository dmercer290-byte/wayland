/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Wave 4 stub for the Memory Home tab. Wave 5 fills the content (recent
 * memories digest, daily prompts, brain scope rollups). This stub exists
 * only so the FullPanelShell tab router has a real child to mount.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

const HomeTab: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div
      data-testid='memory-tab-home'
      className='flex flex-col items-center justify-center p-24px text-14px text-t-secondary'
    >
      {t('memory.panel.tab_home')} stub. Wave 5 will fill this.
    </div>
  );
};

export default HomeTab;
