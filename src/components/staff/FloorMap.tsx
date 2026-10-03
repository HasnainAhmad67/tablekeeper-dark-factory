import { useRef, useState, type KeyboardEvent } from 'react';

import { TableMarker } from '@/components/staff/TableMarker';
import { EmptyState } from '@/components/ui/EmptyState';
import type { FloorSection } from '@/lib/floor-client';
import type { StaffTable } from '@/lib/tables-client';

/**
 * SVG top-down floor map (plan screen 19 "2D Floor Map" — M8 Phase 1).
 *
 * Tables are drawn from their stored geometry (position_x/y is the centre,
 * width/depth the extents) with round tables as circles and every other
 * shape as a rounded rectangle. The view box is derived from the table
 * bounds, so no fixed coordinate system or floor size is assumed.
 * Sections have no geometry in the schema, so their colours only tint
 * markers (via TableMarker) and the legend — never zones.
 *
 * Accessibility: the svg is a labelled group using a roving tabindex —
 * arrow keys move between markers, Enter/Space selects. The ARIA table
 * list below the map mirrors every marker as a button for users who work
 * from lists rather than drawings, and an aria-live region announces
 * selections.
 */

export interface FloorMapProps {
  tables: StaffTable[];
  sections: FloorSection[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * View box covering every table's extents plus padding (5% of the larger
 * span, at least 1 world unit). Deterministic for a given table set — the
 * focused tests assert exact strings.
 */
export function computeViewBox(tables: StaffTable[]): string {
  if (tables.length === 0) {
    return '0 0 10 10';
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const table of tables) {
    minX = Math.min(minX, table.position_x - table.width / 2);
    maxX = Math.max(maxX, table.position_x + table.width / 2);
    minY = Math.min(minY, table.position_y - table.depth / 2);
    maxY = Math.max(maxY, table.position_y + table.depth / 2);
  }

  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const pad = Math.max(1, Math.max(spanX, spanY) * 0.05);
  const x = round(minX - pad);
  const y = round(minY - pad);
  const width = round(Math.max(spanX + pad * 2, 1));
  const height = round(Math.max(spanY + pad * 2, 1));
  return `${x} ${y} ${width} ${height}`;
}

export function FloorMap({ tables, sections, selectedId, onSelect }: FloorMapProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);

  if (tables.length === 0) {
    return (
      <EmptyState
        title="No layout"
        description="This restaurant has no tables placed on the floor yet."
        headingLevel={3}
      />
    );
  }

  const sectionById = new Map(sections.map((section) => [section.id, section]));
  const selectedTable = tables.find((table) => table.id === selectedId) ?? null;
  const announcement = selectedTable ? `${selectedTable.label} selected.` : '';

  function focusMarker(index: number) {
    const next = (index + tables.length) % tables.length;
    setFocusIndex(next);
    const markers = svgRef.current?.querySelectorAll<SVGGElement>('[data-table-marker]');
    if (markers && next < markers.length) {
      markers[next].focus();
    }
  }

  function handleKeyDown(event: KeyboardEvent<SVGGElement>, index: number) {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        focusMarker(index + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        focusMarker(index - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        onSelect(tables[index].id);
        break;
      default:
        break;
    }
  }

  return (
    <div className="mt-4">
      <svg
        ref={svgRef}
        role="group"
        aria-label={`Floor plan with ${tables.length} ${
          tables.length === 1 ? 'table' : 'tables'
        }`}
        viewBox={computeViewBox(tables)}
        className="h-auto w-full rounded-md border border-border bg-surface"
      >
        {tables.map((table, index) => {
          const section =
            table.section_id === null ? undefined : sectionById.get(table.section_id);
          return (
            <TableMarker
              key={table.id}
              table={table}
              color={section ? section.color : null}
              sectionName={section ? section.name : null}
              selected={table.id === selectedId}
              focused={index === focusIndex}
              onKeyDown={(event) => handleKeyDown(event, index)}
              onClick={() => onSelect(table.id)}
            />
          );
        })}
      </svg>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <h3 className="mt-4 text-sm font-semibold text-foreground">Tables</h3>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {tables.map((table) => {
          const section =
            table.section_id === null ? undefined : sectionById.get(table.section_id);
          return (
            <li key={table.id}>
              <button
                type="button"
                onClick={() => onSelect(table.id)}
                aria-pressed={table.id === selectedId}
                className="flex w-full items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-left hover:bg-surface-raised"
              >
                <span className="text-sm font-medium text-foreground">{table.label}</span>
                <span className="text-xs text-foreground-muted">
                  {table.capacity} seats · {section ? section.name : 'No section'}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
