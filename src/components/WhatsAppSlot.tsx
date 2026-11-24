/**
 * Renders nothing unless NEXT_PUBLIC_WHATSAPP_NUMBER is set at build time.
 * Sits on the bottom-left so it does not overlap the chat bubble on the right.
 */
export function WhatsAppSlot() {
  const raw = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return null;

  return (
    <a
      href={`https://wa.me/${digits}`}
      className="fixed bottom-5 left-5 z-40 inline-flex items-center gap-2 rounded-full bg-teal px-4 py-3 text-sm font-semibold text-white shadow-card hover:bg-teal-dark"
      target="_blank"
      rel="noopener noreferrer"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true" fill="currentColor">
        <path d="M12.04 2C6.58 2 2.15 6.4 2.15 11.83c0 1.74.46 3.44 1.34 4.94L2 22l5.39-1.41a10.1 10.1 0 0 0 4.65 1.12h.01c5.46 0 9.89-4.4 9.89-9.83C21.94 6.4 17.5 2 12.04 2zm5.76 14.18c-.24.68-1.4 1.3-1.94 1.34-.5.04-1.12.06-1.81-.11-.42-.1-.95-.3-1.64-.59-2.88-1.24-4.76-4.14-4.9-4.33-.14-.2-1.16-1.54-1.16-2.94 0-1.4.73-2.09 1-2.37.26-.28.57-.35.76-.35h.55c.17 0 .4-.07.63.48.24.57.8 1.97.87 2.11.07.15.12.32.02.51-.09.2-.14.32-.28.49-.14.17-.29.38-.42.51-.14.14-.28.29-.12.56.16.27.7 1.15 1.5 1.86 1.03.92 1.9 1.2 2.17 1.34.27.13.42.11.58-.07.16-.17.66-.77.84-1.03.18-.27.35-.22.58-.13.24.09 1.5.71 1.76.84.26.13.43.19.49.3.07.1.07.61-.17 1.29z" />
      </svg>
      WhatsApp
    </a>
  );
}
