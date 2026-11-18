import AsyncStorage from '@react-native-async-storage/async-storage';
import * as yup from 'yup';
import { ONBOARDING_STEPS, type BusinessActivity, type EmployeeRange, type OnboardingStep } from '@mpm/shared-types';
import { toAsciiDigits } from './digits';

// Onboarding (F1 spec §7, plan Task 15): which screen a step opens, the two forms' rules and request bodies, the
// once-per-device GST intro, and the step to resume at on a cold start. Pure apart from AsyncStorage.

/** Builds messages at render time, so they follow the current language (pass `t` from useTranslation). */
export type Translate = (key: string, options?: Record<string, unknown>) => string;

export type OnboardingScreen = 'YourBusiness' | 'WhereAreYou' | 'Main';

const STEP_TARGET: Record<OnboardingStep, { screen: OnboardingScreen }> = {
  profile: { screen: 'YourBusiness' },
  location: { screen: 'WhereAreYou' },
  done: { screen: 'Main' },
};

/** The root navigator's first screen for a step. */
export function nextScreen(step: OnboardingStep): OnboardingScreen {
  return STEP_TARGET[step].screen;
}

/** Both onboarding screens open either as a step of onboarding or from Profile to edit. */
export type FormMode = 'onboarding' | 'edit';

export const PINCODE_REGEX = /^[1-9]\d{5}$/;
const blank = (s: string | null | undefined): boolean => !s || s.trim() === '';
const digits = (s: string | null | undefined): string => toAsciiDigits(s ?? '').trim();

// ─── Your business ───

export interface ProfileFormValues {
  name: string;
  businessName: string;
  activities: BusinessActivity[];
  categories: string[];
  email: string;
  /** Raw text: Gujarati and Hindi keyboards type their own digits. */
  yearEstablished: string;
  employees: EmployeeRange | null;
}

export function buildProfileSchema(t: Translate) {
  const thisYear = new Date().getFullYear();
  return yup.object({
    name: yup.string().trim().min(2, t('onboarding.errors.nameLength')).max(80).required(t('onboarding.errors.required')),
    businessName: yup.string().trim().min(2, t('onboarding.errors.nameLength')).max(120).required(t('onboarding.errors.required')),
    activities: yup.array(yup.string().required()).min(1, t('onboarding.errors.activities')).required(),
    categories: yup.array(yup.string().required()).min(1, t('onboarding.errors.categories')).required(),
    email: yup.string().trim().email(t('onboarding.errors.email')).max(254),
    yearEstablished: yup.string().test('year', t('onboarding.errors.year', { year: thisYear }), (v) => {
      if (blank(v)) return true;
      const text = digits(v);
      if (!/^\d{4}$/.test(text)) return false;
      const year = Number(text);
      return year >= 1900 && year <= thisYear;
    }),
    employees: yup.string().nullable(),
  });
}

export interface ProfileBody {
  name: string;
  businessName?: string;
  activities: BusinessActivity[];
  categories: string[];
  email?: string | null;
  yearEstablished?: number | null;
  employees?: EmployeeRange | null;
}

/**
 * PATCH /businesses/me. A locked business name (GST verified) is never sent; the optional details are edited only from
 * Profile, so onboarding leaves them out.
 */
export function toProfileBody(v: ProfileFormValues, opts: { nameLocked: boolean; mode: FormMode }): ProfileBody {
  const body: ProfileBody = { name: v.name.trim(), activities: v.activities, categories: v.categories };
  if (!opts.nameLocked) body.businessName = v.businessName.trim();
  if (opts.mode === 'edit') {
    body.email = blank(v.email) ? null : v.email.trim();
    body.yearEstablished = blank(v.yearEstablished) ? null : Number(digits(v.yearEstablished));
    body.employees = v.employees;
  }
  return body;
}

// ─── Where are you? ───

export interface LocationFormValues {
  /** Raw text, see `yearEstablished`. */
  pincode: string;
  city: string;
  state: string;
  industrialAreaId: string | null;
  industrialAreaOther: string;
  addressLine: string;
}

/** Pincode, city, state and exactly one of a listed area and Other (spec §4.2, §7). */
export function buildLocationSchema(t: Translate) {
  return yup
    .object({
      pincode: yup.string().test('pincode', t('onboarding.errors.pincode'), (v) => PINCODE_REGEX.test(digits(v))),
      city: yup.string().trim().max(80).required(t('onboarding.errors.required')),
      state: yup.string().trim().max(80).required(t('onboarding.errors.required')),
      industrialAreaId: yup.string().nullable(),
      industrialAreaOther: yup.string().test('other', t('onboarding.errors.otherLength'), (v) => {
        if (blank(v)) return true;
        const n = v!.trim().length;
        return n >= 2 && n <= 80;
      }),
      addressLine: yup.string().max(200),
    })
    .test('one-area', t('onboarding.errors.area'), function oneArea(v) {
      if (!v || !!v.industrialAreaId !== !blank(v.industrialAreaOther)) return true;
      return this.createError({ path: 'industrialAreaId', message: t('onboarding.errors.area') });
    });
}

export interface LocationBody {
  pincode: string;
  city: string;
  state: string;
  industrialAreaId: string | null;
  industrialAreaOther: string | null;
  addressLine: string | null;
  lat?: number;
  lng?: number;
}

/** PUT /businesses/me/location; the pin is sent only when there is one (the API clears it otherwise). */
export function toLocationBody(v: LocationFormValues, pin: { lat: number; lng: number } | null): LocationBody {
  const other = v.industrialAreaOther.trim();
  return {
    pincode: digits(v.pincode),
    city: v.city.trim(),
    state: v.state.trim(),
    industrialAreaId: v.industrialAreaId ?? null,
    industrialAreaOther: v.industrialAreaId ? null : other || null,
    addressLine: blank(v.addressLine) ? null : v.addressLine.trim(),
    ...(pin ? { lat: pin.lat, lng: pin.lng } : {}),
  };
}

// ─── GST intro: shown once per device and user (plan Task 15) ───

const gstIntroKey = (userId: string) => `gst_intro_seen:${userId}`;

/** A storage failure counts as seen, so the intro never stands between the user and the tabs. */
export async function hasSeenGstIntro(userId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(gstIntroKey(userId))) !== null;
  } catch {
    return true;
  }
}

export async function markGstIntroSeen(userId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(gstIntroKey(userId), '1');
  } catch {
    // Worst case it shows once more.
  }
}

export function shouldShowGstIntro(s: { step: OnboardingStep; gstVerified: boolean; seen: boolean }): boolean {
  return s.step === 'done' && !s.gstVerified && !s.seen;
}

// ─── Cold start: `GET /businesses/me` decides; this is the fallback when it can't answer ───

const stepKey = (userId: string) => `onboarding_step:${userId}`;
const isStep = (v: unknown): v is OnboardingStep => (ONBOARDING_STEPS as readonly unknown[]).includes(v);

/** The last step this device saw for the user, so an offline cold start doesn't skip or repeat onboarding. */
export async function cachedStep(userId: string): Promise<OnboardingStep | null> {
  try {
    const v = await AsyncStorage.getItem(stepKey(userId));
    return isStep(v) ? v : null;
  } catch {
    return null;
  }
}

export async function cacheStep(userId: string, step: OnboardingStep): Promise<void> {
  try {
    await AsyncStorage.setItem(stepKey(userId), step);
  } catch {
    // Only the offline fallback is lost.
  }
}

/**
 * When `GET /businesses/me` fails on a cold start: an invalid token or a suspended account signs out; no business yet
 * is the first step; anything else (offline, server down) resumes at the last known step, or the first step when
 * nothing is cached (never skip onboarding on a guess).
 */
export function stepAfterBootError(err: { status?: number; code?: string }, cached: OnboardingStep | null): OnboardingStep | 'signed_out' {
  if (err.status === 401 || err.code === 'ACCOUNT_SUSPENDED') return 'signed_out';
  if (err.code === 'NO_BUSINESS') return 'profile';
  return cached ?? 'profile';
}

/**
 * The first screen of the signed-in app: the GST intro while it is due (just after onboarding), else the tabs. The
 * root navigator lists this screen first in the `app` group, because React Navigation opens a freshly mounted group
 * on its first route (`StackRouter.getStateForRouteNamesChange` falls back to `routeNames[0]`).
 */
export function appEntry(gstIntro: boolean): { screen: 'GstIntro' | 'Main' } {
  return gstIntro ? { screen: 'GstIntro' } : { screen: 'Main' };
}
