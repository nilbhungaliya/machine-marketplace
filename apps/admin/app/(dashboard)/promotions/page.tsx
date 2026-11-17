import ModulePlaceholder from '@/components/module-placeholder';

export default function Page() {
  return (
    <ModulePlaceholder
      title="Featured & promotions"
      description="Featured / promotional listings, once monetisation is enabled (scope A6)"
      scope={[
        "Feature a listing for a period",
        "Home banners and promotional slots",
      ]}
    />
  );
}
