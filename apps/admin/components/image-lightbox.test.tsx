import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Dialog } from '@/components/ui/dialog';
import ImageLightbox from './image-lightbox';

afterEach(cleanup);

describe('ImageLightbox on the dialog stack', () => {
  it('Escape closes only the top layer', async () => {
    const closeLightbox = vi.fn();
    const closeDialog = vi.fn();
    const { rerender } = render(<ImageLightbox urls={['/a.jpg']} index={0} onIndex={() => {}} onClose={closeLightbox} />);
    rerender(
      <>
        <ImageLightbox urls={['/a.jpg']} index={0} onIndex={() => {}} onClose={closeLightbox} />
        <Dialog open onClose={closeDialog} title="Confirm" />
      </>,
    );
    await screen.findByRole('dialog', { name: 'Confirm' });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(closeDialog).toHaveBeenCalledTimes(1);
    expect(closeLightbox).not.toHaveBeenCalled();

    rerender(<ImageLightbox urls={['/a.jpg']} index={0} onIndex={() => {}} onClose={closeLightbox} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(closeLightbox).toHaveBeenCalledTimes(1);
  });
});
