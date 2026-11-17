import ModulePlaceholder from '@/components/module-placeholder';

export default function Page() {
  return (
    <ModulePlaceholder
      title="Users & businesses"
      description="Every registered user and business (scope A2)"
      scope={[
        "Search and filter businesses by city, industrial area, verification",
        "Business detail: GST, location, listings, activity and deal history",
        "Suspend / block users; manage reported users",
      ]}
    />
  );
}
