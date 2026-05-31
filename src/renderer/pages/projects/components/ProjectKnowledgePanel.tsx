/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import Markdown from '@/renderer/components/Markdown';
import { Button, Message } from '@arco-design/web-react';
import { FileText, FolderOpen, Paperclip, Pencil, Plus, X } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceDragImport } from '@/renderer/pages/conversation/Workspace/hooks/useWorkspaceDragImport';
import KnowledgeEditDrawer, { type KnowledgeKind } from './KnowledgeEditDrawer';

type KnowledgeState = Record<KnowledgeKind, string>;
type ReferenceFile = { name: string; path: string; size: number };

const EMPTY: KnowledgeState = { context: '', rules: '', decisions: '' };
const KINDS: KnowledgeKind[] = ['context', 'rules', 'decisions'];

/** Strip headings/blockquotes for a compact card preview (mirrors the injected view). */
const previewBody = (raw: string): string =>
  raw
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith('>') && !/^#\s/.test(t);
    })
    .join('\n')
    .trim();

/**
 * Project knowledge as cards: each doc (Instructions / Rules / Decisions) shows
 * its one-line summary and a markdown-rendered preview; the body and summary are
 * edited in a drawer. The full body is auto-injected into every chat in the
 * project; the summary is the at-a-glance. A drop zone collects reference files.
 */
const ProjectKnowledgePanel: React.FC<{
  projectId: string;
  hasWorkspace: boolean;
  onSetWorkspace: () => void;
}> = ({ projectId, hasWorkspace, onSetWorkspace }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [knowledge, setKnowledge] = useState<KnowledgeState>(EMPTY);
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [refs, setRefs] = useState<ReferenceFile[]>([]);
  const [canGenerate, setCanGenerate] = useState(false);
  const [editing, setEditing] = useState<KnowledgeKind | null>(null);

  const load = useCallback(async () => {
    if (!hasWorkspace) {
      setLoading(false);
      return;
    }
    try {
      const [k, s, r, hasModel] = await Promise.all([
        ipcBridge.project.readKnowledge.invoke({ id: projectId }),
        ipcBridge.project.readSummaries.invoke({ id: projectId }),
        ipcBridge.project.listReference.invoke({ id: projectId }),
        ipcBridge.project.hasUsableModel.invoke(),
      ]);
      setKnowledge({ context: k.context, rules: k.rules, decisions: k.decisions });
      setSummaries((s as Record<string, string>) || {});
      setRefs(Array.isArray(r) ? r : []);
      setCanGenerate(!!hasModel);
    } catch (err) {
      console.error('[ProjectKnowledgePanel] load failed:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId, hasWorkspace]);

  useEffect(() => {
    void load();
  }, [load]);

  // --- reference files (drag-drop + browse) ---
  const onFilesDropped = useCallback(
    async (files: Array<{ path: string; name: string }>) => {
      try {
        const updated = await ipcBridge.project.addReference.invoke({
          id: projectId,
          filePaths: files.map((f) => f.path),
        });
        setRefs(Array.isArray(updated) ? updated : []);
        Message.success(t('projects.knowledge.fileAdded', { count: files.length }));
      } catch {
        Message.error(t('projects.knowledge.fileAddFailed'));
      }
    },
    [projectId, t]
  );

  const { isDragging, dragHandlers } = useWorkspaceDragImport({
    onFilesDropped,
    messageApi: Message,
    t,
    conversationId: `project-knowledge-${projectId}`,
  });

  const browse = useCallback(async () => {
    const paths = await ipcBridge.dialog.showOpen.invoke({ properties: ['openFile', 'multiSelections'] });
    if (paths && paths.length > 0) await onFilesDropped(paths.map((p) => ({ path: p, name: p })));
  }, [onFilesDropped]);

  const removeRef = useCallback(
    async (name: string) => {
      try {
        const updated = await ipcBridge.project.removeReference.invoke({ id: projectId, name });
        setRefs(Array.isArray(updated) ? updated : []);
      } catch {
        Message.error(t('projects.knowledge.fileRemoveFailed'));
      }
    },
    [projectId, t]
  );

  if (!hasWorkspace) {
    return (
      <div className='flex flex-col items-center justify-center gap-12px text-center px-20px py-48px'>
        <div className='flex items-center justify-center w-48px h-48px rd-12px bg-fill-1 text-t-tertiary'>
          <FolderOpen size={22} />
        </div>
        <div className='text-14px font-600 text-t-primary'>{t('projects.knowledge.noWorkspaceTitle')}</div>
        <div className='text-12px text-t-secondary max-w-320px leading-relaxed'>
          {t('projects.knowledge.noWorkspaceBody')}
        </div>
        <Button type='outline' onClick={onSetWorkspace}>
          {t('projects.knowledge.setWorkspace')}
        </Button>
      </div>
    );
  }

  if (loading) return null;

  return (
    <div className='flex flex-col gap-16px max-w-820px mx-auto'>
      <div className='flex flex-col gap-2px'>
        <div className='text-15px font-700 text-t-primary'>{t('projects.knowledge.title')}</div>
        <div className='text-12px text-t-tertiary leading-relaxed'>{t('projects.knowledge.subtitle')}</div>
      </div>

      {KINDS.map((kind) => {
        const summary = summaries[kind] || '';
        const preview = previewBody(knowledge[kind] || '');
        const empty = !preview;
        return (
          <div
            key={kind}
            role='button'
            tabIndex={0}
            onClick={() => setEditing(kind)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setEditing(kind);
            }}
            className='group flex flex-col gap-8px rd-12px border border-solid border-border-2 bg-fill-1 px-16px py-14px cursor-pointer hover:border-border-3 transition-colors'
          >
            <div className='flex items-center justify-between gap-8px'>
              <span className='text-13px font-700 text-t-primary'>{t(`projects.knowledge.${kind}.label`)}</span>
              <span className='flex items-center gap-4px text-11px text-t-tertiary opacity-0 group-hover:opacity-100 transition-opacity'>
                <Pencil size={12} />
                {t('projects.knowledge.edit')}
              </span>
            </div>
            {summary && <div className='text-12px text-t-secondary italic leading-relaxed'>{summary}</div>}
            {empty ? (
              <div className='text-12px text-t-tertiary'>{t(`projects.knowledge.${kind}.emptyHint`)}</div>
            ) : (
              <div
                className='text-12px text-t-secondary leading-relaxed overflow-hidden'
                style={{ maxHeight: 96, maskImage: 'linear-gradient(to bottom, black 60%, transparent)' }}
              >
                <Markdown>{preview}</Markdown>
              </div>
            )}
          </div>
        );
      })}

      {/* Reference files */}
      <div className='flex flex-col gap-6px'>
        <div className='flex items-center justify-between'>
          <span className='text-13px font-700 text-t-primary'>{t('projects.knowledge.reference.label')}</span>
          <Button size='mini' type='text' icon={<Plus size={13} />} onClick={browse}>
            {t('projects.knowledge.reference.add')}
          </Button>
        </div>
        <div
          {...dragHandlers}
          className='flex flex-col items-center justify-center gap-6px rd-10px px-16px py-18px text-center transition-colors cursor-pointer'
          style={{
            border: `1.5px dashed ${isDragging ? 'var(--color-primary-6)' : 'var(--color-border-2)'}`,
            background: isDragging ? 'var(--color-primary-light-1)' : 'transparent',
          }}
          onClick={browse}
        >
          <Paperclip size={16} className='text-t-tertiary' />
          <div className='text-11px text-t-tertiary leading-relaxed'>{t('projects.knowledge.reference.dropHint')}</div>
        </div>
        {refs.length > 0 && (
          <div className='flex flex-col gap-4px mt-2px'>
            {refs.map((f) => (
              <div
                key={f.name}
                className='group flex items-center gap-8px px-10px py-6px rd-8px bg-fill-1 border border-solid border-border-2'
              >
                <FileText size={13} className='text-t-tertiary flex-shrink-0' />
                <span className='text-12px text-t-primary truncate flex-1' title={f.name}>
                  {f.name}
                </span>
                <button
                  type='button'
                  aria-label={t('projects.knowledge.reference.remove')}
                  className='flex items-center justify-center w-18px h-18px rd-4px bg-transparent border-none cursor-pointer text-t-tertiary opacity-0 group-hover:opacity-100 transition-opacity hover:text-t-primary'
                  onClick={() => void removeRef(f.name)}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <KnowledgeEditDrawer
          visible={!!editing}
          projectId={projectId}
          kind={editing}
          canGenerate={canGenerate}
          onClose={() => setEditing(null)}
          onSaved={() => void load()}
        />
      )}
    </div>
  );
};

export default ProjectKnowledgePanel;
