"use client";

import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { HoursForm, HoursPreview } from '@/components/staff/HoursForm';
import { Alert } from '@/components/ui/Alert';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  HoursApiError,
  defaultHours,
  fetchHours,
  fetchStaffContext,
  saveHours,
  type OperatingHour,
  type StaffContext,
} from '@/lib/hours-client';

/**
 * Operating Hours (plan screen 28, /staff/hours — M7 Phase 4).
 *
 * Auth gate follows the M6/M7 pattern: unauthenticated visitors are sent to
 * login with /staff/hours as the return path. The single-restaurant MVP
 * context comes from the first membership on GET /api/staff/me; a member
 * without restaurants sees an empty state rather than an error. The page
 * shows the stored hours as a read-only preview above the editor; a save
 * 403 (Manager/Owner gate) flips the page into its read-only state — the
 * reactive pattern from Phase 2, not a pre-hidden form.
 */

const LOGIN_URL = '/login?returnTo=/staff/hours';

const READ_ONLY_MESSAGE =
  'You have read-only access to operating hours — only owners and managers can make changes.';

type Phase = 'loading' | 'error' | 'ready';

export default function StaffHoursPage() {
  const { user, loading } = useAuth();
  const [phase, setPhase] = useState<Phase>('loading');
  const [restaurant, setRestaurant] = useState<StaffContext | null>(null);
  const [hours, setHours] = useState<OperatingHour[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState(false);

  useEffect(() => {
    if (loading || user) {
      return;
    }
    window.location.replace(LOGIN_URL);
  }, [loading, user]);

  const load = useCallback(async () => {
    setPhase('loading');
    setSaved(false);
    setSaveError(null);
    try {
      const context = await fetchStaffContext();
      if (!context) {
        setRestaurant(null);
        setHours([]);
        setPhase('ready');
        return;
      }
      const current = await fetchHours(context.id);
      setRestaurant(context);
      setHours(current);
      setPhase('ready');
    } catch (err) {
      if (err instanceof HoursApiError && err.status === 401) {
        window.location.replace(LOGIN_URL);
        return;
      }
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSave(next: OperatingHour[]) {
    if (!restaurant) {
      return;
    }
    setBusy(true);
    setSaved(false);
    setSaveError(null);
    try {
      const savedHours = await saveHours(restaurant.id, next);
      setHours(savedHours);
      setSaved(true);
    } catch (err) {
      if (err instanceof HoursApiError && err.status === 401) {
        window.location.replace(LOGIN_URL);
        return;
      }
      if (err instanceof HoursApiError && err.status === 403) {
        // Owner/Manager gate: flip the surface to read-only (Phase 2 pattern).
        setReadOnly(true);
        return;
      }
      setSaveError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="text-3xl font-bold text-foreground">Operating Hours</h1>
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
            <span className="sr-only">Loading hours</span>
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        ) : null}

        {phase === 'error' ? <ErrorState onRetry={() => void load()} /> : null}

        {phase === 'ready' && restaurant === null ? (
          <EmptyState
            title="No restaurants"
            description="Your account is not attached to a restaurant yet."
          />
        ) : null}

        {phase === 'ready' && restaurant ? (
          <div>
            <h2 className="text-lg font-semibold text-foreground">{restaurant.name}</h2>

            {saved ? <Alert variant="success">Hours saved</Alert> : null}
            {readOnly ? <Alert variant="info">{READ_ONLY_MESSAGE}</Alert> : null}

            <div className="mt-4">
              <HoursPreview hours={hours} />
            </div>

            {!readOnly ? (
              <div className="mt-6">
                <HoursForm
                  initialHours={hours.length > 0 ? hours : defaultHours()}
                  busy={busy}
                  error={saveError}
                  onSubmit={(next) => void handleSave(next)}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
