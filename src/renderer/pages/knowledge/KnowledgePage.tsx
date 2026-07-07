/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 *
 * Knowledge Base page - the custom global wiki + memory (~/.genesis) that
 * replaces the built-in IJFW memory surface at /memory. Left rail: wiki
 * page list + search + memory panel toggle. Main pane: rendered markdown
 * with [[wikilink]] navigation, backlinks, and an inline editor.
 */

import {
  Button,
  Empty,
  Input,
  Message,
  Popconfirm,
  Radio,
  Select,
  Spin,
  Tag,
  Typography,
} from '@arco-design/web-react';
import { IconDelete, IconEdit, IconPlus, IconSave, IconSearch } from '@arco-design/web-react/icon';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type {
  KnowledgeMemoryEntry,
  KnowledgeMemoryKind,
  KnowledgeWikiHit,
  KnowledgeWikiMeta,
  KnowledgeWikiPage,
} from '@/common/adapter/ipcBridge';
import Markdown from '@/renderer/components/Markdown';
import styles from './KnowledgePage.module.css';

const MEMORY_KINDS: KnowledgeMemoryKind[] = ['fact', 'decision', 'preference', 'howto', 'note'];

const KIND_COLORS: Record<KnowledgeMemoryKind, string> = {
  fact: 'arcoblue',
  decision: 'orange',
  preference: 'purple',
  howto: 'green',
  note: 'gray',
};

/** Render [[Page Name]] links as clickable spans before markdown rendering. */
function stripWikiLinkSyntax(content: string): string {
  return content.replace(
    /\[\[([^\][|]+)(?:\|([^\][]*))?\]\]/g,
    (_m, page: string, label?: string) => `**${label || page}**`
  );
}

const WikiPane: React.FC<{
  page: KnowledgeWikiPage;
  onNavigate: (slug: string) => void;
  onEdit: () => void;
  onDelete: () => void;
}> = ({ page, onNavigate, onEdit, onDelete }) => {
  const { t } = useTranslation();
  return (
    <div className={styles.viewer}>
      <div className='flex items-center justify-between mb-8px'>
        <div className='flex items-center gap-8px flex-wrap'>
          {page.tags.map((tag) => (
            <Tag key={tag} size='small'>
              {tag}
            </Tag>
          ))}
        </div>
        <div className='flex gap-8px shrink-0'>
          <Button size='small' icon={<IconEdit />} onClick={onEdit}>
            {t('knowledge.wiki.edit')}
          </Button>
          <Popconfirm title={t('knowledge.wiki.deleteConfirm')} onOk={onDelete}>
            <Button size='small' status='danger' icon={<IconDelete />} />
          </Popconfirm>
        </div>
      </div>
      <Markdown>{stripWikiLinkSyntax(page.content)}</Markdown>
      {(page.links.length > 0 || page.backlinks.length > 0) && (
        <div className={styles.linkFooter}>
          {page.links.length > 0 && (
            <div className='mb-4px'>
              <Typography.Text type='secondary' className='mr-8px'>
                {t('knowledge.wiki.linksTo')}
              </Typography.Text>
              {page.links.map((slug) => (
                <Tag key={slug} className='cursor-pointer mr-4px' onClick={() => onNavigate(slug)}>
                  {slug}
                </Tag>
              ))}
            </div>
          )}
          {page.backlinks.length > 0 && (
            <div>
              <Typography.Text type='secondary' className='mr-8px'>
                {t('knowledge.wiki.linkedFrom')}
              </Typography.Text>
              {page.backlinks.map((slug) => (
                <Tag key={slug} color='arcoblue' className='cursor-pointer mr-4px' onClick={() => onNavigate(slug)}>
                  {slug}
                </Tag>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const MemoryPanel: React.FC = () => {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<KnowledgeMemoryEntry[]>([]);
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<KnowledgeMemoryKind | undefined>(undefined);
  const [newText, setNewText] = useState('');
  const [newKind, setNewKind] = useState<KnowledgeMemoryKind>('note');
  const [newTags, setNewTags] = useState('');
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(await ipcBridge.knowledge.listMemory.invoke({ query: query || undefined, kind: kindFilter }));
    } finally {
      setLoading(false);
    }
  }, [query, kindFilter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = async () => {
    if (!newText.trim()) return;
    const tags = newTags
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const result = await ipcBridge.knowledge.addMemory.invoke({ kind: newKind, text: newText.trim(), tags });
    if ('error' in result) {
      Message.error(result.error);
    } else {
      setNewText('');
      setNewTags('');
      Message.success(t('knowledge.memory.added'));
      void refresh();
    }
  };

  const remove = async (id: string) => {
    await ipcBridge.knowledge.deleteMemory.invoke({ id });
    void refresh();
  };

  return (
    <div className={styles.memoryPanel}>
      <div className='flex gap-8px mb-12px'>
        <Input
          prefix={<IconSearch />}
          placeholder={t('knowledge.memory.searchPlaceholder')}
          value={query}
          onChange={setQuery}
          allowClear
        />
        <Select
          placeholder={t('knowledge.memory.kindFilter')}
          value={kindFilter}
          onChange={(v) => setKindFilter(v as KnowledgeMemoryKind | undefined)}
          allowClear
          style={{ width: 140 }}
          options={MEMORY_KINDS.map((k) => ({ label: t(`knowledge.memory.kind.${k}`), value: k }))}
        />
      </div>
      <div className={styles.memoryAdd}>
        <Radio.Group type='button' size='small' value={newKind} onChange={(v) => setNewKind(v as KnowledgeMemoryKind)}>
          {MEMORY_KINDS.map((k) => (
            <Radio key={k} value={k}>
              {t(`knowledge.memory.kind.${k}`)}
            </Radio>
          ))}
        </Radio.Group>
        <Input.TextArea
          placeholder={t('knowledge.memory.addPlaceholder')}
          value={newText}
          onChange={setNewText}
          autoSize={{ minRows: 2, maxRows: 5 }}
          className='mt-8px'
        />
        <div className='flex gap-8px mt-8px'>
          <Input placeholder={t('knowledge.memory.tagsPlaceholder')} value={newTags} onChange={setNewTags} />
          <Button type='primary' icon={<IconPlus />} onClick={() => void add()} disabled={!newText.trim()}>
            {t('knowledge.memory.addButton')}
          </Button>
        </div>
      </div>
      <Spin loading={loading} className='w-full'>
        {entries.length === 0 ? (
          <Empty description={t('knowledge.memory.empty')} />
        ) : (
          <div className={styles.memoryList}>
            {entries.map((entry) => (
              <div key={entry.id} className={styles.memoryEntry}>
                <div className='flex items-center justify-between'>
                  <div className='flex items-center gap-8px flex-wrap'>
                    <Tag color={KIND_COLORS[entry.kind]} size='small'>
                      {t(`knowledge.memory.kind.${entry.kind}`)}
                    </Tag>
                    {entry.tags.map((tag) => (
                      <Tag key={tag} size='small'>
                        {tag}
                      </Tag>
                    ))}
                    <Typography.Text type='secondary' className='text-12px'>
                      {new Date(entry.ts).toLocaleString()}
                    </Typography.Text>
                  </div>
                  <Popconfirm title={t('knowledge.memory.deleteConfirm')} onOk={() => void remove(entry.id)}>
                    <Button size='mini' status='danger' icon={<IconDelete />} />
                  </Popconfirm>
                </div>
                <div className={styles.memoryText}>{entry.text}</div>
              </div>
            ))}
          </div>
        )}
      </Spin>
    </div>
  );
};

const KnowledgePage: React.FC = () => {
  const { t } = useTranslation();
  const [section, setSection] = useState<'wiki' | 'memory'>('wiki');
  const [pages, setPages] = useState<KnowledgeWikiMeta[]>([]);
  const [hits, setHits] = useState<KnowledgeWikiHit[] | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [current, setCurrent] = useState<KnowledgeWikiPage | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [loading, setLoading] = useState(false);

  const refreshPages = useCallback(async () => {
    setPages(await ipcBridge.knowledge.listPages.invoke());
  }, []);

  useEffect(() => {
    void refreshPages();
  }, [refreshPages]);

  useEffect(() => {
    const q = search.trim();
    if (!q) {
      setHits(undefined);
      return;
    }
    const handle = setTimeout(() => {
      void ipcBridge.knowledge.searchWiki.invoke({ query: q }).then(setHits);
    }, 250);
    return () => clearTimeout(handle);
  }, [search]);

  const openPage = useCallback(async (slug: string) => {
    setLoading(true);
    setEditing(false);
    try {
      setCurrent(await ipcBridge.knowledge.readPage.invoke({ slug }));
    } finally {
      setLoading(false);
    }
  }, []);

  const startNewPage = () => {
    setCurrent(undefined);
    setDraftTitle('');
    setDraftContent('');
    setEditing(true);
  };

  const startEdit = () => {
    if (!current) return;
    setDraftTitle(current.title);
    setDraftContent(current.content);
    setEditing(true);
  };

  const save = async () => {
    const result = await ipcBridge.knowledge.writePage.invoke({
      title: draftTitle.trim(),
      content: draftContent,
      slug: current?.slug,
    });
    if ('error' in result) {
      Message.error(result.error === 'empty_title' ? t('knowledge.wiki.needTitle') : result.error);
    } else {
      Message.success(t('knowledge.wiki.saved'));
      setEditing(false);
      await refreshPages();
      await openPage(result.slug);
    }
  };

  const deletePage = async () => {
    if (!current) return;
    await ipcBridge.knowledge.deletePage.invoke({ slug: current.slug });
    setCurrent(undefined);
    await refreshPages();
  };

  const listItems = useMemo(() => {
    if (hits !== undefined) return hits.map((h) => ({ slug: h.slug, title: h.title, snippet: h.snippet }));
    return pages.map((p) => ({ slug: p.slug, title: p.title, snippet: undefined as string | undefined }));
  }, [pages, hits]);

  return (
    <div className={styles.page}>
      <div className={styles.rail}>
        <Radio.Group
          type='button'
          value={section}
          onChange={(v) => setSection(v as 'wiki' | 'memory')}
          className='mb-12px w-full'
        >
          <Radio value='wiki'>{t('knowledge.tabs.wiki')}</Radio>
          <Radio value='memory'>{t('knowledge.tabs.memory')}</Radio>
        </Radio.Group>
        {section === 'wiki' && (
          <>
            <div className='flex gap-8px mb-8px'>
              <Input
                prefix={<IconSearch />}
                placeholder={t('knowledge.wiki.searchPlaceholder')}
                value={search}
                onChange={setSearch}
                allowClear
              />
              <Button type='primary' icon={<IconPlus />} onClick={startNewPage} title={t('knowledge.wiki.newPage')} />
            </div>
            <div className={styles.pageList}>
              {listItems.length === 0 ? (
                <Empty description={t('knowledge.wiki.empty')} />
              ) : (
                listItems.map((item) => (
                  <div
                    key={item.slug}
                    className={`${styles.pageItem} ${current?.slug === item.slug ? styles.pageItemActive : ''}`}
                    onClick={() => void openPage(item.slug)}
                  >
                    <div className={styles.pageItemTitle}>{item.title}</div>
                    {item.snippet && <div className={styles.pageItemSnippet}>{item.snippet}</div>}
                  </div>
                ))
              )}
            </div>
          </>
        )}
        {section === 'memory' && (
          <Typography.Text type='secondary' className='text-12px'>
            {t('knowledge.memory.hint')}
          </Typography.Text>
        )}
      </div>
      <div className={styles.main}>
        {section === 'memory' ? (
          <MemoryPanel />
        ) : editing ? (
          <div className={styles.editor}>
            <div className='flex gap-8px mb-8px'>
              <Input placeholder={t('knowledge.wiki.titlePlaceholder')} value={draftTitle} onChange={setDraftTitle} />
              <Button type='primary' icon={<IconSave />} onClick={() => void save()} disabled={!draftTitle.trim()}>
                {t('knowledge.wiki.save')}
              </Button>
              <Button onClick={() => setEditing(false)}>{t('knowledge.wiki.cancel')}</Button>
            </div>
            <Input.TextArea
              placeholder={t('knowledge.wiki.contentPlaceholder')}
              value={draftContent}
              onChange={setDraftContent}
              className={styles.editorArea}
            />
          </div>
        ) : loading ? (
          <Spin className='m-auto' />
        ) : current ? (
          <WikiPane
            page={current}
            onNavigate={(slug) => void openPage(slug)}
            onEdit={startEdit}
            onDelete={() => void deletePage()}
          />
        ) : (
          <div className={styles.welcome}>
            <Empty description={t('knowledge.wiki.welcome')} />
            <Button type='primary' icon={<IconPlus />} onClick={startNewPage} className='mt-16px'>
              {t('knowledge.wiki.newPage')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default KnowledgePage;
