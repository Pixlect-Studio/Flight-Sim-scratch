/* ============================================================
   AEROFRAME — procedural Three.js flight simulator
   ============================================================ */

(function(){
"use strict";

/* ---------------- basic setup ---------------- */
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, powerPreference:'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, window.innerWidth/window.innerHeight, 0.5, 20000);

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

/* ---------------- terrain height field ---------------- */
const RUNWAY_HALF_WIDTH = 45;
const RUNWAY_Z_MIN = -1000;
const RUNWAY_Z_MAX = 260;
const RUNWAY_EDGE = 220;

function flattenFactor(x,z){
  const dx = Math.abs(x) - RUNWAY_HALF_WIDTH;
  let dz = 0;
  if(z < RUNWAY_Z_MIN) dz = RUNWAY_Z_MIN - z;
  else if(z > RUNWAY_Z_MAX) dz = z - RUNWAY_Z_MAX;
  const d = Math.max(dx, dz);
  return 1 - smoothstep(0, RUNWAY_EDGE, d);
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

const sunMesh = new THREE.Mesh(
  new THREE.SphereGeometry(60,16,16),
  new THREE.MeshBasicMaterial({ color:0xfff2c0 })
);
scene.add(sunMesh);

const moonMesh = new THREE.Mesh(
  new THREE.SphereGeometry(40,16,16),
  new THREE.MeshBasicMaterial({ color:0xcfd8e8 })
);
scene.add(moonMesh);

/* ---------------- sky dome ---------------- */
const skyUniforms = {
  topColor:{ value:new THREE.Color(0x1f6fd6) },
  bottomColor:{ value:new THREE.Color(0xbfe4ff) },
  offset:{ value:20 },
  exponent:{ value:0.6 }
};
const skyGeo = new THREE.SphereGeometry(9000, 24, 16);
const skyMat = new THREE.ShaderMaterial({
  uniforms:skyUniforms,
  side:THREE.BackSide,
  depthWrite:false,
  vertexShader:`
    varying vec3 vWorldPosition;
    void main(){
      vec4 worldPosition = modelMatrix * vec4(position,1.0);
      vWorldPosition = worldPosition.xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
    }
  `,
  fragmentShader:`
    uniform vec3 topColor;
    uniform vec3 bottomColor;
    uniform float offset;
    uniform float exponent;
    varying vec3 vWorldPosition;
    void main(){
      float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
      gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h,0.0), exponent),0.0)),1.0);
    }
  `
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
terrain.receiveShadow = false;
scene.add(terrain);

/* runway markings */
const runwayGroup = new THREE.Group();
const runwaySurf = new THREE.Mesh(
  new THREE.PlaneGeometry(RUNWAY_HALF_WIDTH*2*0.85, RUNWAY_Z_MAX-RUNWAY_Z_MIN),
  new THREE.MeshLambertMaterial({ color:0x2c2c2e })
);
runwaySurf.rotation.x = -Math.PI/2;
runwaySurf.position.set(0, 0.3, (RUNWAY_Z_MAX+RUNWAY_Z_MIN)/2);
runwayGroup.add(runwaySurf);

// centerline dashes
const dashMat = new THREE.MeshBasicMaterial({ color:0xffffff });
for(let z=RUNWAY_Z_MIN+20; z<RUNWAY_Z_MAX-20; z+=40){
  const dash = new THREE.Mesh(new THREE.PlaneGeometry(2,18), dashMat);
  dash.rotation.x = -Math.PI/2;
  dash.position.set(0,0.35,z);
  runwayGroup.add(dash);
}
// edge lights
const lightMat = new THREE.MeshBasicMaterial({ color:0xfff07a });
for(let z=RUNWAY_Z_MIN; z<RUNWAY_Z_MAX; z+=30){
  [-1,1].forEach(side=>{
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(1.2,6,6), lightMat);
    bulb.position.set(side*RUNWAY_HALF_WIDTH*0.9, 1, z);
    runwayGroup.add(bulb);
  });
}
scene.add(runwayGroup);

/* simple airport buildings + hangars near start */
const buildingMat = new THREE.MeshLambertMaterial({ color:0x9aa3a8 });
const hangarMat = new THREE.MeshLambertMaterial({ color:0x6b7d8a });
function makeBuilding(x,z,w,h,d,mat){
  const b = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat);
  b.position.set(x, h/2, z);
  scene.add(b);
  return b;
}
makeBuilding(-90, -40, 26, 14, 18, buildingMat);
makeBuilding(-95, -70, 20, 10, 14, buildingMat);
makeBuilding(90, -30, 40, 16, 22, hangarMat);
const towerBase = makeBuilding(-70, 10, 8,30,8, buildingMat);
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
    const m = new THREE.Mesh(geo, mat);
    m.position.set(rand(-1,1)*scale*1.4, rand(-0.2,0.3)*scale, rand(-1,1)*scale*1.4);
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

/* recycle clouds so the sky never feels empty as the plane travels far */
function recycleClouds(planePos){
  Object.values(cloudLayers).forEach(layer=>{
    layer.forEach(c=>{
      const dx = c.position.x - planePos.x;
      const dz = c.position.z - planePos.z;
      const dist = Math.sqrt(dx*dx+dz*dz);
      if(dist > 5200){
        const ang = Math.random()*Math.PI*2;
        const r = rand(3000,5000);
        c.position.x = planePos.x + Math.cos(ang)*r;
        c.position.z = planePos.z + Math.sin(ang)*r;
      }
    });
  });
}

/* ---------------- aircraft ---------------- */
const plane = new THREE.Group();

const bodyMat = new THREE.MeshPhongMaterial({ color:0xe8e8ea, shininess:60 });
const accentMat = new THREE.MeshPhongMaterial({ color:0xd23c3c, shininess:40 });
const glassMat = new THREE.MeshPhongMaterial({ color:0x2a3a44, shininess:100 });
const darkMat = new THREE.MeshPhongMaterial({ color:0x1c1c1e });

const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.9,1.3,9,12), bodyMat);
fuselage.rotation.x = Math.PI/2;
plane.add(fuselage);

const nose = new THREE.Mesh(new THREE.ConeGeometry(0.9,1.6,12), bodyMat);
nose.rotation.x = -Math.PI/2;
nose.position.set(0,0,-5.3);
plane.add(nose);

const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.75,12,10,0,Math.PI*2,0,Math.PI/1.6), glassMat);
canopy.position.set(0,0.75,-1.6);
plane.add(canopy);

const wingGeo = new THREE.BoxGeometry(11,0.18,2.1);
const wing = new THREE.Mesh(wingGeo, accentMat);
wing.position.set(0,-0.1,0.2);
plane.add(wing);

const tailWing = new THREE.Mesh(new THREE.BoxGeometry(4.4,0.14,1.1), accentMat);
tailWing.position.set(0,0.15,4.3);
plane.add(tailWing);

const fin = new THREE.Mesh(new THREE.BoxGeometry(0.14,1.8,1.6), accentMat);
fin.position.set(0,0.9,4.3);
plane.add(fin);

const propHub = new THREE.Mesh(new THREE.CylinderGeometry(0.18,0.18,0.4,10), darkMat);
propHub.rotation.x = Math.PI/2;
propHub.position.set(0,0,-6.1);
plane.add(propHub);

const propBlades = new THREE.Group();
for(let i=0;i<3;i++){
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.15,2.4,0.06), darkMat);
  blade.rotation.z = (i*Math.PI*2)/3;
  propBlades.add(blade);
}
propBlades.position.set(0,0,-6.25);
plane.add(propBlades);

[-1,1].forEach(side=>{
  const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.08,0.08,1.4,6), darkMat);
  strut.position.set(side*1.6,-1.0,1.6);
  plane.add(strut);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.55,0.22,8,12), darkMat);
  wheel.position.set(side*1.6,-1.7,1.6);
  plane.add(wheel);
});
const noseStrut = new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.07,1.1,6), darkMat);
noseStrut.position.set(0,-0.9,-3.6);
plane.add(noseStrut);
const noseWheel = new THREE.Mesh(new THREE.TorusGeometry(0.4,0.17,8,12), darkMat);
noseWheel.position.set(0,-1.45,-3.6);
plane.add(noseWheel);

const navLightL = new THREE.PointLight(0xff3b3b, 1, 40);
navLightL.position.set(-5.5,0,0.3);
plane.add(navLightL);
const navLightR = new THREE.PointLight(0x3bff5c, 1, 40);
navLightR.position.set(5.5,0,0.3);
plane.add(navLightR);

scene.add(plane);

/* ---------------- flight state ---------------- */
const START_POS = new THREE.Vector3(0, 6, -50);
const state = {
  pos: START_POS.clone(),
  velocity: new THREE.Vector3(),
  pitch:0, roll:0, yaw:0,
  pitchRate:0, rollRate:0, yawRate:0,
  speed:0, throttle:0,
  stalling:false,
  onGround:true,
  crashed:false
};

const PHYS = {
  PITCH_RATE_MAX: 0.9,
  ROLL_RATE_MAX: 1.7,
  YAW_RATE_MAX: 0.45,
  BANK_TURN_COEFF: 0.55,
  THROTTLE_RATE: 0.6,
  MAX_THRUST: 34,
  DRAG_COEF: 0.010,
  MASS: 1.0,
  STALL_SPEED: 26,
  MAX_SPEED: 140,
  GRAVITY: 9.8,
  GROUND_OFFSET: 1.9,
  CRASH_SPEED: 34
};

function resetPlane(){
  state.pos.copy(START_POS);
  state.velocity.set(0,0,0);
  state.pitch = 0; state.roll = 0; state.yaw = Math.PI;
  state.pitchRate = 0; state.rollRate = 0; state.yawRate = 0;
  state.speed = 0; state.throttle = 0;
  state.stalling = false; state.crashed = false;
  camera.position.set(0,10,-80);
}
state.yaw = Math.PI; // face down the runway (+z build direction faces -z, so start facing +z world)
resetPlane();

/* ---------------- input ---------------- */
const keys = {};
let cameraMode = 'chase'; // or 'cockpit'
let autopilot = false;
let weather = 'clear';

window.addEventListener('keydown', (e)=>{
  keys[e.code] = true;
  ensureAudio();
  if(e.code === 'KeyC'){ cameraMode = (cameraMode === 'chase') ? 'cockpit' : 'chase'; }
  if(e.code === 'KeyP'){ autopilot = !autopilot; }
  if(e.code === 'KeyR'){ resetPlane(); setStatus('Aircraft reset.'); }
  if(['Digit1','Digit2','Digit3','Digit4','Digit5'].includes(e.code)){
    const map = { Digit1:'clear', Digit2:'cloudy', Digit3:'foggy', Digit4:'sunset', Digit5:'night' };
    weather = map[e.code];
  }
});
window.addEventListener('keyup', (e)=>{ keys[e.code] = false; });

/* ---------------- HUD elements ---------------- */
const spdVal = document.getElementById('spdVal');
const altVal = document.getElementById('altVal');
const thrVal = document.getElementById('thrVal');
const hdgVal = document.getElementById('hdgVal');
const statusMsg = document.getElementById('statusMsg');
const camModeEl = document.getElementById('camMode');
const apModeEl = document.getElementById('apMode');
const weatherModeEl = document.getElementById('weatherMode');

let statusTimer = 0;
function setStatus(msg, hold=2.2){
  statusMsg.textContent = msg;
  statusTimer = hold;
}

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

  hCtx.fillStyle = '#3f7fd1';
  hCtx.fillRect(-w, -h*2, w*2, h*2);
  hCtx.fillStyle = '#6b4a2f';
  hCtx.fillRect(-w, 0, w*2, h*2);
  hCtx.strokeStyle = '#eaf6ff';
  hCtx.lineWidth = 3;
  hCtx.beginPath(); hCtx.moveTo(-w,0); hCtx.lineTo(w,0); hCtx.stroke();

  hCtx.restore();

  hCtx.strokeStyle = '#ffb02e';
  hCtx.lineWidth = 3;
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

  mCtx.strokeStyle = 'rgba(150,255,180,0.25)';
  mCtx.lineWidth = 1;
  for(let r=1;r<=3;r++){
    mCtx.beginPath(); mCtx.arc(cx,cy,(w/2)*(r/3),0,Math.PI*2); mCtx.stroke();
  }

  // runway
  mCtx.strokeStyle = '#ffd27a';
  mCtx.lineWidth = 3;
  const rx1 = cx + (0 - state.pos.x)*scale;
  const ry1 = cy + (RUNWAY_Z_MIN - state.pos.z)*scale;
  const rx2 = cx + (0 - state.pos.x)*scale;
  const ry2 = cy + (RUNWAY_Z_MAX - state.pos.z)*scale;
  mCtx.beginPath(); mCtx.moveTo(rx1,ry1); mCtx.lineTo(rx2,ry2); mCtx.stroke();

  // plane marker (fixed at center, rotates with heading)
  mCtx.save();
  mCtx.translate(cx,cy);
  mCtx.rotate(-state.yaw);
  mCtx.fillStyle = '#7dff9e';
  mCtx.beginPath();
  mCtx.moveTo(0,-8); mCtx.lineTo(6,8); mCtx.lineTo(0,4); mCtx.lineTo(-6,8);
  mCtx.closePath(); mCtx.fill();
  mCtx.restore();

  mCtx.fillStyle = '#ffb02e';
  mCtx.font = '10px monospace';
  mCtx.fillText('N', cx-4, 12);
}

/* ---------------- audio ---------------- */
let audioCtx, engineOsc, engineGain, windGain, windFilter;
let audioStarted = false;
function ensureAudio(){
  if(audioStarted) return;
  audioStarted = true;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  engineOsc = audioCtx.createOscillator();
  engineOsc.type = 'sawtooth';
  engineGain = audioCtx.createGain();
  engineGain.gain.value = 0.0;
  const engineFilter = audioCtx.createBiquadFilter();
  engineFilter.type = 'lowpass';
  engineFilter.frequency.value = 800;
  engineOsc.connect(engineFilter).connect(engineGain).connect(audioCtx.destination);
  engineOsc.start();

  const bufferSize = audioCtx.sampleRate*2;
  const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for(let i=0;i<bufferSize;i++) data[i] = Math.random()*2-1;
  const noise = audioCtx.createBufferSource();
  noise.buffer = noiseBuffer;
  noise.loop = true;
  windFilter = audioCtx.createBiquadFilter();
  windFilter.type = 'highpass';
  windFilter.frequency.value = 500;
  windGain = audioCtx.createGain();
  windGain.gain.value = 0.0;
  noise.connect(windFilter).connect(windGain).connect(audioCtx.destination);
  noise.start();
}

function updateAudio(dt){
  if(!audioStarted) return;
  engineOsc.frequency.setTargetAtTime(70 + state.throttle*260, audioCtx.currentTime, 0.05);
  engineGain.gain.setTargetAtTime(0.02 + state.throttle*0.09, audioCtx.currentTime, 0.1);
  windGain.gain.setTargetAtTime(clamp(state.speed/PHYS.MAX_SPEED,0,1)*0.16, audioCtx.currentTime, 0.15);
}

/* ---------------- weather presets ---------------- */
function applyWeather(){
  weatherModeEl.textContent = weather.toUpperCase();
  if(weather === 'clear'){
    fog.color.set(0xbfe4ff); fog.density = 0.00012;
    setCloudOpacity(0.8);
  } else if(weather === 'cloudy'){
    fog.color.set(0x9fb3bd); fog.density = 0.00022;
    setCloudOpacity(1.0);
  } else if(weather === 'foggy'){
    fog.color.set(0xd8dde0); fog.density = 0.0011;
    setCloudOpacity(0.9);
  } else if(weather === 'sunset'){
    fog.color.set(0xe89a63); fog.density = 0.00018;
    setCloudOpacity(0.85);
  } else if(weather === 'night'){
    fog.color.set(0x05070c); fog.density = 0.0002;
    setCloudOpacity(0.5);
  }
  scene.background = null;
}
function setCloudOpacity(mult){
  Object.values(cloudLayers).forEach(layer=>{
    layer.forEach(c=>{
      c.children.forEach(m=>{ m.material.opacity = mult * (m.userData.baseOpacity || m.material.opacity); });
    });
  });
}
// stash base opacities once
Object.values(cloudLayers).forEach(layer=> layer.forEach(c=> c.children.forEach(m=>{ m.userData.baseOpacity = m.material.opacity; })) );

/* ---------------- day/night cycle ---------------- */
let dayTime = 0.32; // 0..1 fraction of day, start mid-morning
const DAY_SPEED = 0.0025; // fraction per second

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

  if(weather === 'sunset'){
    skyUniforms.topColor.value.copy(topSunset);
    skyUniforms.bottomColor.value.copy(botSunset);
  } else {
    skyUniforms.topColor.value.copy(topNight).lerp(topDay, dayFactor);
    skyUniforms.bottomColor.value.copy(botNight).lerp(botDay, dayFactor);
  }

  sunMesh.visible = elevation > -0.05 && weather !== 'foggy';
  moonMesh.visible = elevation < 0.15;
}

/* ---------------- main physics update ---------------- */
const euler = new THREE.Euler(0,0,0,'YXZ');
const forwardVec = new THREE.Vector3();

function updatePhysics(dt){
  if(state.crashed) return;

  const pitchInput = (keys['KeyW']?1:0) - (keys['KeyS']?1:0);
  const rollInput = (keys['KeyD']?1:0) - (keys['KeyA']?1:0);
  const yawInput = (keys['KeyE']?1:0) - (keys['KeyQ']?1:0);
  const throttleInput = (keys['ArrowUp']?1:0) - (keys['ArrowDown']?1:0);

  state.throttle = clamp(state.throttle + throttleInput*PHYS.THROTTLE_RATE*dt, 0, 1);

  if(autopilot){
    state.rollRate = lerp(state.rollRate, -state.roll*2.2, 0.12);
    state.pitchRate = lerp(state.pitchRate, -state.pitch*1.4, 0.08);
    state.yawRate = lerp(state.yawRate, state.roll*PHYS.BANK_TURN_COEFF, 0.1);
  } else {
    state.pitchRate = lerp(state.pitchRate, pitchInput*PHYS.PITCH_RATE_MAX, 0.09);
    state.rollRate = lerp(state.rollRate, rollInput*PHYS.ROLL_RATE_MAX, 0.09);
    state.yawRate = lerp(state.yawRate, yawInput*PHYS.YAW_RATE_MAX + state.roll*PHYS.BANK_TURN_COEFF, 0.09);
  }

  state.pitch = clamp(state.pitch + state.pitchRate*dt, -1.35, 1.35);
  state.roll = clamp(state.roll + state.rollRate*dt, -1.25, 1.25);
  state.yaw += state.yawRate*dt;

  euler.set(state.pitch, state.yaw, state.roll, 'YXZ');
  plane.quaternion.setFromEuler(euler);

  forwardVec.set(0,0,-1).applyQuaternion(plane.quaternion);

  const thrust = state.throttle * PHYS.MAX_THRUST;
  const drag = PHYS.DRAG_COEF*state.speed*state.speed + Math.abs(Math.sin(state.pitch))*0.35*state.speed;
  state.speed = clamp(state.speed + ((thrust-drag)/PHYS.MASS)*dt, 0, PHYS.MAX_SPEED);

  state.stalling = state.speed < PHYS.STALL_SPEED*0.85 && state.pitch > 0.12 && !state.onGround;

  let liftFactor = clamp(state.speed/PHYS.STALL_SPEED, 0, 1.25);
  if(state.stalling) liftFactor = Math.min(liftFactor, 0.35);

  state.velocity.copy(forwardVec).multiplyScalar(state.speed);

  const bankSink = PHYS.GRAVITY*0.35*Math.abs(Math.sin(state.roll));
  const stallSink = PHYS.GRAVITY*(1-liftFactor);
  state.velocity.y -= (bankSink + stallSink)*dt*4;

  if(state.stalling){
    state.pitch -= 0.5*dt;
    plane.position.x += (Math.random()-0.5)*0.15;
    plane.rotation.z += (Math.random()-0.5)*0.02;
  }

  state.pos.addScaledVector(state.velocity, dt);

  const groundH = heightAt(state.pos.x, state.pos.z);
  const floor = groundH + PHYS.GROUND_OFFSET;
  if(state.pos.y <= floor){
    state.onGround = true;
    if(state.speed > PHYS.CRASH_SPEED && (Math.abs(state.pitch) > 0.35 || Math.abs(state.roll) > 0.35 || state.speed*Math.sin(Math.abs(state.pitch))>6)){
      state.crashed = true;
      setStatus('CRASHED — press R to reset', 999);
    } else {
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

  propBlades.rotation.z += dt * (4 + state.throttle*40);

  recycleClouds(state.pos);
}

/* ---------------- camera update ---------------- */
const camTmp = new THREE.Vector3();
const lookTmp = new THREE.Vector3();

function updateCamera(dt){
  if(cameraMode === 'cockpit'){
    const offset = new THREE.Vector3(0, 0.9, -1.2).applyQuaternion(plane.quaternion);
    camera.position.copy(plane.position).add(offset);
    const lookDir = forwardVec.clone().multiplyScalar(40).add(camera.position);
    camera.up.set(0,1,0);
    camera.quaternion.copy(plane.quaternion);
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

/* ---------------- HUD update ---------------- */
function updateHUD(dt){
  spdVal.textContent = Math.round(state.speed*1.94).toString().padStart(3,'0');
  altVal.textContent = Math.round(Math.max(0,state.pos.y)*3.28).toString().padStart(4,'0');
  thrVal.textContent = Math.round(state.throttle*100).toString().padStart(2,'0');
  let hdg = THREE.MathUtils.radToDeg(state.yaw) % 360;
  if(hdg < 0) hdg += 360;
  hdgVal.textContent = Math.round(hdg).toString().padStart(3,'0');

  camModeEl.textContent = cameraMode === 'chase' ? 'CHASE CAM' : 'COCKPIT CAM';
  apModeEl.textContent = autopilot ? 'AUTOPILOT ON' : 'AUTOPILOT OFF';
  apModeEl.className = autopilot ? 'on' : 'off';

  if(state.stalling && statusTimer <= 0) setStatus('STALL — nose down, add throttle', 1.2);
  if(statusTimer > 0){
    statusTimer -= dt;
    if(statusTimer <= 0 && !state.crashed) statusMsg.textContent = '';
  }

  drawHorizon();
  drawMinimap();
}

/* ---------------- main loop ---------------- */
let last = performance.now();
function animate(now){
  requestAnimationFrame(animate);
  const dt = Math.min((now-last)/1000, 0.05);
  last = now;

  updatePhysics(dt);
  updateCamera(dt);
  updateDayNight(dt);
  updateAudio(dt);
  updateHUD(dt);

  renderer.render(scene, camera);
}

/* ---------------- start flow ---------------- */
const startOverlay = document.getElementById('startOverlay');
const hud = document.getElementById('hud');
document.getElementById('startBtn').addEventListener('click', ()=>{
  ensureAudio();
  if(audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  startOverlay.style.display = 'none';
  hud.style.display = 'block';
  applyWeather();
  requestAnimationFrame((t)=>{ last = t; animate(t); });
});

})();
