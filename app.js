const $ = (id) => document.getElementById(id);

const speedTargets = [30, 60, 100, 150];
const baseDistanceTargets = [60, 100, 150, 200, 300, 400, 500, 1000];
const ACCURACY_GOOD = 25;
const ACCURACY_OK = 50;

const state = {
  watchId: null,
  mode: 'idle', // idle, gpsReady, armed, running, stopped
  countdownBusy: false,
  startTime: 0,
  lastFix: null,
  startFix: null,
  lastGpsAt: 0,
  gpsStatus: 'off', // off, requesting, denied, poor, ready, error
  totalDistance: 0,
  currentSpeed: 0,
  maxSpeed: 0,
  points: [],
  speedResults: {},
  distanceResults: {},
  settings: {
    launchSpeed: 5,
    customDistance: 150,
    autoStopDistance: 1000,
    soundEnabled: true,
  },
};

function loadSettings(){
  const saved = localStorage.getItem('dt_settings');
  if(saved){
    try{ state.settings = {...state.settings, ...JSON.parse(saved)}; }catch(e){}
  }
  $('launchSpeed').value = state.settings.launchSpeed;
  $('customDistance').value = state.settings.customDistance;
  $('autoStopDistance').value = state.settings.autoStopDistance;
  $('soundEnabled').checked = state.settings.soundEnabled;
}

function saveSettings(){
  if(!confirm('是否儲存目前設定？')) return;
  state.settings.launchSpeed = clamp(Number($('launchSpeed').value || 5), 1, 30);
  state.settings.customDistance = clamp(Number($('customDistance').value || 150), 10, 3000);
  state.settings.autoStopDistance = clamp(Number($('autoStopDistance').value || 1000), 60, 5000);
  state.settings.soundEnabled = $('soundEnabled').checked;
  localStorage.setItem('dt_settings', JSON.stringify(state.settings));
  renderTargets();
  setStatus('設定已儲存。', 'good');
}

function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }
function now(){ return performance.now(); }
function fmtTime(ms){ return (ms / 1000).toFixed(3); }
function kmh(ms){ return Math.max(0, ms * 3.6); }

function getDistanceTargets(){
  const custom = Number(state.settings.customDistance);
  const set = new Set(baseDistanceTargets);
  if(custom && custom >= 10) set.add(custom);
  return Array.from(set).sort((a,b)=>a-b);
}

function renderTargets(){
  $('speedResults').innerHTML = speedTargets.map(v => resultHtml(`0-${v} km/h`, `speed_${v}`)).join('');
  $('distanceResults').innerHTML = getDistanceTargets().map(v => resultHtml(`${v} m`, `dist_${v}`)).join('');
  updateResultsUi();
}
function resultHtml(name, key){ return `<div class="result" id="res_${key}"><div class="name">${name}</div><div class="value">--</div></div>`; }

function updateResultsUi(){
  for(const target of speedTargets){
    const el = $(`res_speed_${target}`); if(!el) continue;
    const r = state.speedResults[target];
    el.classList.toggle('done', !!r);
    el.querySelector('.value').textContent = r ? `${r.time}s` : '--';
  }
  for(const target of getDistanceTargets()){
    const el = $(`res_dist_${target}`); if(!el) continue;
    const r = state.distanceResults[target];
    el.classList.toggle('done', !!r);
    el.querySelector('.value').innerHTML = r ? `${r.time}s<span class="trap">終速 ${r.trapSpeed} km/h</span>` : '--';
  }
}

function setStatus(text, type=''){
  const el = $('statusText');
  el.textContent = text;
  el.classList.remove('good','warn','bad');
  if(type) el.classList.add(type);
}

function setGpsUi(status, detail=''){
  state.gpsStatus = status;
  const badge = $('gpsBadge');
  const title = $('gpsTitle');
  const dot = $('gpsDot');
  const hint = $('gpsHint');
  badge.className = 'badge';
  dot.className = 'gpsDot';

  const map = {
    off:       ['bad',  'off',  'GPS 狀態：未啟動', 'GPS 未啟動', '點擊啟動'],
    requesting:['warn','wait', 'GPS 狀態：要求權限中', 'GPS 要求中', '允許定位'],
    denied:    ['bad', 'off',  'GPS 狀態：定位被拒絕', 'GPS 未授權', '到設定開啟'],
    poor:      ['warn','wait', 'GPS 狀態：訊號不穩', 'GPS 訊號弱', '到空曠處'],
    ready:     ['good','on',   'GPS 狀態：已定位', 'GPS 已定位', '可開始'],
    error:     ['bad', 'off',  'GPS 狀態：錯誤', 'GPS 錯誤', '檢查權限'],
  };
  const m = map[status] || map.off;
  badge.classList.add(m[0]); dot.classList.add(m[1]);
  title.textContent = detail ? `${m[2]}｜${detail}` : m[2];
  badge.textContent = m[3];
  hint.textContent = m[4];

  const canStart = status === 'ready' || status === 'poor' || state.mode === 'idle';
  if(state.mode !== 'running' && state.mode !== 'armed') $('startBtn').disabled = !canStart && status !== 'off';
}

function updateGpsFixUi(fix){
  const acc = Number.isFinite(fix.accuracy) ? Math.round(fix.accuracy) : null;
  $('gpsAccuracy').textContent = acc ? `±${acc}m` : '--';
  $('gpsAge').textContent = '剛剛';
  state.lastGpsAt = Date.now();
  if(acc && acc <= ACCURACY_GOOD) setGpsUi('ready', `±${acc}m`);
  else if(acc && acc <= ACCURACY_OK) setGpsUi('poor', `±${acc}m`);
  else setGpsUi('poor', acc ? `±${acc}m` : '精度未知');
}

setInterval(()=>{
  if(!state.lastGpsAt) return;
  const age = Math.round((Date.now() - state.lastGpsAt) / 1000);
  $('gpsAge').textContent = age <= 1 ? '剛剛' : `${age}s`;
  if(age > 8 && state.watchId !== null && state.mode !== 'running'){
    setGpsUi('poor', '更新延遲');
  }
},1000);

function beep(freq=880, duration=120){
  if(!state.settings.soundEnabled) return;
  try{
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx(); const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.frequency.value = freq; gain.gain.value = 0.08; osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); setTimeout(()=>{osc.stop(); ctx.close();}, duration);
  }catch(e){}
}

async function countdown(){
  state.countdownBusy = true;
  const el = $('countdown'); el.classList.remove('hidden');
  for(const t of ['3','2','1','GO']){
    el.textContent = t; beep(t === 'GO' ? 1200 : 760, t === 'GO' ? 180 : 90);
    await new Promise(r => setTimeout(r, 800));
  }
  el.classList.add('hidden'); state.countdownBusy = false;
}

function ensureGpsWatch(){
  if(!('geolocation' in navigator)){
    setGpsUi('error'); setStatus('此裝置不支援定位。', 'bad'); return false;
  }
  if(state.watchId !== null) return true;
  setGpsUi('requesting');
  setStatus('請在 iPhone 跳出的視窗選擇「允許定位」。如果沒有跳出，請到設定開啟 Safari 定位權限。', 'warn');
  state.watchId = navigator.geolocation.watchPosition(onPosition, onGeoError, {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 12000,
  });
  return true;
}

async function startTest(){
  if(state.mode === 'running' || state.mode === 'armed') return;
  if(!ensureGpsWatch()) return;

  // 第一次按先啟動 GPS；已經有定位後，第二次才進入倒數。
  if(!state.lastFix){
    setStatus('GPS 啟動中。等畫面顯示「GPS 已定位」後，再按一次開始測試。', 'warn');
    return;
  }

  resetRun(false, false);
  $('startBtn').disabled = true;
  $('stopBtn').disabled = false;
  state.mode = 'armed';
  setStatus(`倒數後，速度超過 ${state.settings.launchSpeed} km/h 才正式開始計時。`, 'warn');
  await countdown();
  setStatus(`待起跑：超過 ${state.settings.launchSpeed} km/h 自動開始。`, 'good');
}

function onGeoError(err){
  let msg = '請確認 Safari 定位權限。';
  if(err.code === 1){ msg = '定位權限被拒絕。請到 iPhone 設定 → 隱私權與安全性 → 定位服務 → Safari 網站，改成允許，並開啟精確位置。'; setGpsUi('denied'); }
  else if(err.code === 2){ msg = '目前收不到定位。請到空曠處，並確認定位服務已開啟。'; setGpsUi('poor'); }
  else if(err.code === 3){ msg = 'GPS 等待逾時。請到空曠處後再試一次。'; setGpsUi('poor'); }
  else setGpsUi('error');
  setStatus(msg, 'bad');
}

function onPosition(pos){
  const c = pos.coords;
  const fix = {
    lat: c.latitude,
    lon: c.longitude,
    accuracy: c.accuracy,
    speed: Number.isFinite(c.speed) && c.speed !== null ? Math.max(0, c.speed) : null,
    t: now(),
    realTs: pos.timestamp,
  };

  if(state.lastFix && fix.speed === null){
    const d = haversine(state.lastFix, fix);
    const dt = Math.max(0.001, (fix.realTs - state.lastFix.realTs) / 1000);
    fix.speed = d / dt;
  }
  if(fix.speed === null) fix.speed = 0;

  updateGpsFixUi(fix);
  const speedKmh = kmh(fix.speed);
  state.currentSpeed = speedKmh;
  $('speedNow').textContent = Math.round(speedKmh);

  if(state.mode === 'armed' && !state.countdownBusy && speedKmh >= state.settings.launchSpeed){ beginRun(fix); }
  if(state.mode === 'running'){ addRunningFix(fix); }
  state.lastFix = fix;
}

function beginRun(fix){
  state.mode = 'running'; state.startTime = fix.t; state.startFix = fix; state.lastFix = fix;
  state.totalDistance = 0; state.maxSpeed = kmh(fix.speed);
  state.points = [{...fix, distance: 0, elapsed: 0, speedKmh: kmh(fix.speed)}];
  beep(1400, 160); setStatus('測試中。達到自動結束距離或按停止會儲存紀錄。', 'good');
}

function addRunningFix(fix){
  const previous = state.points[state.points.length - 1] || state.startFix;
  let segment = haversine(previous, fix);
  if(!Number.isFinite(segment) || segment < 0) segment = 0;
  if(segment > 80) segment = 0;
  state.totalDistance += segment;
  state.maxSpeed = Math.max(state.maxSpeed, kmh(fix.speed));
  const elapsed = fix.t - state.startTime;
  const point = {...fix, distance: state.totalDistance, elapsed, speedKmh: kmh(fix.speed)};
  state.points.push(point);
  $('elapsed').textContent = fmtTime(elapsed);
  $('distanceNow').textContent = state.totalDistance.toFixed(1);
  $('maxSpeed').textContent = Math.round(state.maxSpeed);
  checkTargets(point); updateResultsUi();
  if(state.totalDistance >= state.settings.autoStopDistance) stopTest(true);
}

function checkTargets(point){
  for(const target of speedTargets){
    if(state.speedResults[target]) continue;
    if(point.speedKmh >= target){ const crossed = interpolateBySpeed(target); state.speedResults[target] = {time: fmtTime(crossed.elapsed)}; beep(1000,80); }
  }
  for(const target of getDistanceTargets()){
    if(state.distanceResults[target]) continue;
    if(point.distance >= target){ const crossed = interpolateByDistance(target); state.distanceResults[target] = {time: fmtTime(crossed.elapsed), trapSpeed: Math.round(crossed.speedKmh)}; beep(940,80); }
  }
}
function interpolateBySpeed(targetKmh){
  const pts = state.points; for(let i=1;i<pts.length;i++){ const a=pts[i-1],b=pts[i]; if(a.speedKmh<=targetKmh && b.speedKmh>=targetKmh){ const ratio=(targetKmh-a.speedKmh)/Math.max(.0001,b.speedKmh-a.speedKmh); return mixPoint(a,b,ratio); }} return pts[pts.length-1];
}
function interpolateByDistance(targetM){
  const pts = state.points; for(let i=1;i<pts.length;i++){ const a=pts[i-1],b=pts[i]; if(a.distance<=targetM && b.distance>=targetM){ const ratio=(targetM-a.distance)/Math.max(.0001,b.distance-a.distance); return mixPoint(a,b,ratio); }} return pts[pts.length-1];
}
function mixPoint(a,b,r){ r=clamp(r,0,1); return {elapsed:a.elapsed+(b.elapsed-a.elapsed)*r, speedKmh:a.speedKmh+(b.speedKmh-a.speedKmh)*r, distance:a.distance+(b.distance-a.distance)*r}; }

function stopTest(auto=false){
  if(state.mode !== 'running' && state.mode !== 'armed') return;
  if(!auto && !confirm('確定停止並儲存本次測試？')) return;
  state.mode = 'stopped'; $('startBtn').disabled = false; $('stopBtn').disabled = true;
  setStatus(auto ? '已達自動結束距離，成績已儲存。' : '測試已停止，成績已儲存。', 'good');
  saveRun();
}

function resetRun(clearUi=true, ask=true){
  if(ask && (state.mode === 'running' || state.mode === 'armed' || state.points.length) && !confirm('確定歸零目前測試？未儲存資料會消失。')) return;
  state.mode = state.lastFix ? 'gpsReady' : 'idle';
  state.startTime = 0; state.startFix = null; state.totalDistance = 0; state.currentSpeed = 0; state.maxSpeed = 0; state.points = []; state.speedResults = {}; state.distanceResults = {};
  $('startBtn').disabled = false; $('stopBtn').disabled = true;
  if(clearUi){
    $('speedNow').textContent = state.lastFix ? Math.round(kmh(state.lastFix.speed || 0)) : '0';
    $('elapsed').textContent = '0.000'; $('distanceNow').textContent = '0.0'; $('maxSpeed').textContent = '0';
    setStatus(state.lastFix ? 'GPS 已啟動。按開始測試進入倒數。' : '按「啟動 GPS / 開始」後，請允許定位。', state.lastFix ? 'good' : '');
  }
  renderTargets();
}

function saveRun(){
  if(state.points.length < 2) return;
  const record = { id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())), date: new Date().toLocaleString('zh-TW',{hour12:false}), totalTime: $('elapsed').textContent, totalDistance: state.totalDistance.toFixed(1), maxSpeed: Math.round(state.maxSpeed), speedResults: state.speedResults, distanceResults: state.distanceResults };
  const list = getHistory(); list.unshift(record); localStorage.setItem('dt_history', JSON.stringify(list.slice(0,100))); renderHistory();
}
function getHistory(){ try{return JSON.parse(localStorage.getItem('dt_history') || '[]');}catch(e){return []} }
function renderHistory(){
  const list = getHistory();
  if(!list.length){ $('historyList').className='history empty'; $('historyList').textContent='尚無紀錄'; return; }
  $('historyList').className='history';
  $('historyList').innerHTML = list.map(r=>{ const d150=r.distanceResults?.['150']; const d400=r.distanceResults?.['400']; const s100=r.speedResults?.['100']; return `<div class="historyItem"><b>${r.date}</b><p>最高速度：${r.maxSpeed} km/h｜距離：${r.totalDistance} m｜時間：${r.totalTime}s</p><p>0-100：${s100 ? s100.time + 's' : '--'}｜150m：${d150 ? d150.time + 's / ' + d150.trapSpeed + 'km/h' : '--'}｜400m：${d400 ? d400.time + 's / ' + d400.trapSpeed + 'km/h' : '--'}</p></div>`; }).join('');
}
function clearHistory(){ if(confirm('確定清除所有歷史紀錄？此操作無法復原。')){ localStorage.removeItem('dt_history'); renderHistory(); setStatus('歷史紀錄已清除。','good'); } }

function haversine(a,b){ const R=6371000; const toRad=x=>x*Math.PI/180; const dLat=toRad(b.lat-a.lat), dLon=toRad(b.lon-a.lon), lat1=toRad(a.lat), lat2=toRad(b.lat); const s=Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2; return 2*R*Math.atan2(Math.sqrt(s), Math.sqrt(1-s)); }

function setupTabs(){ document.querySelectorAll('.tab').forEach(btn=>{ btn.addEventListener('click',()=>{ document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active')); document.querySelectorAll('.page').forEach(p=>p.classList.remove('active')); btn.classList.add('active'); $(btn.dataset.page).classList.add('active'); }); }); }
function registerServiceWorker(){ if('serviceWorker' in navigator){ navigator.serviceWorker.register('./sw.js').catch(()=>{}); } }

$('startBtn').addEventListener('click', startTest);
$('gpsBadge').addEventListener('click', ensureGpsWatch);
$('stopBtn').addEventListener('click', ()=>stopTest(false));
$('resetBtn').addEventListener('click', ()=>resetRun(true,true));
$('saveSettingsBtn').addEventListener('click', saveSettings);
$('clearHistoryBtn').addEventListener('click', clearHistory);

setupTabs(); loadSettings(); renderTargets(); renderHistory(); registerServiceWorker(); setGpsUi('off'); setStatus('按「啟動 GPS / 開始」後，請允許定位。');
