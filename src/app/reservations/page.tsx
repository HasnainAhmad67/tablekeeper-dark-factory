"use client";

import { useEffect } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { ReservationList } from '@/components/reservations/ReservationList';

/**
 * Screen 11 — My Reservations (plan Screen Map §G: /reservations, list own
 * reservations through GET /api/reservations).
 *
 * Auth gate per plan decision: unauthenticated guests are redirected to
 * /login?returnTo=/reservations while the session resolves or is absent.
 */

const LOGIN_URL = '/login?returnTo=/reservations';

export default function ReservationsPage() {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading || user) {
      return;
    }
    window.location.replace(LOGIN_URL);
  }, [loading, user]);

  return (
    <div>
      <h1 className="text-3xl font-bold text-foreground">My Reservations</h1>
      <div className="mt-6">
        <ReservationList />
      </div>
    </div>
  );
}
