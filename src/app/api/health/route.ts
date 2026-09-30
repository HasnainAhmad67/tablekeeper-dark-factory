import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'composable-floor',
    timestamp: new Date().toISOString(),
  });
}
