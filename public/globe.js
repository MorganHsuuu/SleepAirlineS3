/* Natural Earth country outlines are stored locally in countries.geojson. */
(function () {
  'use strict';

  const canvas = document.getElementById('globe-canvas');
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const cx = width / 2;
  const cy = 467;
  const radius = 287;
  const globe = { type: 'Sphere' };
  const graticule = d3.geoGraticule10();
  let countries = null;
  let frameId = null;

  const ready = fetch('countries.geojson')
    .then((response) => {
      if (!response.ok) throw new Error('Country outlines could not be loaded');
      return response.json();
    })
    .then((data) => { countries = data; return true; })
    .catch(() => false);

  const ease = (t) => t * t * (3 - 2 * t);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const at = (point) => [point.lon, point.lat];

  function pathFor(projection) {
    return d3.geoPath(projection, ctx);
  }

  function drawDot(projection, focus, point, label, alpha, side) {
    if (d3.geoDistance(focus, at(point)) >= Math.PI / 2) return;
    const xy = projection(at(point));
    if (!xy || alpha <= 0) return;
    const [x, y] = xy;
    if (x < -35 || x > width + 35 || y < -35 || y > height + 35) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#f5e3bd';
    ctx.shadowColor = '#f5d99e';
    ctx.shadowBlur = 19;
    ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,239,205,.75)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.stroke();
    ctx.font = '600 19px DM Sans, PingFang TC, sans-serif';
    ctx.textAlign = side < 0 ? 'right' : 'left';
    ctx.fillStyle = '#f9f4e9';
    ctx.fillText(label, x + side * 20, y - 15);
    ctx.restore();
  }

  function draw(from, to, progress, options = {}) {
    const zoom = options.zoom || 1;
    const routeAlpha = options.routeAlpha ?? 1;
    const interpolate = d3.geoInterpolate(at(from), at(to));
    const focus = options.focus || interpolate(Math.min(1, progress));
    const projection = d3.geoOrthographic()
      .translate([cx, cy]).scale(radius * zoom)
      .rotate([-focus[0], -focus[1]])
      .clipAngle(90).precision(.35);
    const path = pathFor(projection);

    ctx.clearRect(0, 0, width, height);
    const backdrop = ctx.createLinearGradient(0, 0, width, height);
    backdrop.addColorStop(0, '#07131f');
    backdrop.addColorStop(.5, '#10283a');
    backdrop.addColorStop(1, '#061018');
    ctx.fillStyle = backdrop;
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    for (let i = 0; i < 80; i++) {
      const x = (i * 97 + 20) % width;
      const y = (i * 53 + 11) % height;
      ctx.globalAlpha = 0.25 + ((i * 17) % 10) / 16;
      ctx.fillStyle = i % 4 === 0 ? '#f8e7c0' : '#d7f3ee';
      ctx.fillRect(x, y, i % 6 === 0 ? 2.2 : 1.2, i % 6 === 0 ? 2.2 : 1.2);
    }
    ctx.restore();

    ctx.save();
    ctx.shadowColor = 'rgba(107,178,177,.42)';
    ctx.shadowBlur = zoom <= 1.3 ? 52 : 0;
    ctx.beginPath(); path(globe);
    ctx.fillStyle = '#19475a'; ctx.fill();
    ctx.restore();

    ctx.beginPath(); path(globe);
    const ocean = ctx.createRadialGradient(cx - radius * zoom * .3, cy - radius * zoom * .37, radius * zoom * .07, cx, cy, radius * zoom * 1.13);
    ocean.addColorStop(0, '#376c76');
    ocean.addColorStop(.68, '#1a4b5b');
    ocean.addColorStop(1, '#092c43');
    ctx.fillStyle = ocean; ctx.fill();

    ctx.beginPath(); path(graticule);
    ctx.strokeStyle = 'rgba(205,230,222,.18)';
    ctx.lineWidth = Math.max(.6, 1.05 * Math.sqrt(zoom));
    ctx.stroke();

    if (countries) {
      ctx.beginPath(); path(countries);
      ctx.fillStyle = '#739d94'; ctx.fill();
      ctx.strokeStyle = 'rgba(230,242,224,.72)';
      ctx.lineWidth = Math.max(.85, 1.45 / Math.sqrt(zoom));
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.beginPath(); path(countries);
      ctx.strokeStyle = 'rgba(29,75,73,.36)';
      ctx.lineWidth = Math.max(.4, .8 / Math.sqrt(zoom));
      ctx.stroke();
    }

    ctx.save();
    ctx.beginPath(); path(globe);
    ctx.strokeStyle = 'rgba(132, 230, 214, .72)';
    ctx.lineWidth = 8;
    ctx.shadowColor = 'rgba(110, 230, 210, .85)';
    ctx.shadowBlur = 26;
    ctx.stroke();
    ctx.restore();
    ctx.beginPath(); path(globe);
    ctx.strokeStyle = 'rgba(236,248,244,.7)';
    ctx.lineWidth = 2;
    ctx.stroke();

    const route = [];
    const steps = Math.max(2, Math.ceil(progress * 90));
    for (let i = 0; i <= steps; i++) route.push(interpolate(progress * i / steps));
    ctx.save();
    ctx.globalAlpha = routeAlpha;
    ctx.beginPath(); path({ type: 'LineString', coordinates: route });
    ctx.strokeStyle = 'rgba(245,218,171,.3)';
    ctx.lineWidth = 3; ctx.stroke();

    const a = projection(at(from));
    const b = projection(at(to));
    const bothVisible = d3.geoDistance(focus, at(from)) < Math.PI / 2 - .04
      && d3.geoDistance(focus, at(to)) < Math.PI / 2 - .04;
    let plane = projection(interpolate(progress));
    let planeAngle = 0;
    if (bothVisible && a && b) {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const distance = Math.hypot(dx, dy) || 1;
      const side = dx >= 0 ? -1 : 1;
      const lift = Math.max(54, Math.min(112, distance * .24));
      const control = [(a[0] + b[0]) / 2 - dy / distance * lift * 2 * side,
        (a[1] + b[1]) / 2 + dx / distance * lift * 2 * side];
      const arcPoint = (u) => [
        (1 - u) ** 2 * a[0] + 2 * (1 - u) * u * control[0] + u ** 2 * b[0],
        (1 - u) ** 2 * a[1] + 2 * (1 - u) * u * control[1] + u ** 2 * b[1],
      ];
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const point = arcPoint(progress * i / steps);
        if (i === 0) ctx.moveTo(point[0], point[1]);
        else ctx.lineTo(point[0], point[1]);
      }
      ctx.strokeStyle = 'rgba(92, 220, 255, .28)';
      ctx.lineWidth = 22; ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const point = arcPoint(progress * i / steps);
        if (i === 0) ctx.moveTo(point[0], point[1]);
        else ctx.lineTo(point[0], point[1]);
      }
      ctx.strokeStyle = '#fff4d2';
      ctx.shadowColor = '#ffd98a';
      ctx.shadowBlur = 16;
      ctx.lineWidth = 3.2;
      ctx.stroke();
      ctx.shadowBlur = 0;
      const sparkCount = 5;
      for (let s = 0; s < sparkCount; s++) {
        const u = Math.max(0, progress - s * 0.045);
        const spark = arcPoint(u);
        ctx.globalAlpha = (1 - s / sparkCount) * routeAlpha;
        ctx.fillStyle = s === 0 ? '#fffaf0' : '#7ee7ff';
        ctx.beginPath();
        ctx.arc(spark[0], spark[1], 7 - s, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = routeAlpha;
      plane = arcPoint(progress);
      const next = arcPoint(Math.min(1, progress + .01));
      planeAngle = Math.atan2(next[1] - plane[1], next[0] - plane[0]);
    }
    drawDot(projection, focus, from, from.name, Math.max(.16, 1 - progress * .62), -1);
    drawDot(projection, focus, to, to.name, Math.max(.18, progress), 1);

    if (progress < .995 && routeAlpha > .1
      && d3.geoDistance(focus, interpolate(progress)) < Math.PI / 2) {
      if (plane) {
        ctx.translate(plane[0], plane[1]); ctx.rotate(planeAngle);
        ctx.shadowColor = '#f5e2b4'; ctx.shadowBlur = 15;
        ctx.fillStyle = '#fff0cb';
        ctx.beginPath();
        ctx.moveTo(16, 0); ctx.lineTo(-11, -7); ctx.lineTo(-5, 0); ctx.lineTo(-11, 7);
        ctx.closePath(); ctx.fill();
      }
    }
    ctx.restore();

    if (zoom < 1.08 && progress < 0.04) {
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(225,239,229,.6)';
      ctx.font = '600 17px DM Sans, sans-serif';
      ctx.fillText('A QUIET JOURNEY ACROSS THE WORLD', cx, 851);
      ctx.fillStyle = '#f4f2e8';
      ctx.font = '500 27px PingFang TC, Noto Serif TC, serif';
      ctx.fillText(`${from.name}  →  ${to.name}`, cx, 894);
    }
  }

  function animate(from, to, _duration, onArrival, onPhase) {
    if (frameId) cancelAnimationFrame(frameId);
    const liftMs = 1700;
    const aboveOriginMs = 1200;
    const widenMs = 1500;
    const flyMs = 6200;
    const diveMs = 2100;
    const marks = [0, liftMs, liftMs + aboveOriginMs, liftMs + aboveOriginMs + widenMs, liftMs + aboveOriginMs + widenMs + flyMs];
    return new Promise((resolve) => {
      const start = performance.now();
      let arrived = false;
      let phase = '';
      const between = d3.geoInterpolate(at(from), at(to));
      function setPhase(name) {
        if (phase === name) return;
        phase = name;
        onPhase?.(name);
      }
      function frame(now) {
        const t = now - start;
        if (t < marks[1]) {
          setPhase('lift');
          const u = easeOut(Math.min(1, t / liftMs));
          draw(from, to, 0, {
            zoom: 8.4 - 5.6 * u,
            focus: at(from),
            routeAlpha: 0,
          });
          frameId = requestAnimationFrame(frame);
          return;
        }
        if (t < marks[2]) {
          setPhase('origin');
          draw(from, to, 0, {
            zoom: 2.8,
            focus: at(from),
            routeAlpha: 0,
          });
          frameId = requestAnimationFrame(frame);
          return;
        }
        if (t < marks[3]) {
          setPhase('globe');
          const u = ease(Math.min(1, (t - marks[2]) / widenMs));
          draw(from, to, 0, {
            zoom: 2.8 - 2.34 * u,
            focus: between(u * 0.5),
            routeAlpha: 0,
          });
          frameId = requestAnimationFrame(frame);
          return;
        }
        if (t < marks[4]) {
          setPhase('fly');
          const u = ease(Math.min(1, (t - marks[3]) / flyMs));
          draw(from, to, u, {
            zoom: 0.46,
            focus: between(u),
            routeAlpha: 1,
          });
          frameId = requestAnimationFrame(frame);
          return;
        }
        if (!arrived) {
          arrived = true;
          setPhase('dive');
          onArrival?.();
        }
        const u = Math.min(1, (t - marks[4]) / diveMs);
        const eased = easeOut(u);
        draw(from, to, 1, {
          zoom: 0.46 + 8.2 * eased,
          focus: at(to),
          routeAlpha: 1 - eased,
        });
        if (u < 1) frameId = requestAnimationFrame(frame);
        else { frameId = null; resolve(); }
      }
      frameId = requestAnimationFrame(frame);
    });
  }

  window.FlightGlobe = { ready, draw, animate };
})();
