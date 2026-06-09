/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { Button, Input, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { openExternalUrl } from '@renderer/utils/platform';
import styles from '../panes/Panes.module.css';

export type ToolKeyCardProps = {
  /** Display name of the backend (e.g. "Brave Search"). */
  name: string;
  /** One-line "what this unlocks" description (already translated). */
  description: string;
  /** Whether a key is currently stored for this backend. */
  connected: boolean;
  /** Free-key signup URL, opened externally. */
  signupUrl: string;
  /** Persist a key for this backend. */
  onSave: (key: string) => void | Promise<void>;
  /** Remove the stored key for this backend. */
  onRemove: () => void | Promise<void>;
};

/**
 * A single web-search backend credential card: name + "what a key unlocks"
 * line, a password input, a save / connected state, a "Get a free key" signup
 * link, and a remove action once a key is stored.
 *
 * Krug/Sutherland framing: a missing key is never an error - it is an optional
 * upgrade ("add a key to go faster / higher-volume"), because free DuckDuckGo
 * search is already on.
 */
const ToolKeyCard: React.FC<ToolKeyCardProps> = ({ name, description, connected, signupUrl, onSave, onRemove }) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSave = async (): Promise<void> => {
    const trimmed = draft.trim();
    if (trimmed.length === 0 || busy) return;
    setBusy(true);
    try {
      await onSave(trimmed);
      setDraft('');
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await onRemove();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.toolKeyCard}>
      <div className='flex items-start gap-8px'>
        <div className='flex-1 min-w-0 flex flex-col gap-2px'>
          <div className='flex items-center gap-8px'>
            <Typography.Text className='text-14px font-medium'>{name}</Typography.Text>
            {connected && (
              <span className='flex items-center gap-4px text-12px text-success'>
                <CheckCircle2 size={13} />
                {t('settings.wcoreConfig.services.connected', { defaultValue: 'Connected' })}
              </span>
            )}
          </div>
          <Typography.Text type='secondary' className='text-12px'>
            {description}
          </Typography.Text>
        </div>
        <div
          role='button'
          tabIndex={0}
          onClick={() => void openExternalUrl(signupUrl)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              void openExternalUrl(signupUrl);
            }
          }}
          className='shrink-0 flex items-center gap-4px text-12px text-t-secondary hover:text-primary cursor-pointer'
        >
          {t('settings.wcoreConfig.services.getFreeKey', { defaultValue: 'Get a free key' })}
          <ArrowRight size={12} />
        </div>
      </div>

      <div className='flex items-center gap-8px'>
        <Input.Password
          value={draft}
          onChange={setDraft}
          onPressEnter={() => void handleSave()}
          disabled={busy}
          placeholder={
            connected
              ? t('settings.wcoreConfig.services.replaceKeyPlaceholder', { defaultValue: 'Replace key…' })
              : t('settings.wcoreConfig.services.keyPlaceholder', { defaultValue: 'Paste API key…' })
          }
          className='flex-1'
        />
        <Button
          type='primary'
          size='default'
          loading={busy}
          disabled={draft.trim().length === 0}
          onClick={() => void handleSave()}
        >
          {connected
            ? t('settings.wcoreConfig.services.replace', { defaultValue: 'Replace' })
            : t('settings.wcoreConfig.services.save', { defaultValue: 'Save' })}
        </Button>
        {connected && (
          <Button status='danger' size='default' disabled={busy} onClick={() => void handleRemove()}>
            {t('settings.wcoreConfig.services.remove', { defaultValue: 'Remove' })}
          </Button>
        )}
      </div>
    </div>
  );
};

export default ToolKeyCard;
