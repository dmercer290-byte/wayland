import React from 'react';
import { useTranslation } from 'react-i18next';
import { Card, PreferenceRow, ConfirmDialog } from '@renderer/components/settings/shared';
import { storage } from '@/common/adapter/ipcBridge';
import { FolderOpen } from 'lucide-react';
import DesktopActionButton from './DesktopActionButton';

type DirKind = 'workspace' | 'cache' | 'logs';
type ClearableKind = 'cache' | 'logs';

const DirectoriesCard: React.FC = () => {
  const { t } = useTranslation();
  const [clearTarget, setClearTarget] = React.useState<ClearableKind | null>(null);

  const openDir = (kind: DirKind) => {
    void storage.openDir.invoke(kind);
  };

  const clearDir = (kind: ClearableKind) => {
    void storage.clearDir.invoke(kind).then(() => setClearTarget(null));
  };

  return (
    <>
      <Card title={t('settings.storagePage.directoriesTitle')} titleIcon={FolderOpen}>
        <PreferenceRow label={t('settings.storagePage.workspace')}>
          <DesktopActionButton size='small' onClick={() => openDir('workspace')}>
            {t('settings.storagePage.open')}
          </DesktopActionButton>
        </PreferenceRow>

        <PreferenceRow label={t('settings.storagePage.cacheDir')}>
          <div className='flex gap-8px'>
            <DesktopActionButton size='small' onClick={() => openDir('cache')}>
              {t('settings.storagePage.open')}
            </DesktopActionButton>
            <DesktopActionButton size='small' status='danger' onClick={() => setClearTarget('cache')}>
              {t('settings.storagePage.clear')}
            </DesktopActionButton>
          </div>
        </PreferenceRow>

        <PreferenceRow label={t('settings.storagePage.logsDir')}>
          <div className='flex gap-8px'>
            <DesktopActionButton size='small' onClick={() => openDir('logs')}>
              {t('settings.storagePage.open')}
            </DesktopActionButton>
            <DesktopActionButton size='small' status='danger' onClick={() => setClearTarget('logs')}>
              {t('settings.storagePage.clear')}
            </DesktopActionButton>
          </div>
        </PreferenceRow>
      </Card>

      <ConfirmDialog
        open={clearTarget !== null}
        onClose={() => setClearTarget(null)}
        onConfirm={() => clearTarget && clearDir(clearTarget)}
        title={t('settings.storagePage.clearConfirmTitle')}
        body={t('settings.storagePage.clearConfirmBody')}
        confirmLabel={t('settings.storagePage.clear')}
        destructive
      />
    </>
  );
};

export default DirectoriesCard;
