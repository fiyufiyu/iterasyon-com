// ── Year ─────────────────────────────────────────
const yr = document.getElementById("yr");
if (yr) yr.textContent = new Date().getFullYear();

// ── Orb canvas ───────────────────────────────────
(function () {
  const canvas = document.getElementById("orb");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  let W, H, mouse = { x: 0.5, y: 0.5 };
  let target = { x: 0.5, y: 0.5 };
  let current = { x: 0.5, y: 0.5 };
  let raf;

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  window.addEventListener("resize", resize);
  resize();

  window.addEventListener("mousemove", (e) => {
    target.x = e.clientX / W;
    target.y = e.clientY / H;
  });

  // touch support
  window.addEventListener("touchmove", (e) => {
    const t = e.touches[0];
    target.x = t.clientX / W;
    target.y = t.clientY / H;
  }, { passive: true });

  function lerp(a, b, t) { return a + (b - a) * t; }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // smooth follow
    current.x = lerp(current.x, target.x, 0.04);
    current.y = lerp(current.y, target.y, 0.04);

    const cx = current.x * W;
    const cy = current.y * H;
    const r  = Math.min(W, H) * 0.65;

    // Outer soft glow — gold
    const g1 = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g1.addColorStop(0,   "rgba(201,169,110,.13)");
    g1.addColorStop(0.4, "rgba(180,140,80,.05)");
    g1.addColorStop(1,   "transparent");
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, W, H);

    // Inner core — cool tint
    const r2 = Math.min(W, H) * 0.28;
    const g2 = ctx.createRadialGradient(cx, cy, 0, cx, cy, r2);
    g2.addColorStop(0,   "rgba(160,180,255,.11)");
    g2.addColorStop(0.5, "rgba(120,150,240,.04)");
    g2.addColorStop(1,   "transparent");
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, W, H);

    raf = requestAnimationFrame(draw);
  }

  draw();
})();
