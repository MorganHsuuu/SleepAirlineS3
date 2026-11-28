window.ExtendedGlobe = function (select) {
  const canvas = document.querySelector('#earth');
  const world = canvas.parentElement;
  const ctx = canvas.getContext('2d');
  const pins = document.querySelector('#pins');
  const note = document.querySelector('#map-note');
  const projection = d3.geoOrthographic().clipAngle(90).precision(.55);
  const path = d3.geoPath(projection, ctx);
  const sphere = { type: 'Sphere' };
  const grid = d3.geoGraticule().step([15, 15])();
  const home = [121.5654, 25.033];
  const start = [-93, -29];
  let rotation = start.slice();
  let countries, features, selected, drag, frame, animation;
  let stations = [], elements = new Map(), zoom = 1;
  let width = 1, height = 1, ratio = 1;
  let edgeFade = '';

  // The bundled Natural Earth GeoJSON uses RFC 7946 winding. D3 expects the reverse.
  fetch('../countries.geojson').then((r) => {
    if (!r.ok) throw new Error('map');
    return r.json();
  }).then((data) => {
    features = data.features.filter((f) => f.geometry).map((f) => {
      const g = f.geometry;
      if (d3.geoArea(f) > 2 * Math.PI) {
        for (const p of (g.type === 'Polygon' ? [g.coordinates] : g.coordinates)) {
          for (const ring of p) ring.reverse();
        }
      }
      return f;
    });
    countries = { type:'FeatureCollection', features };
    request();
  }).catch(() => {});

  function request() {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; draw(); });
  }
  function shape(feature, fill, stroke, lineWidth = 1) {
    ctx.beginPath();
    path(feature);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke(); }
  }
  function softenVerticalEdges(radius, centerY) {
    const depth = Math.min(76, height * .18);
    const feather = (clearance) => {
      // Leave the full globe intact and feather in as it approaches the viewport edge.
      const amount = Math.max(0, Math.min(1, (8 - clearance) / (height * .12)));
      return Math.round(depth * amount * amount * (3 - 2 * amount));
    };
    const top = feather(centerY - radius);
    const bottom = feather(height - centerY - radius);
    const key = top + ':' + bottom;
    if (key === edgeFade) return;
    edgeFade = key;
    world.style.setProperty('--earth-fade-top', top + 'px');
    world.style.setProperty('--earth-fade-bottom', bottom + 'px');
  }
  function draw() {
    const x = width / 2, y = height / 2 + 1;
    const r = Math.max(1, Math.min(width * .402, height * .45) * zoom);
    softenVerticalEdges(r, y);
    projection.scale(r).translate([x,y]).rotate(rotation);
    ctx.setTransform(ratio,0,0,ratio,0,0);
    ctx.clearRect(0,0,width,height);
    const night = document.body.dataset.theme === 'night';
    // Subtle seed-fixed stars behind the sphere.
    for (let i=0;i<112;i++) {
      const sx=(i*167+17)%Math.max(1,width), sy=(i*79+9)%Math.max(1,height);
      ctx.fillStyle = night ? (i%9===0?'#f2dcffbf':'#d5c8fa48') : (i%9===0?'#ffffffea':'#fff9');
      ctx.fillRect(sx,sy,i%9===0?1.5:1,i%9===0?1.5:1);
    }
    ctx.save();
    ctx.shadowColor=night?'#a48ce291':'#9f91d883';ctx.shadowBlur=37;
    shape(sphere,night?'#333256':'#becbf0',night?'#e3d2ff70':'#ffffff91');
    ctx.restore();

    const light = ctx.createRadialGradient(x-r*.35,y-r*.39,r*.06,x,y,r*1.13);
    light.addColorStop(0,night?'#565886':'#f2f4ff'); light.addColorStop(.62,night?'#323b63':'#c9dbfa'); light.addColorStop(1,night?'#1b2448':'#a9b7e0');
    shape(sphere,light);
    const terrain = ctx.createLinearGradient(x-r,y-r,x+r,y+r);
    terrain.addColorStop(0,night?'#aaa1d0':'#fffaff');terrain.addColorStop(.52,night?'#777bab':'#f2eeff');terrain.addColorStop(1,night?'#515580':'#cbc9ef');
    if (countries) shape(countries,terrain);
    if (features) {
      ctx.beginPath();
      for (const feature of features) path(feature);
      ctx.lineWidth=.65;ctx.strokeStyle=night?'#ddd0ff45':'#8276ac54';ctx.stroke();
    }
    shape(grid,null,night?'#e6d9ff3d':'#756db03b',.64);

    const shade=ctx.createLinearGradient(x-r,y-r,x+r*.9,y+r*.9);
    shade.addColorStop(0,night?'#ffe1ff29':'#ffffff8c');shade.addColorStop(.48,'#fff0');shade.addColorStop(.8,night?'#140c2840':'#eaa1bf18');shade.addColorStop(1,night?'#22183d80':'#65509443');
    shape(sphere,shade,night?'#e0d0ff8a':'#ffffffdc',1.25);

    const center=projection.invert([x,y]);
    const show = (coord) => center && d3.geoDistance(center,coord) < 1.54;
    ctx.setLineDash([3,5]);
    for (const stop of stations) {
      const coord=[stop.lon,stop.lat];
      if (!stop.origin) continue;
      const active=stop.id===selected;
      shape({ type:'LineString', coordinates:[stop.origin,coord] },null,active?(night?'#f7c0ab':'#a65888'):(night?'#c6b6f0':'#7867a5'),active?1.4:.95);
    }
    ctx.setLineDash([]);
    if (stations.some((stop) => stop.origin?.[0]===home[0] && stop.origin?.[1]===home[1]) && show(home)) {
      const point=projection(home);
      ctx.beginPath();ctx.arc(...point,3,0,Math.PI*2);ctx.fillStyle=night?'#f5e2ffd0':'#7562b5';ctx.fill();
    }
    note.hidden = true;
    for (const stop of stations) {
      const node=elements.get(stop.id);
      const coord=[stop.lon,stop.lat], [px,py]=projection(coord);
      node.hidden = !show(coord) || px<0 || px>width-18 || py<12 || py>height-16;
      const active=stop.id===selected;
      node.classList.toggle('selected',active);
      node.setAttribute('aria-pressed',String(active));
      node.style.left=px+'px';node.style.top=py+'px';
      if (active && !node.hidden && stop.story && py > 76) {
        note.hidden=false;
        const bounds=note.getBoundingClientRect();
        note.style.left=Math.max(4,Math.min(px-15,width-bounds.width-4))+'px';
        note.style.top=Math.max(2,py-bounds.height-17)+'px';
      }
    }
  }
  function resize() {
    const rect=canvas.getBoundingClientRect();
    width=Math.max(1,Math.round(rect.width)); height=Math.max(1,Math.round(rect.height));
    ratio=Math.min(2,window.devicePixelRatio||1);
    canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);
    request();
  }
  new ResizeObserver(resize).observe(canvas);
  canvas.addEventListener('pointerdown',(event) => {
    if (drag || event.button!==0) return;
    cancelAnimationFrame(animation);
    drag={ id:event.pointerId, x:event.clientX, y:event.clientY };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove',(event) => {
    if (drag?.id!==event.pointerId) return;
    const deltaX=event.clientX-drag.x, deltaY=event.clientY-drag.y;
    rotation=[rotation[0]+deltaX*.31/zoom,Math.max(-83,Math.min(83,rotation[1]-deltaY*.31/zoom))];
    Object.assign(drag,{ x:event.clientX, y:event.clientY });
    request();
  });
  for (const name of ['pointerup','pointercancel','lostpointercapture']) {
    canvas.addEventListener(name,(event) => { if (drag?.id===event.pointerId) drag=null; });
  }
  function focus(point) {
    cancelAnimationFrame(animation);
    const nearLon=rotation[0]+((((point[0]-rotation[0]+180)%360)+360)%360-180);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      rotation=[nearLon,point[1]];request();return;
    }
    const [a,b]=rotation, now=performance.now();
    function next(at) {
      const f=Math.min(1,(at-now)/540), k=1-(1-f)**3;
      rotation=[a+(nearLon-a)*k,b+(point[1]-b)*k];request();
      if (f<1) animation=requestAnimationFrame(next);
    }
    animation=requestAnimationFrame(next);
  }
  document.querySelectorAll('[data-globe]').forEach((button) => button.addEventListener('click',() => {
    const action=button.dataset.globe;
    if (action==='reset') { zoom=1;focus(start); }
    else { zoom=Math.min(1.6,Math.max(.77,zoom*(action==='in'?1.14:1/1.14)));request(); }
  }));
  note.addEventListener('click',() => select(selected,false,true));
  return {
    repaint: request,
    set(data,id) {
      stations=data;
      selected=id;
      for (const [key,node] of elements) {
        if (!data.some((s) => s.id===key)) { node.remove();elements.delete(key); }
      }
      for (const stop of data) {
        if (!elements.has(stop.id)) {
          const button=document.createElement('button');
          button.type='button';button.className='pin';
          const dot=document.createElement('span');dot.className='pin-dot';
          button.append(dot,document.createElement('span'));
          button.addEventListener('click',() => select(stop.id,false,true));
          pins.append(button);elements.set(stop.id,button);
        }
        const node=elements.get(stop.id);
        node.lastChild.textContent=stop.name;
        node.setAttribute('aria-label',stop.name+'，'+stop.member+'的近況');
      }
      const stop=data.find((s) => s.id===id);
      if (stop?.story) {
        const label=document.createElement('small');
        label.textContent=stop.name+' · 旅程訊息';
        const snippet=Array.from(stop.story.text);
        note.replaceChildren(label,document.createTextNode(snippet.slice(0,42).join('')+(snippet.length>42?'…':'')));
      }
      request();
    },
    focus(stop) { focus([-stop.lon,-Math.max(-67,Math.min(67,stop.lat))]); }
  };
};
