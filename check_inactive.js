const fs = require('fs');
const path = require('path');

const dir = __dirname;
const dataDir = path.join(dir, 'data');
const snapshotDir = path.join(dir, 'data_snapshot');

if (!fs.existsSync(snapshotDir)) {
    fs.mkdirSync(snapshotDir);
}

if (!fs.existsSync(dataDir)) {
    console.error('[오류] data 폴더를 찾을 수 없습니다. 크롤러를 먼저 실행해 주세요.');
    process.exit(1);
}

const currentFiles = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
const snapshotFiles = fs.readdirSync(snapshotDir).filter(f => f.endsWith('.json'));

const inactiveStreamers = [];
let totalEvaluated = 0;
let totalSkipped = 0;

// 💡 24시간 기준 (밀리초 변환). 크론탭 주기를 고려해 23.8시간으로 약간의 유격을 둡니다.
const GRACE_PERIOD_MS = 23.8 * 60 * 60 * 1000;

console.log('🔍 개별 스냅샷 생성 후 24시간이 경과한 스트리머들을 타겟팅하여 분석합니다...\n');

for (const file of currentFiles) {
    const currentFilePath = path.join(dataDir, file);
    const snapshotFilePath = path.join(snapshotDir, file);

    // 1. 스냅샷이 아예 없는 신규 스트리머는 지금 스냅샷을 찍고 24시간 타이머 시작
    if (!fs.existsSync(snapshotFilePath)) {
        fs.copyFileSync(currentFilePath, snapshotFilePath);
        continue;
    }

    // 2. 스냅샷 파일의 마지막 수정 시간 확인
    const snapshotStat = fs.statSync(snapshotFilePath);
    const ageMs = Date.now() - snapshotStat.mtimeMs;
    const ageHours = (ageMs / (1000 * 60 * 60)).toFixed(1);

    // 3. 아직 24시간이 안 지났다면 이번 검사에서는 패스 (유예 기간 보장)
    if (ageMs < GRACE_PERIOD_MS) {
        totalSkipped++;
        continue;
    }

    // 4. 24시간이 경과한 스트리머만 본격적인 비교 평가 시작
    try {
        const currentData = JSON.parse(fs.readFileSync(currentFilePath, 'utf-8')).streamer;
        const snapshotData = JSON.parse(fs.readFileSync(snapshotFilePath, 'utf-8')).streamer;

        totalEvaluated++;

        const yesterdayEndangered = new Set((snapshotData.vods || []).map(v => String(v.titleNo)));
        const todaySafe = new Set((currentData.safeVods || []).map(v => String(v.titleNo)));

        let savedCount = 0;
        for (const titleNo of yesterdayEndangered) {
            if (todaySafe.has(titleNo)) {
                savedCount++;
            }
        }

        if (savedCount === 0 && yesterdayEndangered.size > 0) {
            inactiveStreamers.push({
                id: currentData.id,
                nickname: currentData.nickname,
                yesterdayEndangeredCount: yesterdayEndangered.size,
                todayEndangeredCount: (currentData.vods || []).length,
                ageHours: ageHours // 실제 경과 시간 기록
            });
        }

        // 5. ⭐️ 평가가 완료된 스트리머만 스냅샷을 덮어씌워 다음 24시간 타이머를 리셋함
        fs.copyFileSync(currentFilePath, snapshotFilePath);

    } catch (e) {
        console.error(`[오류] ${file} 파일 분석 실패: ${e.message}`);
    }
}

// 6. 삭제된 스트리머의 스냅샷 찌꺼기 정리
for (const file of snapshotFiles) {
    if (!currentFiles.includes(file)) {
        fs.unlinkSync(path.join(snapshotDir, file));
    }
}

// ==========================================
// 리포트 출력부
// ==========================================
console.log(`==================================================`);
console.log(`📊 분석 완료 (이번 시간 평가 대상: ${totalEvaluated}명 / 대기 중인 대상: ${totalSkipped}명)`);
console.log(`==================================================`);

if (totalEvaluated === 0) {
    console.log('✅ 현재 24시간이 경과하여 평가 기준에 도달한 스냅샷이 없습니다.');
} else if (inactiveStreamers.length === 0) {
    console.log('✅ 평가 대상 스트리머들의 위기 영상이 모두 성공적으로 구출(전환)되었습니다!');
} else {
    console.log(`⚠️ 최근 24시간 동안 [소멸예정 ➔ 영구보관] 전환이 단 1개도 없는 스트리머 (${inactiveStreamers.length}명):\n`);
    inactiveStreamers.forEach(s => {
        console.log(`- ${s.nickname} (${s.id}) [측정 시간: ${s.ageHours}시간]`);
        console.log(`  * 어제 기준 소멸예정 영상: ${s.yesterdayEndangeredCount}개`);
        console.log(`  * 오늘 기준 소멸예정 영상: ${s.todayEndangeredCount}개`);
        console.log(`  --------------------------------------------`);
    });
}