import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';

import { Skeleton } from '@/components/ui/Skeleton';
import type { FloorSection } from '@/lib/floor-client';
import type { StaffTable } from '@/lib/tables-client';

/**
 * Live 3D floor scene (plan screen 18 "Live 3D Floor" — M8 Phase 2).
 *
 * Renders the floor as a WebGL scene: a lit ground plane plus one mesh
 * per table (round tables as cylinders, every other shape as a box),
 * coloured by the table's section — sections carry no geometry in the
 * schema, so their colour lives on the meshes and in the page's legend,
 * never as zones. Interaction follows the plan's 3D interaction matrix:
 * click selects, orbit/pan/zoom come from OrbitControls (scroll zooms,
 * right-drag pans), and W/A/S/D pan the camera from the keyboard. The
 * ARIA table list mirrors every mesh as a button so keyboard and
 * screen-reader users get the same selection surface, with an aria-live
 * announcement for changes.
 *
 * The Canvas only mounts behind a one-frame `ready` gate (set in an
 * effect), so it is never server-rendered or constructed under
 * renderToString — tests assert the loader, hints, and ARIA list, and
 * /staff/floor owns the automatic 2D fallback after its WebGL check
 * (plan: "lazy loading — 3D components load only when the floor view is
 * active"; the page also lazy-loads this module via next/dynamic).
 * Table states (available/occupied) are not shown yet: there is no
 * state source until the realtime/state slice lands (Section N
 * decision 5 — polling fallback).
 */

export const TABLE_HEIGHT = 0.7;

/** Mirrors the dark-theme tokens (materials cannot use Tailwind classes). */
const GROUND_COLOR = '#131824'; // --surface
const TABLE_NEUTRAL_COLOR = '#2a3242'; // --border
const SELECTED_EMISSIVE = '#e2b34a'; // --primary

const KEYBOARD_PAN_KEYS = ['w', 'a', 's', 'd'];

export interface SceneTable {
  id: string;
  kind: 'cylinder' | 'box';
  /** World x (tables store position_x). */
  x: number;
  /** World z (tables store position_y — top-down y maps to 3D depth). */
  z: number;
  width: number;
  depth: number;
  /** Cylinder radius for round tables (half the smaller dimension). */
  radius: number;
  /** Section colour, or the neutral fallback for unsectioned tables. */
  color: string;
}

export interface SceneLayout {
  tables: SceneTable[];
  ground: { x: number; z: number; width: number; depth: number };
  camera: { position: [number, number, number]; target: [number, number, number] };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Derive the scene from stored table geometry — the same bounds maths as
 * the 2D view's computeViewBox, plus a ground plane (bounds + 15%
 * padding) and a default camera framing the centre of the floor.
 * Deterministic for a given table set — the focused tests assert exact
 * numbers.
 */
export function computeSceneLayout(
  tables: StaffTable[],
  sections: FloorSection[],
): SceneLayout {
  if (tables.length === 0) {
    return {
      tables: [],
      ground: { x: 0, z: 0, width: 10, depth: 10 },
      camera: { position: [0, 7.5, 8], target: [0, 0, 0] },
    };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const table of tables) {
    minX = Math.min(minX, table.position_x - table.width / 2);
    maxX = Math.max(maxX, table.position_x + table.width / 2);
    minZ = Math.min(minZ, table.position_y - table.depth / 2);
    maxZ = Math.max(maxZ, table.position_y + table.depth / 2);
  }

  const spanX = maxX - minX;
  const spanZ = maxZ - minZ;
  const pad = Math.max(1, Math.max(spanX, spanZ) * 0.15);
  const groundWidth = round(spanX + pad * 2);
  const groundDepth = round(spanZ + pad * 2);
  const cx = round((minX + maxX) / 2);
  const cz = round((minZ + maxZ) / 2);

  const span = Math.max(groundWidth, groundDepth);
  const camera: SceneLayout['camera'] = {
    position: [cx, round(span * 0.55 + 2), round(cz + span * 0.5 + 3)],
    target: [cx, 0, cz],
  };

  const sectionById = new Map(sections.map((section) => [section.id, section]));
  const sceneTables: SceneTable[] = tables.map((table) => {
    const section =
      table.section_id === null ? undefined : sectionById.get(table.section_id);
    return {
      id: table.id,
      kind: table.shape === 'round' ? 'cylinder' : 'box',
      x: table.position_x,
      z: table.position_y,
      width: table.width,
      depth: table.depth,
      radius: Math.min(table.width, table.depth) / 2,
      color: section ? section.color : TABLE_NEUTRAL_COLOR,
    };
  });

  return {
    tables: sceneTables,
    ground: { x: cx, z: cz, width: groundWidth, depth: groundDepth },
    camera,
  };
}

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return Boolean(
    element &&
      (element.tagName === 'INPUT' ||
        element.tagName === 'TEXTAREA' ||
        element.tagName === 'SELECT' ||
        element.isContentEditable),
  );
}

export interface Floor3DProps {
  tables: StaffTable[];
  sections: FloorSection[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function Floor3D({ tables, sections, selectedId, onSelect }: Floor3DProps) {
  const [ready, setReady] = useState(false);
  const controlsRef = useRef<ComponentRef<typeof OrbitControls> | null>(null);

  useEffect(() => {
    setReady(true);
  }, []);

  // W/A/S/D pan: move camera and orbit target together across the ground
  // plane (plan interaction matrix: pan = Shift+Arrow in 3D; this phase's
  // keyboard decision is W/S/A/D). Ignored while typing.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      if (!KEYBOARD_PAN_KEYS.includes(key)) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) {
        return;
      }
      const controls = controlsRef.current;
      if (!controls) {
        return;
      }

      const camera = controls.object;
      const forward = new THREE.Vector3().subVectors(controls.target, camera.position);
      forward.y = 0;
      if (forward.lengthSq() < 1e-6) {
        forward.set(0, 0, -1);
      }
      forward.normalize();
      const right = new THREE.Vector3()
        .crossVectors(forward, new THREE.Vector3(0, 1, 0))
        .normalize();

      const step = Math.max(0.3, camera.position.distanceTo(controls.target) * 0.06);
      const delta = new THREE.Vector3();
      if (key === 'w') delta.addScaledVector(forward, step);
      if (key === 's') delta.addScaledVector(forward, -step);
      if (key === 'd') delta.addScaledVector(right, step);
      if (key === 'a') delta.addScaledVector(right, -step);

      camera.position.add(delta);
      controls.target.add(delta);
      controls.update();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const layout = computeSceneLayout(tables, sections);
  const sectionById = new Map(sections.map((section) => [section.id, section]));
  const selectedTable = tables.find((table) => table.id === selectedId) ?? null;
  const announcement = selectedTable ? `${selectedTable.label} selected.` : '';

  return (
    <div className="mt-4">
      {ready ? (
        <div
          role="img"
          aria-label={`3D floor view with ${tables.length} ${
            tables.length === 1 ? 'table' : 'tables'
          }`}
          className="h-[60vh] w-full rounded-md border border-border bg-surface"
        >
          <Canvas
            camera={{ position: layout.camera.position, fov: 50, near: 0.1, far: 200 }}
            dpr={[1, 2]}
          >
            <ambientLight intensity={1.2} />
            <directionalLight position={[8, 14, 6]} intensity={2} />
            <mesh
              rotation={[-Math.PI / 2, 0, 0]}
              position={[layout.ground.x, 0, layout.ground.z]}
            >
              <planeGeometry args={[layout.ground.width, layout.ground.depth]} />
              <meshStandardMaterial color={GROUND_COLOR} roughness={0.9} metalness={0} />
            </mesh>
            {layout.tables.map((table) => (
              <mesh
                key={table.id}
                position={[table.x, TABLE_HEIGHT / 2, table.z]}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(table.id);
                }}
                onPointerOver={() => {
                  document.body.style.cursor = 'pointer';
                }}
                onPointerOut={() => {
                  document.body.style.cursor = 'auto';
                }}
              >
                {table.kind === 'cylinder' ? (
                  <cylinderGeometry args={[table.radius, table.radius, TABLE_HEIGHT, 32]} />
                ) : (
                  <boxGeometry args={[table.width, TABLE_HEIGHT, table.depth]} />
                )}
                <meshStandardMaterial
                  color={table.color}
                  emissive={table.id === selectedId ? SELECTED_EMISSIVE : '#000000'}
                  emissiveIntensity={table.id === selectedId ? 0.6 : 0}
                  roughness={0.6}
                  metalness={0.1}
                />
              </mesh>
            ))}
            <OrbitControls
              ref={controlsRef}
              target={layout.camera.target}
              enableDamping={false}
            />
          </Canvas>
        </div>
      ) : (
        <div role="status" className="grid gap-3">
          <span className="sr-only">Loading 3D view</span>
          <Skeleton className="h-96" />
        </div>
      )}

      <p className="mt-3 text-sm text-foreground-muted">
        Use W, A, S, D to pan the camera, scroll to zoom, and press V to switch between
        the 3D and 2D views. Click a table to select it.
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

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

export default Floor3D;
