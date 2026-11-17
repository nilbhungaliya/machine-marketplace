import ModulePlaceholder from '@/components/module-placeholder';

export default function Page() {
  return (
    <ModulePlaceholder
      title="Part requests"
      description="Buyer part requests and availability alerts (scope F8)"
      scope={[
        "Active, matched, fulfilled and closed requests",
        "Matching listings found for each request",
        "Close or remove abusive requests",
      ]}
    />
  );
}
