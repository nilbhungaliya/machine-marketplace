import ModulePlaceholder from '@/components/module-placeholder';

export default function Page() {
  return (
    <ModulePlaceholder
      title="Rental bookings"
      description="Machinery rental requests and bookings (scope A1, A5)"
      scope={[
        "Requested, confirmed, active and returned bookings",
        "Machinery available for rental by region",
      ]}
    />
  );
}
