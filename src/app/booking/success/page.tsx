"use client";

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';

/**
 * Booking success landing (M6 Polish — /booking/success).
 *
 * Scope note: plan.md's Screen Map has no intermediate success screen —
 * the planned flow is Screen 7 (confirm) → Screen 10 (booking
 * confirmation at /reservations/[id]/confirmed), and plan "Screen 8" is
 * the login screen. This route exists as an explicitly authorized,
 * lightweight success landing: a simple success message (Alert's
 * role="status" pattern from Phase 2/3) plus onward links. Nothing in
 * the booking flow navigates here yet — Screen 7's redirect target was
 * outside this phase's modify list.
 */
export default function BookingSuccessPage() {
  return (
    <div className="mx-auto w-full max-w-md">
      <h1 className="text-2xl font-semibold tracking-tight">Booking confirmed</h1>
      <div className="mt-4">
        <Alert variant="success">Your reservation was created successfully.</Alert>
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button
          onClick={() => {
            window.location.href = '/reservations';
          }}
        >
          My Reservations
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            window.location.href = '/';
          }}
        >
          Home
        </Button>
      </div>
    </div>
  );
}
