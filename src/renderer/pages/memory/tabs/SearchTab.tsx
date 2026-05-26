/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Wave 4 stub for the Memory Search tab. Wave 5 fills the content (search
 * input, hit list, semantic vs keyword toggle).
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

const SearchTab: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div
      data-testid='memory-tab-search'
      className='flex flex-col items-center justify-center p-24px text-14px text-t-secondary'
    >
      {t('memory.panel.tab_search')} stub. Wave 5 will fill this.
    </div>
  );
};

export default SearchTab;
