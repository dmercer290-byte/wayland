/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IProject } from '@/common/types/project';
import type { TChatConversation } from '@/common/config/storage';
import { Button, Message, Modal } from '@arco-design/web-react';
import { BookOpen, ChevronLeft, Folder, FolderOpen, MessageSquare, MessageSquarePlus, Pencil } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { useProjects } from './hooks/useProjects';
import CreateProjectModal from './components/CreateProjectModal';
import ProjectKnowledgePanel from './components/ProjectKnowledgePanel';
import ChatWorkspace from '@/renderer/pages/conversation/Workspace';

type ProjectTab = 'chats' | 'files' | 'knowledge';

/**
 * Per-project workspace. The umbrella view: every chat under this project, plus
 * one obvious "New chat in this project" button that hands off to the normal
 * composer (full backend / model / assistant freedom) carrying the projectId.
 * No execution lock — multiple chats can run at once, so nothing here disables.
 */
const ProjectWorkspacePage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const { updateProject } = useProjects();

  const [project, setProject] = useState<IProject | null>(null);
  const [conversations, setConversations] = useState<TChatConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ProjectTab>('chats');

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      const [proj, convs] = await Promise.all([
        ipcBridge.project.get.invoke({ id: projectId }),
        ipcBridge.project.getConversations.invoke({ projectId }),
      ]);
      setProject(proj);
      setConversations(Array.isArray(convs) ? convs : []);
    } catch (err) {
      console.error('[ProjectWorkspacePage] load failed:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
    const unsub = ipcBridge.project.changed.on(() => void load());
    return () => unsub();
  }, [load]);

  const [modalCtrl, modalNode] = CreateProjectModal.useModal({
    project: project ?? undefined,
    onSubmit: async (params) => {
      if (!projectId) return;
      try {
        await updateProject(projectId, params);
        Message.success(t('projects.toast.updated'));
      } catch {
        Message.error(t('projects.toast.saveFailed'));
      }
    },
  });

  const startNewChat = () => {
    // Hand off to the normal composer, scoped to this project. The composer keeps
    // full backend / model / assistant freedom; useGuidSend stamps extra.projectId.
    // We also pass the project name + workspace so the composer can root the chat
    // in the project folder and show which project the chat belongs to.
    navigate('/guid', {
      state: { projectId, projectName: project?.name, projectWorkspace: project?.workspace },
    });
  };

  const removeFromProject = (conversationId: string) => {
    Modal.confirm({
      title: t('projects.removeChat.title'),
      content: t('projects.removeChat.body'),
      okText: t('projects.removeChat.confirm'),
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          await ipcBridge.project.removeConversation.invoke({ conversationId });
          Message.success(t('projects.toast.chatRemoved'));
        } catch {
          Message.error(t('projects.toast.saveFailed'));
        }
      },
    });
  };

  const color = project?.iconColor || '#FF6A00';

  return (
    <div className='flex flex-col h-full w-full overflow-hidden'>
      {/* Header */}
      <div
        className='flex items-center gap-12px px-24px py-16px flex-shrink-0'
        style={{ borderBottom: '1px solid var(--color-border-2)' }}
      >
        <Button type='text' shape='circle' icon={<ChevronLeft size={18} />} onClick={() => navigate('/projects')} />
        <div
          className='flex items-center justify-center w-36px h-36px rd-9px flex-shrink-0'
          style={{ background: `${color}1a`, color }}
        >
          <Folder size={18} />
        </div>
        <div className='flex flex-col gap-1px min-w-0 flex-1'>
          <div className='text-16px font-700 text-t-primary truncate'>
            {project?.name || t('projects.workspace.loading')}
          </div>
          {project?.description && <div className='text-12px text-t-secondary truncate'>{project.description}</div>}
        </div>
        <Button
          type='text'
          icon={<Pencil size={15} />}
          onClick={() => modalCtrl.open({ project: project ?? undefined })}
        >
          {t('projects.workspace.edit')}
        </Button>
        <Button type='primary' onClick={startNewChat}>
          <span className='flex items-center gap-6px'>
            <MessageSquarePlus size={16} />
            {t('projects.workspace.newChat')}
          </span>
        </Button>
      </div>

      {/* Tab bar: Chats / Files / Knowledge */}
      <div
        className='flex items-center gap-2px px-20px flex-shrink-0'
        style={{ borderBottom: '1px solid var(--color-border-2)' }}
      >
        {(
          [
            {
              key: 'chats',
              label: t('projects.workspace.tabChats'),
              icon: <MessageSquare size={15} />,
              count: conversations.length,
            },
            { key: 'files', label: t('projects.workspace.tabFiles'), icon: <FolderOpen size={15} /> },
            { key: 'knowledge', label: t('projects.workspace.tabKnowledge'), icon: <BookOpen size={15} /> },
          ] as Array<{ key: ProjectTab; label: string; icon: React.ReactNode; count?: number }>
        ).map((tab) => {
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type='button'
              onClick={() => setActiveTab(tab.key)}
              className='flex items-center gap-6px px-14px py-12px bg-transparent border-none cursor-pointer text-13px transition-colors'
              style={{
                color: active ? 'var(--color-text-1)' : 'var(--color-text-3)',
                fontWeight: active ? 600 : 400,
                borderBottom: `2px solid ${active ? 'var(--color-primary-6)' : 'transparent'}`,
                marginBottom: -1,
              }}
            >
              {tab.icon}
              {tab.label}
              {typeof tab.count === 'number' && tab.count > 0 && (
                <span className='text-11px text-t-tertiary'>{tab.count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className='flex-1 overflow-hidden'>
        {activeTab === 'chats' && (
          <div className='h-full overflow-auto px-24px py-16px'>
            {!loading && conversations.length === 0 ? (
              <div className='flex flex-col items-center justify-center gap-16px h-full text-center'>
                <div className='flex items-center justify-center w-56px h-56px rd-14px bg-fill-1 text-t-tertiary'>
                  <MessageSquarePlus size={26} />
                </div>
                <div className='flex flex-col gap-4px'>
                  <div className='text-15px font-600 text-t-primary'>{t('projects.workspace.emptyTitle')}</div>
                  <div className='text-13px text-t-secondary max-w-360px'>{t('projects.workspace.emptyBody')}</div>
                </div>
                <Button type='primary' onClick={startNewChat}>
                  <span className='flex items-center gap-6px'>
                    <MessageSquarePlus size={16} />
                    {t('projects.workspace.newChat')}
                  </span>
                </Button>
              </div>
            ) : (
              <div className='flex flex-col gap-8px max-w-720px mx-auto'>
                {conversations.map((c) => {
                  const backend = (c.extra as { backend?: string } | undefined)?.backend || c.type;
                  return (
                    <div
                      key={c.id}
                      role='button'
                      tabIndex={0}
                      onClick={() => navigate(`/conversation/${c.id}`)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') navigate(`/conversation/${c.id}`);
                      }}
                      className='group flex items-center gap-12px px-14px py-12px rd-10px bg-fill-1 border border-solid border-border-2 cursor-pointer hover:border-border-3 transition-all'
                    >
                      <div className='flex flex-col gap-2px min-w-0 flex-1'>
                        <div className='text-14px font-500 text-t-primary truncate'>
                          {c.name || t('projects.workspace.untitledChat')}
                        </div>
                        <div className='text-11px text-t-tertiary uppercase tracking-wide'>{backend}</div>
                      </div>
                      <Button
                        type='text'
                        size='mini'
                        className='opacity-0 group-hover:opacity-100 transition-opacity'
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFromProject(c.id);
                        }}
                      >
                        {t('projects.workspace.removeChat')}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'files' &&
          (project?.workspace ? (
            <div className='h-full'>
              <ChatWorkspace
                workspace={project.workspace}
                conversation_id={`project:${projectId}`}
                messageApi={Message}
              />
            </div>
          ) : (
            <div className='flex flex-col items-center justify-center gap-12px h-full text-center px-20px'>
              <div className='flex items-center justify-center w-48px h-48px rd-12px bg-fill-1 text-t-tertiary'>
                <FolderOpen size={22} />
              </div>
              <div className='text-14px font-600 text-t-primary'>{t('projects.knowledge.noWorkspaceTitle')}</div>
              <div className='text-12px text-t-secondary max-w-320px leading-relaxed'>
                {t('projects.knowledge.noWorkspaceBody')}
              </div>
              <Button type='outline' onClick={() => modalCtrl.open({ project: project ?? undefined })}>
                {t('projects.knowledge.setWorkspace')}
              </Button>
            </div>
          ))}

        {activeTab === 'knowledge' && (
          <div className='h-full overflow-auto px-24px py-18px'>
            <ProjectKnowledgePanel
              projectId={projectId || ''}
              hasWorkspace={!!project?.workspace}
              onSetWorkspace={() => modalCtrl.open({ project: project ?? undefined })}
            />
          </div>
        )}
      </div>

      {modalNode}
    </div>
  );
};

export default ProjectWorkspacePage;
