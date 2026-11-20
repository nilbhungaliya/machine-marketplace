'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import type { AdminListingDetail } from '@mpm/shared-types';
import { ListingReview } from '@/components/listings/listing-review';
import { ListingRentalBlock } from '@/components/rentals/listing-rental-block';
import { PageHeader } from '@/components/ui/page-header';
import { useBackTarget } from '@/lib/back-link';
import { formatRef } from '@/lib/listings-api';

/**
 * One listing (F2 spec §11.2, §11.4): the review screen Listing moderation uses, opened from Parts & machinery. A rental
 * listing also shows its bookings and the owner's calendar blocks (M14 §15), from the same detail.
 */
export default function ListingPage() {
  const { id } = useParams<{ id: string }>();
  const back = useBackTarget({ href: '/listings/', label: 'Parts & machinery' });
  const [heading, setHeading] = useState<{ title: string; ref: string } | null>(null);
  const [rental, setRental] = useState<AdminListingDetail['rental']>(null);

  return (
    <div>
      <PageHeader
        back={back}
        trail={[heading ? heading.ref : 'Listing']}
        title={heading?.title ?? 'Listing'}
        description={heading ? `Reference ${heading.ref}` : undefined}
      />
      <ListingReview
        id={id}
        from={{ href: `/listings/${id}/`, label: heading?.title ?? 'Listing' }}
        onLoaded={(d) => {
          setHeading((h) => (
            h?.title === d.listing.title && h.ref === formatRef(d.listing.ref) ? h : { title: d.listing.title, ref: formatRef(d.listing.ref) }
          ));
          setRental(d.listing.id === id ? d.rental : null);
        }}
      />
      {rental && <ListingRentalBlock listingId={id} rental={rental} />}
    </div>
  );
}
