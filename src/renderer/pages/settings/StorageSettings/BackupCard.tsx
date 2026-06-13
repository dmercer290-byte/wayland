import { Checkbox, Input } from '@arco-design/web-react';
import { Archive } from 'lucide-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, PreferenceRow } from '@renderer/components/settings/shared';
import { storage } from '@/common/adapter/ipcBridge';
import DesktopActionButton from './DesktopActionButton';

const BackupCard: React.FC = () => {
  const { t } = useTranslation();
  const [includeKeys, setIncludeKeys] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);

  const handleExport = () => {
    setExporting(true);
    void storage.exportAll
      .invoke({ includeKeys, passphrase: includeKeys ? passphrase : undefined })
      .finally(() => setExporting(false));
  };

  const handleImport = () => {
    setImporting(true);
    void storage.importBackup.invoke({}).finally(() => setImporting(false));
  };

  return (
    <Card title={t('settings.storagePage.backupTitle')} titleIcon={Archive}>
      <PreferenceRow label={t('settings.storagePage.exportIncludeKeys')}>
        <Checkbox checked={includeKeys} onChange={setIncludeKeys} />
      </PreferenceRow>

      {includeKeys && (
        <PreferenceRow label={t('settings.storagePage.exportPassphraseLabel')}>
          <Input
            type='password'
            value={passphrase}
            onChange={setPassphrase}
            placeholder={t('settings.storagePage.exportPassphrasePlaceholder')}
            style={{ width: 220 }}
            size='small'
          />
        </PreferenceRow>
      )}

      <div className='flex gap-8px mt-4px'>
        <DesktopActionButton type='primary' size='small' loading={exporting} onClick={handleExport}>
          {t('settings.storagePage.exportAll')}
        </DesktopActionButton>
        <DesktopActionButton size='small' loading={importing} onClick={handleImport}>
          {t('settings.storagePage.restore')}
        </DesktopActionButton>
      </div>
    </Card>
  );
};

export default BackupCard;
