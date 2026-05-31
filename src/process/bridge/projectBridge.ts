/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { projectServiceSingleton as projectService } from '@process/services/projectServiceSingleton';
import {
  readProjectKnowledge,
  writeProjectKnowledge,
  listProjectReference,
  addProjectReference,
  removeProjectReference,
  readProjectSummaries,
  writeProjectSummary,
} from '@process/services/projectKnowledge/knowledge';
import { hasUsableModel, oneShotComplete } from '@process/services/completion/oneShot';

/** Prompt the cheap model with a knowledge doc and ask for a single-sentence summary. */
const SUMMARY_KIND_LABEL = { context: 'project instructions', rules: 'project rules', decisions: 'project decisions' };

/** Resolve a project's workspace dir, throwing a clear error if unset. */
async function requireWorkspace(id: string): Promise<string> {
  const project = await projectService.getProject(id);
  if (!project?.workspace) throw new Error('Project has no workspace folder');
  return project.workspace;
}

/**
 * Initialize project IPC bridge handlers. A project is an umbrella over
 * conversations; there is no execution lock, so none of these handlers gate on
 * a "currently running" conversation. `changed` is emitted after every mutation
 * so the renderer can refresh the project list and per-project chat counts.
 */
export function initProjectBridge(): void {
  ipcBridge.project.create.provider(async (params) => {
    const project = await projectService.createProject(params);
    ipcBridge.project.changed.emit();
    return project;
  });

  ipcBridge.project.get.provider(async ({ id }) => {
    return projectService.getProject(id);
  });

  ipcBridge.project.list.provider(async () => {
    return projectService.listProjects();
  });

  ipcBridge.project.update.provider(async ({ id, updates }) => {
    await projectService.updateProject(id, updates);
    ipcBridge.project.changed.emit();
  });

  ipcBridge.project.remove.provider(async ({ id }) => {
    await projectService.removeProject(id);
    ipcBridge.project.changed.emit();
  });

  ipcBridge.project.getConversations.provider(async ({ projectId }) => {
    return projectService.getProjectConversations(projectId);
  });

  ipcBridge.project.assignConversation.provider(async ({ conversationId, projectId }) => {
    await projectService.assignConversation(conversationId, projectId);
    ipcBridge.project.changed.emit();
  });

  ipcBridge.project.removeConversation.provider(async ({ conversationId }) => {
    await projectService.removeConversationFromProject(conversationId);
    ipcBridge.project.changed.emit();
  });

  ipcBridge.project.readKnowledge.provider(async ({ id }) => {
    const project = await projectService.getProject(id);
    // No workspace yet → empty docs (the UI prompts the user to set a folder).
    if (!project?.workspace) return { context: '', rules: '', decisions: '' };
    return readProjectKnowledge(project.workspace);
  });

  ipcBridge.project.writeKnowledge.provider(async ({ id, kind, content }) => {
    const workspace = await requireWorkspace(id);
    await writeProjectKnowledge(workspace, kind, content);
  });

  ipcBridge.project.listReference.provider(async ({ id }) => {
    const project = await projectService.getProject(id);
    if (!project?.workspace) return [];
    return listProjectReference(project.workspace);
  });

  ipcBridge.project.addReference.provider(async ({ id, filePaths }) => {
    const workspace = await requireWorkspace(id);
    return addProjectReference(workspace, filePaths);
  });

  ipcBridge.project.removeReference.provider(async ({ id, name }) => {
    const workspace = await requireWorkspace(id);
    return removeProjectReference(workspace, name);
  });

  ipcBridge.project.readSummaries.provider(async ({ id }) => {
    const project = await projectService.getProject(id);
    if (!project?.workspace) return {};
    return readProjectSummaries(project.workspace);
  });

  ipcBridge.project.writeSummary.provider(async ({ id, kind, summary }) => {
    const workspace = await requireWorkspace(id);
    await writeProjectSummary(workspace, kind, summary);
  });

  ipcBridge.project.hasUsableModel.provider(async () => hasUsableModel());

  ipcBridge.project.generateSummary.provider(async ({ id, kind }) => {
    // Never reject: a model error must stop the UI spinner and surface a message,
    // not hang the in-flight invoke. Errors are returned, not thrown.
    try {
      const workspace = await requireWorkspace(id);
      const knowledge = await readProjectKnowledge(workspace);
      const body = knowledge[kind]?.trim();
      if (!body) return { summary: '' };
      const prompt =
        `Write a single concise sentence (max 18 words) summarizing the following ${SUMMARY_KIND_LABEL[kind]}. ` +
        `Reply with only the sentence, no preamble, no quotes.\n\n---\n${body}`;
      const raw = await oneShotComplete(prompt, { maxTokens: 80 });
      // Defend against a chatty model: keep the first line, strip wrapping quotes.
      const summary = raw
        .split('\n')[0]
        .trim()
        .replace(/^["']|["']$/g, '');
      await writeProjectSummary(workspace, kind, summary);
      return { summary };
    } catch (err) {
      console.error('[projectBridge] generateSummary failed:', err);
      const msg = err instanceof Error ? err.message : '';
      return { summary: '', error: msg === 'no-usable-model' ? 'no-model' : 'failed' };
    }
  });
}
