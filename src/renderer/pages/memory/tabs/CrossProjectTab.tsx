/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Wave 5 — CrossProjectTab lets the user search memories across every
 * project brain, not just the current one. The active scope from
 * `useActiveBrainScope` is shown in a top bar; a Switch overrides the scope
 * to `'app'` so the same query can be re-run against the global brain.
 *
 * On submit the tab invokes the `cross_project_search` MCP verb via
 * `useIjfwBrain` and renders each match through `MCPVerbCard`. Per-match
 * rows expose the project basename + preview + relevance score; click is a
 * stub today (Wave 6 wires real cross-project navigation).
 */

import { Button, Input, Message, Switch } from '@arco-design/web-react';
import { Folder, Globe, Search } from 'lucide-react';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MCPVerbCard } from '@renderer/pages/memory/components/MCPVerbCard';
import { useIjfwBrain } from '@renderer/pages/memory/hooks/useIjfwBrain';
import { useActiveBrainScope } from '@renderer/pages/memory/getActiveBrainScope';
import styles from './CrossProjectTab.module.css';

type Match = {
  projectPath: string;
  entryId: string;
  preview: string;
  score: number;
};
type CrossProjectPayload = { matches: Match[] };

const projectBasename = (path: string): string => {
  if (!path || path === '/') return path;
  const trimmed = path.replace(/[/\\]+$/, '');
  const slashIdx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return slashIdx >= 0 ? trimmed.slice(slashIdx + 1) || trimmed : trimmed;
};

const CrossProjectTab: React.FC = () => {
  const { t } = useTranslation();
  const activeScope = useActiveBrainScope();

  // `crossAll` ON forces app scope regardless of the active brain.
  const [crossAll, setCrossAll] = useState(false);
  const [queryDraft, setQueryDraft] = useState('');
  // Committed query — only changes on submit so the hook does not re-fetch
  // on every keystroke.
  const [submittedQuery, setSubmittedQuery] = useState('');

  const effectiveScope = useMemo(
    () => (crossAll ? { scope: 'app' as const, path: '/' } : activeScope),
    [crossAll, activeScope]
  );

  const handleSubmit = useCallback(() => {
    setSubmittedQuery(queryDraft.trim());
  }, [queryDraft]);

  const handleToggle = useCallback((next: boolean) => {
    setCrossAll(next);
  }, []);

  const handleMatchClick = useCallback(() => {
    Message.info(t('memory.crossProject.navigation_stub'));
  }, [t]);

  const searchState = useIjfwBrain<CrossProjectPayload>(
    'cross_project_search',
    { query: submittedQuery, scope: effectiveScope.scope, path: effectiveScope.path },
    [submittedQuery, effectiveScope.scope, effectiveScope.path]
  );

  const scopeLabel = useMemo(() => {
    if (effectiveScope.scope === 'app') {
      return t('memory.crossProject.scope_label_app');
    }
    return t('memory.crossProject.scope_label_project', {
      project: projectBasename(effectiveScope.path),
    });
  }, [effectiveScope, t]);

  const ScopeIcon = effectiveScope.scope === 'app' ? Globe : Folder;

  return (
    <div className={styles.root} data-testid='memory-tab-cross-project'>
      <div className={styles.scopeBar} data-testid='memory-cross-scope-bar'>
        <ScopeIcon size={14} aria-hidden />
        <span className={styles.scopeBarLabel}>{scopeLabel}</span>
      </div>

      <div className={styles.controls}>
        <Input.Search
          allowClear
          searchButton={t('memory.crossProject.search_button')}
          placeholder={t('memory.crossProject.search_placeholder')}
          prefix={<Search size={14} aria-hidden />}
          value={queryDraft}
          onChange={setQueryDraft}
          onSearch={handleSubmit}
          data-testid='memory-cross-search-input'
        />
        <label className={styles.toggleRow}>
          <Switch checked={crossAll} onChange={handleToggle} data-testid='memory-cross-toggle' />
          <span>{t('memory.crossProject.toggle_label')}</span>
        </label>
      </div>

      {submittedQuery.length === 0 ? (
        <div className={styles.empty} data-testid='memory-cross-prompt'>
          {t('memory.crossProject.prompt_empty')}
        </div>
      ) : (
        <MCPVerbCard
          state={searchState}
          empty={
            <div className={styles.empty} data-testid='memory-cross-empty'>
              {t('memory.crossProject.results_empty')}
            </div>
          }
          render={(data) => (
            <div className={styles.matchList} data-testid='memory-cross-results'>
              {data.matches.length === 0 ? (
                <div className={styles.empty} data-testid='memory-cross-empty'>
                  {t('memory.crossProject.results_empty')}
                </div>
              ) : (
                data.matches.map((match) => (
                  <Button
                    key={match.entryId}
                    type='text'
                    className={styles.matchRow}
                    onClick={handleMatchClick}
                    data-testid={`memory-cross-match-${match.entryId}`}
                  >
                    <div className={styles.matchHeader}>
                      <span className={styles.matchProject}>
                        <Folder size={12} aria-hidden />
                        {projectBasename(match.projectPath)}
                      </span>
                      <span className={styles.matchScore}>{match.score.toFixed(2)}</span>
                    </div>
                    <span className={styles.matchPreview}>{match.preview}</span>
                  </Button>
                ))
              )}
            </div>
          )}
        />
      )}
    </div>
  );
};

export default CrossProjectTab;
