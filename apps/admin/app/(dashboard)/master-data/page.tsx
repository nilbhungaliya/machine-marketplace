import ModulePlaceholder from '@/components/module-placeholder';

export default function Page() {
  return (
    <ModulePlaceholder
      title="Master data"
      description="Units, condition types and Left / Right / Pair options (scope A4)"
      scope={[
        "Units (pcs, set, pair, kg, …)",
        "Condition types (New, Used, Unused, Excess)",
        "Left / Right / Pair options and which categories use them",
      ]}
    />
  );
}
