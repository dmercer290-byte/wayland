/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, FileText, Lock } from 'lucide-react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { useWcoreConfig } from '@renderer/hooks/useWcoreConfig';
import WcSwitch from '../components/WcSwitch';
import WcSegmented from '../components/WcSegmented';
import ScopeLabel from '../components/ScopeLabel';
import styles from './Panes.module.css';

/**
 * One engine tool backend. `needsKey` marks a tool whose backend requires a
 * credential set under Services & Keys; `keyState` lets the chip show "on" once
 * a key is present (representative here; see CATALOG note below).
 */
type ToolDef = {
  id: string;
  descKey: string;
  descDefault: string;
  /** Shows a "needs key / needs auth" chip that deep-links to Services & Keys. */
  needsKey?: 'key' | 'auth';
  /** When the backend's key is already satisfied (e.g. the free web_search default). */
  keySatisfied?: boolean;
};

type ToolCategory = {
  id: 'file' | 'web' | 'media' | 'data' | 'cloud' | 'prod' | 'agent' | 'system';
  labelKey: string;
  labelDefault: string;
  tools: readonly ToolDef[];
};

/**
 * AUTHORITATIVE engine tool catalogue, mirroring the Wayland Core v0.11.0
 * built-in registry assembled in `wcore-agent/src/bootstrap.rs`. Every `id`
 * here is the EXACT canonical tool name the engine registers (the string a
 * tool returns from `fn name()`), so the allow_list read/write round-trips
 * correctly: an enabled tool renders ON and toggling writes the right name.
 *
 * The enable/disable STATE is real, read from / written to
 * `config.toml [tools].allow_list`. An empty/absent `allow_list` means
 * "all tools on" (engine default), so the UI seeds every tool on until the
 * user revokes one.
 *
 * `needsKey` reflects the engine's conditional registration: tools the engine
 * gates on an env var / credential (and hides via `is_available()` when it's
 * absent) carry a chip. CLI tools (aws_cli/gcloud/kubectl) shell out to a
 * locally-configured CLI rather than an engine key, so they carry no chip.
 */
const CATEGORIES: readonly ToolCategory[] = [
  {
    id: 'file',
    labelKey: 'settings.wcoreConfig.tools.catFile',
    labelDefault: 'File & Code',
    tools: [
      { id: 'Read', descKey: 'settings.wcoreConfig.tools.descRead', descDefault: 'Read any file in the workspace' },
      { id: 'Write', descKey: 'settings.wcoreConfig.tools.descWrite', descDefault: 'Create or overwrite files' },
      { id: 'Edit', descKey: 'settings.wcoreConfig.tools.descEdit', descDefault: 'Surgical string-replace edits' },
      { id: 'Glob', descKey: 'settings.wcoreConfig.tools.descGlob', descDefault: 'Find files by pattern' },
      { id: 'Grep', descKey: 'settings.wcoreConfig.tools.descGrep', descDefault: 'Search file contents by regex' },
      { id: 'Bash', descKey: 'settings.wcoreConfig.tools.descBash', descDefault: 'Run shell commands in the sandbox' },
      {
        id: 'RepoMap',
        descKey: 'settings.wcoreConfig.tools.descRepoMap',
        descDefault: 'Map the repository structure & symbols',
      },
    ],
  },
  {
    id: 'web',
    labelKey: 'settings.wcoreConfig.tools.catWeb',
    labelDefault: 'Web & Search',
    tools: [
      {
        id: 'web',
        descKey: 'settings.wcoreConfig.tools.descWeb',
        descDefault: 'Search, extract, or crawl the web · free DuckDuckGo default',
        needsKey: 'key',
        keySatisfied: true,
      },
      {
        id: 'WebFetch',
        descKey: 'settings.wcoreConfig.tools.descWebFetch',
        descDefault: 'Fetch a URL & read it as clean markdown',
      },
    ],
  },
  {
    id: 'media',
    labelKey: 'settings.wcoreConfig.tools.catMedia',
    labelDefault: 'Vision & Media',
    tools: [
      {
        id: 'vision_analyze',
        descKey: 'settings.wcoreConfig.tools.descVision',
        descDefault: 'Describe & reason over images',
      },
      {
        id: 'image_inspect',
        descKey: 'settings.wcoreConfig.tools.descImageInspect',
        descDefault: 'Inspect image dimensions & metadata',
      },
      {
        id: 'image_generate',
        descKey: 'settings.wcoreConfig.tools.descImageGen',
        descDefault: 'Generate images from a text prompt',
        needsKey: 'key',
      },
      {
        id: 'transcribe_audio',
        descKey: 'settings.wcoreConfig.tools.descTranscribe',
        descDefault: 'Transcribe speech to text (Whisper)',
        needsKey: 'key',
      },
      {
        id: 'text_to_speech',
        descKey: 'settings.wcoreConfig.tools.descTts',
        descDefault: 'Synthesize speech audio from text',
        needsKey: 'key',
      },
      {
        id: 'video_analyze',
        descKey: 'settings.wcoreConfig.tools.descVideo',
        descDefault: 'Sample & analyze video frames',
        needsKey: 'key',
      },
      { id: 'pdf_extract', descKey: 'settings.wcoreConfig.tools.descPdf', descDefault: 'Extract text from PDFs' },
    ],
  },
  {
    id: 'data',
    labelKey: 'settings.wcoreConfig.tools.catData',
    labelDefault: 'Data & Files',
    tools: [
      { id: 'Jsonl', descKey: 'settings.wcoreConfig.tools.descJsonl', descDefault: 'Stream & query large JSON Lines' },
      {
        id: 'sql_query',
        descKey: 'settings.wcoreConfig.tools.descSqlQuery',
        descDefault: 'Run SQL against a local SQLite file',
      },
      {
        id: 'postgres_schema',
        descKey: 'settings.wcoreConfig.tools.descPostgres',
        descDefault: 'Inspect a Postgres schema',
        needsKey: 'key',
      },
      {
        id: 'markdown_table',
        descKey: 'settings.wcoreConfig.tools.descMarkdownTable',
        descDefault: 'Format & align markdown tables',
      },
      { id: 'Archive', descKey: 'settings.wcoreConfig.tools.descArchive', descDefault: 'Inspect & extract archives' },
      {
        id: 'email_parse',
        descKey: 'settings.wcoreConfig.tools.descEmailParse',
        descDefault: 'Parse raw email into headers & body',
      },
    ],
  },
  {
    id: 'cloud',
    labelKey: 'settings.wcoreConfig.tools.catCloud',
    labelDefault: 'Dev & Cloud',
    tools: [
      { id: 'Git', descKey: 'settings.wcoreConfig.tools.descGit', descDefault: 'Stage, commit, branch, diff' },
      { id: 'github_api', descKey: 'settings.wcoreConfig.tools.descGithub', descDefault: 'GitHub PRs, issues, releases' },
      {
        id: 'gitlab_api',
        descKey: 'settings.wcoreConfig.tools.descGitlab',
        descDefault: 'GitLab merge requests & pipelines',
        needsKey: 'key',
      },
      { id: 'kubectl', descKey: 'settings.wcoreConfig.tools.descKubectl', descDefault: 'Inspect & manage Kubernetes' },
      { id: 'aws_cli', descKey: 'settings.wcoreConfig.tools.descAws', descDefault: 'AWS CLI operations' },
      { id: 'gcloud', descKey: 'settings.wcoreConfig.tools.descGcloud', descDefault: 'Google Cloud CLI operations' },
    ],
  },
  {
    id: 'prod',
    labelKey: 'settings.wcoreConfig.tools.catProd',
    labelDefault: 'Productivity',
    tools: [
      {
        id: 'notion_api',
        descKey: 'settings.wcoreConfig.tools.descNotion',
        descDefault: 'Read & write Notion pages',
        needsKey: 'key',
      },
      {
        id: 'linear_api',
        descKey: 'settings.wcoreConfig.tools.descLinear',
        descDefault: 'Create & update Linear issues',
        needsKey: 'key',
      },
      {
        id: 'discord_server',
        descKey: 'settings.wcoreConfig.tools.descDiscord',
        descDefault: 'Manage a Discord server & channels',
        needsKey: 'key',
      },
      {
        id: 'homeassistant',
        descKey: 'settings.wcoreConfig.tools.descHass',
        descDefault: 'Control smart-home devices',
        needsKey: 'key',
      },
      {
        id: 'send_message',
        descKey: 'settings.wcoreConfig.tools.descSendMessage',
        descDefault: 'Send messages to a connected channel',
      },
      {
        id: 'cronjob',
        descKey: 'settings.wcoreConfig.tools.descCron',
        descDefault: 'Schedule recurring agent runs',
      },
    ],
  },
  {
    id: 'agent',
    labelKey: 'settings.wcoreConfig.tools.catAgent',
    labelDefault: 'Agent & Planning',
    tools: [
      {
        id: 'Spawn',
        descKey: 'settings.wcoreConfig.tools.descSpawn',
        descDefault: 'Spawn named sub-agents for parallel work',
      },
      {
        id: 'Delegate',
        descKey: 'settings.wcoreConfig.tools.descDelegate',
        descDefault: 'Delegate a focused single task or batch',
      },
      {
        id: 'Workflow',
        descKey: 'settings.wcoreConfig.tools.descWorkflow',
        descDefault: 'Run a multi-stage dynamic workflow',
      },
      { id: 'todo', descKey: 'settings.wcoreConfig.tools.descTodo', descDefault: 'Track multi-step task progress' },
      {
        id: 'clarify',
        descKey: 'settings.wcoreConfig.tools.descClarify',
        descDefault: 'Ask the user a clarifying question',
      },
      {
        id: 'AskUserQuestion',
        descKey: 'settings.wcoreConfig.tools.descAskUser',
        descDefault: 'Ask the user a structured multi-choice question',
      },
      {
        id: 'EnterPlanMode',
        descKey: 'settings.wcoreConfig.tools.descEnterPlan',
        descDefault: 'Enter read-only plan mode',
      },
      {
        id: 'ExitPlanMode',
        descKey: 'settings.wcoreConfig.tools.descExitPlan',
        descDefault: 'Exit plan mode & begin executing',
      },
    ],
  },
  {
    id: 'system',
    labelKey: 'settings.wcoreConfig.tools.catSystem',
    labelDefault: 'Wayland & Memory',
    tools: [
      {
        id: 'ToolSearch',
        descKey: 'settings.wcoreConfig.tools.descToolSearch',
        descDefault: 'Search the tool catalogue by intent',
      },
      { id: 'Skill', descKey: 'settings.wcoreConfig.tools.descSkill', descDefault: 'Run an installed skill' },
      {
        id: 'session_search',
        descKey: 'settings.wcoreConfig.tools.descSessionSearch',
        descDefault: 'Search past sessions & transcripts',
      },
      {
        id: 'record_episode',
        descKey: 'settings.wcoreConfig.tools.descRecordEpisode',
        descDefault: 'Store a durable memory episode',
      },
      {
        id: 'assert_fact',
        descKey: 'settings.wcoreConfig.tools.descAssertFact',
        descDefault: 'Store a durable fact in memory',
      },
      {
        id: 'wayland_status',
        descKey: 'settings.wcoreConfig.tools.descWaylandStatus',
        descDefault: 'Read live session status & token usage',
      },
      {
        id: 'wayland_telemetry_query',
        descKey: 'settings.wcoreConfig.tools.descWaylandTelemetry',
        descDefault: 'Query per-tool call counts & telemetry',
      },
    ],
  },
];

/** Every known tool id, used to seed "all on" when allow_list is absent. */
const ALL_TOOL_IDS: readonly string[] = CATEGORIES.flatMap((c) => c.tools.map((t) => t.id));

type FilterKey = 'all' | ToolCategory['id'];

type ToolsPaneProps = {
  /** Deep-link to the Services & Keys pane (for needs-key chips). */
  onGoServices: () => void;
};

const ToolsPane: React.FC<ToolsPaneProps> = ({ onGoServices }) => {
  const { t } = useTranslation();
  const { getSection, setSection } = useWcoreConfig();
  const [filter, setFilter] = useState<FilterKey>('all');
  // `null` until loaded. A Set of enabled tool ids. Absent allow_list => all on.
  const [enabled, setEnabled] = useState<Set<string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getSection<{ allow_list?: string[] }>('tools').then((section) => {
      if (cancelled) return;
      const list = section?.allow_list;
      // An absent/empty allow_list means the engine runs every tool (default).
      setEnabled(new Set(Array.isArray(list) && list.length > 0 ? list : ALL_TOOL_IDS));
    });
    return () => {
      cancelled = true;
    };
  }, [getSection]);

  const persist = useCallback(
    (next: Set<string>): void => {
      // Persist the full allow_list (names only). We merge into the existing
      // section so unknown engine keys (auto_approve, skills, ...) survive.
      void getSection<Record<string, unknown>>('tools').then((prev) => {
        void setSection('tools', { ...prev, allow_list: Array.from(next).sort() });
      });
    },
    [getSection, setSection]
  );

  const toggle = useCallback(
    (id: string): void => {
      setEnabled((cur) => {
        const next = new Set(cur ?? ALL_TOOL_IDS);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const filters = useMemo(
    () =>
      [
        { value: 'all', label: t('settings.wcoreConfig.tools.filterAll', { defaultValue: 'All' }) },
        ...CATEGORIES.map((c) => ({ value: c.id, label: t(c.labelKey, { defaultValue: c.labelDefault }) })),
      ] as const,
    [t]
  );

  const visibleCats = filter === 'all' ? CATEGORIES : CATEGORIES.filter((c) => c.id === filter);
  const on = enabled ?? new Set<string>(ALL_TOOL_IDS);

  return (
    <div className={styles.pane}>
      <div className={styles.head}>
        <div className={styles.eyebrow}>Wayland Core</div>
        <h1 className={styles.title}>{t('settings.wcoreConfig.rail.tools', { defaultValue: 'Tools' })}</h1>
        <p className={styles.sub}>
          {t('settings.wcoreConfig.tools.subtitle', {
            defaultValue:
              'Everything the engine can actually do, with sensible defaults already on. Toggle a tool to grant or revoke it across all profiles. Tools that need a credential link straight to where you set it.',
          })}
        </p>
        <ScopeLabel />
      </div>

      <div style={{ marginBottom: 8 }}>
        <WcSegmented
          options={filters}
          value={filter}
          onChange={(v) => setFilter(v as FilterKey)}
          label={t('settings.wcoreConfig.tools.filterLabel', { defaultValue: 'Filter tools by category' })}
        />
      </div>

      {visibleCats.map((cat) => {
        const onCount = cat.tools.filter((tool) => on.has(tool.id)).length;
        return (
          <div key={cat.id} className={styles.toolCat}>
            <div className={styles.toolCatLabel}>
              {t(cat.labelKey, { defaultValue: cat.labelDefault })}
              <span className={styles.toolCatCount}>
                {t('settings.wcoreConfig.tools.catCount', {
                  defaultValue: '{{total}} tools · {{on}} on',
                  total: cat.tools.length,
                  on: onCount,
                })}
              </span>
            </div>
            <div className={styles.group}>
              {cat.tools.map((tool) => (
                <div key={tool.id} className={styles.toolRow}>
                  <div>
                    <div className={styles.toolName}>
                      {tool.id}
                      {tool.needsKey &&
                        (tool.keySatisfied ? (
                          <span
                            role='button'
                            tabIndex={0}
                            onClick={onGoServices}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                onGoServices();
                              }
                            }}
                            className={classNames(styles.chipKey, styles.ok)}
                          >
                            <Check size={9} />
                            {t('settings.wcoreConfig.tools.chipOnDdg', { defaultValue: 'on · DuckDuckGo' })}
                          </span>
                        ) : (
                          <span
                            role='button'
                            tabIndex={0}
                            onClick={onGoServices}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                onGoServices();
                              }
                            }}
                            className={styles.chipKey}
                          >
                            <Lock size={9} />
                            {tool.needsKey === 'auth'
                              ? t('settings.wcoreConfig.tools.chipNeedsAuth', { defaultValue: 'needs auth' })
                              : t('settings.wcoreConfig.tools.chipNeedsKey', { defaultValue: 'needs key' })}
                          </span>
                        ))}
                    </div>
                    <div className={styles.toolDesc}>{t(tool.descKey, { defaultValue: tool.descDefault })}</div>
                  </div>
                  <div className={styles.toolCtrl}>
                    <WcSwitch
                      size='xs'
                      checked={on.has(tool.id)}
                      onChange={() => toggle(tool.id)}
                      label={t('settings.wcoreConfig.tools.toggleLabel', {
                        defaultValue: 'Enable {{tool}}',
                        tool: tool.id,
                      })}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <div className={styles.scopeLabel} style={{ marginTop: 20 }}>
        <FileText size={13} />
        {t('settings.wcoreConfig.tools.catalogNote', {
          defaultValue:
            'Tool list reflects the engine’s built-in catalogue. Enable/disable state is read from and written to your config.toml.',
        })}
      </div>
    </div>
  );
};

export default ToolsPane;
