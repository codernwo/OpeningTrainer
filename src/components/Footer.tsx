/** Legal and project links, shown under every screen. Relative links: the app lives in a sub-folder on GitHub Pages. */
export function Footer({ className = 'site-footer' }: { className?: string }) {
  return (
    <footer className={className}>
      <a href="#about">About</a>
      <a href="privacy.html">Privacy Policy</a>
      <a href="terms.html">Terms of Service</a>
    </footer>
  );
}
