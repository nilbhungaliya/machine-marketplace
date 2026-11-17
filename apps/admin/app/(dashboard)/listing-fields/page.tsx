import ModulePlaceholder from '@/components/module-placeholder';

export default function Page() {
  return (
    <ModulePlaceholder
      title="Specifications & fields"
      description="Dynamic specification fields per category (scope A4)"
      scope={[
        "Field templates per category / subcategory (text, number, select, unit)",
        "Rental-related fields",
        "Seller form preview",
      ]}
    />
  );
}
