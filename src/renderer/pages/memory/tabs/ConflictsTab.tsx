/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Wave 4 stub for the Memory Conflicts tab. Wave 5 fills the content
 * (contradictory facts, manual resolution UI).
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

const ConflictsTab: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div
      data-testid='memory-tab-conflicts'
      className='flex flex-col items-center justify-center p-24px text-14px text-t-secondary'
    >
      {t('memory.panel.tab_conflicts')} stub. Wave 5 will fill this.
    </div>
  );
};

export default ConflictsTab;
