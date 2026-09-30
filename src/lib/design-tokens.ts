/**
 * Composable Floor design tokens — TypeScript contract.
 *
 * The runtime source of truth for these tokens is the CSS variable layer in
 * `src/app/globals.css`. This module documents the contract so it can be
 * asserted in tests and consumed by tooling without parsing CSS.
 */

export const colorTokens = {
  background: { cssVar: '--background', description: 'Page background' },
  surface: { cssVar: '--surface', description: 'Default surface (cards, panels)' },
  'surface-raised': {
    cssVar: '--surface-raised',
    description: 'Elevated surface (dropdowns, popovers)',
  },
  foreground: { cssVar: '--foreground', description: 'Primary text' },
  'foreground-muted': { cssVar: '--foreground-muted', description: 'Secondary text' },
  primary: { cssVar: '--primary', description: 'Brand accent' },
  'primary-foreground': { cssVar: '--primary-foreground', description: 'Text on primary accent' },
  border: { cssVar: '--border', description: 'Borders and dividers' },
  success: { cssVar: '--success', description: 'Success / available state' },
  warning: { cssVar: '--warning', description: 'Warning / held state' },
  danger: { cssVar: '--danger', description: 'Danger / occupied state' },
  info: { cssVar: '--info', description: 'Informational state' },
} as const;

export const radiusTokens = {
  sm: { cssVar: '--radius-sm' },
  md: { cssVar: '--radius-md' },
  lg: { cssVar: '--radius-lg' },
  xl: { cssVar: '--radius-xl' },
} as const;

export const typographyTokens = {
  sans: { cssVar: '--font-sans' },
} as const;

export const shadowTokens = {
  sm: { cssVar: '--shadow-sm' },
  md: { cssVar: '--shadow-md' },
  lg: { cssVar: '--shadow-lg' },
} as const;

export const designTokens = {
  color: colorTokens,
  radius: radiusTokens,
  typography: typographyTokens,
  shadow: shadowTokens,
} as const;

export type DesignTokenGroup = keyof typeof designTokens;
