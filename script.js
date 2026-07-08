/* ============================================================
   AEROFRAME PRO — procedural Three.js flight simulator
   ============================================================ */

(function(){
"use strict";

/* ---------------- basic setup ---------------- */
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, powerPreference:'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, window.innerWidth/window.innerHeight, 0.5, 24000);

window.addEventListener('resize', ()=>{
  camera.aspect = window.innerWidth/window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* ---------------- utility ---------------- */
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function lerp(a,b,t){ return a + (b-a)*t; }
function smoothstep(a,b,x){ const t = clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); }
function rand(a,b){ return a + Math.random()*(b-a); }
const KMH = 3.6; // m/s -> km/h

/* ---------------- terrain height field ---------------- */
const RUNWAYS = [
  { x:0,     zMin:-1000, zMax:260,  halfWidth:45, edge:220, home:true },
  { x:2700,  zMin:1500,  zMax:2050, halfWidth:45, edge:200 },
  { x:-2900, zMin:-3300, zMax:-2750,halfWidth:45, edge:200 },
  { x:-2400, zMin:1900,  zMax:2450, halfWidth:45, edge:200 }
];
const RUNWAY_HALF_WIDTH = RUNWAYS[0].halfWidth;
const RUNWAY_Z_MIN = RUNWAYS[0].zMin;
const RUNWAY_Z_MAX = RUNWAYS[0].zMax;

function flattenFactor(x,z){
  let maxF = 0;
  for(const rw of RUNWAYS){
    const dx = Math.abs(x-rw.x) - rw.halfWidth;
    let dz = 0;
    if(z < rw.zMin) dz = rw.zMin - z;
    else if(z > rw.zMax) dz = z - rw.zMax;
    const d = Math.max(dx, dz);
    const f = 1 - smoothstep(0, rw.edge, d);
    if(f > maxF) maxF = f;
  }
  return maxF;
}

function rawHeight(x,z){
  let h = 0;
  h += Math.sin(x*0.0015)*40 + Math.cos(z*0.0016)*40;
  h += Math.sin(x*0.004 + z*0.003)*14;
  h += Math.sin(x*0.011)*Math.cos(z*0.010)*8;
  const ridge = Math.max(0, Math.sin(x*0.0007+1.3)*Math.cos(z*0.0009-0.6));
  h += ridge*140;
  const ridge2 = Math.max(0, Math.sin(x*0.0004-2.1)*Math.cos(z*0.00055+1.1));
  h += ridge2*90;
  return h;
}

function heightAt(x,z){
  const f = flattenFactor(x,z);
  return rawHeight(x,z) * (1-f);
}

/* ---------------- lighting ---------------- */
const hemiLight = new THREE.HemisphereLight(0x8fd0ff, 0x2a3a2a, 0.8);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xfff2d6, 1.2);
sunLight.position.set(500,600,200);
scene.add(sunLight);

const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(60,16,16), new THREE.MeshBasicMaterial({ color:0xfff2c0 }));
scene.add(sunMesh);
const moonMesh = new THREE.Mesh(new THREE.SphereGeometry(40,16,16), new THREE.MeshBasicMaterial({ color:0xcfd8e8 }));
scene.add(moonMesh);

/* ---------------- sky dome ---------------- */
const skyUniforms = {
  topColor:{ value:new THREE.Color(0x1f6fd6) },
  bottomColor:{ value:new THREE.Color(0xbfe4ff) },
  offset:{ value:20 },
  exponent:{ value:0.6 }
};
const skyGeo = new THREE.SphereGeometry(9500, 24, 16);
const skyMat = new THREE.ShaderMaterial({
  uniforms:skyUniforms, side:THREE.BackSide, depthWrite:false,
  vertexShader:`varying vec3 vWorldPosition; void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vWorldPosition = wp.xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader:`uniform vec3 topColor; uniform vec3 bottomColor; uniform float offset; uniform float exponent; varying vec3 vWorldPosition;
    void main(){ float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y; gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h,0.0), exponent),0.0)),1.0); }`
});
const skyDome = new THREE.Mesh(skyGeo, skyMat);
scene.add(skyDome);

let fog = new THREE.FogExp2(0xbfe4ff, 0.00018);
scene.fog = fog;

/* ---------------- terrain mesh ---------------- */
const TERRAIN_SIZE = 8000;
const TERRAIN_SEG = 140;
const terrainGeo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEG, TERRAIN_SEG);
terrainGeo.rotateX(-Math.PI/2);

const colors = [];
const posAttr = terrainGeo.attributes.position;
const lowCol = new THREE.Color(0x3c6b35);
const midCol = new THREE.Color(0x6e5a3c);
const highCol = new THREE.Color(0x8a8a8a);
const snowCol = new THREE.Color(0xf4f7fa);
const runwayCol = new THREE.Color(0x565b60);

for(let i=0;i<posAttr.count;i++){
  const x = posAttr.getX(i);
  const z = posAttr.getZ(i);
  const h = heightAt(x,z);
  posAttr.setY(i,h);
  const f = flattenFactor(x,z);
  let c = new THREE.Color();
  if(h < 20) c.copy(lowCol);
  else if(h < 90) c.copy(lowCol).lerp(midCol, smoothstep(20,90,h));
  else if(h < 160) c.copy(midCol).lerp(highCol, smoothstep(90,160,h));
  else c.copy(highCol).lerp(snowCol, smoothstep(160,220,h));
  c.lerp(runwayCol, f*0.9);
  colors.push(c.r,c.g,c.b);
}
terrainGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors,3));
terrainGeo.computeVertexNormals();
const terrainMat = new THREE.MeshLambertMaterial({ vertexColors:true });
const terrain = new THREE.Mesh(terrainGeo, terrainMat);
scene.add(terrain);

/* runway markings — one full set per airport in RUNWAYS */
const runwayLights = [];
const dashMat = new THREE.MeshBasicMaterial({ color:0xffffff });
const lightMat = new THREE.MeshBasicMaterial({ color:0xfff07a });

function buildRunway(rw){
  const group = new THREE.Group();
  const surf = new THREE.Mesh(
    new THREE.PlaneGeometry(rw.halfWidth*2*0.85, rw.zMax-rw.zMin),
    new THREE.MeshLambertMaterial({ color:0x2c2c2e })
  );
  surf.rotation.x = -Math.PI/2;
  surf.position.set(rw.x, 0.3, (rw.zMax+rw.zMin)/2);
  group.add(surf);
  for(let z=rw.zMin+20; z<rw.zMax-20; z+=40){
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(2,18), dashMat);
    dash.rotation.x = -Math.PI/2;
    dash.position.set(rw.x,0.35,z);
    group.add(dash);
  }
  for(let z=rw.zMin; z<rw.zMax; z+=30){
    [-1,1].forEach(side=>{
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(1.2,6,6), lightMat.clone());
      bulb.position.set(rw.x+side*rw.halfWidth*0.9, 1, z);
      group.add(bulb);
      runwayLights.push(bulb);
    });
  }
  for(let z=rw.zMin-180; z<rw.zMin; z+=20){
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.9,6,6), new THREE.MeshBasicMaterial({color:0xff5c3c}));
    bulb.position.set(rw.x,1,z);
    group.add(bulb);
  }
  scene.add(group);
  return group;
}
RUNWAYS.forEach(buildRunway);

/* windsock (home airport) */
const windsockPole = new THREE.Mesh(new THREE.CylinderGeometry(0.15,0.15,8,6), new THREE.MeshLambertMaterial({color:0xcccccc}));
windsockPole.position.set(60, 4, -60);
scene.add(windsockPole);
const windsock = new THREE.Mesh(new THREE.ConeGeometry(1.3,5,10), new THREE.MeshLambertMaterial({color:0xff7a3c}));
windsock.rotation.z = Math.PI/2;
windsock.position.set(63, 7.5, -60);
scene.add(windsock);

/* simple airport buildings + hangars + tower (home airport) */
const buildingMat = new THREE.MeshLambertMaterial({ color:0x9aa3a8 });
const hangarMat = new THREE.MeshLambertMaterial({ color:0x6b7d8a });
function makeBuilding(x,z,w,h,d,mat){
  const b = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat);
  b.position.set(x, h/2, z);
  scene.add(b);
  return b;
}
const terminalBuilding = makeBuilding(-90, -40, 26, 14, 18, buildingMat);
makeBuilding(-95, -70, 20, 10, 14, buildingMat);
makeBuilding(90, -30, 40, 16, 22, hangarMat);
makeBuilding(-70, 10, 8,30,8, buildingMat);
const towerTop = new THREE.Mesh(new THREE.BoxGeometry(14,6,14), new THREE.MeshLambertMaterial({color:0xbcd8e0}));
towerTop.position.set(-70, 33, 10);
scene.add(towerTop);

/* ---------------- clouds ---------------- */
function makeCloudPuff(scale, opacity){
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color:0xffffff, transparent:true, opacity:opacity, depthWrite:false });
  const puffCount = 5 + Math.floor(Math.random()*4);
  for(let i=0;i<puffCount;i++){
    const geo = new THREE.IcosahedronGeometry(rand(0.6,1.2)*scale, 0);
    const m = new THREE.Mesh(geo, mat.clone());
    m.position.set(rand(-1,1)*scale*1.4, rand(-0.2,0.3)*scale, rand(-1,1)*scale*1.4);
    m.userData.baseOpacity = opacity;
    group.add(m);
  }
  return group;
}
const cloudLayers = { low:[], mid:[], high:[] };
function seedClouds(){
  [ ['low', 300, 900, 24, 40, 0.85],
    ['mid', 700, 1400, 34, 60, 0.75],
    ['high', 1600, 2000, 46, 20, 0.55]
  ].forEach(([key, altMin, altMax, scale, count, opacity])=>{
    for(let i=0;i<count;i++){
      const c = makeCloudPuff(scale, opacity);
      c.position.set(rand(-4000,4000), rand(altMin,altMax), rand(-4500,3500));
      scene.add(c);
      cloudLayers[key].push(c);
    }
  });
}
seedClouds();
function recycleClouds(planePos){
  Object.values(cloudLayers).forEach(layer=>{
    layer.forEach(c=>{
      const dx = c.position.x - planePos.x, dz = c.position.z - planePos.z;
      if(Math.sqrt(dx*dx+dz*dz) > 5200){
        const ang = Math.random()*Math.PI*2, r = rand(3000,5000);
        c.position.x = planePos.x + Math.cos(ang)*r;
        c.position.z = planePos.z + Math.sin(ang)*r;
      }
    });
  });
}
function setCloudOpacity(mult){
  Object.values(cloudLayers).forEach(layer=> layer.forEach(c=> c.children.forEach(m=>{
    m.material.opacity = mult * m.userData.baseOpacity;
  })));
}

/* ---------------- precipitation particles ---------------- */
function makePrecip(count, color, size){
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count*3);
  for(let i=0;i<count;i++){
    positions[i*3] = rand(-300,300);
    positions[i*3+1] = rand(0,220);
    positions[i*3+2] = rand(-300,300);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions,3));
  const mat = new THREE.PointsMaterial({ color, size, transparent:true, opacity:0.7, depthWrite:false });
  const pts = new THREE.Points(geo, mat);
  pts.visible = false;
  scene.add(pts);
  return pts;
}
const rainPts = makePrecip(2200, 0xaad0ff, 1.1);
const snowPts = makePrecip(1400, 0xffffff, 1.6);

function updatePrecip(dt, planePos){
  [rainPts, snowPts].forEach(pts=>{
    const arr = pts.geometry.attributes.position.array;
    const fall = pts === rainPts ? 260 : 30;
    for(let i=0;i<arr.length;i+=3){
      arr[i+1] -= fall*dt;
      if(pts === snowPts){ arr[i] += Math.sin(performance.now()*0.001 + i)*0.05; }
      if(arr[i+1] < 0){
        arr[i+1] = 220;
        arr[i] = planePos.x + rand(-300,300);
        arr[i+2] = planePos.z + rand(-300,300);
      }
    }
    pts.position.set(0,0,0);
    if(pts.visible){
      // keep centered near plane laterally without rewriting every particle each frame
      const dx = planePos.x - pts.userData.lastX || 0;
    }
    pts.userData.lastX = planePos.x;
    pts.geometry.attributes.position.needsUpdate = true;
  });
  rainPts.position.set(0,0,0);
}

/* lightning flash (storm) */
let lightningTimer = rand(2,6);
let lightningFlash = 0;

/* ---------------- birds ---------------- */
const birdMat = new THREE.MeshBasicMaterial({ color:0x2b2b2b, side:THREE.DoubleSide });
function makeBird(){
  const bird = new THREE.Group();
  const wingGeoL = new THREE.PlaneGeometry(1.4, 0.5);
  const wingL = new THREE.Mesh(wingGeoL, birdMat);
  wingL.position.set(-0.65, 0, 0);
  bird.add(wingL);
  const wingR = new THREE.Mesh(wingGeoL.clone(), birdMat);
  wingR.position.set(0.65, 0, 0);
  bird.add(wingR);
  bird.userData.wingL = wingL;
  bird.userData.wingR = wingR;
  bird.userData.flapPhase = rand(0, Math.PI*2);
  bird.userData.speed = rand(6,12);
  bird.userData.headingAngle = rand(0, Math.PI*2);
  bird.userData.circleR = rand(60,180);
  bird.userData.circleCx = 0; bird.userData.circleCz = 0;
  return bird;
}
const birds = [];
const BIRD_FLOCKS = 5, BIRDS_PER_FLOCK = 6;
for(let f=0; f<BIRD_FLOCKS; f++){
  const cx = rand(-3500,3500), cz = rand(-3500,3500), cy = rand(60,220);
  for(let i=0;i<BIRDS_PER_FLOCK;i++){
    const b = makeBird();
    b.userData.circleCx = cx + rand(-40,40);
    b.userData.circleCz = cz + rand(-40,40);
    b.position.set(cx + rand(-30,30), cy + rand(-15,15), cz + rand(-30,30));
    scene.add(b);
    birds.push(b);
  }
}
function updateBirds(dt, planePos){
  const now = performance.now()*0.001;
  birds.forEach(b=>{
    b.userData.headingAngle += (b.userData.speed/Math.max(b.userData.circleR,1))*dt;
    b.position.x = b.userData.circleCx + Math.cos(b.userData.headingAngle)*b.userData.circleR;
    b.position.z = b.userData.circleCz + Math.sin(b.userData.headingAngle)*b.userData.circleR;
    b.position.y += Math.sin(now*1.5 + b.userData.flapPhase)*0.15;
    b.rotation.y = -b.userData.headingAngle + Math.PI/2;
    const flap = Math.sin(now*10 + b.userData.flapPhase);
    b.userData.wingL.rotation.z = flap*0.6;
    b.userData.wingR.rotation.z = -flap*0.6;

    const dx = b.position.x - planePos.x, dz = b.position.z - planePos.z;
    if(Math.sqrt(dx*dx+dz*dz) > 5500){
      const ang = Math.random()*Math.PI*2, r = rand(2500,3500);
      b.userData.circleCx = planePos.x + Math.cos(ang)*r;
      b.userData.circleCz = planePos.z + Math.sin(ang)*r;
    }
  });
}

/* ---------------- aircraft definitions ---------------- */
const AIRCRAFT_TYPES = {
  prop: {
    name:'PROP TRAINER', scale:1.0, color:0xe8e8ea, accent:0xd23c3c, hasProp:true,
    maxThrust:34, dragCoef:0.010, mass:1.0, stallSpeed:26, maxSpeedKmh:280,
    engine:'prop', fuelBurn:0.55, agility:1.0
  },
  jet: {
    name:'BUSINESS JET', scale:1.3, color:0xf2f2f5, accent:0x2a5fd6, hasProp:false,
    maxThrust:98, dragCoef:0.0068, mass:1.7, stallSpeed:48, maxSpeedKmh:1050,
    engine:'jet', fuelBurn:0.9, agility:0.95
  },
  airliner: {
    name:'AIRLINER', scale:2.2, color:0xffffff, accent:0x1c4fa0, hasProp:false,
    maxThrust:150, dragCoef:0.0062, mass:3.2, stallSpeed:62, maxSpeedKmh:900,
    engine:'airliner', fuelBurn:1.4, agility:0.55
  },
  fighter: {
    name:'FIGHTER JET', scale:0.9, color:0x4a4f55, accent:0xff8c1a, hasProp:false,
    maxThrust:320, dragCoef:0.0046, mass:1.2, stallSpeed:70, maxSpeedKmh:1650,
    engine:'fighter', fuelBurn:1.9, agility:1.4
  }
};
let currentType = 'prop';

/* ---------------- aircraft builder ---------------- */
const glassMat = new THREE.MeshPhongMaterial({ color:0x2a3a44, shininess:100 });
const darkMat = new THREE.MeshPhongMaterial({ color:0x1c1c1e });

function buildAircraft(typeKey){
  const t = AIRCRAFT_TYPES[typeKey];
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshPhongMaterial({ color:t.color, shininess:60 });
  const accentMat = new THREE.MeshPhongMaterial({ color:t.accent, shininess:40 });
  const s = t.scale;

  const fuseLen = t.hasProp ? 9 : (typeKey==='airliner'?15:11);
  const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.9*s,1.3*s,fuseLen*s,12), bodyMat);
  fuselage.rotation.x = Math.PI/2;
  group.add(fuselage);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.9*s,1.6*s,12), bodyMat);
  nose.rotation.x = -Math.PI/2;
  nose.position.set(0,0,-(fuseLen/2+0.7)*s);
  group.add(nose);

  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.7*s,12,10,0,Math.PI*2,0,Math.PI/1.6), glassMat);
  canopy.position.set(0,0.75*s,-fuseLen*0.25*s);
  group.add(canopy);

  const wingSpan = typeKey==='fighter' ? 8*s : (typeKey==='airliner'? 16*s : 11*s);
  const wingSweep = typeKey==='fighter' ? 0.6 : 0;
  const wing = new THREE.Mesh(new THREE.BoxGeometry(wingSpan,0.2*s,2.1*s), accentMat);
  wing.position.set(0,-0.1*s,0.2*s);
  wing.rotation.y = wingSweep;
  group.add(wing);

  const tailWing = new THREE.Mesh(new THREE.BoxGeometry(4.2*s,0.16*s,1.1*s), accentMat);
  tailWing.position.set(0,0.15*s,(fuseLen*0.42)*s);
  group.add(tailWing);

  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.16*s,1.8*s,1.6*s), accentMat);
  fin.position.set(0,0.9*s,(fuseLen*0.42)*s);
  group.add(fin);

  let propBlades = null, propHub = null;
  if(t.hasProp){
    propHub = new THREE.Mesh(new THREE.CylinderGeometry(0.18*s,0.18*s,0.4*s,10), darkMat);
    propHub.rotation.x = Math.PI/2;
    propHub.position.set(0,0,-(fuseLen/2+1.3)*s);
    group.add(propHub);
    propBlades = new THREE.Group();
    for(let i=0;i<3;i++){
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.15*s,2.2*s,0.06*s), darkMat);
      blade.rotation.z = (i*Math.PI*2)/3;
      propBlades.add(blade);
    }
    propBlades.position.set(0,0,-(fuseLen/2+1.45)*s);
    group.add(propBlades);
  } else {
    // engine nacelles for jets
    [-1,1].forEach(side=>{
      const nac = new THREE.Mesh(new THREE.CylinderGeometry(0.5*s,0.55*s,2.2*s,10), darkMat);
      nac.rotation.x = Math.PI/2;
      nac.position.set(side*wingSpan*0.32, -0.3*s, 1.2*s);
      group.add(nac);
    });
  }

  // landing gear (retractable)
  const gearGroup = new THREE.Group();
  [-1,1].forEach(side=>{
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.08*s,0.08*s,1.4*s,6), darkMat);
    strut.position.set(side*1.6*s,-1.0*s,1.6*s);
    gearGroup.add(strut);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.55*s,0.22*s,8,12), darkMat);
    wheel.position.set(side*1.6*s,-1.7*s,1.6*s);
    gearGroup.add(wheel);
  });
  const noseStrut = new THREE.Mesh(new THREE.CylinderGeometry(0.07*s,0.07*s,1.1*s,6), darkMat);
  noseStrut.position.set(0,-0.9*s,-3.6*s);
  gearGroup.add(noseStrut);
  const noseWheel = new THREE.Mesh(new THREE.TorusGeometry(0.4*s,0.17*s,8,12), darkMat);
  noseWheel.position.set(0,-1.45*s,-3.6*s);
  gearGroup.add(noseWheel);
  group.add(gearGroup);

  // flaps (visual: small hinged panels on trailing edge of wing)
  const flapGroup = new THREE.Group();
  [-1,1].forEach(side=>{
    const flap = new THREE.Mesh(new THREE.BoxGeometry(wingSpan*0.35,0.12*s,0.9*s), accentMat);
    flap.position.set(side*wingSpan*0.28, -0.1*s, 1.2*s);
    flapGroup.add(flap);
  });
  group.add(flapGroup);

  // airbrake / spoiler panels on top of wing
  const spoilerGroup = new THREE.Group();
  [-1,1].forEach(side=>{
    const sp = new THREE.Mesh(new THREE.BoxGeometry(wingSpan*0.3,0.08*s,1.0*s), new THREE.MeshPhongMaterial({color:0x222222}));
    sp.position.set(side*wingSpan*0.22, 0.05*s, 0.4*s);
    spoilerGroup.add(sp);
  });
  spoilerGroup.visible = false;
  group.add(spoilerGroup);

  const navLightL = new THREE.PointLight(0xff3b3b, 1, 40);
  navLightL.position.set(-wingSpan/2,0,0.3*s);
  group.add(navLightL);
  const navLightR = new THREE.PointLight(0x3bff5c, 1, 40);
  navLightR.position.set(wingSpan/2,0,0.3*s);
  group.add(navLightR);

  scene.add(group);
  return { group, propBlades, gearGroup, flapGroup, spoilerGroup, fuseLen, wingSpan };
}

let aircraft = buildAircraft(currentType);
let plane = aircraft.group;

/* ---------------- flight & systems state ---------------- */
const START_POS = new THREE.Vector3(0, 6, -50);
const state = {
  pos: START_POS.clone(),
  velocity: new THREE.Vector3(),
  pitch:0, roll:0, yaw:Math.PI,
  pitchRate:0, rollRate:0, yawRate:0,
  speed:0, throttle:0,
  gear:1, gearIndex:0,
  gearDown:true,
  flapsStage:0,
  effFlaps:0,
  airbrake:false,
  reverseThrust:false,
  wheelBrake:false,
  trim:0,
  engineOn:false,
  fuel:100,
  damage:100,
  gForce:1,
  stalling:false,
  onGround:true,
  crashed:false
};

const GEAR_RATIOS = [
  {top:0.20, accel:1.6},
  {top:0.38, accel:1.4},
  {top:0.55, accel:1.2},
  {top:0.72, accel:1.0},
  {top:0.88, accel:0.85},
  {top:1.0,  accel:0.7}
];

let gearShiftFlash = 0;

function currentSpec(){ return AIRCRAFT_TYPES[currentType]; }
function maxSpeedMs(){ return currentSpec().maxSpeedKmh/KMH; }

function resetPlane(){
  state.pos.copy(START_POS);
  state.velocity.set(0,0,0);
  state.pitch = 0; state.roll = 0; state.yaw = Math.PI;
  state.pitchRate = 0; state.rollRate = 0; state.yawRate = 0;
  state.speed = 0; state.throttle = 0;
  state.gearIndex = 0;
  state.gearDown = true;
  state.flapsStage = 0;
  state.airbrake = false;
  state.reverseThrust = false;
  state.trim = 0;
  state.fuel = 100;
  state.damage = 100;
  state.gForce = 1;
  state.stalling = false;
  state.crashed = false;
  camera.position.set(0,10,-80);
}
resetPlane();

/* ---------------- input ---------------- */
const keys = {};
let cameraMode = 'chase'; // chase | cockpit | wing | free | cinematic
const CAMERA_MODES = ['chase','cockpit','wing','free','cinematic'];
let autopilot = false;
let weather = 'clear';
const WEATHER_KEYS = { Digit1:'clear', Digit2:'cloudy', Digit3:'foggy', Digit4:'sunset', Digit5:'night', Digit6:'storm', Digit7:'snow' };

let freeCamYaw = 0, freeCamPitch = 0.15, freeCamDist = 30;
let dragging = false, lastMouseX=0, lastMouseY=0;

window.addEventListener('keydown', (e)=>{
  if(keys[e.code]) return; // ignore auto-repeat for toggle keys
  keys[e.code] = true;
  ensureAudio();

  if(e.code === 'KeyC'){
    const idx = (CAMERA_MODES.indexOf(cameraMode)+1) % CAMERA_MODES.length;
    cameraMode = CAMERA_MODES[idx];
  }
  if(e.code === 'KeyP'){ autopilot = !autopilot; }
  if(e.code === 'KeyR'){ resetPlane(); setStatus('Aircraft reset.'); }
  if(e.code === 'KeyG'){ state.gearDown = !state.gearDown; setStatus(state.gearDown?'Gear down':'Gear up', 1.4); }
  if(e.code === 'KeyF'){ state.flapsStage = clamp(state.flapsStage+1,0,3); }
  if(e.code === 'KeyV'){ state.flapsStage = clamp(state.flapsStage-1,0,3); }
  if(e.code === 'KeyI'){
    state.engineOn = !state.engineOn;
    if(state.engineOn) playEngineStart();
    setStatus(state.engineOn?'Engine start':'Engine shutdown', 1.4);
  }
  if(e.code === 'BracketLeft'){ state.trim = clamp(state.trim - 0.05, -1, 1); }
  if(e.code === 'BracketRight'){ state.trim = clamp(state.trim + 0.05, -1, 1); }
  if(WEATHER_KEYS[e.code]){ weather = WEATHER_KEYS[e.code]; applyWeather(); }
});
window.addEventListener('keyup', (e)=>{ keys[e.code] = false; });

renderer.domElement.addEventListener('mousedown', (e)=>{
  if(cameraMode==='free'){ dragging = true; lastMouseX=e.clientX; lastMouseY=e.clientY; }
});
window.addEventListener('mouseup', ()=> dragging=false);
window.addEventListener('mousemove', (e)=>{
  if(dragging){
    freeCamYaw -= (e.clientX-lastMouseX)*0.006;
    freeCamPitch = clamp(freeCamPitch - (e.clientY-lastMouseY)*0.006, -1.4, 1.4);
    lastMouseX = e.clientX; lastMouseY = e.clientY;
  }
});
renderer.domElement.addEventListener('wheel', (e)=>{
  if(cameraMode==='free'){ freeCamDist = clamp(freeCamDist + e.deltaY*0.03, 8, 120); }
});

/* ---------------- aircraft picker (start screen) ---------------- */
document.querySelectorAll('.craftOption').forEach(el=>{
  el.addEventListener('click', ()=>{
    document.querySelectorAll('.craftOption').forEach(o=>o.classList.remove('selected'));
    el.classList.add('selected');
    currentType = el.dataset.craft;
  });
});

/* ---------------- passenger check-in mini-game (airliner only) ---------------- */
const PAX_COLORS = ['#ff5c5c','#7dff9e','#5ce1e6','#ffb02e','#c98bff','#ff8ac8','#8affc1','#ffe15c'];
let coins = 100;
let passengers = [];
let paxIndex = 0;
let acceptedColors = [];

function generatePassengers(n){
  const list = [];
  for(let i=0;i<n;i++){
    const squareColor = PAX_COLORS[Math.floor(Math.random()*PAX_COLORS.length)];
    const matches = Math.random() < 0.55;
    const passportColor = matches ? squareColor : PAX_COLORS[Math.floor(Math.random()*PAX_COLORS.length)];
    list.push({ squareColor, passportColor, decision:null });
  }
  return list;
}

const coinsValEl = document.getElementById('coinsVal');
const passengerQueueEl = document.getElementById('passengerQueue');
const personSwatchEl = document.getElementById('personSwatch');
const passportSwatchEl = document.getElementById('passportSwatch');
const boardingResultEl = document.getElementById('boardingResult');
const acceptBtn = document.getElementById('acceptBtn');
const declineBtn = document.getElementById('declineBtn');
const boardBtn = document.getElementById('boardBtn');
const boardingOverlay = document.getElementById('boardingOverlay');

function renderQueue(){
  passengerQueueEl.innerHTML = '';
  passengers.forEach((p,i)=>{
    const sq = document.createElement('div');
    sq.className = 'paxSquare';
    if(i === paxIndex) sq.classList.add('current');
    else if(p.decision === 'accepted') sq.classList.add('accepted');
    else if(p.decision === 'declined') sq.classList.add('declined');
    sq.style.background = p.squareColor;
    passengerQueueEl.appendChild(sq);
  });
}

function showCurrentPassenger(){
  if(paxIndex >= passengers.length){
    personSwatchEl.style.background = '#222';
    passportSwatchEl.style.background = '#222';
    boardingResultEl.textContent = 'All passengers processed — ready to board.';
    boardingResultEl.className = 'boardingResult good';
    acceptBtn.disabled = true;
    declineBtn.disabled = true;
    return;
  }
  const p = passengers[paxIndex];
  personSwatchEl.style.background = p.squareColor;
  passportSwatchEl.style.background = p.passportColor;
  acceptBtn.disabled = false;
  declineBtn.disabled = false;
}

function decide(action){
  if(paxIndex >= passengers.length) return;
  const p = passengers[paxIndex];
  const isMatch = p.squareColor === p.passportColor;
  const correctAction = isMatch ? 'accept' : 'decline';
  const wasRight = action === correctAction;

  if(wasRight){
    const gain = Math.floor(rand(5,16));
    coins += gain;
    playCorrectTone();
    boardingResultEl.textContent = 'Correct — +' + gain + ' coins';
    boardingResultEl.className = 'boardingResult good';
  } else {
    const loss = Math.floor(rand(4,13));
    coins = Math.max(0, coins - loss);
    playWrongTone();
    boardingResultEl.textContent = 'Wrong call — -' + loss + ' coins';
    boardingResultEl.className = 'boardingResult bad';
  }
  coinsValEl.textContent = coins;

  p.decision = action === 'accept' ? 'accepted' : 'declined';
  if(action === 'accept') acceptedColors.push(p.squareColor);

  paxIndex++;
  renderQueue();
  showCurrentPassenger();
}
acceptBtn.addEventListener('click', ()=> decide('accept'));
declineBtn.addEventListener('click', ()=> decide('decline'));

function openBoarding(){
  coins = 100;
  passengers = generatePassengers(10);
  paxIndex = 0;
  acceptedColors = [];
  coinsValEl.textContent = coins;
  boardingResultEl.textContent = '';
  boardingResultEl.className = 'boardingResult';
  renderQueue();
  showCurrentPassenger();
  boardingOverlay.classList.remove('hiddenOverlay');
}

/* boarding dots — accepted passengers walk from the terminal to the aircraft door */
let boardingDots = [];
function spawnBoardingDots(colors){
  boardingDots.forEach(d=> scene.remove(d));
  boardingDots = [];
  colors.forEach((color,i)=>{
    const dot = new THREE.Mesh(new THREE.SphereGeometry(1.0,8,8), new THREE.MeshBasicMaterial({ color }));
    dot.position.set(terminalBuilding.position.x + rand(-9,9), 1.1, terminalBuilding.position.z + rand(-7,7));
    dot.userData.start = dot.position.clone();
    dot.userData.delay = i*0.35;
    dot.userData.t = 0;
    scene.add(dot);
    boardingDots.push(dot);
  });
}
function updateBoardingDots(dt){
  if(!boardingDots.length) return;
  boardingDots.forEach(d=>{
    if(d.userData.delay > 0){ d.userData.delay -= dt; return; }
    if(d.userData.t >= 1) return;
    d.userData.t = Math.min(1, d.userData.t + dt/3.2);
    const target = new THREE.Vector3(plane.position.x, 1.2, plane.position.z + 2);
    d.position.lerpVectors(d.userData.start, target, d.userData.t);
    if(d.userData.t >= 1) d.visible = false;
  });
}

/* ---------------- HUD elements ---------------- */
const spdVal = document.getElementById('spdVal');
const altVal = document.getElementById('altVal');
const thrVal = document.getElementById('thrVal');
const rpmVal = document.getElementById('rpmVal');
const gearVal = document.getElementById('gearVal');
const hdgVal = document.getElementById('hdgVal');
const fuelVal = document.getElementById('fuelVal');
const dmgVal = document.getElementById('dmgVal');
const statusMsg = document.getElementById('statusMsg');
const camModeEl = document.getElementById('camMode');
const apModeEl = document.getElementById('apMode');
const weatherModeEl = document.getElementById('weatherMode');
const sysGear = document.getElementById('sysGear');
const sysFlaps = document.getElementById('sysFlaps');
const sysBrake = document.getElementById('sysBrake');
const sysTrim = document.getElementById('sysTrim');
const sysEngine = document.getElementById('sysEngine');
const sysG = document.getElementById('sysG');
const sysCraft = document.getElementById('sysCraft');
const visionOverlay = document.getElementById('visionOverlay');

let statusTimer = 0;
function setStatus(msg, hold=2.2){ statusMsg.textContent = msg; statusTimer = hold; }

/* horizon + minimap canvases */
const horizonCanvas = document.getElementById('horizon');
const hCtx = horizonCanvas.getContext('2d');
const mapCanvas = document.getElementById('minimap');
const mCtx = mapCanvas.getContext('2d');
function fitCanvas(c){ const r = c.getBoundingClientRect(); c.width = r.width*devicePixelRatio; c.height = r.height*devicePixelRatio; }

function drawHorizon(){
  fitCanvas(horizonCanvas);
  const w = horizonCanvas.width, h = horizonCanvas.height;
  hCtx.save();
  hCtx.clearRect(0,0,w,h);
  hCtx.beginPath(); hCtx.arc(w/2,h/2,w/2-2,0,Math.PI*2); hCtx.clip();
  hCtx.translate(w/2,h/2);
  hCtx.rotate(state.roll);
  const pitchOffset = clamp(state.pitch, -1.2, 1.2) * (h*0.5);
  hCtx.translate(0, pitchOffset);
  hCtx.fillStyle = '#3f7fd1'; hCtx.fillRect(-w, -h*2, w*2, h*2);
  hCtx.fillStyle = '#6b4a2f'; hCtx.fillRect(-w, 0, w*2, h*2);
  hCtx.strokeStyle = '#eaf6ff'; hCtx.lineWidth = 3;
  hCtx.beginPath(); hCtx.moveTo(-w,0); hCtx.lineTo(w,0); hCtx.stroke();
  hCtx.restore();
  hCtx.strokeStyle = '#ffb02e'; hCtx.lineWidth = 3;
  hCtx.beginPath();
  hCtx.moveTo(w*0.28,h/2); hCtx.lineTo(w*0.42,h/2);
  hCtx.moveTo(w*0.58,h/2); hCtx.lineTo(w*0.72,h/2);
  hCtx.moveTo(w/2,h/2-8); hCtx.lineTo(w/2,h/2+8);
  hCtx.stroke();
}

function drawMinimap(){
  fitCanvas(mapCanvas);
  const w = mapCanvas.width, h = mapCanvas.height;
  mCtx.clearRect(0,0,w,h);
  const scale = 0.012;
  const cx = w/2, cy = h/2;
  mCtx.strokeStyle = 'rgba(150,255,180,0.25)'; mCtx.lineWidth = 1;
  for(let r=1;r<=3;r++){ mCtx.beginPath(); mCtx.arc(cx,cy,(w/2)*(r/3),0,Math.PI*2); mCtx.stroke(); }
  mCtx.strokeStyle = '#ffd27a'; mCtx.lineWidth = 3;
  const rx = cx + (0 - state.pos.x)*scale;
  const ry1 = cy + (RUNWAY_Z_MIN - state.pos.z)*scale;
  const ry2 = cy + (RUNWAY_Z_MAX - state.pos.z)*scale;
  mCtx.beginPath(); mCtx.moveTo(rx,ry1); mCtx.lineTo(rx,ry2); mCtx.stroke();
  mCtx.save();
  mCtx.translate(cx,cy);
  mCtx.rotate(-state.yaw);
  mCtx.fillStyle = '#7dff9e';
  mCtx.beginPath();
  mCtx.moveTo(0,-8); mCtx.lineTo(6,8); mCtx.lineTo(0,4); mCtx.lineTo(-6,8);
  mCtx.closePath(); mCtx.fill();
  mCtx.restore();
  mCtx.fillStyle = '#ffb02e'; mCtx.font = '10px monospace'; mCtx.fillText('N', cx-4, 12);
}

/* ---------------- audio ---------------- */
let audioCtx, engineOsc, engineOsc2, engineGain, engineGain2, engineFilter, windGain, windFilter, noiseSrc;
let audioStarted = false;
function ensureAudio(){
  if(audioStarted) return;
  audioStarted = true;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  engineOsc = audioCtx.createOscillator();
  engineOsc.type = 'sawtooth';
  engineGain = audioCtx.createGain();
  engineGain.gain.value = 0.0;
  engineFilter = audioCtx.createBiquadFilter();
  engineFilter.type = 'lowpass';
  engineFilter.frequency.value = 800;
  engineOsc.connect(engineFilter).connect(engineGain).connect(audioCtx.destination);
  engineOsc.start();

  // second layer: adds a whine/harmonic on top of the base tone so each
  // aircraft's engine reads as a distinct timbre rather than one raw wave
  engineOsc2 = audioCtx.createOscillator();
  engineOsc2.type = 'sine';
  engineGain2 = audioCtx.createGain();
  engineGain2.gain.value = 0.0;
  engineOsc2.connect(engineGain2).connect(audioCtx.destination);
  engineOsc2.start();

  const bufferSize = audioCtx.sampleRate*2;
  const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for(let i=0;i<bufferSize;i++) data[i] = Math.random()*2-1;
  noiseSrc = audioCtx.createBufferSource();
  noiseSrc.buffer = noiseBuffer;
  noiseSrc.loop = true;
  windFilter = audioCtx.createBiquadFilter();
  windFilter.type = 'highpass';
  windFilter.frequency.value = 500;
  windGain = audioCtx.createGain();
  windGain.gain.value = 0.0;
  noiseSrc.connect(windFilter).connect(windGain).connect(audioCtx.destination);
  noiseSrc.start();
}

/* short UI / event tones — used by engine start and the check-in mini-game */
function playTone(freq, dur, type, vol, delay){
  if(!audioCtx) return;
  const t0 = audioCtx.currentTime + (delay||0);
  const osc = audioCtx.createOscillator();
  osc.type = type || 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(vol||0.16, t0+0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t0+dur);
  osc.connect(g).connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0+dur+0.03);
}
function playEngineStart(){
  if(!audioCtx) return;
  const t0 = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  osc.type = 'sawtooth';
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.22, t0+0.2);
  g.gain.exponentialRampToValueAtTime(0.0001, t0+1.3);
  osc.frequency.setValueAtTime(45, t0);
  osc.frequency.exponentialRampToValueAtTime(300, t0+1.1);
  osc.connect(g).connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0+1.4);
}
function playCorrectTone(){ playTone(680,0.1,'sine',0.18); playTone(1020,0.14,'sine',0.18,0.09); }
function playWrongTone(){ playTone(220,0.3,'sawtooth',0.2); }

function updateAudio(dt){
  if(!audioStarted) return;
  const spec = currentSpec();
  const running = state.engineOn ? 1 : 0;
  let baseFreq = 70, waveType = 'sawtooth', filterFreq = 800, harmonicMult = 2.0, harmonicVol = 0.02;
  if(spec.engine === 'prop'){ baseFreq = 60; waveType='sawtooth'; filterFreq=700; harmonicMult=1.5; harmonicVol=0.015; }
  else if(spec.engine === 'jet'){ baseFreq = 140; waveType='sine'; filterFreq=2200; harmonicMult=3.2; harmonicVol=0.045; }
  else if(spec.engine === 'airliner'){ baseFreq = 90; waveType='sine'; filterFreq=1400; harmonicMult=2.4; harmonicVol=0.03; }
  else if(spec.engine === 'fighter'){ baseFreq = 180; waveType='sawtooth'; filterFreq=3200; harmonicMult=4.0; harmonicVol=0.06; }
  if(engineOsc.type !== waveType) engineOsc.type = waveType;
  engineFilter.frequency.setTargetAtTime(filterFreq, audioCtx.currentTime, 0.2);
  const freq = baseFreq + state.throttle*260*running;
  engineOsc.frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.05);
  engineOsc2.frequency.setTargetAtTime(freq*harmonicMult, audioCtx.currentTime, 0.05);
  engineGain.gain.setTargetAtTime(running*(0.02 + state.throttle*0.09), audioCtx.currentTime, 0.1);
  engineGain2.gain.setTargetAtTime(running*(harmonicVol*0.4 + state.throttle*harmonicVol), audioCtx.currentTime, 0.1);
  windGain.gain.setTargetAtTime(clamp(state.speed/maxSpeedMs(),0,1)*0.16, audioCtx.currentTime, 0.15);
}

/* ---------------- weather presets ---------------- */
function applyWeather(){
  weatherModeEl.textContent = weather.toUpperCase();
  rainPts.visible = false; snowPts.visible = false;
  if(weather === 'clear'){ fog.color.set(0xbfe4ff); fog.density = 0.00012; setCloudOpacity(0.8); }
  else if(weather === 'cloudy'){ fog.color.set(0x9fb3bd); fog.density = 0.00022; setCloudOpacity(1.0); }
  else if(weather === 'foggy'){ fog.color.set(0xd8dde0); fog.density = 0.0011; setCloudOpacity(0.9); }
  else if(weather === 'sunset'){ fog.color.set(0xe89a63); fog.density = 0.00018; setCloudOpacity(0.85); }
  else if(weather === 'night'){ fog.color.set(0x05070c); fog.density = 0.0002; setCloudOpacity(0.5); }
  else if(weather === 'storm'){ fog.color.set(0x3a4048); fog.density = 0.0006; setCloudOpacity(1.0); rainPts.visible = true; }
  else if(weather === 'snow'){ fog.color.set(0xd9e3ea); fog.density = 0.0006; setCloudOpacity(0.9); snowPts.visible = true; }
}

/* ---------------- day/night cycle ---------------- */
let dayTime = 0.32;
const DAY_SPEED = 0.0025;
function updateDayNight(dt){
  if(weather === 'night'){ dayTime = 0.02; }
  else if(weather === 'sunset'){ dayTime = 0.5; }
  else { dayTime = (dayTime + DAY_SPEED*dt) % 1; }
  const ang = dayTime*Math.PI*2;
  const sunDist = 4000;
  sunMesh.position.set(Math.cos(ang)*sunDist, Math.sin(ang)*sunDist*0.9, 800);
  moonMesh.position.set(-Math.cos(ang)*sunDist, -Math.sin(ang)*sunDist*0.9, 800);
  sunLight.position.copy(sunMesh.position);
  const elevation = Math.sin(ang);
  const dayFactor = clamp(elevation*1.4 + 0.4, 0, 1);
  sunLight.intensity = 0.15 + dayFactor*1.1;
  hemiLight.intensity = 0.25 + dayFactor*0.65;
  const topDay = new THREE.Color(0x1f6fd6), topNight = new THREE.Color(0x02030a);
  const botDay = new THREE.Color(0xbfe4ff), botNight = new THREE.Color(0x0a1522);
  const topSunset = new THREE.Color(0x3a4d8c), botSunset = new THREE.Color(0xe8905a);
  if(weather === 'sunset'){ skyUniforms.topColor.value.copy(topSunset); skyUniforms.bottomColor.value.copy(botSunset); }
  else if(weather === 'storm'){ skyUniforms.topColor.value.copy(topNight).lerp(topDay,dayFactor*0.4); skyUniforms.bottomColor.value.copy(botNight).lerp(botDay,dayFactor*0.4); }
  else { skyUniforms.topColor.value.copy(topNight).lerp(topDay, dayFactor); skyUniforms.bottomColor.value.copy(botNight).lerp(botDay, dayFactor); }
  sunMesh.visible = elevation > -0.05 && weather !== 'foggy';
  moonMesh.visible = elevation < 0.15;

  runwayLights.forEach(l=> l.material.color.set(elevation < 0.2 ? 0xfff07a : 0xffffff));

  if(weather === 'storm'){
    lightningTimer -= dt;
    if(lightningTimer <= 0){ lightningFlash = 1; lightningTimer = rand(3,8); }
  }
  if(lightningFlash > 0){
    lightningFlash = Math.max(0, lightningFlash - dt*2.2);
    hemiLight.intensity += lightningFlash*1.5;
  }
}

/* ---------------- main physics update ---------------- */
const euler = new THREE.Euler(0,0,0,'YXZ');
const forwardVec = new THREE.Vector3();
let prevVy = 0;

function updatePhysics(dt){
  if(state.crashed) return;
  const spec = currentSpec();

  const pitchInput = (keys['KeyS']?1:0) - (keys['KeyW']?1:0);
  const turnInput = (keys['KeyD']?1:0) - (keys['KeyA']?1:0);
  const manualRollInput = (keys['KeyE']?1:0) - (keys['KeyQ']?1:0);
  const throttleInput = (keys['ArrowUp']?1:0) - (keys['ArrowDown']?1:0);

  state.throttle = clamp(state.throttle + throttleInput*0.6*dt, 0, 1);
  state.wheelBrake = !!keys['Space'];
  state.reverseThrust = !!keys['KeyX'] && state.onGround && state.gearDown;

  // fuel: unlimited — engine only stops if the pilot shuts it down manually
  const engineRunning = state.engineOn;

  // trim is always auto-managed now — it quietly cancels out sustained pitch pressure
  state.trim = lerp(state.trim, clamp(state.pitchRate*0.4,-1,1), 0.02);
  const trimPitch = state.trim*0.4;

  const agility = spec.agility || 1.0;
  if(autopilot){
    state.rollRate = lerp(state.rollRate, -state.roll*2.2, 0.12*agility);
    state.pitchRate = lerp(state.pitchRate, (trimPitch-state.pitch)*1.4, 0.08*agility);
    state.yawRate = lerp(state.yawRate, state.roll*0.55, 0.1*agility);
  } else {
    const targetBank = turnInput * 0.35; // coordinated turn: slight bank only
    state.rollRate = lerp(state.rollRate, (targetBank-state.roll)*3.0 + manualRollInput*1.6, clamp(0.12*agility,0,0.9));
    state.pitchRate = lerp(state.pitchRate, pitchInput*0.9 + (trimPitch-state.pitch)*0.3, clamp(0.09*agility,0,0.9));
    state.yawRate = lerp(state.yawRate, turnInput*0.5 + state.roll*0.5, clamp(0.09*agility,0,0.9));
  }

  // auto-coordinated flaps: a touch of extra flap deploys automatically while banking/turning
  const turningFactor = state.onGround ? 0 : clamp(Math.abs(turnInput)*0.6 + Math.abs(state.roll)/1.25*0.6, 0, 1);
  state.effFlaps = clamp(state.flapsStage + turningFactor, 0, 3);

  state.pitch = clamp(state.pitch + state.pitchRate*dt, -1.35, 1.35);
  state.roll = clamp(state.roll + state.rollRate*dt, -1.25, 1.25);
  state.yaw += state.yawRate*dt;

  euler.set(state.pitch, state.yaw, state.roll, 'YXZ');
  plane.quaternion.setFromEuler(euler);
  forwardVec.set(0,0,-1).applyQuaternion(plane.quaternion);

  // automatic transmission: shifts itself based on speed, with hysteresis so it doesn't hunt back and forth
  const speedFrac = clamp(state.speed/maxSpeedMs(), 0, 1);
  if(speedFrac > GEAR_RATIOS[state.gearIndex].top*0.92 && state.gearIndex < 5){
    state.gearIndex++; gearShiftFlash = 0.35;
  } else if(state.gearIndex > 0 && speedFrac < GEAR_RATIOS[state.gearIndex-1].top*0.55){
    state.gearIndex--; gearShiftFlash = 0.35;
  }

  // gearbox
  const gr = GEAR_RATIOS[state.gearIndex];
  const gearMaxSpeed = maxSpeedMs() * gr.top;
  let thrust = engineRunning ? state.throttle * spec.maxThrust * gr.accel : 0;
  if(state.reverseThrust) thrust = -spec.maxThrust*0.5;
  if(gearShiftFlash > 0){ gearShiftFlash -= dt; thrust *= 0.6; }

  // auto airbrake / spoiler: deploys by itself whenever it's actually needed —
  // shedding speed on the rollout after landing, bleeding off overspeed for the
  // current gear, or catching a low-power steep dive.
  const overspeedForGear = !state.onGround && state.speed > gearMaxSpeed*0.92;
  const steepDiveLowPower = !state.onGround && state.pitch < -0.22 && state.throttle < 0.25 && state.speed > spec.stallSpeed*1.3;
  const groundRollout = state.onGround && state.speed > 4 && state.throttle < 0.2;
  state.airbrake = overspeedForGear || steepDiveLowPower || groundRollout;

  const flapDrag = state.effFlaps*0.25;
  const flapLiftBonus = state.effFlaps*0.10;
  const gearDrag = state.gearDown ? 0.12 : 0;
  const airbrakeDrag = state.airbrake ? 1.1 : 0;

  let drag = spec.dragCoef*state.speed*state.speed
    + Math.abs(Math.sin(state.pitch))*0.35*state.speed
    + flapDrag*state.speed
    + gearDrag*state.speed
    + airbrakeDrag*state.speed;

  if(state.onGround && state.wheelBrake) drag += 40;

  let newSpeed = state.speed + ((thrust-drag)/spec.mass)*dt;
  newSpeed = clamp(newSpeed, state.reverseThrust ? -12 : 0, Math.max(gearMaxSpeed, spec.stallSpeed*1.05));
  state.speed = newSpeed;

  const effectiveStall = spec.stallSpeed*(1-flapLiftBonus);
  state.stalling = state.speed < effectiveStall*0.85 && state.pitch > 0.12 && !state.onGround;

  let liftFactor = clamp(state.speed/effectiveStall, 0, 1.25) + flapLiftBonus*0.4;
  if(state.stalling) liftFactor = Math.min(liftFactor, 0.35);

  // ground effect: extra lift near the ground
  const groundH0 = heightAt(state.pos.x, state.pos.z);
  const agl = state.pos.y - groundH0;
  if(agl < 15 && agl > 0) liftFactor += (1-agl/15)*0.18;

  state.velocity.copy(forwardVec).multiplyScalar(state.speed);

  const bankSink = 9.8*0.35*Math.abs(Math.sin(state.roll));
  const stallSink = 9.8*(1-liftFactor);
  state.velocity.y -= (bankSink + stallSink)*dt*4;

  if(state.stalling){
    state.pitch -= 0.5*dt;
    plane.position.x += (Math.random()-0.5)*0.15;
    plane.rotation.z += (Math.random()-0.5)*0.02;
  }

  // turbulence / wind gusts
  if(weather === 'storm' || weather === 'cloudy'){
    const gust = weather==='storm' ? 3.2 : 1.1;
    state.velocity.x += (Math.random()-0.5)*gust;
    state.velocity.y += (Math.random()-0.5)*gust*0.5;
  }

  state.pos.addScaledVector(state.velocity, dt);

  // G-force estimate from vertical accel + turn rate
  const vAccel = (state.velocity.y - prevVy)/Math.max(dt,0.001);
  prevVy = state.velocity.y;
  const turnG = Math.abs(state.yawRate)*state.speed/9.8;
  state.gForce = 1 + vAccel/9.8 + turnG*0.3;

  if(state.gForce > 4.5 || state.gForce < -1.5){
    state.damage = clamp(state.damage - Math.abs(state.gForce)*dt*2, 0, 100);
  }

  const groundH = heightAt(state.pos.x, state.pos.z);
  const floor = groundH + 1.9;
  if(state.pos.y <= floor){
    state.onGround = true;
    const hardLanding = Math.abs(state.velocity.y) > 8;
    const badAttitude = Math.abs(state.pitch) > 0.35 || Math.abs(state.roll) > 0.35;
    const gearUpLanding = !state.gearDown;
    if(state.speed > 34*1.0 && (badAttitude || gearUpLanding) ){
      state.crashed = true;
      setStatus(gearUpLanding ? 'CRASHED — gear-up landing! Press R to reset' : 'CRASHED — press R to reset', 999);
    } else {
      if(hardLanding){ state.damage = clamp(state.damage - Math.abs(state.velocity.y)*3, 0, 100); if(state.damage<=0){ state.crashed=true; setStatus('CRASHED — structural failure. Press R', 999); } }
      state.pos.y = floor;
      state.velocity.y = 0;
      state.speed *= (1 - 1.2*dt);
      state.pitch = lerp(state.pitch, 0, 0.06);
      state.roll = lerp(state.roll, 0, 0.08);
    }
  } else {
    state.onGround = false;
  }

  plane.position.copy(state.pos);
  euler.set(state.pitch, state.yaw, state.roll, 'YXZ');
  plane.quaternion.setFromEuler(euler);

  if(aircraft.propBlades) aircraft.propBlades.rotation.z += dt * (4 + state.throttle*40*(engineRunning?1:0));
  if(aircraft.gearGroup) aircraft.gearGroup.visible = state.gearDown;
  if(aircraft.flapGroup) aircraft.flapGroup.rotation.x = state.effFlaps*0.15;
  if(aircraft.spoilerGroup) aircraft.spoilerGroup.visible = state.airbrake;

  recycleClouds(state.pos);
}

/* ---------------- camera update ---------------- */
const camTmp = new THREE.Vector3();
const lookTmp = new THREE.Vector3();
let cineAngle = 0;

function updateCamera(dt){
  if(cameraMode === 'cockpit'){
    const offset = new THREE.Vector3(0, 0.9*currentSpec().scale, -1.2*currentSpec().scale).applyQuaternion(plane.quaternion);
    camera.position.copy(plane.position).add(offset);
    camera.up.set(0,1,0);
    camera.quaternion.copy(plane.quaternion);
  } else if(cameraMode === 'wing'){
    const offset = new THREE.Vector3(aircraft.wingSpan*0.55, 0.4, 1).applyQuaternion(plane.quaternion);
    camera.position.copy(plane.position).add(offset);
    camera.up.set(0,1,0);
    lookTmp.copy(plane.position);
    camera.lookAt(lookTmp);
  } else if(cameraMode === 'free'){
    const dir = new THREE.Vector3(
      Math.sin(freeCamYaw)*Math.cos(freeCamPitch),
      Math.sin(freeCamPitch),
      Math.cos(freeCamYaw)*Math.cos(freeCamPitch)
    );
    camTmp.copy(plane.position).addScaledVector(dir, freeCamDist);
    camera.position.lerp(camTmp, clamp(dt*6,0,1));
    camera.up.set(0,1,0);
    camera.lookAt(plane.position);
  } else if(cameraMode === 'cinematic'){
    cineAngle += dt*0.15;
    const dist = 26;
    camTmp.set(plane.position.x + Math.sin(cineAngle)*dist, plane.position.y+6, plane.position.z + Math.cos(cineAngle)*dist);
    camera.position.lerp(camTmp, clamp(dt*2,0,1));
    camera.up.set(0,1,0);
    camera.lookAt(plane.position);
  } else {
    const behind = forwardVec.clone().multiplyScalar(-16);
    const up = new THREE.Vector3(0,1,0).applyQuaternion(plane.quaternion);
    camTmp.copy(plane.position).add(behind).addScaledVector(new THREE.Vector3(0,1,0), 6).addScaledVector(up, 1.5);
    camera.position.lerp(camTmp, clamp(dt*3,0,1));
    lookTmp.copy(plane.position).addScaledVector(forwardVec, 25).addScaledVector(new THREE.Vector3(0,1,0), 2);
    camera.up.set(0,1,0);
    camera.lookAt(lookTmp);
  }
}

/* ---------------- G-force vision effect ---------------- */
function updateVisionEffect(){
  if(state.gForce > 3.2){
    const t = clamp((state.gForce-3.2)/3.5, 0, 1);
    visionOverlay.style.opacity = t*0.85;
    visionOverlay.style.background = 'radial-gradient(circle, rgba(0,0,0,0) 30%, rgba(0,0,0,0.95) 100%)';
  } else if(state.gForce < -0.8){
    const t = clamp((-state.gForce-0.8)/2, 0, 1);
    visionOverlay.style.opacity = t*0.6;
    visionOverlay.style.background = 'radial-gradient(circle, rgba(120,0,0,0) 30%, rgba(140,0,0,0.7) 100%)';
  } else {
    visionOverlay.style.opacity = 0;
  }
}

/* ---------------- HUD update ---------------- */
function updateHUD(dt){
  spdVal.textContent = Math.round(Math.abs(state.speed)*KMH).toString().padStart(3,'0');
  altVal.textContent = Math.round(Math.max(0,state.pos.y)*3.28).toString().padStart(4,'0');
  thrVal.textContent = Math.round(state.throttle*100).toString().padStart(2,'0');
  rpmVal.textContent = Math.round((state.throttle*100*(1+state.gearIndex*0.15))/10).toString().padStart(2,'0');
  gearVal.textContent = (state.gearIndex+1).toString();
  fuelVal.textContent = '\u221e';
  dmgVal.textContent = Math.round(state.damage).toString().padStart(3,'0');

  let hdg = THREE.MathUtils.radToDeg(state.yaw) % 360;
  if(hdg < 0) hdg += 360;
  hdgVal.textContent = Math.round(hdg).toString().padStart(3,'0');

  camModeEl.textContent = cameraMode.toUpperCase() + ' CAM';
  apModeEl.textContent = autopilot ? 'AUTOPILOT ON' : 'AUTOPILOT OFF';
  apModeEl.className = autopilot ? 'on' : 'off';

  sysGear.textContent = 'GEAR: ' + (state.gearDown ? 'DOWN' : 'UP');
  sysFlaps.textContent = 'FLAPS: ' + state.flapsStage + (state.effFlaps > state.flapsStage ? ' (+turn)' : '');
  sysBrake.textContent = 'AIRBRAKE: ' + (state.airbrake ? 'AUTO-ON' : 'off');
  sysTrim.textContent = 'TRIM: ' + state.trim.toFixed(2) + ' (auto)';
  sysEngine.textContent = 'ENGINE: ' + (state.engineOn ? 'ON' : 'OFF');
  sysG.textContent = 'G: ' + state.gForce.toFixed(1);
  sysCraft.textContent = currentSpec().name;

  if(state.stalling && statusTimer <= 0) setStatus('STALL — nose down, add throttle', 1.2);
  if(!state.engineOn && state.throttle > 0.05 && statusTimer <= 0 && !state.crashed) setStatus('Engine off — press I to start', 1.4);
  if(statusTimer > 0){
    statusTimer -= dt;
    if(statusTimer <= 0 && !state.crashed) statusMsg.textContent = '';
  }

  drawHorizon();
  drawMinimap();
  updateVisionEffect();
}

/* ---------------- main loop ---------------- */
let last = performance.now();
function animate(now){
  requestAnimationFrame(animate);
  const dt = Math.min((now-last)/1000, 0.05);
  last = now;

  updatePhysics(dt);
  updatePrecip(dt, state.pos);
  updateBoardingDots(dt);
  updateCamera(dt);
  updateDayNight(dt);
  updateAudio(dt);
  updateHUD(dt);

  renderer.render(scene, camera);
}

/* ---------------- start flow ---------------- */
const startOverlay = document.getElementById('startOverlay');
const hud = document.getElementById('hud');

function beginFlight(){
  // rebuild aircraft to match the selected type
  scene.remove(aircraft.group);
  aircraft = buildAircraft(currentType);
  plane = aircraft.group;
  resetPlane();

  startOverlay.style.display = 'none';
  boardingOverlay.classList.add('hiddenOverlay');
  hud.style.display = 'block';
  applyWeather();

  if(currentType === 'airliner' && acceptedColors.length){
    spawnBoardingDots(acceptedColors);
  }

  requestAnimationFrame((t)=>{ last = t; animate(t); });
}

document.getElementById('startBtn').addEventListener('click', ()=>{
  ensureAudio();
  if(audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

  if(currentType === 'airliner'){
    startOverlay.style.display = 'none';
    openBoarding();
  } else {
    beginFlight();
  }
});

boardBtn.addEventListener('click', ()=>{ beginFlight(); });

})();
