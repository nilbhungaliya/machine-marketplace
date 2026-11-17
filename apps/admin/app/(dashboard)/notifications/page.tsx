import ModulePlaceholder from '@/components/module-placeholder';

export default function Page() {
  return (
    <ModulePlaceholder
      title="Notifications"
      description="Notification templates and broadcasts (scope F9)"
      scope={[
        "Templates for enquiry, message, offer, part match, booking, listing and deal events",
        "Broadcast to a segment",
      ]}
    />
  );
}
