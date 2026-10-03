"use client";

import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { SettingsForm } from '@/components/staff/SettingsForm';
import { Alert } from '@/components/ui/Alert';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  SettingsApiError,
  canEditSettings,
  fetchRestaurantSettings,
  fetchStaffContext,
  updateRestaurantSettings,
  type RestaurantSettings,
  type SettingsFormValues,
  type StaffContext,
} from '@/lib/settings-client';

/**
 * Restaurant Settings (plan screen 29, /staff/settings — M10 Phase 1).
 *
 * Auth gate follows the M6/M7 pattern: an unauthenticated visitor is sent
 * to login with /staff/settings as the return path. The single-restaurant
 * MVP context comes from the first membership on GET /api/staff/me (its
 * role decides the manager/owner write gate); the editable values come
 * from the shipped public GET /api/restaurants/[slug]. A member without
 * restaurants sees an empty state rather than an error.
 *
 * Writes target the plan's PUT /api/restaurants/[slug] contract — the
 * route currently ships GET only, so a save surfaces the failure inline
 * (the backend lands in a later slice). A 403 (staff role, or a future
 * API gate) flips the form into its read-only state; 401 refreshes the
 * session. The do-nothing slug and the hours link to /staff/hours are
 * always visible, per decision.
 */

const LOGIN_URL = '/login?returnTo=/staff/settings';

type Phase = 'loading' | 'error' | 'ready';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong. Please try again.';
}

export default function StaffSettingsPage() {
  const { user, loading } = useAuth();
  const [phase, setPhase] = useState<Phase>('loading');
  const [restaurant, setRestaurant] = useState<StaffContext | null>(null);
  const [settings, setSettings] = useState<RestaurantSettings | null>(null);

  const [writeForbidden, setWriteForbidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (loading || user) {
      return;
    }
    window.location.replace(LOGIN_URL);
  }, [loading, user]);

  const load = useCallback(async () => {
    setPhase('loading');
    setFormError(null);
    setNotice(null);
    try {
      const context = await fetchStaffContext();
      if (!context) {
        setRestaurant(null);
        setSettings(null);
        setPhase('ready');
        return;
      }
      const detail = await fetchRestaurantSettings(context.slug);
      setRestaurant(context);
      setSettings(detail);
      setPhase('ready');
    } catch (err) {
      if (err instanceof SettingsApiError && err.status === 401) {
        window.location.replace(LOGIN_URL);
        return;
      }
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSave(values: SettingsFormValues) {
    if (!restaurant || !settings) {
      return;
    }
    setBusy(true);
    setFormError(null);
    setNotice(null);
    try {
      const updated = await updateRestaurantSettings(settings.slug, values);
      setSettings(updated);
      setNotice('Settings saved.');
    } catch (err) {
      if (err instanceof SettingsApiError && err.status === 401) {
        window.location.replace(LOGIN_URL);
        return;
      }
      if (err instanceof SettingsApiError && err.status === 403) {
        // Staff role / API write gate: flip the form into read-only.
        setWriteForbidden(true);
        setFormError(null);
        return;
      }
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const readOnly = !restaurant || !canEditSettings(restaurant.role) || writeForbidden;

  return (
    <div>
      <h1 className="text-3xl font-bold text-foreground">Restaurant Settings</h1>
      <p className="mt-3">
        <a
          href="/staff"
          className="text-sm font-medium text-foreground-muted underline underline-offset-4 hover:text-foreground"
        >
          Back to dashboard
        </a>
      </p>

      <div className="mt-6">
        {phase === 'loading' ? (
          <div role="status" className="grid gap-3">
            <span className="sr-only">Loading settings</span>
            <Skeleton className="h-64" />
            <Skeleton className="h-8" />
          </div>
        ) : null}

        {phase === 'error' ? <ErrorState onRetry={() => void load()} /> : null}

        {phase === 'ready' && (restaurant === null || settings === null) ? (
          <EmptyState
            title="No restaurants"
            description="Your account is not attached to a restaurant yet."
          />
        ) : null}

        {phase === 'ready' && restaurant && settings ? (
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-foreground">{restaurant.name}</h2>
              {notice ? <Alert variant="success">{notice}</Alert> : null}
            </div>

            <div className="mt-4">
              <SettingsForm
                key={`${settings.name}|${settings.timezone}`}
                slug={settings.slug}
                initialValues={{ name: settings.name, timezone: settings.timezone }}
                readOnly={readOnly}
                busy={busy}
                error={formError}
                onSubmit={(values) => void handleSave(values)}
                onCancel={() => setFormError(null)}
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
