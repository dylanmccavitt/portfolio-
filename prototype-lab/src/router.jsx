export function navigate(path) {
  if (window.location.pathname === path) return;
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function Link({ href, children, className = "", ...props }) {
  const local = href.startsWith("/");
  return (
    <a
      href={href}
      className={className}
      onClick={
        local
          ? (event) => {
              event.preventDefault();
              navigate(href);
            }
          : undefined
      }
      {...props}
    >
      {children}
    </a>
  );
}
