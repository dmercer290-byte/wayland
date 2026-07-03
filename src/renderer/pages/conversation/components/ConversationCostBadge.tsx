/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ConversationCostBadge - live "this conversation has cost $X" indicator for
 * the chat header. Reads the same cost_events analytics Mission Control's
 * Cost tab uses (ipcBridge.cost.byConversation), scoped to one conversation.
 * Hidden until the conversation has recorded at least one costed turn.
 */

import { Tag, Tooltip } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';

const REFRESH_MS = 30_000;

const formatUsd = (v: number): string => (v >= 1 ? `$${v.toFixed(2)}` : v > 0 ? `$${v.toFixed(3)}` : '$0');

const formatTokens = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
};

const ConversationCostBadge: React.FC<{ conversationId: string }> = ({ conversationId }) => {
  const { t } = useTranslation();
  const [costUsd, setCostUsd] = useState(0);
  const [tokens, setTokens] = useState(0);
  const [hasEvents, setHasEvents] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const rows = await ipcBridge.cost.byConversation.invoke({ fromMs: 0, toMs: Date.now() });
      const row = Array.isArray(rows) ? rows.find((r) => r.key === conversationId) : undefined;
      if (row) {
        setCostUsd(row.costUsd);
        setTokens(row.tokensTotal);
        setHasEvents(row.events > 0);
      } else {
        setHasEvents(false);
      }
    } catch {
      // Cost analytics unavailable - stay hidden rather than erroring the header.
      setHasEvents(false);
    }
  }, [conversationId]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, REFRESH_MS);
    return () => {
      clearInterval(timer);
    };
  }, [refresh]);

  if (!hasEvents) return null;

  return (
    <Tooltip
      content={t('conversation.cost.badgeTooltip', {
        defaultValue: 'Spend in this conversation: {{cost}} · {{tokens}} tokens',
        cost: formatUsd(costUsd),
        tokens: formatTokens(tokens),
      })}
    >
      <Tag size='small' className='shrink-0 cursor-default' data-testid='conversation-cost-badge'>
        {formatUsd(costUsd)}
      </Tag>
    </Tooltip>
  );
};

export default ConversationCostBadge;
