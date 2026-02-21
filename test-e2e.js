const io = require('socket.io-client');
const URL = 'http://localhost:3000';
let passed = 0, failed = 0;
const errors = [];

function assert(ok, name) {
    if (ok) { passed++; console.log(`  ✅ ${name}`); }
    else { failed++; errors.push(name); console.log(`  ❌ ${name}`); }
}
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
    const rider = io(URL, { query: { room: 'test8' } });
    const driver = io(URL, { query: { room: 'test8' } });
    let rs = {}, ds = {}, tl = [];
    rider.on('state-update', s => rs = { ...s });
    driver.on('state-update', s => ds = { ...s });
    driver.on('timeline-sync', t => tl = [...t]);

    await new Promise(r => rider.on('connect', r));
    await new Promise(r => driver.on('connect', r));
    await delay(200);

    // ========== ROUND 1: Happy Path (完整正常流程) ==========
    console.log('\n🔄 ROUND 1: Happy Path');
    rider.emit('change-state', 0); await delay(100);
    assert(ds.status === 0, 'R1: Reset OK');

    rider.emit('change-state', { meetPoint: '大門口' }); await delay(100);
    assert(ds.meetPoint === '大門口', 'R1: meetPoint sync');

    rider.emit('change-state', { status: 2, meetPoint: '大門口', msg: '', eta: null, timelineEvent: '🚨 乘客呼叫接送' }); await delay(100);
    assert(ds.status === 2, 'R1: Rider calls → Driver sees status 2');

    driver.emit('change-state', { status: 3, eta: null, targetTime: null, timelineEvent: '🚙 司機已接受' }); await delay(100);
    assert(rs.status === 3, 'R1: Driver accepts → Rider sees status 3');
    assert(rs.eta === null, 'R1: ETA null initially (driver checking map)');

    driver.emit('change-state', { status: 3, eta: 5, targetTime: Date.now() + 300000, timelineEvent: '🚙 司機出發 (5分)' }); await delay(100);
    assert(rs.eta === 5, 'R1: ETA = 5 after driver reports');
    assert(rs.targetTime > Date.now(), 'R1: targetTime in future');

    driver.emit('change-state', { status: 4, msg: '我到了，快出來', timelineEvent: '✅ 司機已抵達' }); await delay(100);
    assert(rs.status === 4, 'R1: Driver arrived → Rider sees 4');
    assert(rs.msg === '我到了，快出來', 'R1: Arrival msg correct');

    // ========== ROUND 2: Rider cancels ==========
    console.log('\n🔄 ROUND 2: Cancel Flow');
    rider.emit('change-state', 0); await delay(100);

    rider.emit('change-state', { status: 2, meetPoint: '旁邊巷口', msg: '', eta: null, timelineEvent: '🚨 呼叫' }); await delay(100);
    assert(ds.status === 2, 'R2: Call sent');

    rider.emit('change-state', { status: 0, msg: '', eta: null, timelineEvent: '❌ 乘客取消呼叫' }); await delay(100);
    assert(ds.status === 0, 'R2: Cancel → back to 0');
    assert(ds.meetPoint === '旁邊巷口', 'R2: meetPoint preserved after cancel');

    // ========== ROUND 3: Emergency during ride ==========
    console.log('\n🔄 ROUND 3: Emergency (status 5)');
    rider.emit('change-state', 0); await delay(100);

    rider.emit('change-state', { status: 2, meetPoint: '對面馬路', msg: '', eta: null, timelineEvent: '🚨 呼叫' }); await delay(100);
    driver.emit('change-state', { status: 3, eta: 3, targetTime: Date.now() + 180000, timelineEvent: '🚙 出發 (3分)' }); await delay(100);
    assert(rs.status === 3 && rs.eta === 3, 'R3: Enroute with ETA 3');

    rider.emit('change-state', { status: 5, msg: '缺貨/看LINE', meetPoint: '對面馬路', eta: null, timelineEvent: '⚠️ 缺貨' }); await delay(100);
    assert(ds.status === 5, 'R3: Driver sees status 5');
    assert(ds.msg === '缺貨/看LINE', 'R3: Emergency msg received');

    driver.emit('change-state', { status: 5, msg: '警察趕人，我要繞一圈', timelineEvent: '⚠️ 警察趕人' }); await delay(100);
    assert(rs.status === 5, 'R3: Rider sees driver warning');
    assert(rs.msg === '警察趕人，我要繞一圈', 'R3: Warning msg correct');

    // ========== ROUND 4: Rider ready before driver arrives ==========
    console.log('\n🔄 ROUND 4: Rider ready first');
    rider.emit('change-state', 0); await delay(100);

    rider.emit('change-state', { status: 2, meetPoint: '原下車處', msg: '', eta: null, timelineEvent: '🚨 呼叫' }); await delay(100);
    driver.emit('change-state', { status: 3, eta: 7, targetTime: Date.now() + 420000, timelineEvent: '🚙 出發 (7分)' }); await delay(100);

    rider.emit('change-state', { status: 4, msg: '', meetPoint: '原下車處', eta: null, timelineEvent: '✅ 乘客已在路邊' }); await delay(100);
    assert(ds.status === 4, 'R4: Driver sees status 4 (rider ready)');
    assert(ds.msg !== '我到了，快出來', 'R4: msg is NOT driver-arrived msg');

    // Verify countdown was cleared
    assert(rs.targetTime === null || rs.status !== 3, 'R4: Countdown should stop on status != 3');

    // ========== ROUND 5: Custom ETA + GMap URL + Room Isolation ==========
    console.log('\n🔄 ROUND 5: Custom ETA + URL + Room Isolation');

    // Room isolation check
    const otherRoom = io(URL, { query: { room: 'other' } });
    let otherState = {};
    otherRoom.on('state-update', s => otherState = { ...s });
    await new Promise(r => otherRoom.on('connect', r));
    await delay(100);

    rider.emit('change-state', 0); await delay(100);

    rider.emit('change-state', { status: 2, meetPoint: 'https://maps.app.goo.gl/xyz', msg: '', eta: null, timelineEvent: '🚨 呼叫' }); await delay(100);
    assert(ds.meetPoint === 'https://maps.app.goo.gl/xyz', 'R5: GMap URL synced');
    assert(otherState.status === 0, 'R5: Room isolation — other room NOT affected');

    driver.emit('change-state', { status: 3, eta: 12, targetTime: Date.now() + 720000, timelineEvent: '🚙 出發 (12分)' }); await delay(100);
    assert(rs.eta === 12, 'R5: Custom ETA 12 works');

    driver.emit('change-state', { status: 4, msg: '我到了，快出來', timelineEvent: '✅ 抵達' }); await delay(100);
    assert(rs.msg === '我到了，快出來', 'R5: Arrival complete');
    assert(otherState.status === 0, 'R5: Room isolation confirmed');

    otherRoom.disconnect();

    // ========== TIMELINE CHECK ==========
    console.log('\n📋 TIMELINE CHECK');
    await delay(200);
    assert(tl.length >= 5, `Timeline: ${tl.length} entries (>=5 expected)`);
    assert(tl.some(e => e.event && typeof e.time === 'number'), 'Timeline: entries have proper structure');

    // ========== QR API ==========
    console.log('\n📱 QR API');
    try {
        const resp = await fetch('http://localhost:3000/api/qrcode?room=test8');
        const data = await resp.json();
        assert(data.qr && data.qr.startsWith('data:image'), 'QR: Valid data URL');
        assert(data.url.includes('test8'), 'QR: Contains room ID');
    } catch (e) { assert(false, 'QR: API error - ' + e.message); }

    // ========== SUMMARY ==========
    console.log('\n' + '='.repeat(50));
    console.log(`📊 Results: ${passed} passed, ${failed} failed`);
    if (errors.length) { errors.forEach(e => console.log(`  ❌ ${e}`)); }
    else { console.log('🎉 ALL TESTS PASSED!'); }
    console.log('='.repeat(50));

    rider.disconnect(); driver.disconnect();
    process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
