import React, { useCallback, useState } from 'react';
import { Button, Message } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';

/** Inline Google "G" mark. Brand colors are intentional literals. */
const GoogleMark: React.FC = () => (
  <svg viewBox='0 0 24 24' width={16} height={16} aria-hidden focusable='false'>
    <path fill='#4285F4' d='M22.5 12.2c0-.7-.1-1.4-.2-2H12v4h5.9a5 5 0 0 1-2.2 3.3v2.7h3.5c2-1.9 3.3-4.7 3.3-8Z' />
    <path
      fill='#34A853'
      d='M12 23c3 0 5.5-1 7.3-2.7l-3.5-2.7c-1 .7-2.3 1.1-3.8 1.1-2.9 0-5.4-2-6.3-4.6H2v2.8A11 11 0 0 0 12 23Z'
    />
    <path fill='#FBBC05' d='M5.7 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2a11 11 0 0 0 0 9.8l3.7-2.8Z' />
    <path fill='#EA4335' d='M12 5.4c1.6 0 3 .6 4.2 1.6l3.1-3.1A11 11 0 0 0 2 7.1l3.7 2.8C6.6 7.3 9.1 5.4 12 5.4Z' />
  </svg>
);

/**
 * "Continue with Google" — the §4.2 secondary connect action.
 *
 * Wired to the existing `ipcBridge.googleAuth.login` OAuth flow. The
 * full Google-source model wiring (surfacing Gemini models in the registry
 * after sign-in) is finished in Wave 3 — TODO(wave3).
 */
const GoogleButton: React.FC = () => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  const handleClick = useCallback(async () => {
    setLoading(true);
    try {
      const res = await ipcBridge.googleAuth.login.invoke({});
      if (res.success) {
        Message.success(
          t('settings.modelsPage.connect.googleSuccess', {
            account: res.data?.account ?? '',
          })
        );
        // TODO(wave3): refresh the registry so the Google source's Gemini
        // models appear as a connected provider row.
      } else {
        Message.error(res.msg ?? t('settings.modelsPage.connect.googleFailed'));
      }
    } catch {
      Message.error(t('settings.modelsPage.connect.googleFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  return (
    <Button long loading={loading} icon={<GoogleMark />} onClick={() => void handleClick()}>
      {t('settings.modelsPage.connect.google')}
    </Button>
  );
};

export default GoogleButton;
