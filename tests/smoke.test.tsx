import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { designTokens } from '@/lib/design-tokens';
import HomePage from '@/app/page';
import { GET } from '@/app/api/health/route';

function readRootFile(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), 'utf8');
}

describe('design tokens', () => {
  it('declares the full color, radius, typography, and shadow contract', () => {
    expect(Object.keys(designTokens)).toEqual(['color', 'radius', 'typography', 'shadow']);
    expect(Object.keys(designTokens.color)).toEqual([
      'background',
      'surface',
      'surface-raised',
      'foreground',
      'foreground-muted',
      'primary',
      'primary-foreground',
      'border',
      'success',
      'warning',
      'danger',
      'info',
    ]);
    expect(Object.keys(designTokens.radius)).toEqual(['sm', 'md', 'lg', 'xl']);
    expect(Object.keys(designTokens.typography)).toEqual(['sans']);
    expect(Object.keys(designTokens.shadow)).toEqual(['sm', 'md', 'lg']);
  });

  it('maps every token to a CSS variable defined in globals.css', () => {
    const css = readRootFile('src/app/globals.css');
    const tokens = [
      ...Object.values(designTokens.color),
      ...Object.values(designTokens.radius),
      ...Object.values(designTokens.typography),
      ...Object.values(designTokens.shadow),
    ];
    for (const token of tokens) {
      expect(css, `globals.css should define ${token.cssVar}`).toContain(token.cssVar);
    }
  });
});

describe('health check route', () => {
  it('responds 200 without Supabase credentials', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; timestamp: string };
    expect(body.status).toBe('ok');
    expect(typeof body.timestamp).toBe('string');
  });
});

describe('home page', () => {
  it('renders the discovery landing without Supabase credentials', () => {
    const html = renderToString(<HomePage />);
    expect(html).toContain('Composable Floor');
    expect(html).toContain('Restaurants');
    expect(html).toContain('Loading restaurants');
    expect(html).not.toContain('Design tokens');
  });
});

describe('project configuration', () => {
  it('declares all required npm scripts', () => {
    const packageJson = JSON.parse(readRootFile('package.json')) as {
      scripts: Record<string, string>;
    };
    const requiredScripts = [
      'dev',
      'build',
      'start',
      'typecheck',
      'test',
      'test:watch',
      'lint',
      'format:check',
      'security:scan',
    ];
    for (const script of requiredScripts) {
      expect(packageJson.scripts, `package.json should define "${script}"`).toHaveProperty(script);
    }
  });

  it('declares the required Supabase environment variables as empty placeholders', () => {
    const envExample = readRootFile('.env.example');
    const requiredVariables = [
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      'SUPABASE_SECRET_KEY',
    ];
    for (const name of requiredVariables) {
      expect(envExample, `.env.example should declare ${name}`).toContain(`${name}=`);
    }
  });
});
