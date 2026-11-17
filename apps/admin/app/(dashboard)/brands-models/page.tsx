import ModulePlaceholder from '@/components/module-placeholder';

export default function Page() {
  return (
    <ModulePlaceholder
      title="Brands, models & compatibility"
      description="Machine brands, models and which parts fit them (scope A4)"
      scope={[
        "Brands and their models",
        "Compatibility information: part ↔ machine brand / model",
      ]}
    />
  );
}
