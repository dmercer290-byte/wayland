/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ContextModeSelector - Economy / Light / Max context-compaction preset for
 * wcore engine conversations. Persists 'wcore.compactMode'; the wcore spawn
 * path injects the matching `[compact]` section into the generated
 * `.wcore.toml`, so the preset applies from the next engine start.
 */

import { Message, Radio, Typography } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfigStorage } from '@/common/config/storage';

type CompactMode = 'economy' | 'light' | 'max';

const MODES: CompactMode[] = ['economy', 'light', 'max'];

const ContextModeSelector: React.FC = () => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<CompactMode>('light');

  useEffect(() => {
    let disposed = false;
    void ConfigStorage.get('wcore.compactMode')
      .then((value) => {
        if (disposed) return;
        if (value === 'economy' || value === 'light' || value === 'max') setMode(value);
      })
      .catch((err) => {
        console.error('[ContextModeSelector] read failed:', err);
      });
    return () => {
      disposed = true;
    };
  }, []);

  const handleChange = useCallback(
    (value: CompactMode) => {
      const previous = mode;
      setMode(value);
      void ConfigStorage.set('wcore.compactMode', value).catch((err: unknown) => {
        setMode(previous);
        Message.error(err instanceof Error ? err.message : String(err));
      });
    },
    [mode]
  );

  const labelFor = (m: CompactMode): string => {
    switch (m) {
      case 'economy':
        return t('settings.contextMode.economy', { defaultValue: 'Economy' });
      case 'max':
        return t('settings.contextMode.max', { defaultValue: 'Max' });
      default:
        return t('settings.contextMode.light', { defaultValue: 'Light' });
    }
  };

  const descriptionFor = (m: CompactMode): string => {
    switch (m) {
      case 'economy':
        return t('settings.contextMode.economyDesc', {
          defaultValue:
            'Compacts early (~50K tokens). Cheapest for long sessions; the agent remembers less old detail.',
        });
      case 'max':
        return t('settings.contextMode.maxDesc', {
          defaultValue:
            'Holds as much context as possible and keeps more tool results. Best recall, highest token use.',
        });
      default:
        return t('settings.contextMode.lightDesc', {
          defaultValue: 'Engine defaults: compacts only when the conversation nears the context limit.',
        });
    }
  };

  return (
    <div className='flex flex-col gap-12px p-16px rd-12px bg-aou-1' data-testid='context-mode-selector'>
      <div className='flex flex-col gap-4px'>
        <Typography.Text className='text-14px font-medium'>
          {t('settings.contextMode.title', { defaultValue: 'Context mode' })}
        </Typography.Text>
        <Typography.Text type='secondary' className='text-12px'>
          {t('settings.contextMode.subtitle', {
            defaultValue:
              'Controls when long conversations are auto-compacted before being re-sent to the model. Applies to new Genesis engine sessions.',
          })}
        </Typography.Text>
      </div>
      <Radio.Group
        value={mode}
        onChange={(value: CompactMode) => {
          handleChange(value);
        }}
        data-testid='context-mode-radio-group'
      >
        {MODES.map((m) => (
          <Radio key={m} value={m} data-testid={`context-mode-${m}`}>
            {labelFor(m)}
          </Radio>
        ))}
      </Radio.Group>
      <Typography.Text type='secondary' className='text-12px'>
        {descriptionFor(mode)}
      </Typography.Text>
    </div>
  );
};

export default ContextModeSelector;
