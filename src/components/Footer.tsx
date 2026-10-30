/** Legal and project links, shown under every screen. Relative links: the app lives in a sub-folder on GitHub Pages. */
export function Footer({ className = 'site-footer' }: { className?: string }) {
  return (
    <footer className={className}>
      <a href="#about">About</a>
      <a href="terms.html">Terms of Service</a>
      <a href="https://https://github.com/codernwo/OpeningTrainer" target="_blank" rel="noreferrer">
        Source code (GPL-3.0)
      </a>
    </footer>
  );
}
