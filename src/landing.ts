export function renderLandingPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:,">
<title>Instapod</title>
<style>
:root {
  --bg: #0f1117;
  --surface: #1a1d27;
  --surface2: #242837;
  --border: #2e3348;
  --text: #e1e4ed;
  --text2: #8b90a5;
  --accent: #6c63ff;
  --accent2: #8b83ff;
  --focus: rgba(139, 131, 255, 0.38);
  --font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: var(--font);
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  min-height: 100svh;
}
.page {
  min-height: 100vh;
  min-height: 100svh;
  display: grid;
  grid-template-rows: auto 1fr;
}
.topbar {
  width: min(100%, 1040px);
  margin: 0 auto;
  padding: 22px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.brand {
  color: var(--text);
  font-size: 1rem;
  font-weight: 700;
  text-decoration: none;
}
.github-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  min-height: 38px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text);
  font-size: 0.88rem;
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}
.github-badge:hover {
  background: var(--surface2);
  border-color: var(--accent2);
}
.github-icon {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
}
.main {
  width: min(100%, 1040px);
  margin: 0 auto;
  padding: 72px 20px 96px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.intro {
  width: min(100%, 620px);
  text-align: center;
}
.eyebrow {
  color: var(--accent2);
  font-size: 0.78rem;
  font-weight: 700;
  margin-bottom: 16px;
  text-transform: uppercase;
}
h1 {
  font-size: 4rem;
  line-height: 1.02;
  font-weight: 700;
  margin-bottom: 20px;
}
.summary {
  color: var(--text2);
  font-size: 1.1rem;
  line-height: 1.65;
  margin: 0 auto;
  max-width: 560px;
}
.actions {
  margin-top: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.primary-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 148px;
  min-height: 46px;
  padding: 0 18px;
  border-radius: 10px;
  background: linear-gradient(135deg, var(--accent), var(--accent2));
  color: #fff;
  font-size: 0.95rem;
  font-weight: 700;
  text-decoration: none;
  transition: box-shadow 0.15s ease, transform 0.15s ease;
}
.primary-action:hover {
  box-shadow: 0 6px 22px rgba(108, 99, 255, 0.28);
  transform: translateY(-1px);
}
a:focus-visible {
  outline: 3px solid var(--focus);
  outline-offset: 3px;
}
@media (max-width: 560px) {
  .topbar {
    padding: 18px 16px;
  }
  .github-badge {
    width: 36px;
    min-height: 36px;
  }
  .main {
    padding: 56px 16px 80px;
    align-items: start;
  }
  h1 {
    font-size: 2.2rem;
  }
  .summary {
    font-size: 1rem;
    line-height: 1.55;
  }
}
@media (min-width: 561px) and (max-width: 800px) {
  h1 {
    font-size: 3rem;
  }
}
</style>
</head>
<body>
<div class="page">
  <nav class="topbar" aria-label="Primary">
    <a class="brand" href="/" aria-label="Instapod home">Instapod</a>
    <a class="github-badge" href="https://github.com/jnordlund/instapod" target="_blank" rel="noreferrer" aria-label="GitHub repository" title="GitHub repository">
      <svg class="github-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M8 0C3.58 0 0 3.67 0 8.2c0 3.62 2.29 6.69 5.47 7.78.4.08.55-.18.55-.4 0-.2-.01-.86-.01-1.56-2.01.38-2.53-.5-2.69-.96-.09-.24-.48-.96-.82-1.15-.28-.16-.68-.55-.01-.56.63-.01 1.08.59 1.23.84.72 1.24 1.87.89 2.33.68.07-.53.28-.89.51-1.1-1.78-.21-3.64-.91-3.64-4.05 0-.9.31-1.63.82-2.2-.08-.21-.36-1.04.08-2.17 0 0 .67-.22 2.2.84A7.43 7.43 0 0 1 8 3.91c.68 0 1.36.09 2 .28 1.53-1.06 2.2-.84 2.2-.84.44 1.13.16 1.96.08 2.17.51.57.82 1.3.82 2.2 0 3.15-1.87 3.84-3.65 4.05.29.26.54.76.54 1.53 0 1.1-.01 1.99-.01 2.27 0 .22.15.48.55.4A8.16 8.16 0 0 0 16 8.2C16 3.67 12.42 0 8 0Z"/>
      </svg>
    </a>
  </nav>
  <main class="main">
    <section class="intro" aria-labelledby="landing-title">
      <p class="eyebrow">Private podcast automation</p>
      <h1 id="landing-title">Your private article-to-audio workspace.</h1>
      <p class="summary">Instapod turns saved Instapaper reads into translated audio episodes and a private podcast feed.</p>
      <div class="actions">
        <a class="primary-action" href="/admin">Open admin</a>
      </div>
    </section>
  </main>
</div>
</body>
</html>`;
}
