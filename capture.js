// Scroll real content, then stitch only the previously unseen pixels.
// Works in the extension worker, without an offscreen document or remote service.
globalThis.captureLongPage = async function ({ step, wait, check, shot, progress }) {
  const first = await step("prepareCapture");
  const outputHeight = first.documentScroll ? first.total : first.viewportHeight + first.total - first.height;
  const scale = first.dpr;
  const width = Math.round(first.viewportWidth * scale);
  const height = Math.round(outputHeight * scale);
  if (width <= 0 || height <= 0 || height > 60000 || width * height > 120000000)
    throw new Error("This page is too large for one PNG. Reduce browser zoom and try again.");
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create the screenshot canvas.");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, width, height);
  const px = value => Math.round(value * scale);
  let covered = 0;
  try {
    for (let tile = 0; covered < first.total; tile++) {
      check();
      if (tile > 300) throw new Error("Screenshot exceeded the scrolling limit.");
      const target = tile ? Math.min(covered - Math.min(80, first.height / 4), first.maxScroll) : 0;
      await step("scrollCapture", { top: target, subsequent: tile > 0 });
      await wait(400);
      let current = await step("capturePosition");
      // Some frameworks apply scrolling on a later animation frame or reset it
      // once after a reveal. Retry the same position; never skip missing rows.
      for (let retry = 0; retry < 4 && Math.abs(current.top - target) > 1; retry++) {
        check();
        await step("scrollCapture", { top: target, subsequent: tile > 0 });
        await wait(300);
        current = await step("capturePosition");
      }
      if (["total", "contentHeight", "width", "height", "x", "y", "viewportWidth", "viewportHeight", "dpr"].some(key => Math.abs(current[key] - first[key]) > 1))
        throw new Error("The page layout changed during capture. Stopped instead of saving an incomplete image.");
      const end = Math.min(first.total, current.top + first.height);
      if (current.top > covered + 1 || end <= covered)
        throw new Error(`Scrolling stopped at ${Math.round(current.top)}px (requested ${Math.round(target)}px, range ${Math.round(first.maxScroll)}px). No incomplete screenshot was saved.`);
      const data = await shot();
      check();
      const blob = await (await fetch(`data:image/png;base64,${data}`)).blob();
      const bitmap = await createImageBitmap(blob);
      try {
        if (Math.abs(bitmap.width - width) > 2 || Math.abs(bitmap.height - px(first.viewportHeight)) > 2)
          throw new Error("The browser viewport changed during capture. Try again without resizing the window.");
        if (!tile) {
          // Keep the header/sidebar once; extend the area below with white.
          ctx.drawImage(bitmap, 0, 0);
          ctx.fillRect(0, px(first.y + first.height), width, height - px(first.y + first.height));
        }
        const sourceY = px(first.y + covered - current.top);
        const destinationY = px(first.y + covered);
        const tileHeight = px(first.y + end) - destinationY;
        ctx.drawImage(bitmap, px(first.x), sourceY, px(first.width), tileHeight,
          px(first.x), destinationY, px(first.width), tileHeight);
        if (end >= first.total) {
          // Put any footer outside a nested scroll panel at the very bottom.
          const footerY = px(first.y + first.height);
          const footerHeight = first.documentScroll ? 0 : bitmap.height - footerY;
          if (footerHeight > 0) ctx.drawImage(bitmap, 0, footerY, width, footerHeight,
            0, px(first.y + first.total), width, footerHeight);
        }
      } finally { bitmap.close(); }
      covered = end;
      await progress(covered, first.total);
    }
    check();
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 32768)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    check();
    return `data:image/png;base64,${btoa(binary)}`;
  } finally { canvas.width = 1; canvas.height = 1; }
};
