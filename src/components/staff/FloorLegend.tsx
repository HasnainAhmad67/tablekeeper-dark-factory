import type { FloorSection } from '@/lib/floor-client';
import type { StaffTable } from '@/lib/tables-client';

/**
 * Colour-coded section legend for the 2D floor map (plan screen 19 —
 * M8 Phase 1). Sections carry no geometry in the schema (name, colour,
 * sort order only), so they appear here as a legend rather than as zones
 * on the map — a per-section count shows how the floor is distributed.
 * Tables without a section (or whose section no longer exists) are
 * summarised in a neutral "No section" row, matching the markers' own
 * unsectioned styling.
 */

export interface FloorLegendProps {
  sections: FloorSection[];
  tables: StaffTable[];
}

function tableWord(count: number): string {
  return `${count} ${count === 1 ? 'table' : 'tables'}`;
}

export function FloorLegend({ sections, tables }: FloorLegendProps) {
  const sectionIds = new Set(sections.map((section) => section.id));
  const unsectioned = tables.filter(
    (table) => table.section_id === null || !sectionIds.has(table.section_id),
  ).length;

  if (sections.length === 0 && unsectioned === 0) {
    return null;
  }

  return (
    <section aria-labelledby="floor-legend-heading" className="mt-4">
      <h3 id="floor-legend-heading" className="text-sm font-semibold text-foreground">
        Sections
      </h3>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
        {sections.map((section) => {
          const count = tables.filter((table) => table.section_id === section.id).length;
          return (
            <li
              key={section.id}
              className="flex items-center gap-2 text-sm text-foreground-muted"
            >
              <span
                aria-hidden="true"
                className="inline-block size-3 rounded-sm border border-border"
                style={{ backgroundColor: section.color }}
              />
              <span className="text-foreground">{section.name}</span>
              <span>{tableWord(count)}</span>
            </li>
          );
        })}
        {unsectioned > 0 ? (
          <li className="flex items-center gap-2 text-sm text-foreground-muted">
            <span
              aria-hidden="true"
              className="inline-block size-3 rounded-sm border border-border bg-surface-raised"
            />
            <span className="text-foreground">No section</span>
            <span>{tableWord(unsectioned)}</span>
          </li>
        ) : null}
      </ul>
    </section>
  );
}
