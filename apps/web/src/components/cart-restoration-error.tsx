export function CartRestorationError({ message, conflict, retry }: {
  message: string;
  conflict?: boolean;
  retry?: () => void;
}) {
  return <section className="surface-card" role="alert">
    <h2>Your cart needs to be restored</h2>
    <p>{message}</p>
    {conflict ? <p>Using the saved cart replaces this browser&apos;s unsaved edits with the latest saved version.</p> : null}
    <button type="button" onClick={retry}>{conflict ? "Use saved cart" : "Retry restoration"}</button>
  </section>;
}
