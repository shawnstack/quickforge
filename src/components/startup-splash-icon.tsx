// Shared startup bolt icon: drawn by the StartupSplash and the migration
// progress view with the same animation classes defined in index.css.
export function StartupSplashIcon() {
  return (
    <svg className="quickforge-startup-splash-icon" viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="startupIconStroke" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#9ca3af" />
          <stop offset="1" stopColor="#4b5563" />
        </linearGradient>
        <linearGradient id="startupIconBolt" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#374151" />
          <stop offset="1" stopColor="#0f172a" />
        </linearGradient>
      </defs>
      <polygon className="quickforge-startup-splash-outline" points="32,6 52.78,18 52.78,42 32,54 11.22,42 11.22,18" fill="none" stroke="url(#startupIconStroke)" strokeWidth="4.5" strokeLinejoin="round" />
      <polygon className="quickforge-startup-splash-outline-final" points="32,6 52.78,18 52.78,42 32,54 11.22,42 11.22,18" fill="none" stroke="url(#startupIconStroke)" strokeWidth="4.5" strokeLinejoin="round" />
      <path className="quickforge-startup-splash-bolt" d="M37.2 13 L22 34 L30.6 34 L26.8 50 L42.8 26 L33.8 26 Z" fill="url(#startupIconBolt)" />
      <path className="quickforge-startup-splash-bolt-trace" d="M37.2 13 L22 34 L30.6 34 L26.8 50 L42.8 26 L33.8 26 Z" fill="none" stroke="#f8fafc" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path className="quickforge-startup-splash-bolt-highlight" d="M37.2 13 L22 34 L30.6 34 L33.8 26 Z" fill="#e5e7eb" />
    </svg>
  )
}
