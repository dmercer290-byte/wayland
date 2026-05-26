/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Wave 4 stub for the Memory Promotions tab. Wave 5 fills the content
 * (pending facts promoted to long-term memory, approve/reject flow).
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

const PromotionsTab: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div
      data-testid='memory-tab-promotions'
      className='flex flex-col items-center justify-center p-24px text-14px text-t-secondary'
    >
      {t('memory.panel.tab_promotions')} stub. Wave 5 will fill this.
    </div>
  );
};

export default PromotionsTab;
