/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

/**
 * Sibling-tab strip for the MCP Library. Keeps Browse and Installed always one
 * click apart - the Installed management surface was previously orphaned (a real
 * route nothing linked to). The Installed tab carries a live count so the user
 * sees at a glance how many servers they have.
 */
export function McpLibraryTabs({
  active,
  installedCount,
}: {
  active: 'browse' | 'installed';
  installedCount: number;
}) {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <nav className='mcp-tabs' role='tablist' aria-label={t('mcpLibrary.tabs.aria', 'MCP Library sections')}>
      <button
        type='button'
        role='tab'
        aria-selected={active === 'browse'}
        className={`mcp-tab${active === 'browse' ? ' is-active' : ''}`}
        onClick={() => navigate('/settings/mcp-library/browse')}
      >
        {t('mcpLibrary.tabs.browse', 'Browse')}
      </button>
      <button
        type='button'
        role='tab'
        aria-selected={active === 'installed'}
        className={`mcp-tab${active === 'installed' ? ' is-active' : ''}`}
        onClick={() => navigate('/settings/mcp-library/installed')}
      >
        {t('mcpLibrary.tabs.installed', 'Installed')}
        {installedCount > 0 ? <span className='mcp-tab-count'>{installedCount}</span> : null}
      </button>
    </nav>
  );
}
