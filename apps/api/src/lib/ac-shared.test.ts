import { describe, expect, it } from 'vitest';
import {
  APP_SETTINGS,
  adminPasswordProblem,
  adminUserStatus,
  appSettingDefaults,
  validateSettings,
} from '@mpm/shared-types';

// Admin close-out plan C0-1: the shared pure functions and the fraud settings' ranges (spec §5.1, §11, §12).

describe('adminUserStatus (§5.1)', () => {
  it('deactivated wins, even with a password', () => {
    expect(adminUserStatus({ isActive: false, hasPassword: true, lastLoginAt: new Date() })).toBe('deactivated');
  });

  it('no password: invited before the first sign-in, reset pending after one', () => {
    expect(adminUserStatus({ isActive: true, hasPassword: false, lastLoginAt: null })).toBe('invited');
    expect(adminUserStatus({ isActive: true, hasPassword: false, lastLoginAt: '2026-11-20T10:00:00.000Z' })).toBe('reset_pending');
  });

  it('active otherwise', () => {
    expect(adminUserStatus({ isActive: true, hasPassword: true, lastLoginAt: null })).toBe('active');
    expect(adminUserStatus({ isActive: true, hasPassword: true, lastLoginAt: new Date() })).toBe('active');
  });
});

describe('adminPasswordProblem (§11.2)', () => {
  it('too short, too long, the email itself, or fine', () => {
    expect(adminPasswordProblem('short', 'a@b.in')).toBe('too_short');
    expect(adminPasswordProblem('x'.repeat(129), 'a@b.in')).toBe('too_long');
    expect(adminPasswordProblem('Admin@Example.com ', 'admin@example.com')).toBe('is_email');
    expect(adminPasswordProblem('abcdefghijkl', 'a@b.in')).toBeNull();
    expect(adminPasswordProblem('x'.repeat(128), 'a@b.in')).toBeNull();
  });
});

describe('fraud settings (§12)', () => {
  it('eight fraud_ keys, the defaults valid', () => {
    expect(APP_SETTINGS.filter((s) => s.key.startsWith('fraud_'))).toHaveLength(8);
    expect(validateSettings(appSettingDefaults())).toBeNull();
  });

  it('refuses values outside their ranges', () => {
    expect(validateSettings({ ...appSettingDefaults(), fraud_device_accounts: 1 })?.key).toBe('fraud_device_accounts');
    expect(validateSettings({ ...appSettingDefaults(), fraud_window_days: 91 })?.key).toBe('fraud_window_days');
  });
});
