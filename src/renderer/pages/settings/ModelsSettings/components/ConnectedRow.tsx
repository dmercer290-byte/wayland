import React from 'react';
import { Button } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { IModelRegistryProviderView } from '@/common/adapter/ipcBridge';
import type { ConnectError } from '@process/providers/types';
import { providerMeta } from '../providerCatalog';
import styles from '../ModelsSettings.module.css';

type Props = {
  provider: IModelRegistryProviderView;
  /** Open the Manage page for this provider (Packet 2B). */
  onManage: (provider: IModelRegistryProviderView) => void;
  /** Open re-key for a provider in the error state (Packet 2B). */
  onFix: (provider: IModelRegistryProviderView) => void;
};

/** Map a registry error code to its i18n key suffix for the status line. */
const ERROR_KEY: Record<ConnectError, string> = {
  unauthorized: 'errorUnauthorized',
  'no-credit': 'errorNoCredit',
  offline: 'errorOffline',
  unrecognized: 'errorUnrecognized',
  'no-models': 'errorNoModels',
  unknown: 'errorUnknown',
};

/**
 * One compact connected-provider row. No chips, no overflow menu (spec §4.2).
 *
 * Drives three states from the registry view:
 *  - `connected` — green dot, model count, Manage.
 *  - `testing`   — spinner, "Testing…", Manage hidden.
 *  - `error`     — persistent "Action needed" status + a red Fix action
 *                  (spec §4.3 — never a stale green badge).
 *
 * `no-models` is an honest sub-case: the provider connected but returned zero
 * models, so the row stays `connected` with a recovery hint instead of a count.
 */
const ConnectedRow: React.FC<Props> = ({ provider, onManage, onFix }) => {
  const { t } = useTranslation();
  const meta = providerMeta(provider.providerId);

  const isError = provider.state === 'error';
  const isTesting = provider.state === 'testing';
  const noModels = !isError && !isTesting && provider.modelCount === 0;

  const rowClass = [styles.row, isTesting ? styles.rowTesting : '', isError ? styles.rowError : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rowClass} data-provider={provider.providerId} data-state={provider.state}>
      <div
        className={styles.avatar}
        style={{ background: meta.bg, color: meta.darkText ? '#1a1a1a' : '#fff' }}
        aria-hidden
      >
        {meta.mono}
      </div>

      <div className='min-w-0'>
        <div className={styles.rowName}>{meta.displayName}</div>
        <div className={styles.rowVia}>{provider.connectedVia}</div>
      </div>

      {isTesting && (
        <div className={`${styles.status} ${styles.statusTesting}`}>
          <span className='arco-spin-icon' />
          {t('settings.modelsPage.row.testing')}
        </div>
      )}

      {isError && (
        <div className={`${styles.status} ${styles.statusError}`} role='alert'>
          <span className={styles.statusDot} />
          {t('settings.modelsPage.row.actionNeeded', {
            reason: t(`settings.modelsPage.row.${ERROR_KEY[provider.error ?? 'unknown']}`),
          })}
        </div>
      )}

      {!isError && !isTesting && (
        <div className={`${styles.status} ${styles.statusConnected}`}>
          <span className={styles.statusDot} />
          {t('settings.modelsPage.row.connected')}
        </div>
      )}

      {!isError && !isTesting && (
        <>
          <div className={styles.divider} />
          <div className={styles.count}>
            {noModels
              ? t('settings.modelsPage.row.noModelsHint')
              : t('settings.modelsPage.row.modelCount', { count: provider.modelCount })}
          </div>
        </>
      )}

      {isError ? (
        <Button size='small' status='danger' onClick={() => onFix(provider)}>
          {t('settings.modelsPage.row.fix')}
        </Button>
      ) : (
        !isTesting && (
          <Button size='small' onClick={() => onManage(provider)}>
            {t('settings.modelsPage.row.manage')}
          </Button>
        )
      )}
    </div>
  );
};

export default ConnectedRow;
