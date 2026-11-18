import type { AppSettingsValues, AppSettingsView, SettingsExpiryImpact } from '@mpm/shared-types';
import { api } from './api';

// Typed calls to the marketplace settings API (F2 spec §11.5, §12). Super admin only.

export const fetchSettings = () => api.get<AppSettingsView>('/admin/settings');

/** Only the keys sent change; `400 SETTING_INVALID` with `details.key` names the setting. */
export const updateSettings = (patch: Partial<AppSettingsValues>) => api.patch<AppSettingsView>('/admin/settings', patch);

/** Live and rented listings not refreshed for `days` (7–365): what the next expiry run would expire. */
export const fetchExpiryImpact = (days: number) =>
  api.get<SettingsExpiryImpact>(`/admin/settings/expiry-impact?days=${days}`);
