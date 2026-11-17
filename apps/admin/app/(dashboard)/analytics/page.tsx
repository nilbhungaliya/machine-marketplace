import ModulePlaceholder from '@/components/module-placeholder';

export default function Page() {
  return (
    <ModulePlaceholder
      title="Activity & KPIs"
      description="Marketplace performance and activity reports (scope A1, A6)"
      scope={[
        "Listings, enquiries, offers, deals and rentals over time",
        "Breakdown by city, category and brand",
      ]}
    />
  );
}
