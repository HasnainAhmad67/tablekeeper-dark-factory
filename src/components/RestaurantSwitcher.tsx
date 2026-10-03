'use client';

import { useEffect, useState } from 'react';

import { getSelectedRestaurantId, switchRestaurant } from '@/lib/auth';

/**
 * Restaurant switcher for users with multiple memberships (plan line 498:
 * restaurant_memberships enables multi-restaurant; Section N decision 4
 * line 990 kept the MVP single with "UI can be added later" — this slice
 * is that UI, labelled as planned per lines 185/952).
 *
 * Data: GET /api/staff/me is the same payload every fetchStaffContext copy
 * reads, but all nine copies keep only the FIRST membership by design, so
 * listing every membership requires the full `restaurants` array from the
 * endpoint directly (client libs are outside this slice's file list — a
 * future slice can promote a shared fetchStaffContext that returns all).
 *
 * Behaviour: renders nothing while loading, when the request fails or
 * 401s, and when the user has a single membership (nothing to switch).
 * The current selection is the stored id from src/lib/auth.ts when it
 * still matches a membership, otherwise the first one (the default). On
 * change it calls switchRestaurant and reloads so every screen re-reads
 * its context. Self-contained by design: no existing component imports it
 * yet, so nothing changes until a later slice mounts it into the header.
 */

/** Field-style classes reused for the native <select> (TeamMemberItem precedent). */
const SELECT_CLASSES =
  'rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground';

interface MembershipOption {
  id: string;
  name: string;
}

/** Coerces one /api/staff/me membership entry to a dropdown option. */
function toOption(entry: unknown): MembershipOption | null {
  if (!entry || typeof entry !== 'object') return null;
  const record = entry as Record<string, unknown>;
  if (typeof record.id !== 'string' || record.id.length === 0) return null;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  return { id: record.id, name: name.length > 0 ? name : 'Untitled restaurant' };
}

export function RestaurantSwitcher() {
  const [options, setOptions] = useState<MembershipOption[] | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const response = await fetch('/api/staff/me', {
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) {
          throw new Error(`Request failed (${response.status})`);
        }
        const body = (await response.json()) as { restaurants?: unknown };
        const memberships = (Array.isArray(body.restaurants) ? body.restaurants : [])
          .map(toOption)
          .filter((option): option is MembershipOption => option !== null);
        if (!active) return;

        const stored = getSelectedRestaurantId();
        const storedIsValid =
          stored !== null && memberships.some((option) => option.id === stored);
        setOptions(memberships);
        setCurrentId(storedIsValid ? stored : (memberships[0]?.id ?? null));
      } catch {
        // Unauthenticated or network failure: hide the switcher — the
        // surrounding screen's auth handling stays in charge.
        if (active) setOptions([]);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  // Loading, failed, or a single membership: nothing to switch.
  if (!options || options.length <= 1) return null;

  return (
    <label className="flex items-center gap-2 text-sm text-foreground-muted">
      <span>Restaurant</span>
      <select
        className={SELECT_CLASSES}
        value={currentId ?? ''}
        onChange={(event) => {
          const nextId = event.target.value;
          if (nextId === currentId) return;
          switchRestaurant(nextId);
          setCurrentId(nextId);
          // Reload so every screen re-reads its staff context against the
          // newly stored restaurant selection.
          window.location.reload();
        }}
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );
}
