import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicationDeliveryStatus } from '@/components/editorial/EditorialDetailSheet';
import { AUTOPUBLISH_STAGE_LABELS } from '@/hooks/useAutopublishStatus';

const state = vi.hoisted(() => ({ stage: 'cancelled', retry: vi.fn() }));
vi.mock('@/hooks/useAutopublishStatus', async importOriginal => {
  const original = await importOriginal<typeof import('@/hooks/useAutopublishStatus')>();
  return { ...original, useAutopublishStatus: () => ({ data: {
    stage: state.stage, attempts: 1, last_error: 'Cancelada antes do envio; histórico preservado.',
  } }), retryAutopublish: state.retry };
});
vi.mock('@tanstack/react-query', async importOriginal => {
  const original = await importOriginal<typeof import('@tanstack/react-query')>();
  return { ...original, useQueryClient: () => ({ invalidateQueries: vi.fn() }) };
});
afterEach(cleanup);
beforeEach(() => { state.stage = 'cancelled'; vi.clearAllMocks(); });

describe('publication delivery status', () => {
  it('cancellation is terminal and cannot be retried from the progress indicator', () => {
    const { container } = render(<PublicationDeliveryStatus publicationId="synthetic" />);
    expect(screen.getByText(AUTOPUBLISH_STAGE_LABELS.cancelled)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).toBeNull();
    expect(container.querySelector('.animate-spin')).toBeNull();
    expect(state.retry).not.toHaveBeenCalled();
  });
  it('new preparation remains visible and in progress', () => {
    state.stage = 'sign';
    const { container } = render(<PublicationDeliveryStatus publicationId="synthetic" />);
    expect(screen.getByText(AUTOPUBLISH_STAGE_LABELS.sign)).toBeTruthy();
    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });
});
