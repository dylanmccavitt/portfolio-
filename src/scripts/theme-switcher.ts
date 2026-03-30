const STORAGE_KEY = "portfolio-theme";
const VALID_THEMES = [
  "nord",
  "dracula",
  "rose-pine",
  "gruvbox",
  "everforest",
  "night-owl",
  "dark-plus",
];

function getTheme(): string {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored && VALID_THEMES.includes(stored) ? stored : "nord";
}

function setTheme(themeId: string): void {
  document.documentElement.setAttribute("data-theme", themeId);
  localStorage.setItem(STORAGE_KEY, themeId);
  updateActiveStates(themeId);
}

function updateActiveStates(themeId: string): void {
  const items = document.querySelectorAll<HTMLElement>(
    ".palette-nav__dropdown-item",
  );
  items.forEach((item) => {
    item.setAttribute("data-active", String(item.dataset.themeId === themeId));
  });
}

function initThemeSwitcher(): void {
  const toggle = document.getElementById("theme-toggle");
  const dropdown = document.getElementById("theme-dropdown");
  if (!toggle || !dropdown) return;

  const currentTheme = getTheme();
  updateActiveStates(currentTheme);

  // Toggle dropdown
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!isOpen));
    dropdown.hidden = isOpen;
  });

  // Theme selection
  dropdown.addEventListener("click", (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>(
      ".palette-nav__dropdown-item",
    );
    if (!item?.dataset.themeId) return;
    setTheme(item.dataset.themeId);
    toggle.setAttribute("aria-expanded", "false");
    dropdown.hidden = true;
  });

  // Close on outside click
  document.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest(".palette-nav__wrapper")) {
      toggle.setAttribute("aria-expanded", "false");
      dropdown.hidden = true;
    }
  });

  // Close on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !dropdown.hidden) {
      toggle.setAttribute("aria-expanded", "false");
      dropdown.hidden = true;
      toggle.focus();
    }
  });
}

initThemeSwitcher();
