import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  verifyCommitmentAccess: vi.fn(),
  getCommitmentEvents: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireUser: mocks.requireUser,
}));

vi.mock('@/lib/commitments', () => ({
  verifyCommitmentAccess: mocks.verifyCommitmentAccess,
  getCommitmentEvents: mocks.getCommitmentEvents,
}));

function makeRequest(url = 'http://localhost/api/commitments/c1/events?limit=10') {
  return new NextRequest(url);
}

const mockUser = { id: 'user-1', email: 'user@example.com' };

const baseEvents = [
  { id: 'evt_1', type: 'CREATED', timestamp: '2024-01-01T00:00:00.000Z', blockNumber: 1, transactionHash: '0xabc1' },
  { id: 'evt_2', type: 'APPROVED', timestamp: '2024-01-02T00:00:00.000Z', blockNumber: 2, transactionHash: '0xabc2' },
  { id: 'evt_3', type: 'DEPOSIT', timestamp: '2024-01-03T00:00:00.000Z', blockNumber: 3, transactionHash: '0xabc3' },
];

describe('GET /api/commitments/[id]/events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolved({ user: mockUser });
    mocks.verifyCommitmentAccess.mockResolved(true);
    mocks.getCommitmentEvents.mockResolved([]);
  });

  it('returns 401 when the user is not authenticated', async () => {
    mocks.requireUser.mockRejected(new Error('Unauthorized'));

    const res = await GET(baseRequest(), { params: { id: 'c1' } });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('returns 403 when the user lacks access', async () => {
    mocks.verifyCommitmentAccess.mockResolved(false);

    const res = await GET(baseRequest(), { params: { id: 'c1' } });
    expect(res.status).toBe(403);
  });

  it('returns 400 for an invalid id', async () => {
    const res = await GET(baseRequest(), { params: { id: 'bad' } });
    expect(res.status).toBe(400);
  });

  it('returns ordered events', async () => {
    mocks.getCommitmentEvents.mockResolved([baseEvents[2], baseEvents[0], baseEvents[1]]);
    const res = await GET(makeRequest(), { params: { id: 'c1' } });
    const body = await res.json();
    expect(body.events.map((e: any) => e.id)).toEqual(['evt_1', 'evt_2', 'evt_3']);
  });

  it('deduplicates events', async () => {
    mocks.getCommitmentEvents.mockResolved([baseEvents[0], baseEvents[1], baseEvents[0]]);
    const res = await GET(makeRequest(), { params: { id: 'c1' } });
    const body = await res.json();
    expect(body.events.map((e: any) => e.id)).toEqual(['evt_1', 'evt_2']);
  });

  it('empty list', async () => {
    const res = await GET(baseRequest(), { params: { id: 'c1' } });
    const body = await res.json();
    expect(body.events).toEqual([]);
    expect(body.nextCursor).toBe(null);
  });

  it('paginates with cursor', async () => {
    mocks.getCommitmentEvents.mockResolved([baseEvents[0], baseEvents[1], baseEvents[2], { ...baseEvents[2], id: 'evt_4', timestamp: '2024-01-04T00:00:00.000Z' }]);
    const res = await GET(request('limit=2'), { params: { id: 'c1' } });
    const body = await res.json();
    expect(body.events.length).toBe(2);
    expect(body.nextCursor).toBeTruth();
  });

  it('returns 500 on service failure', async () => {
    mocks.getCommitmentEvents.mockRejected(new Error('db'));
    const res = await GET(baseRequest(), { params: { id: 'c1' } });
    expect(res.status).toBe(500);
  });

  it('retries on transient failure', async () => {
    mocks.getCommitmentEvents.mockRejectedOnce(new Error('lag')).mockResolvedOnce([baseEvents[0]]);
    const res = await GET(baseRequest(), { params: { id: 'c1' } });
    expect(res.status).toBe(200);
    expect(mocks.getCommitmentEvents).toHaveBeenCalledTimes(2);
  });
});
