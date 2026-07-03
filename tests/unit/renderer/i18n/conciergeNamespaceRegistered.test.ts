import i18next from 'i18next';
import { describe, expect, it } from 'vitest';

import deDE from '@/renderer/services/i18n/locales/de-DE/index';
import enUS from '@/renderer/services/i18n/locales/en-US/index';
import esES from '@/renderer/services/i18n/locales/es-ES/index';
import frFR from '@/renderer/services/i18n/locales/fr-FR/index';
import jaJP from '@/renderer/services/i18n/locales/ja-JP/index';
import koKR from '@/renderer/services/i18n/locales/ko-KR/index';
import ptBR from '@/renderer/services/i18n/locales/pt-BR/index';
import ruRU from '@/renderer/services/i18n/locales/ru-RU/index';
import trTR from '@/renderer/services/i18n/locales/tr-TR/index';
import ukUA from '@/renderer/services/i18n/locales/uk-UA/index';
import zhCN from '@/renderer/services/i18n/locales/zh-CN/index';
import zhTW from '@/renderer/services/i18n/locales/zh-TW/index';

// Mirrors the static locale wiring in src/renderer/services/i18n/index.ts. The
// runtime i18next bundle is built ONLY from these default exports, so a module
// that exists on disk but is omitted here renders raw key strings at runtime.
const LOCALE_BUNDLES: Record<string, Record<string, unknown>> = {
  'de-DE': deDE,
  'en-US': enUS,
  'es-ES': esES,
  'fr-FR': frFR,
  'ja-JP': jaJP,
  'ko-KR': koKR,
  'pt-BR': ptBR,
  'ru-RU': ruRU,
  'tr-TR': trTR,
  'uk-UA': ukUA,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
};

describe('concierge i18n namespace registration', () => {
  it('bundles the concierge namespace with panel keys in every locale', () => {
    for (const [locale, bundle] of Object.entries(LOCALE_BUNDLES)) {
      const concierge = bundle.concierge as Record<string, unknown> | undefined;
      expect(concierge, `${locale} is missing the concierge namespace`).toBeDefined();
      const hasPanelKey = Object.keys(concierge ?? {}).some((key) => key.startsWith('panel.'));
      expect(hasPanelKey, `${locale} concierge namespace has no panel.* keys`).toBe(true);
    }
  });

  it('resolves a concierge key to translated text rather than the raw key', async () => {
    const instance = i18next.createInstance();
    await instance.init({
      lng: 'en-US',
      fallbackLng: 'en-US',
      interpolation: { escapeValue: false },
      resources: {
        'en-US': { translation: enUS },
      },
    });

    const resolved = instance.t('concierge.panel.title');
    expect(resolved).not.toBe('concierge.panel.title');
    expect(resolved.length).toBeGreaterThan(0);
  });
});
