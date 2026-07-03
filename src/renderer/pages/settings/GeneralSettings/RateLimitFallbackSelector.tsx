/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * RateLimitFallbackSelector - pick the model scheduled tasks fail over to
 * when a provider's WEEKLY rate limit is hit (short-window hits auto-retry
 * at reset instead). Persists 'rateLimit.fallbackModel'.
 */

import { Select, Typography } from '@arco-design/web-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfigStorage } from '@/common/config/storage';
import type { IProvider } from '@/common/config/storage';

const NONE = '__none__';

const RateLimitFallbackSelector: React.FC = () => {
  const { t } = useTranslation();
  const [providers, setProviders] = useState<IProvider[]>([]);
  const [providerId, setProviderId] = useState<string>(NONE);
  const [useModel, setUseModel] = useState<string>('');

  useEffect(() => {
    let disposed = false;
    void Promise.all([ConfigStorage.get('model.config'), ConfigStorage.get('rateLimit.fallbackModel')])
      .then(([config, fallback]) => {
        if (disposed) return;
        const list = Array.isArray(config) ? config.filter((p) => p.enabled !== false) : [];
        setProviders(list);
        if (fallback?.providerId && fallback.useModel) {
          setProviderId(fallback.providerId);
          setUseModel(fallback.useModel);
        }
      })
      .catch((err) => {
        console.error('[RateLimitFallbackSelector] read failed:', err);
      });
    return () => {
      disposed = true;
    };
  }, []);

  const models = useMemo(() => {
    const provider = providers.find((p) => p.id === providerId);
    return (provider?.model ?? []).filter((m) => provider?.modelEnabled?.[m] !== false);
  }, [providers, providerId]);

  const persist = useCallback((nextProviderId: string, nextModel: string) => {
    const value =
      nextProviderId !== NONE && nextModel ? { providerId: nextProviderId, useModel: nextModel } : undefined;
    void ConfigStorage.set('rateLimit.fallbackModel', value).catch((err: unknown) => {
      console.error('[RateLimitFallbackSelector] save failed:', err);
    });
  }, []);

  return (
    <div className='flex flex-col gap-12px p-16px rd-12px bg-aou-1' data-testid='rate-limit-fallback-selector'>
      <div className='flex flex-col gap-4px'>
        <Typography.Text className='text-14px font-medium'>
          {t('settings.rateLimitFallback.title', { defaultValue: 'Rate-limit fallback model' })}
        </Typography.Text>
        <Typography.Text type='secondary' className='text-12px'>
          {t('settings.rateLimitFallback.subtitle', {
            defaultValue:
              'When a scheduled task hits a weekly rate limit, it switches to this model (e.g. OpenRouter or ZenMux) and retries. Short-window limits retry automatically at reset.',
          })}
        </Typography.Text>
      </div>
      <div className='flex items-center gap-8px'>
        <Select
          value={providerId}
          onChange={(value: string) => {
            setProviderId(value);
            setUseModel('');
            if (value === NONE) persist(NONE, '');
          }}
          style={{ width: 220 }}
          data-testid='rate-limit-fallback-provider'
        >
          <Select.Option value={NONE}>
            {t('settings.rateLimitFallback.none', { defaultValue: 'No fallback' })}
          </Select.Option>
          {providers.map((p) => (
            <Select.Option key={p.id} value={p.id}>
              {p.name}
            </Select.Option>
          ))}
        </Select>
        {providerId !== NONE && (
          <Select
            value={useModel || undefined}
            placeholder={t('settings.rateLimitFallback.pickModel', { defaultValue: 'Pick a model' })}
            onChange={(value: string) => {
              setUseModel(value);
              persist(providerId, value);
            }}
            style={{ width: 260 }}
            showSearch
            data-testid='rate-limit-fallback-model'
          >
            {models.map((m) => (
              <Select.Option key={m} value={m}>
                {m}
              </Select.Option>
            ))}
          </Select>
        )}
      </div>
    </div>
  );
};

export default RateLimitFallbackSelector;
