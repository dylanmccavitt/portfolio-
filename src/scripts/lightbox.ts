function initLightbox(): void {
  document.addEventListener("click", (e) => {
    const img = (e.target as HTMLElement).closest<HTMLImageElement>(
      ".project-content img, .screenshot-grid img",
    );
    if (!img) return;

    const overlay = document.createElement("div");
    overlay.className = "lightbox";

    const fullImg = document.createElement("img");
    fullImg.src = img.src;
    fullImg.alt = img.alt;
    overlay.appendChild(fullImg);

    overlay.addEventListener("click", (ev) => {
      if (ev.target !== fullImg) overlay.remove();
    });

    document.addEventListener(
      "keydown",
      (ev) => {
        if (ev.key === "Escape") overlay.remove();
      },
      { once: true },
    );

    document.body.appendChild(overlay);
  });
}

function initCaptions(): void {
  document
    .querySelectorAll<HTMLImageElement>(
      ".project-content img, .screenshot-strip img",
    )
    .forEach((img) => {
      if (!img.alt) return;
      const wrapper = document.createElement("figure");
      wrapper.className = "img-caption";
      img.parentNode!.insertBefore(wrapper, img);
      wrapper.appendChild(img);
      const caption = document.createElement("figcaption");
      caption.className = "img-caption__text";
      caption.textContent = img.alt;
      wrapper.appendChild(caption);
    });
}

initLightbox();
initCaptions();
