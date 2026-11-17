import ModulePlaceholder from '@/components/module-placeholder';

export default function Page() {
  return (
    <ModulePlaceholder
      title="Business verification"
      description="GST and business verification requests (scope A2)"
      scope={[
        "Pending GST / business verification requests",
        "View GST and business details and documents",
        "Approve / reject verification with a reason",
      ]}
    />
  );
}
