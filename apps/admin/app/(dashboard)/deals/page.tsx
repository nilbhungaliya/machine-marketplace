import ModulePlaceholder from '@/components/module-placeholder';

export default function Page() {
  return (
    <ModulePlaceholder
      title="Deals"
      description="Agreed, completed and cancelled deals (scope A5, F7)"
      scope={[
        "Deal status, agreed price and quantity",
        "Completed / sold transactions",
        "Handle disputes when required",
      ]}
    />
  );
}
