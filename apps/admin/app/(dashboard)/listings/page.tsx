import ModulePlaceholder from '@/components/module-placeholder';

export default function Page() {
  return (
    <ModulePlaceholder
      title="Parts & machinery"
      description="All listings across every status (scope A3)"
      scope={[
        "Filter by kind (part / machine / rental), status, category, brand, condition, side, city",
        "Edit / hide / remove listings",
        "Monitor sold / unavailable listings",
      ]}
    />
  );
}
