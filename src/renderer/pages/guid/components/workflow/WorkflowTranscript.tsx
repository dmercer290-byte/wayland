/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WorkflowTranscript - polished consulting-style view of a workflow conversation.
 *
 * Replaces the raw MessageList when isWorkflow=true and mode='workflow'.
 * Renders the same TMessage[] but transforms presentation:
 *   - text (assistant) -> avatar "W" + cleaned prose via WorkflowAwareMessage
 *   - text (user)      -> avatar "S" + prose
 *   - agent_status     -> dropped (quiet)
 *   - tool_group / acp_tool_call / thinking -> grouped Activity collapsible
 *   - acp_permission   -> verbatim MessageAcpPermission (fully functional)
 *   - step markers     -> .steptag divider above the message that contained them
 *   - all other types  -> null (no crash)
 */

import { ChevronDown, ChevronRight } from 'lucide-react';
import type { IMessageAcpToolCall, IMessageAcpPermission, IMessageToolGroup, IMessageText, IMessageThinking } from '@/common/chat/chatLib';
import { useConversationContextSafe } from '@/renderer/hooks/context/ConversationContext';
import { useWorkflowViewMode } from '@/renderer/pages/guid/components/workflow/workflowViewMode';
import { WorkflowMessageBody } from '@renderer/pages/conversation/Messages/components/WorkflowMessageBody';
import MessageAcpPermission from '@renderer/pages/conversation/Messages/acp/MessageAcpPermission';
import MarkdownView from '@renderer/components/Markdown';
import { useMessageList } from '@renderer/pages/conversation/Messages/hooks';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import styles from './WorkflowTranscript.module.css';

// Mirror MessageText's envelope handling so the transcript shows the same clean
// prose the raw view does. The per-turn WORKFLOW_STEP_CONTEXT and the
// [workflow_answer] wrapper ride the user channel for cache safety but must be
// stripped before display; the hidden `begin <slug>` kickoff is hidden entirely.
const WORKFLOW_STEP_CONTEXT_RE = /\[workflow_step_context [^\]]*\][\s\S]*?\[\/workflow_step_context\]\s*/g;
const WORKFLOW_ANSWER_RE = /\[workflow_answer [^\]]*\]\s*<answer>([\s\S]*?)<\/answer>\s*\[\/workflow_answer\]\s*/g;
const BEGIN_COMMAND_RE = /^begin\s+[a-z0-9][a-z0-9-]*\s*$/i;
// First `<step n="N" status="...">` marker in an assistant body, for the tag divider.
const STEP_MARKER_RE = /<step\s+n=["']?(\d+)["']?(?:\s+status=["']?([a-z_]+)["']?)?/i;

const stripWorkflowEnvelopes = (text: string): string =>
  text.replace(WORKFLOW_STEP_CONTEXT_RE, '').replace(WORKFLOW_ANSWER_RE, (_m, answer: string) => answer).trimStart();

/** The raw string content of a text message, or '' when absent. */
const textOf = (m: IMessageText): string => {
  const c = (m.content as { content?: unknown } | undefined)?.content;
  return typeof c === 'string' ? c : '';
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type StepTag = { n: number; title: string };

type ActivityGroup = {
  type: 'activity';
  id: string;
  messages: Array<IMessageToolGroup | IMessageAcpToolCall | IMessageThinking>;
};

type TranscriptItem =
  | { type: 'steptag'; tag: StepTag; id: string }
  | { type: 'user'; message: IMessageText; id: string }
  | { type: 'assistant'; message: IMessageText; id: string }
  | ActivityGroup
  | { type: 'permission'; message: IMessageAcpPermission; id: string };

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const AvatarBadge: React.FC<{ label: string; variant: 'w' | 's' }> = ({ label, variant }) => (
  <div className={`${styles.avatar} ${variant === 'w' ? styles.avatarW : styles.avatarS}`}>
    {label}
  </div>
);

const StepTagRow: React.FC<{ tag: StepTag; done?: boolean }> = ({ tag, done }) => {
  const { t } = useTranslation();
  return (
    <div className={`${styles.steptag} ${done ? styles.steptagDone : ''}`}>
      <span className={styles.steptagIcon}>&#9654;</span>
      <span>
        {t('workflow.transcript.stepTag', { n: tag.n, title: tag.title })}
      </span>
    </div>
  );
};

const ActivityBlock: React.FC<{ group: ActivityGroup }> = ({ group }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const count = group.messages.length;

  const titles = group.messages.map((m) => {
    if (m.type === 'thinking') return t('workflow.transcript.thinking');
    if (m.type === 'tool_group') {
      const first = m.content?.[0];
      return first?.name ?? 'Tool';
    }
    // acp_tool_call
    const title = (m as IMessageAcpToolCall).content?.update?.title;
    return title ?? 'Action';
  });

  return (
    <div className={styles.activity}>
      <button
        className={styles.activityHeader}
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <span className={styles.activityIcon}>
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
        <span className={styles.activityLabel}>
          {t('workflow.transcript.activity', { count })}
        </span>
      </button>
      {expanded && (
        <ul className={styles.activityList}>
          {titles.map((title, i) => (
            <li key={i} className={styles.activityItem}>
              {title}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const WorkflowTranscript: React.FC = () => {
  const { t } = useTranslation();
  const messages = useMessageList();
  const conversationContext = useConversationContextSafe();
  const workflowSessionId = conversationContext?.workflowSessionId;
  const { stepTitles = [] } = useWorkflowViewMode();

  // Build a flat list of transcript items from the raw message list.
  // Adjacent tool/thinking messages are collapsed into a single ActivityGroup.
  const items = React.useMemo<TranscriptItem[]>(() => {
    const result: TranscriptItem[] = [];
    let currentActivity: ActivityGroup | null = null;

    const flushActivity = () => {
      if (currentActivity) {
        result.push(currentActivity);
        currentActivity = null;
      }
    };

    for (const msg of messages) {
      if (msg.hidden) continue;
      if (msg.type === 'available_commands') continue;

      if (msg.type === 'tool_group' || msg.type === 'acp_tool_call' || msg.type === 'thinking') {
        if (!currentActivity) {
          currentActivity = {
            type: 'activity',
            id: `activity-${msg.id}`,
            messages: [],
          };
        }
        currentActivity.messages.push(msg as IMessageToolGroup | IMessageAcpToolCall | IMessageThinking);
        continue;
      }

      flushActivity();

      if (msg.type === 'agent_status') {
        // Dropped - too noisy for transcript view
        continue;
      }

      if (msg.type === 'acp_permission') {
        result.push({ type: 'permission', message: msg as IMessageAcpPermission, id: msg.id });
        continue;
      }

      if (msg.type === 'text') {
        const textMsg = msg as IMessageText;
        if (textMsg.position === 'right') {
          result.push({ type: 'user', message: textMsg, id: msg.id });
        } else {
          result.push({ type: 'assistant', message: textMsg, id: msg.id });
        }
        continue;
      }

      // All other types: skip silently
    }

    flushActivity();
    return result;
  }, [messages]);

  if (items.length === 0) {
    return (
      <div className={styles.root}>
        <div className={styles.empty}>{t('workflow.transcript.starting')}</div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.scroll}>
        {items.map((item) => {
          if (item.type === 'steptag') {
            return <StepTagRow key={item.id} tag={item.tag} />;
          }

          if (item.type === 'activity') {
            return <ActivityBlock key={item.id} group={item} />;
          }

          if (item.type === 'permission') {
            return (
              <div key={item.id} className={`${styles.row} ${styles.rowPermission}`}>
                <MessageAcpPermission message={item.message} />
              </div>
            );
          }

          if (item.type === 'user') {
            // Mirror MessageText: strip the per-turn envelopes and hide the
            // hidden `begin <slug>` kickoff so the tape reads as a real exchange.
            const userText = stripWorkflowEnvelopes(textOf(item.message));
            if (!userText.trim() || BEGIN_COMMAND_RE.test(userText.trim())) return null;
            return (
              <div key={item.id} className={`${styles.row} ${styles.rowUser}`}>
                <AvatarBadge label={t('workflow.transcript.you')} variant='s' />
                <div className={styles.body}>
                  <MarkdownView>{userText}</MarkdownView>
                </div>
              </div>
            );
          }

          if (item.type === 'assistant') {
            const rawBody = textOf(item.message);
            if (!rawBody.trim()) return null;
            const marker = STEP_MARKER_RE.exec(rawBody);
            const stepN = marker ? Number(marker[1]) : null;
            const stepDone = marker?.[2]
              ? ['done', 'skipped', 'errored'].includes(marker[2].toLowerCase())
              : false;
            const stepTitle = stepN ? stepTitles[stepN - 1] ?? '' : '';
            return (
              <React.Fragment key={item.id}>
                {stepN !== null && <StepTagRow tag={{ n: stepN, title: stepTitle }} done={stepDone} />}
                <div className={`${styles.row} ${styles.rowAssistant}`}>
                  <AvatarBadge label={t('workflow.transcript.assistant')} variant='w' />
                  <div className={styles.body}>
                    {/* Canonical assistant body render (same as the raw view):
                        WorkflowMessageBody strips step markers + routes them to
                        the session, then hands clean markdown to MarkdownView. */}
                    <WorkflowMessageBody workflowSessionId={workflowSessionId} body={rawBody}>
                      {(cleanedBody) => <MarkdownView>{cleanedBody}</MarkdownView>}
                    </WorkflowMessageBody>
                  </div>
                </div>
              </React.Fragment>
            );
          }

          return null;
        })}
        <div className={styles.spacer} />
      </div>
    </div>
  );
};

