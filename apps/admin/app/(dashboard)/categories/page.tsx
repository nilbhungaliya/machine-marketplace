import ModulePlaceholder from '@/components/module-placeholder';

export default function Page() {
  return (
    <ModulePlaceholder
      title="Categories & machine types"
      description="Machine categories, machine types and part subcategories (scope A4)"
      scope={[
        "Tree editor: machine category → machine type → part subcategory",
        "Reorder, rename, hide; changes need no app release",
      ]}
    />
  );
}
