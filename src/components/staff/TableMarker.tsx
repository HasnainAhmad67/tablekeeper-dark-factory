import type { KeyboardEvent } from 'react';

import type { StaffTable } from '@/lib/tables-client';

/**
 * One table on the SVG floor map (plan screen 19 — M8 Phase 1).
 *
 * Markers are focusable groups (roving tabindex, role="button") so the map
 * is keyboard operable: arrows move between markers, Enter/Space selects —
 * the plan's interaction matrix maps Enter/Space to "Select". Round tables
 * render as circles (radius = half the smaller dimension); square, rect,
 * and booth render as rounded rectangles sized by width/depth, with the
 * stored position as the centre. Section colour tints the fill; selection
 * is conveyed by a primary stroke plus aria-pressed, never colour alone.
 * A `<title>` supplies the plan's hover tooltip.
 */

export interface TableMarkerProps {
  table: StaffTable;
  /** Section colour for the fill, or null when the table has no section. */
  color: string | null;
  /** Section name for the accessible label, or null when unsectioned. */
  sectionName: string | null;
  selected: boolean;
  /** Roving tabindex: only the current marker is tab-reachable. */
  focused: boolean;
  onKeyDown: (event: KeyboardEvent<SVGGElement>) => void;
  onClick: () => void;
}

export function TableMarker({
  table,
  color,
  sectionName,
  selected,
  focused,
  onKeyDown,
  onClick,
}: TableMarkerProps) {
  const halfWidth = table.width / 2;
  const halfDepth = table.depth / 2;
  const label = `${table.label}, ${table.capacity} seats, ${sectionName ?? 'No section'}`;
  const fontSize = Math.max(0.12, Math.min(table.width, table.depth) * 0.3);
  const strokeClass = selected ? 'stroke-primary' : 'stroke-border';
  const strokeWeight = selected ? 3 : 1.5;
  const fillClass = color === null ? 'fill-surface-raised' : '';
  const fillStyle = color === null ? undefined : { fill: color };
  const fillOpacity = color === null ? 1 : 0.3;
  const shapeClassName = `${fillClass} ${strokeClass}`.trim();

  return (
    <g
      data-table-marker=""
      role="button"
      tabIndex={focused ? 0 : -1}
      aria-pressed={selected}
      aria-label={label}
      onKeyDown={onKeyDown}
      onClick={onClick}
      className="cursor-pointer"
    >
      <title>{label}</title>
      {table.shape === 'round' ? (
        <circle
          cx={table.position_x}
          cy={table.position_y}
          r={Math.min(halfWidth, halfDepth)}
          fillOpacity={fillOpacity}
          style={fillStyle}
          strokeWidth={strokeWeight}
          vectorEffect="non-scaling-stroke"
          className={shapeClassName}
        />
      ) : (
        <rect
          x={table.position_x - halfWidth}
          y={table.position_y - halfDepth}
          width={table.width}
          height={table.depth}
          rx={Math.min(table.width, table.depth) * 0.1}
          fillOpacity={fillOpacity}
          style={fillStyle}
          strokeWidth={strokeWeight}
          vectorEffect="non-scaling-stroke"
          className={shapeClassName}
        />
      )}
      <text
        x={table.position_x}
        y={table.position_y}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={fontSize}
        className="pointer-events-none fill-foreground font-medium select-none"
      >
        {table.label}
      </text>
    </g>
  );
}
