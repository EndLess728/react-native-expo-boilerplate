import i18n from 'i18next';

import { initI18n } from '../i18n';
import { translate } from '../utils';

// Loads the real i18n stack — expo-localization included, which ships
// untranspiled ESM — so this also guards the Jest transform config.
describe('i18n', () => {
  beforeAll(async () => {
    await initI18n();
  });

  it('translates from the bundled resources', () => {
    expect(i18n.isInitialized).toBe(true);
    expect(translate('settings.title')).not.toBe('settings.title');
  });

  it('switches language', async () => {
    const english = translate('settings.title');
    await i18n.changeLanguage('es');

    expect(translate('settings.title')).not.toBe(english);
    await i18n.changeLanguage('en');
  });
});
