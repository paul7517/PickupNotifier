const io = require('socket.io-client');

const URL = 'http://localhost:3000';
let passed = 0;
let failed = 0;
const errors = [];

function assert(condition, testName) {
    if (condition) { passed++; console.log(`  ✅ ${testName}`); }
    else { failed++; errors.push(testName); console.log(`  ❌ FAIL: ${testName}`); }
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runTests() {
    // === Test Room Isolation ===
    console.log('\n🏠 ROOM ISOLATION TEST');
    const roomA1 = io(URL, { query: { room: 'testA' } });
    const roomA2 = io(URL, { query: { room: 'testA' } });
    const roomB1 = io(URL, { query: { room: 'testB' } });

    let stateA1 = {}, stateA2 = {}, stateB1 = {};
    roomA1.on('state-update', s => stateA1 = { ...s });
    roomA2.on('state-update', s => stateA2 = { ...s });
    roomB1.on('state-update', s => stateB1 = { ...s });

    await new Promise(r => roomA1.on('connect', r));
    await new Promise(r => roomA2.on('connect', r));
    await new Promise(r => roomB1.on('connect', r));
    await delay(200);

    // Room A sets state
    roomA1.emit('change-state', { status: 2, meetPoint: 'Room-A-大門口', timelineEvent: '🛒 Room A 呼叫' });
    await delay(200);
    assert(stateA2.status === 2, 'Room A: member 2 sees status 2');
    assert(stateA2.meetPoint === 'Room-A-大門口', 'Room A: meetPoint synced');
    assert(stateB1.status === 0, 'Room B: NOT affected by Room A change');

    // Room B sets different state
    roomB1.emit('change-state', { status: 5, msg: 'Room B 警報', timelineEvent: '⚠️ Room B 警報' });
    await delay(200);
    assert(stateB1.status === 5, 'Room B: sees its own status 5');
    assert(stateA1.status === 2, 'Room A: still at status 2, not affected');

    roomA1.disconnect(); roomA2.disconnect(); roomB1.disconnect();

    // === Test Timeline ===
    console.log('\n📋 TIMELINE TEST');
    const s1 = io(URL, { query: { room: 'timelineTest' } });
    const s2 = io(URL, { query: { room: 'timelineTest' } });
    let timeline = [];
    s2.on('timeline-sync', t => { timeline = [...t]; });

    await new Promise(r => s1.on('connect', r));
    await new Promise(r => s2.on('connect', r));
    await delay(200);

    s1.emit('change-state', { status: 1, meetPoint: 'test', timelineEvent: '🛒 進店' });
    await delay(100);
    s1.emit('change-state', { status: 2, timelineEvent: '🚨 呼叫' });
    await delay(100);
    s1.emit('change-state', { status: 3, eta: 3, targetTime: Date.now() + 180000, timelineEvent: '🚙 司機出發 (3分)' });
    await delay(200);

    assert(timeline.length >= 3, 'Timeline: has at least 3 entries');
    assert(timeline.some(e => e.event.includes('進店')), 'Timeline: contains "進店" event');
    assert(timeline.some(e => e.event.includes('呼叫')), 'Timeline: contains "呼叫" event');
    assert(timeline.some(e => e.event.includes('司機出發')), 'Timeline: contains "司機出發" event');

    s1.disconnect(); s2.disconnect();

    // === Full E2E (3 rounds) ===
    console.log('\n🛒 ROUND 1: Shopper Full Flow');
    const shopper = io(URL, { query: { room: 'e2e' } });
    const driver = io(URL, { query: { room: 'e2e' } });
    let ss = {}, ds = {};
    shopper.on('state-update', s => ss = { ...s });
    driver.on('state-update', s => ds = { ...s });
    await new Promise(r => shopper.on('connect', r));
    await new Promise(r => driver.on('connect', r));
    await delay(200);

    shopper.emit('change-state', 0); await delay(100);
    shopper.emit('change-state', { meetPoint: '大門口', timelineEvent: '📌 設定會合點' }); await delay(100);
    assert(ds.meetPoint === '大門口', 'R1: meetPoint synced');
    shopper.emit('change-state', { status: 1, meetPoint: '大門口', timelineEvent: '🛒 進店' }); await delay(100);
    assert(ds.status === 1, 'R1: status 1');
    shopper.emit('change-state', { status: 2, meetPoint: '大門口', timelineEvent: '🚨 呼叫' }); await delay(100);
    assert(ds.status === 2, 'R1: ALERT');
    driver.emit('change-state', { status: 3, eta: 3, targetTime: Date.now() + 180000, timelineEvent: '🚙 出發(3分)' }); await delay(100);
    assert(ss.status === 3 && ss.eta === 3 && ss.targetTime > 0, 'R1: Shopper sees ETA 3 + targetTime');
    shopper.emit('change-state', { status: 4, msg: '', meetPoint: '大門口', timelineEvent: '✅ 路邊等' }); await delay(100);
    assert(ds.status === 4 && ds.msg !== '我到了，快出來', 'R1: Shopper-initiated status 4');

    console.log('\n🚙 ROUND 2: Driver Flow');
    driver.emit('change-state', 0); await delay(100);
    shopper.emit('change-state', { status: 2, meetPoint: 'https://maps.app.goo.gl/test', timelineEvent: '🚨 呼叫' }); await delay(100);
    driver.emit('change-state', { status: 3, eta: 7, targetTime: Date.now() + 420000, timelineEvent: '🚙 出發(7分)' }); await delay(100);
    assert(ss.eta === 7, 'R2: Custom ETA 7');
    driver.emit('change-state', { status: 4, msg: '我到了，快出來', timelineEvent: '✅ 抵達' }); await delay(100);
    assert(ss.msg === '我到了，快出來', 'R2: Driver arrived msg');

    console.log('\n⚠️ ROUND 3: Edge Cases');
    driver.emit('change-state', 0); await delay(100);
    shopper.emit('change-state', { status: 2, meetPoint: '', timelineEvent: '🚨 空呼叫' }); await delay(100);
    assert(ds.meetPoint === '', 'R3: Empty meetPoint handled');
    shopper.emit('change-state', { status: 5, msg: '缺貨/看LINE', timelineEvent: '⚠️ 缺貨' }); await delay(100);
    assert(ds.msg === '缺貨/看LINE', 'R3: Emergency msg');
    shopper.emit('change-state', { status: 1, msg: '', timelineEvent: '🔄 取消' }); await delay(100);
    assert(ds.status === 1, 'R3: Undo');
    driver.emit('change-state', { status: 5, msg: '警察趕人', timelineEvent: '⚠️ 警察' }); await delay(100);
    assert(ss.status === 5 && ss.msg === '警察趕人', 'R3: Driver warning');
    driver.emit('change-state', 0); await delay(100);
    assert(ds.status === 0, 'R3: Final reset');

    shopper.disconnect(); driver.disconnect();

    // === QR Code API ===
    console.log('\n📱 QR CODE API TEST');
    try {
        const resp = await fetch('http://localhost:3000/api/qrcode?room=testQR');
        const data = await resp.json();
        assert(data.qr && data.qr.startsWith('data:image'), 'QR: Returns valid data URL');
        assert(data.url.includes('testQR'), 'QR: URL contains room ID');
    } catch (err) {
        assert(false, 'QR: API reachable - ' + err.message);
    }

    // ====== SUMMARY ======
    console.log('\n' + '='.repeat(50));
    console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
    if (errors.length > 0) {
        console.log('❌ Failed tests:');
        errors.forEach(e => console.log(`   - ${e}`));
    } else {
        console.log('🎉 ALL TESTS PASSED!');
    }
    console.log('='.repeat(50));
    process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => { console.error('Test error:', err); process.exit(1); });
