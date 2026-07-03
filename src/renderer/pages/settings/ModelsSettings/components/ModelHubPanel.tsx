/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ModelHubPanel - one dashboard over every model server the user runs
 * (Ollama / LM Studio / vLLM / ...). Lists all models across servers; for
 * Ollama models a Load button performs the VRAM swap: whatever is resident
 * on that server is unloaded first, then the picked model is warmed.
 */

import { Button, Empty, Input, Message, Spin, Table, Tag, Typography } from '@arco-design/web-react';
import { Delete, Refresh } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { ModelHubModel, ModelHubServerStatus } from '@/common/adapter/ipcBridge';

const formatSize = (bytes?: number): string => {
  if (!bytes || bytes <= 0) return '—';
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(0)} MB`;
};

const ModelHubPanel: React.FC = () => {
  const { t } = useTranslation();
  const [servers, setServers] = useState<ModelHubServerStatus[]>([]);
  const [models, setModels] = useState<ModelHubModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [addUrl, setAddUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [loadingModel, setLoadingModel] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const snapshot = await ipcBridge.modelHub.list.invoke();
      setServers(snapshot?.servers ?? []);
      setModels(snapshot?.models ?? []);
    } catch (err) {
      console.error('[ModelHubPanel] list failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleAdd = useCallback(async () => {
    const url = addUrl.trim();
    if (!url || adding) return;
    setAdding(true);
    try {
      const result = await ipcBridge.modelHub.addServer.invoke({ url });
      if (result?.ok) {
        setAddUrl('');
        Message.success(t('settings.modelHub.addSuccess', { defaultValue: 'Server added' }));
        await refresh();
      } else {
        const reason = result?.ok === false ? result.error : 'unknown';
        Message.error(
          reason === 'unreachable'
            ? t('settings.modelHub.addUnreachable', { defaultValue: 'Could not reach a model server at that URL' })
            : reason === 'duplicate'
              ? t('settings.modelHub.addDuplicate', { defaultValue: 'That server is already registered' })
              : t('settings.modelHub.addInvalid', { defaultValue: 'Enter a valid http(s) URL' })
        );
      }
    } finally {
      setAdding(false);
    }
  }, [addUrl, adding, refresh, t]);

  const handleRemove = useCallback(
    async (id: string) => {
      await ipcBridge.modelHub.removeServer.invoke({ id });
      await refresh();
    },
    [refresh]
  );

  const handleLoad = useCallback(
    async (model: ModelHubModel) => {
      const key = `${model.serverId}:${model.name}`;
      setLoadingModel(key);
      try {
        const result = await ipcBridge.modelHub.loadModel.invoke({ serverId: model.serverId, model: model.name });
        if (result?.ok) {
          Message.success(
            result.unloaded.length > 0
              ? t('settings.modelHub.loadedSwapped', {
                  defaultValue: 'Loaded {{model}} (freed VRAM: {{unloaded}})',
                  model: result.loaded,
                  unloaded: result.unloaded.join(', '),
                })
              : t('settings.modelHub.loaded', { defaultValue: 'Loaded {{model}}', model: result.loaded })
          );
          await refresh();
        } else {
          Message.error(
            t('settings.modelHub.loadFailed', {
              defaultValue: 'Load failed: {{error}}',
              error: result?.ok === false ? result.error : 'unknown',
            })
          );
        }
      } finally {
        setLoadingModel(null);
      }
    },
    [refresh, t]
  );

  return (
    <div className='flex flex-col gap-12px p-16px rd-12px bg-aou-1' data-testid='model-hub-panel'>
      <div className='flex items-center justify-between gap-16px'>
        <div className='flex flex-col gap-2px'>
          <Typography.Text className='text-14px font-medium'>
            {t('settings.modelHub.title', { defaultValue: 'Model Hub' })}
          </Typography.Text>
          <Typography.Text type='secondary' className='text-12px'>
            {t('settings.modelHub.subtitle', {
              defaultValue:
                'All models from your local and remote model servers in one place. Loading an Ollama model frees the VRAM it needs first.',
            })}
          </Typography.Text>
        </div>
        <Button
          size='small'
          icon={<Refresh size={14} aria-hidden='true' />}
          loading={loading}
          onClick={() => void refresh()}
          data-testid='model-hub-refresh'
        >
          {t('settings.modelHub.refresh', { defaultValue: 'Refresh' })}
        </Button>
      </div>

      <div className='flex items-center gap-8px'>
        <Input
          value={addUrl}
          onChange={setAddUrl}
          placeholder={t('settings.modelHub.addPlaceholder', {
            defaultValue: 'http://localhost:11434 (Ollama) or http://host:1234 (LM Studio)',
          })}
          onPressEnter={() => void handleAdd()}
          data-testid='model-hub-add-url'
        />
        <Button type='primary' loading={adding} onClick={() => void handleAdd()} data-testid='model-hub-add-button'>
          {t('settings.modelHub.addButton', { defaultValue: 'Add server' })}
        </Button>
      </div>

      {servers.length > 0 && (
        <div className='flex flex-wrap items-center gap-8px'>
          {servers.map((s) => (
            <Tag
              key={s.id}
              color={s.online ? 'green' : 'red'}
              closable
              onClose={() => void handleRemove(s.id)}
              icon={<Delete size={12} aria-hidden='true' style={{ display: 'none' }} />}
              data-testid={`model-hub-server-${s.id}`}
            >
              {s.name} · {s.kind}
              {s.online ? '' : ` · ${t('settings.modelHub.offline', { defaultValue: 'offline' })}`}
            </Tag>
          ))}
        </div>
      )}

      {loading && models.length === 0 ? (
        <div className='flex justify-center p-16px'>
          <Spin />
        </div>
      ) : models.length === 0 ? (
        <Empty
          description={t('settings.modelHub.empty', {
            defaultValue: 'No servers registered yet. Add your Ollama or LM Studio server above.',
          })}
        />
      ) : (
        <Table
          rowKey={(record: ModelHubModel) => `${record.serverId}:${record.name}`}
          data={models}
          pagination={models.length > 15 ? { pageSize: 15 } : false}
          size='small'
          columns={[
            {
              title: t('settings.modelHub.colModel', { defaultValue: 'Model' }),
              dataIndex: 'name',
              render: (_: unknown, record: ModelHubModel) => (
                <span className='flex items-center gap-8px'>
                  {record.name}
                  {record.loaded && (
                    <Tag color='arcoblue' size='small'>
                      {t('settings.modelHub.inVram', { defaultValue: 'in VRAM' })}
                    </Tag>
                  )}
                </span>
              ),
            },
            {
              title: t('settings.modelHub.colServer', { defaultValue: 'Server' }),
              dataIndex: 'serverName',
              width: 160,
            },
            {
              title: t('settings.modelHub.colSize', { defaultValue: 'Size' }),
              dataIndex: 'sizeBytes',
              width: 90,
              render: (_: unknown, record: ModelHubModel) => formatSize(record.sizeBytes),
            },
            {
              title: '',
              width: 110,
              render: (_: unknown, record: ModelHubModel) =>
                record.supportsSwap ? (
                  <Button
                    size='mini'
                    type={record.loaded ? 'secondary' : 'primary'}
                    disabled={record.loaded}
                    loading={loadingModel === `${record.serverId}:${record.name}`}
                    onClick={() => void handleLoad(record)}
                    data-testid={`model-hub-load-${record.name}`}
                  >
                    {record.loaded
                      ? t('settings.modelHub.loadedLabel', { defaultValue: 'Loaded' })
                      : t('settings.modelHub.loadButton', { defaultValue: 'Load' })}
                  </Button>
                ) : null,
            },
          ]}
        />
      )}
    </div>
  );
};

export default ModelHubPanel;
