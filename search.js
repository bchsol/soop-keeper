const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { google } = require('googleapis');
const { setGlobalDispatcher, Agent } = require('undici');
require('dotenv').config({ path: path.join(__dirname, '.env') });

setGlobalDispatcher(new Agent({
    connections: 250,
    pipelining: 10,
    keepAliveTimeout: 30000,
    keepAliveMaxTimeout: 60000
}));

async function runWithConcurrencyLimit(tasks, limit) {
    const results = [];
    const executing = new Set();

    for (const task of tasks) {
        const p = Promise.resolve().then(() => task());
        results.push(p);
        executing.add(p);
        const clean = () => executing.delete(p);
        p.then(clean).catch(clean);

        if (executing.size >= limit) {
            await Promise.race(executing);
        }
    }
    return Promise.all(results);
}

const GOOGLE_FOLDER_ID = process.env.GOOGLE_FOLDER_ID;
let GOOGLE_KEY_PATH = path.join(__dirname, 'google-key.json');

function writeLog(message) {
    const now = new Date();
    const timeStr = `${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}`;
    const logMsg = `[${timeStr}] ${message}`;
    console.log(logMsg);
}

const r2 = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});
const R2_BUCKET = process.env.R2_BUCKET_NAME;

let serverId = 1;
let totalServers = 1;

process.argv.forEach(arg => {
    if (arg.startsWith('--server=')) {
        serverId = parseInt(arg.split('=')[1], 10) || 1;
    } else if (arg.startsWith('--total=')) {
        totalServers = parseInt(arg.split('=')[1], 10) || 1;
    }
});

if (serverId > 1) {
    GOOGLE_KEY_PATH = path.join(__dirname, `google-key${serverId}.json`);
}

const targetArg = process.argv.find(arg => arg.startsWith('--target='));
const TARGET_STREAMER = targetArg ? targetArg.split('=')[1].trim().toLowerCase() : null;

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

const IGNORE_ZERO = true; // [옵션] 이전 크롤링에서 소멸예정이 0개였던 스트리머는 아예 크롤링을 생략합니다. (새로운 VOD 감지 불가)
const USE_TOP_API = process.argv.includes('--use-top'); // [옵션] --use-top 플래그가 있을 때만 Top API 폴백을 사용합니다.

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const STREAMER_BATCH = 30; // 스트리머 동시 처리 수 (IGNORE_ZERO 스킵이 많으므로 넉넉하게)
const BATCH_SIZE = 100;    // VOD 동시 처리 수
const LIST_PAGE_BATCH = 10;
const LIST_DELAY = 0;
const BATCH_DELAY = 0;
const MAX_RETRIES = 2;

const CACHE_FILE = path.join(__dirname, 'cache.json');
let cache = { permanent: {}, safe: {}, meta: {}, endangered: {} };
let isUpdatingSheets = false;

function loadCache() {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const content = fs.readFileSync(CACHE_FILE, 'utf-8').trim();
            if (!content) {
                writeLog('캐시 파일이 비어 있어 초기화합니다.');
                cache = { permanent: {}, safe: {}, meta: {}, endangered: {} };
                return;
            }
            cache = JSON.parse(content);
            if (!cache.permanent) cache.permanent = {};
            if (!cache.safe) cache.safe = {};
            if (!cache.meta) cache.meta = {};
            if (!cache.endangered) cache.endangered = {};
            const permCount = Object.keys(cache.permanent).length;
            const safeCount = Object.keys(cache.safe).length;
            const metaCount = Object.keys(cache.meta).length;
            writeLog(`캐시 로드: 영구보관 ${permCount}개, 안전 ${safeCount}개, 메타 ${metaCount}개`);
        }
    } catch (e) {
        writeLog(`캐시 파싱 실패: ${e.message}`);
        cache = { permanent: {}, safe: {}, meta: {}, endangered: {} };
    }
}

let isSaving = false;
let savePending = false;

async function saveCache() {
    if (isSaving) {
        savePending = true;
        return;
    }
    isSaving = true;
    savePending = false;

    try {
        let diskCache = { permanent: {}, safe: {}, meta: {}, endangered: {}, sheets: {} };
        if (fs.existsSync(CACHE_FILE)) {
            try {
                const diskData = await fs.promises.readFile(CACHE_FILE, 'utf-8');
                diskCache = JSON.parse(diskData);
            } catch (err) { }
        }

        // 메모리와 디스크 캐시 병합 (다른 PM2 프로세스나 수동 스크립트가 저장한 데이터 보존)
        cache.permanent = { ...diskCache.permanent, ...cache.permanent };
        cache.safe = { ...diskCache.safe, ...cache.safe };
        cache.meta = { ...diskCache.meta, ...cache.meta };
        cache.endangered = { ...diskCache.endangered, ...cache.endangered };
        cache.sheets = { ...diskCache.sheets, ...cache.sheets };

        const tempFile = `${CACHE_FILE}.tmp`;
        await fs.promises.writeFile(tempFile, JSON.stringify(cache), 'utf-8');
        await fs.promises.rename(tempFile, CACHE_FILE);
    } catch (e) {
        writeLog(`캐시 저장 실패: ${e.message}`);
    } finally {
        isSaving = false;
        if (savePending) {
            // 대기 중인 저장이 있다면 겹치지 않게 순차 실행
            saveCache();
        }
    }
}
const MAX_CONCURRENT_REQUESTS = 250; // 일반 API(별풍선 등) 동시 요청 한도는 다시 시원하게 풉니다!
let currentRequests = 0;
const requestQueue = [];

async function acquireRequest() {
    if (currentRequests < MAX_CONCURRENT_REQUESTS) {
        currentRequests++;
        return;
    }
    return new Promise(resolve => requestQueue.push(resolve));
}

function releaseRequest() {
    currentRequests--;
    if (requestQueue.length > 0) {
        currentRequests++;
        const next = requestQueue.shift();
        next();
    }
}

const MAX_VIEW_CONCURRENT = 100; // view API는 SOOP 서버가 민감하므로 30개까지만 동시 허용
let currentViewRequests = 0;
const viewRequestQueue = [];

async function acquireViewRequest() {
    if (currentViewRequests < MAX_VIEW_CONCURRENT) {
        currentViewRequests++;
        return;
    }
    return new Promise(resolve => viewRequestQueue.push(resolve));
}

function releaseViewRequest() {
    currentViewRequests--;
    if (viewRequestQueue.length > 0) {
        currentViewRequests++;
        const next = viewRequestQueue.shift();
        next();
    }
}

async function fetchWithRetry(url, options, retries = MAX_RETRIES) {
    const isViewApi = url.includes('/station/video/a/view');

    for (let i = 0; i <= retries; i++) {
        if (isViewApi) await acquireViewRequest();
        else await acquireRequest();

        try {
            const fetchOptions = { ...options, signal: AbortSignal.timeout(15000) };
            const res = await fetch(url, fetchOptions);

            if (res.status === 429) {
                writeLog(`\n [경고] 서버 한계 도달! (HTTP 429) [URL: ${url}] - 재시도 중...`);
            } else if (!res.ok) {
                writeLog(` ⚠️ HTTP 오류: ${res.status} [URL: ${url}] - 재시도 중...`);
            }
            if (!res.ok && i < retries) {
                if (isViewApi) releaseViewRequest();
                else releaseRequest();
                await delay(1000);
                continue;
            }
            const data = await res.json();

            if (isViewApi) releaseViewRequest();
            else releaseRequest();

            return data;
        } catch (e) {
            if (isViewApi) releaseViewRequest();
            else releaseRequest();

            if (e.name === 'TimeoutError' || e.name === 'AbortError') {
                writeLog(` ⏱️ 타임아웃 발생 [URL: ${url}] - 재시도 중...`);
            } else {
                writeLog(` ❌ 네트워크/파싱 에러 [${e.code || e.name}: ${e.message}] [URL: ${url}] - 재시도 중...`);
            }
            if (i === retries) {
                writeLog(` 🚨 [최종 실패] 최대 재시도 초과 [URL: ${url}]`);
                return null;
            }
            await delay(1000);
        }
    }
    return null;
}

async function fetchVodList(streamerId) {
    const firstPage = await fetchWithRetry(
        `https://bjapi.afreecatv.com/api/${streamerId}/vods?page=1`,
        { headers: { "User-Agent": USER_AGENT, "Referer": `https://bj.afreecatv.com/${streamerId}/vods` } }
    );
    if (!firstPage || !firstPage.data) return [];

    let allVods = [...firstPage.data];
    const totalPages = firstPage.meta?.last_page || 1;

    for (let start = 2; start <= totalPages; start += LIST_PAGE_BATCH) {
        const end = Math.min(start + LIST_PAGE_BATCH - 1, totalPages);
        const pageNums = [];
        for (let p = start; p <= end; p++) pageNums.push(p);

        const pageResults = await Promise.all(
            pageNums.map(page =>
                fetchWithRetry(
                    `https://bjapi.afreecatv.com/api/${streamerId}/vods?page=${page}`,
                    { headers: { "User-Agent": USER_AGENT, "Referer": `https://bj.afreecatv.com/${streamerId}/vods` } }
                )
            )
        );
        for (let i = 0; i < pageResults.length; i++) {
            let result = pageResults[i];
            let retryPage = pageNums[i];
            let attempts = 0;
            // 만약 타임아웃 등으로 해당 페이지가 날아갔다면, 될 때까지 개별 재시도 (최대 5번 추가 시도)
            while ((!result || !result.data) && attempts < 5) {
                writeLog(` [경고] ${streamerId}의 VOD 목록 ${retryPage}페이지 누락 감지! 즉시 개별 재시도 중... (${attempts + 1}/5)`);
                await delay(1000);
                result = await fetchWithRetry(
                    `https://bjapi.afreecatv.com/api/${streamerId}/vods?page=${retryPage}`,
                    { headers: { "User-Agent": USER_AGENT, "Referer": `https://bj.afreecatv.com/${streamerId}/vods` } }
                );
                attempts++;
            }
            if (result?.data) {
                allVods.push(...result.data);
            } else {
                writeLog(` [치명적 오류] ${streamerId}의 VOD 목록 ${retryPage}페이지를 끝내 가져오지 못해 일부 영상이 증발할 수 있습니다!`);
            }
        }
        if (end < totalPages) await delay(LIST_DELAY);
    }
    return allVods;
}

async function fetchVodDetail(titleNo) {
    const json = await fetchWithRetry("https://api.m.sooplive.com/station/video/a/view", {
        headers: { "User-Agent": USER_AGENT, "content-type": "application/x-www-form-urlencoded", "Referer": `https://vod.sooplive.com/player/${titleNo}` },
        body: `nTitleNo=${titleNo}&nApiLevel=11&nPlaylistIdx=0`,
        method: "POST"
    });
    return json?.data || {};
}

async function fetchVodGiftDetailAndAggregate(bbsNo, stationNo, titleNo, bjId, permanence, autoDeleteDate) {
    if (!bbsNo || !stationNo) return { totalGifts: 0, supporters: [] };

    let totalGifts = 0;
    const supMap = {};

    function processItems(listData) {
        if (!Array.isArray(listData)) return;
        for (const item of listData) {
            const isGiftType = item.item_type === 'STARBALLOON' || item.item_type === 'ADBALLOON' || item.gift_cnt || item.ad_cnt;
            if (!isGiftType) continue;

            const cnt = parseInt(item.gift_cnt || "0", 10) + parseInt(item.ad_cnt || "0", 10);
            if (cnt > 0) {
                totalGifts += cnt;
                const senderId = item.user_id;
                const regDateStr = item.reg_date ? item.reg_date.substring(0, 10) : '1970-01-01';

                if (!supMap[senderId]) supMap[senderId] = { id: senderId, nick: item.user_nick, cnt: 0, history: {} };
                supMap[senderId].cnt += cnt;
                supMap[senderId].history[regDateStr] = (supMap[senderId].history[regDateStr] || 0) + cnt;
            }
        }
    }

    const firstPageJson = await fetchWithRetry(`https://stbbs.sooplive.com/api/bbs_memo_action.php`, {
        method: "POST",
        headers: { "User-Agent": USER_AGENT, "content-type": "application/x-www-form-urlencoded", "Referer": `https://vod.sooplive.com/player/${titleNo}` },
        body: `nStationNo=${stationNo}&nBbsNo=${bbsNo}&nTitleNo=${titleNo}&bj_id=${bjId}&nPageNo=1&nOrderNo=1&nBoardType=105&szAction=get&nVod=1&nLastNo=0`
    });

    const firstListData = firstPageJson?.CHANNEL?.DATA?.list_data;
    if (firstListData && firstListData.length > 0) {
        processItems(firstListData);

        const totalCnt = parseInt(firstPageJson?.CHANNEL?.DATA?.TOTAL_CNT || "0", 10);
        const maxPage = Math.min(Math.ceil(totalCnt / 20) || 1, 50);

        if (maxPage > 1) {
            const pageNums = [];
            for (let p = 2; p <= maxPage; p++) pageNums.push(p);

            for (let i = 0; i < pageNums.length; i += 25) {
                const chunk = pageNums.slice(i, i + 25);
                const chunkResults = await Promise.all(chunk.map(p =>
                    fetchWithRetry(`https://stbbs.sooplive.com/api/bbs_memo_action.php`, {
                        method: "POST",
                        headers: { "User-Agent": USER_AGENT, "content-type": "application/x-www-form-urlencoded", "Referer": `https://vod.sooplive.com/player/${titleNo}` },
                        body: `nStationNo=${stationNo}&nBbsNo=${bbsNo}&nTitleNo=${titleNo}&bj_id=${bjId}&nPageNo=${p}&nOrderNo=1&nBoardType=105&szAction=get&nVod=1&nLastNo=0`
                    })
                ));

                chunkResults.forEach(res => processItems(res?.CHANNEL?.DATA?.list_data));
            }
        }
    }

    // [Fallback] --use-top 플래그가 있거나, 이미 영구보관(permanence === 'Y') 또는 소멸예정일이 없는 안전 영상인 경우 Top API를 사용하여 확인
    const isAlreadySafe = (permanence === 'Y' || !autoDeleteDate);
    if (totalGifts < 10 && (USE_TOP_API || isAlreadySafe)) {
        const topJson = await fetchWithRetry(`https://item.m.sooplive.com/api/vod/starballoon/a/top`, {
            method: "POST",
            headers: { "User-Agent": USER_AGENT, "content-type": "application/x-www-form-urlencoded", "Referer": `https://vod.sooplive.com/player/${titleNo}` },
            body: `count=100&title_no=${titleNo}`
        });

        if (topJson?.data?.list && Array.isArray(topJson.data.list)) {
            for (const item of topJson.data.list) {
                const senderId = item.sender_id;
                const topCnt = parseInt(item.gift_cnt || "0", 10);

                if (topCnt > 0) {
                    if (!supMap[senderId]) supMap[senderId] = { id: senderId, nick: item.sender_nick, cnt: 0, history: {} };

                    const currentCnt = supMap[senderId].cnt;
                    if (topCnt > currentCnt) {
                        const diff = topCnt - currentCnt;
                        supMap[senderId].cnt = topCnt;
                        totalGifts += diff;
                        supMap[senderId].history['1970-01-01'] = (supMap[senderId].history['1970-01-01'] || 0) + diff;
                    }
                }
            }
        }
    }

    const supporters = Object.values(supMap).map(s => ({
        id: s.id, nick: s.nick, cnt: s.cnt,
        history: Object.entries(s.history).map(([date, cnt]) => ({ date, cnt }))
    }));

    return { totalGifts, supporters };
}

async function processStreamer(streamerId) {
    // 괱신 중단 목록 체크: 기존 데이터가 있으면 그대로 반환, 없으면 null
    if (deleteSet.has(streamerId.toLowerCase())) {
        const dataPath = path.join(__dirname, 'data', `${streamerId}.json`);
        if (fs.existsSync(dataPath)) {
            try {
                const existingData = JSON.parse(await fs.promises.readFile(dataPath, 'utf8'));
                if (existingData.streamer) {
                    writeLog(`⏸️ [${streamerId}] 괱신 중단 스트리머 (기존 데이터 유지)`);
                    existingData.streamer._skipped = true;
                    return existingData.streamer;
                }
            } catch (e) { }
        }
        writeLog(`⏸️ [${streamerId}] 괱신 중단 스트리머 (기존 데이터 없음, 건너뜀)`);
        return null;
    }


    if (IGNORE_ZERO && !TARGET_STREAMER) {
        const dataPath = path.join(__dirname, 'data', `${streamerId}.json`);
        if (fs.existsSync(dataPath)) {
            try {
                const existingData = JSON.parse(await fs.promises.readFile(dataPath, 'utf8'));
                if (existingData.streamer && (!existingData.streamer.vods || existingData.streamer.vods.length === 0)) {
                    writeLog(`⏭️ [${streamerId}] 소멸예정 0개이므로 크롤링 건너뜀 (IGNORE_ZERO 옵션 활성화)`);
                    existingData.streamer._skipped = true;
                    return existingData.streamer;
                }
            } catch (e) { }
        }
    }

    const vodList = await fetchVodList(streamerId);
    if (vodList.length === 0) return null;

    const endangeredList = [];
    const safeList = [];
    const reviews = vodList.filter(v => v.ucc?.file_type === 'REVIEW');
    const candidates = [];

    const BROAD_CHANGE_DATE = new Date('2025-01-14T11:35:00').getTime();

    for (const vod of reviews) {
        const titleNo = vod.title_no;
        const cachedObj = cache.permanent[titleNo];

        if (cachedObj && (cachedObj.v > 1000 || (cachedObj.b || 0) >= 10)) {
            safeList.push({
                titleNo: titleNo,
                title: vod.title_name,
                viewCount: cachedObj.v,
                thumbnail: vod.ucc?.thumb || '',
                deleteDate: '안전',
                balloons: cachedObj.b || 0,
                supporters: cachedObj.s || [],
                duration: Math.round((vod.ucc?.total_file_duration || 0) / 60000),
                isPlus: (vod.auth_no === 107)
            });
            continue;
        }

        // 영구보관 캐시에 있지만 조건 미충족 (별풍 <10, 조회수 <1000)
        if (cache.permanent[titleNo]) {
            if (USE_TOP_API) {
                // --use-top 모드: Top API로 재검사하기 위해 candidates에 포함
                delete cache.meta[titleNo]; // meta 캐시 삭제하여 view API도 다시 호출
                candidates.push(vod);
            } else {
                // 일반 모드: 영구보관이면 안전 처리
                safeList.push({
                    titleNo: titleNo,
                    title: vod.title_name,
                    viewCount: cachedObj?.v || 0,
                    thumbnail: vod.ucc?.thumb || '',
                    deleteDate: '안전',
                    balloons: cachedObj?.b || 0,
                    supporters: cachedObj?.s || [],
                    duration: Math.round((vod.ucc?.total_file_duration || 0) / 60000),
                    isPlus: (vod.auth_no === 107)
                });
            }
            continue;
        }

        candidates.push(vod);
    }

    if (candidates.length === 0) {
        writeLog(`✅ [${streamerId}] 검사 완료 (이미 완성된 영상만 있음)`);
        return {
            id: streamerId,
            nickname: vodList[0]?.user_nick || streamerId,
            profileImg: `https://stimg.sooplive.com/LOGO/${streamerId.substring(0, 2)}/${streamerId}/${streamerId}.jpg`,
            vods: endangeredList,
            safeVods: safeList
        };
    }

    writeLog(`   ⏳ [${streamerId}] VOD 상세 데이터 분석 중... (동시성 큐 처리, 총 ${candidates.length}개)`);

    const tasks = candidates.map(vod => async () => {
        const titleNo = vod.title_no;
        const cachedMeta = cache.meta[titleNo];
        let bbsNo, stationNo, autoDeleteDate, permanence;
        let finalViewCount = vod.count?.vod_read_cnt || 0;

        const vodDateStr = vod.reg_date || "1970-01-01";
        const broadStart = new Date(vodDateStr).getTime();
        const isOldVod = broadStart > 0 && broadStart < BROAD_CHANGE_DATE;

        const needDetailForViews = finalViewCount <= 1 || isOldVod;
        const META_CACHE_TTL = 1 * 60 * 60 * 1000; // 1시간마다 메타 정보(영구보관 여부, 소멸예정일) 업데이트
        const metaAge = cachedMeta?.t ? (Date.now() - cachedMeta.t) : Infinity;
        const forceMetaRefresh = cachedMeta && cachedMeta.pm !== 'Y' && (metaAge > META_CACHE_TTL || !!TARGET_STREAMER);

        if (cachedMeta && !forceMetaRefresh) {
            bbsNo = cachedMeta.bn;
            stationNo = cachedMeta.sn;
            autoDeleteDate = cachedMeta.ad;
            permanence = cachedMeta.pm;
            // old VOD나 조회수≤1: 이전 사이클에서 수집한 정확한 조회수 재활용
            if (needDetailForViews && cache.endangered?.[titleNo]?.v) {
                finalViewCount = cache.endangered[titleNo].v;
            }
        } else {
            const viewData = await fetchVodDetail(titleNo);

            if (!viewData || Object.keys(viewData).length === 0) {
                const fallbackViews = finalViewCount;
                const fallbackVod = {
                    titleNo: titleNo, title: vod.title_name, deleteDate: '분석 지연(재검사 예정)',
                    viewCount: fallbackViews, balloons: 0, thumbnail: vod.ucc?.thumb || '',
                    supporters: [], duration: Math.round((vod.ucc?.total_file_duration || 0) / 60000),
                    isPlus: (vod.auth_no === 107)
                };
                if (fallbackViews >= 1000) {
                    fallbackVod.deleteDate = '안전';
                    return { status: 'safe', data: fallbackVod };
                }
                return { status: 'endangered', data: fallbackVod };
            }

            bbsNo = viewData.bbs_no;
            stationNo = viewData.station_no;
            autoDeleteDate = viewData.auto_delete_date;
            permanence = viewData.permanence;

            if (isOldVod) {
                finalViewCount = viewData.view_cnt || finalViewCount;
            } else {
                if (finalViewCount <= 1 && viewData.view_cnt > 1) {
                    const liveView = viewData.live_total_view || vod.live_total_view || 0;
                    finalViewCount = Math.max(0, viewData.view_cnt - liveView);
                }
            }

            cache.meta[titleNo] = { bn: bbsNo, sn: stationNo, ad: autoDeleteDate, pm: permanence, t: Date.now() };
        }

        const { totalGifts, supporters } = await fetchVodGiftDetailAndAggregate(bbsNo, stationNo, titleNo, streamerId, permanence, autoDeleteDate);

        const detailedVod = {
            titleNo: titleNo, title: vod.title_name, deleteDate: autoDeleteDate,
            viewCount: finalViewCount, balloons: totalGifts, thumbnail: vod.ucc?.thumb || '',
            supporters: supporters, duration: Math.round((vod.ucc?.total_file_duration || 0) / 60000),
            isPlus: (vod.auth_no === 107)
        };

        if (permanence === 'Y' || !autoDeleteDate) {
            cache.permanent[titleNo] = { b: totalGifts, s: supporters, v: finalViewCount };
            delete cache.meta[titleNo];
            if (cache.endangered) delete cache.endangered[titleNo];
            detailedVod.deleteDate = '안전';
            return { status: 'safe', data: detailedVod };
        }


        if (!cache.endangered) cache.endangered = {};
        cache.endangered[titleNo] = { v: finalViewCount, b: totalGifts, s: supporters, ad: autoDeleteDate, t: Date.now() };
        return { status: 'endangered', data: detailedVod };
    });

    const results = await runWithConcurrencyLimit(tasks, BATCH_SIZE);

    for (const res of results) {
        if (res.status === 'safe') safeList.push(res.data);
        else if (res.status === 'endangered') endangeredList.push(res.data);
    }

    safeList.sort((a, b) => b.titleNo - a.titleNo);
    writeLog(`✅ [${streamerId}] 검사 완료 (위기 VOD: ${endangeredList.length}개, 영구보관/안전: ${safeList.length}개)`);
    return {
        id: streamerId, nickname: vodList[0]?.user_nick || streamerId,
        profileImg: `https://stimg.sooplive.com/LOGO/${streamerId.substring(0, 2)}/${streamerId}/${streamerId}.jpg`,
        vods: endangeredList, safeVods: safeList
    };
}

// 구글 API 에러(Quota 및 Internal 500) 방지용 재시도 함수
async function retryApi(apiFunc, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await apiFunc();
        } catch (error) {
            const isQuota = error.code === 429 || (error.message && error.message.includes('Quota'));
            const isInternal = error.code >= 500 || (error.message && error.message.includes('Internal error'));

            if (isQuota || isInternal) {
                const reason = isQuota ? '속도 제한(Quota)' : '서버 내부 오류(Internal Error)';
                writeLog(`   ⚠️ 구글 API ${reason} 감지. 10초 대기 후 재시도 (${i + 1}/${maxRetries})...`);
                await delay(10000); // 10초 대기
            } else {
                throw error;
            }
        }
    }
    return await apiFunc(); // 마지막 시도
}

async function updateGoogleSheets(streamers) {
    if (!fs.existsSync(GOOGLE_KEY_PATH)) return;
    try {
        const auth = new google.auth.GoogleAuth({
            keyFile: GOOGLE_KEY_PATH,
            scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets']
        });
        const drive = google.drive({ version: 'v3', auth });
        const sheets = google.sheets({ version: 'v4', auth });
        const botEmail = require(GOOGLE_KEY_PATH).client_email;
        const webAppUrl = process.env.GOOGLE_SHEET_WEBAPP_URL;

        writeLog(" 구글 시트 일괄 업데이트 시작...");
        for (let i = 0; i < streamers.length; i++) {
            const streamer = streamers[i];
            const streamerName = streamer.nickname || streamer.id;
            const fileName = `[${streamerName}] SOOP VOD 아카이브`;

            try {
                if (!cache.sheets) cache.sheets = {};
                let sheetCache = cache.sheets[streamer.id];

                // 데이터 해시(Hash) 비교를 통한 구글 시트 업데이트 스킵 (API 사용량 획기적 단축)
                const crypto = require('crypto');
                const currentDataStr = JSON.stringify({ v: streamer.vods, s: streamer.safeVods });
                const currentHash = crypto.createHash('md5').update(currentDataStr).digest('hex');

                let spreadsheetId = sheetCache ? sheetCache.spreadsheetId : null;
                let existingTabCount = sheetCache ? sheetCache.tabCount : 0;

                if (sheetCache && sheetCache.hash === currentHash && spreadsheetId) {
                    // 데이터 변동 없음! 구글 시트 업데이트 건너뛰기
                    continue;
                }

                if (!spreadsheetId) {
                    const res = await retryApi(() => drive.files.list({
                        q: `'${GOOGLE_FOLDER_ID}' in parents and name = '${fileName}' and trashed = false`,
                        fields: 'files(id)'
                    }));

                    if (res.data.files.length > 0) {
                        spreadsheetId = res.data.files[0].id;
                    } else {
                        writeLog(`   👉 [${streamerName}] 시트가 없어 새로 생성합니다...`);
                        const createRes = await fetch(webAppUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ fileName, folderId: GOOGLE_FOLDER_ID, botEmail })
                        });
                        spreadsheetId = await createRes.text();
                    }
                    cache.sheets[streamer.id] = { spreadsheetId, tabCount: 0 };
                    saveCache();
                }

                streamer.spreadsheetId = spreadsheetId;

                let allVods = [...(streamer.vods || []), ...(streamer.safeVods || [])];
                allVods.sort((a, b) => parseInt(b.titleNo) - parseInt(a.titleNo));

                const CHUNK_SIZE = 60;
                const pages = [];
                for (let j = 0; j < allVods.length; j += CHUNK_SIZE) {
                    pages.push(allVods.slice(j, j + CHUNK_SIZE));
                }
                if (pages.length === 0) continue;

                const requiredTabCount = pages.length;
                const requests = [];
                let needsFormatting = true;

                if (requiredTabCount > existingTabCount) {
                    const sheetMeta = await retryApi(() => sheets.spreadsheets.get({ spreadsheetId }));
                    const existingTabs = sheetMeta.data.sheets.map(s => s.properties.title);
                    const existingTabIds = sheetMeta.data.sheets.map(s => s.properties.sheetId);

                    pages.forEach((page, index) => {
                        const tabTitle = `${index + 1}페이지`;
                        if (!existingTabs.includes(tabTitle)) {
                            requests.push({ addSheet: { properties: { title: tabTitle } } });
                            needsFormatting = true;
                        }
                    });

                    if (existingTabs.includes('시트1') && requests.length > 0) {
                        const defaultSheetIndex = existingTabs.indexOf('시트1');
                        requests.push({ deleteSheet: { sheetId: existingTabIds[defaultSheetIndex] } });
                    }

                    if (requests.length > 0) {
                        await retryApi(() => sheets.spreadsheets.batchUpdate({ spreadsheetId, resource: { requests } }));
                    }

                    // 캐시 갱신
                    if (!cache.sheets[streamer.id]) cache.sheets[streamer.id] = { spreadsheetId };
                    cache.sheets[streamer.id].tabCount = requiredTabCount;
                    saveCache();
                }

                const dataToUpdate = [];
                pages.forEach((page, index) => {
                    const tabTitle = `${index + 1}페이지`;
                    const rows = [['VOD 제목', '방송 날짜', 'VOD 링크', '방송 시간', '조회수', '총 별풍선', '후원자 목록 (닉네임: 개수)']];

                    page.forEach(vod => {
                        const supportersStr = (vod.supporters || []).sort((a, b) => b.cnt - a.cnt).map(s => `${s.nick}(${s.cnt})`).join(', ');
                        let dateStr = '날짜 모름';
                        if (vod.thumbnail) {
                            const match = vod.thumbnail.match(/rowKey=(\d{4})(\d{2})(\d{2})/);
                            if (match) dateStr = `${match[1]}-${match[2]}-${match[3]}`;
                        }

                        let durationStr = '알 수 없음';
                        if (vod.duration) {
                            if (vod.duration < 60) durationStr = `${vod.duration}분`;
                            else {
                                const h = Math.floor(vod.duration / 60);
                                const m = vod.duration % 60;
                                durationStr = m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
                            }
                        }

                        rows.push([
                            vod.title || '', dateStr, `https://vod.sooplive.com/player/${vod.titleNo}`,
                            durationStr,
                            vod.viewCount || 0, vod.balloons || 0, supportersStr || '없음'
                        ]);
                    });
                    dataToUpdate.push({ range: `'${tabTitle}'!A1:G${rows.length}`, values: rows });
                });

                try {
                    await retryApi(() => sheets.spreadsheets.values.batchUpdate({
                        spreadsheetId,
                        resource: { valueInputOption: 'USER_ENTERED', data: dataToUpdate }
                    }));
                } catch (batchErr) {
                    writeLog(`   ⚠️ [${streamerName}] 시트 업데이트 실패 (캐시 지움): ${batchErr.message}`);
                    delete cache.sheets[streamer.id];
                    saveCache();
                    continue;
                }

                if (needsFormatting) {
                    const finalMeta = await retryApi(() => sheets.spreadsheets.get({ spreadsheetId }));
                    const formatRequests = [];
                    finalMeta.data.sheets.forEach(sheet => {
                        const sheetId = sheet.properties.sheetId;
                        formatRequests.push({
                            repeatCell: {
                                range: { sheetId: sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 7 },
                                cell: { userEnteredFormat: { backgroundColor: { red: 0.902, green: 0.569, blue: 0.220 }, textFormat: { bold: true }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' } },
                                fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)'
                            }
                        });
                        formatRequests.push({
                            repeatCell: {
                                range: { sheetId: sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 },
                                cell: { userEnteredFormat: { horizontalAlignment: 'LEFT', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } },
                                fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy)'
                            }
                        });
                        formatRequests.push({
                            repeatCell: {
                                range: { sheetId: sheetId, startRowIndex: 1, startColumnIndex: 1, endColumnIndex: 6 },
                                cell: { userEnteredFormat: { horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' } },
                                fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment)'
                            }
                        });
                        formatRequests.push({
                            repeatCell: {
                                range: { sheetId: sheetId, startRowIndex: 1, startColumnIndex: 6, endColumnIndex: 7 },
                                cell: { userEnteredFormat: { horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } },
                                fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy)'
                            }
                        });
                        const colWidths = [375, 140, 280, 100, 100, 90, 470];
                        colWidths.forEach((width, idx) => {
                            formatRequests.push({
                                updateDimensionProperties: {
                                    range: { sheetId: sheetId, dimension: 'COLUMNS', startIndex: idx, endIndex: idx + 1 },
                                    properties: { pixelSize: width },
                                    fields: 'pixelSize'
                                }
                            });
                        });
                    });
                    await retryApi(() => sheets.spreadsheets.batchUpdate({ spreadsheetId, resource: { requests: formatRequests } }));
                }

                // 시트 갱신이 성공적으로 끝났으므로 캐시에 해시(Hash) 저장
                if (!cache.sheets[streamer.id]) cache.sheets[streamer.id] = {};
                cache.sheets[streamer.id].hash = currentHash;
                saveCache();

                // 실제 업데이트가 발생한 경우에만 딜레이 (분당 60회 쓰기 할당량 보호)
                await delay(1500);

                writeLog(`   ✅ [${streamerName}] 구글 시트 갱신 완료!`);
            } catch (innerErr) {
                writeLog(`   ⚠️ [${streamerName}] 개별 시트 처리 중 오류 발생: ${innerErr.message}`);
                if (innerErr.message.includes('not found') || innerErr.code === 404) {
                    writeLog(`   🧹 존재하지 않는 시트로 확인되어 캐시를 삭제합니다.`);
                    delete cache.sheets[streamer.id];
                    saveCache();
                }
            }
        }
        writeLog(" 구글 시트 일괄 업데이트 완료!");
    } catch (err) {
        writeLog(` [오류] 구글 시트 업데이트 중 에러 발생: ${err.message}`);
    }
}

let deleteSet = new Set(); // 전역 변수로 선언하여 processStreamer에서도 접근 가능하게 유지

async function main() {
    // 매 사이클마다 최신 streamers.txt 및 streamers_delete.txt 파일을 다시 읽어옵니다.
    const rawStreamers = fs.readFileSync(path.join(__dirname, 'streamers.txt'), 'utf-8')
        .split('\n').map(id => id.trim()).filter(id => id.length > 0);

    const deleteListPath = path.join(__dirname, 'streamers_delete.txt');
    deleteSet.clear(); // 기존 목록 지우기
    if (fs.existsSync(deleteListPath)) {
        const deleteList = fs.readFileSync(deleteListPath, 'utf-8')
            .split('\n').map(id => id.trim().toLowerCase()).filter(id => id.length > 0);
        deleteList.forEach(id => deleteSet.add(id));
        writeLog(`[블랙리스트] ${deleteSet.size}명의 스트리머가 크롤링 제외 목록에 등록되어 있습니다.`);
    }

    const seenStreamers = new Set();
    const UNIQUE_STREAMERS = rawStreamers.filter(id => {
        const lower = id.toLowerCase();
        if (seenStreamers.has(lower)) return false;
        if (deleteSet.has(lower)) return false; // 블랙리스트 제외
        seenStreamers.add(lower);
        return true;
    });

    let STREAMER_IDS = UNIQUE_STREAMERS.filter((id, index) => {
        return (index % totalServers) === (serverId - 1);
    });

    if (TARGET_STREAMER) {
        STREAMER_IDS = [TARGET_STREAMER];
        writeLog(`🎯 [타겟 모드] 특정 스트리머(${TARGET_STREAMER})만 단독 갱신합니다.`);
    } else {
        writeLog(`[샤딩 모드] 서버 ${serverId}/${totalServers} 동작 중. (할당된 스트리머: ${STREAMER_IDS.length} / ${UNIQUE_STREAMERS.length}명)`);
    }

    if (process.argv.includes('--clear-cache')) {
        writeLog(" [!] 캐시 초기화 옵션 감지. 기존 캐시를 모두 제거하고 완전히 깨끗하게 처음부터 수집합니다.");
        cache = { permanent: {}, safe: {}, meta: {} };
    } else {
        loadCache();
    }
    // Load deletion report to get deleted counts
    let delMap = {};
    try {
        const reportPath = path.join(__dirname, 'deletion_report.json');
        if (fs.existsSync(reportPath)) {
            const reportData = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
            if (reportData && reportData.streamers) {
                reportData.streamers.forEach(ds => {
                    delMap[ds.id.toLowerCase()] = ds.deleted;
                });
            }
        }
    } catch (e) {
        writeLog(`[경고] deletion_report.json 로드 실패: ${e.message}`);
    }

    const finalOutput = { streamers: [] };

    writeLog(" 전체 스트리머 분석 시작 (동시성 큐 적용)...");
    let completedStreamers = 0;
    let startedStreamers = 0;

    const streamerTasks = STREAMER_IDS.map(streamerId => async () => {
        startedStreamers++;
        writeLog(`\n▶ [진행도] 스트리머 검사 시작 (${startedStreamers} / ${STREAMER_IDS.length}명) - 👉 ${streamerId}`);
        let result = null;
        try {
            result = await processStreamer(streamerId);
        } catch (e) {
            writeLog(` [오류] ${streamerId} 처리 중 치명적 에러: ${e.message}`);
        }
        completedStreamers++;
        return result;
    });

    const results = await runWithConcurrencyLimit(streamerTasks, STREAMER_BATCH);

    for (const result of results) {
        if (result) finalOutput.streamers.push(result);
    }

    // R2 업로드 및 JSON 생성을 위해 캐시에서 구글 시트 ID를 미리 붙여줍니다.
    for (const s of finalOutput.streamers) {
        if (cache.sheets && cache.sheets[s.id] && cache.sheets[s.id].spreadsheetId) {
            s.spreadsheetId = cache.sheets[s.id].spreadsheetId;
        }
    }

    saveCache();

    // 로컬 저장용 data 폴더 생성
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir);
    }

    const uploadTasks = [];
    let summarySize = 0;
    let summaryFileName = totalServers > 1 ? `summary_${serverId}.json` : 'summary.json';

    let summaryData = { streamers: [] };

    let skipSummaryUpload = false;

    if (TARGET_STREAMER) {
        // 타겟 모드: 기존 summary를 R2에서 읽어와서 해당 스트리머만 교체 (목록 갱신 동기화)
        if (finalOutput.streamers.length > 0) {
            const target = finalOutput.streamers[0];
            const updatedInfo = {
                id: target.id, nickname: target.nickname, profileImg: target.profileImg,
                vodCount: (target.vods || []).length, safeVodCount: (target.safeVods || []).length,
                spreadsheetId: target.spreadsheetId || null,
                deletedCount: delMap[target.id.toLowerCase()] || 0
            };

            let summaryLoaded = false;

            // R2 SDK를 통해 기존 summary 파일 읽어오기
            const summaryFiles = ['summary_2.json', 'summary_1.json'];
            for (const fname of summaryFiles) {
                if (summaryLoaded) break;
                try {
                    const getRes = await r2.send(new GetObjectCommand({
                        Bucket: R2_BUCKET,
                        Key: fname,
                    }));
                    const bodyStr = await getRes.Body.transformToString();
                    const existing = JSON.parse(bodyStr);
                    const idx = existing.streamers.findIndex(s => s.id === target.id);
                    if (idx !== -1) {
                        existing.streamers[idx] = updatedInfo;
                        summaryData = existing;
                        summaryFileName = fname;
                        summaryLoaded = true;
                    } else if (fname === 'summary_1.json') {
                        // summary_1에도 없으면 새로 추가
                        existing.streamers.push(updatedInfo);
                        summaryData = existing;
                        summaryFileName = fname;
                        summaryLoaded = true;
                    }
                } catch (e) { }
            }

            // 모든 시도 실패 시: summary 업로드를 건너뛰어 기존 목록 보호
            if (!summaryLoaded) {
                writeLog(` [경고] 타겟 모드에서 기존 summary를 찾을 수 없어 summary 업로드를 건너뜁니다. (data 파일만 갱신)`);
                skipSummaryUpload = true;
            }
        }
    } else {
        // 전체 갱신 모드
        summaryData.streamers = finalOutput.streamers.map(s => ({
            id: s.id, nickname: s.nickname, profileImg: s.profileImg,
            vodCount: (s.vods || []).length, safeVodCount: (s.safeVods || []).length,
            spreadsheetId: s.spreadsheetId || null,
            deletedCount: delMap[s.id.toLowerCase()] || 0
        }));
    }

    if (summaryData.streamers.length > 0 && !skipSummaryUpload) {
        const summaryJson = JSON.stringify(summaryData);
        summarySize = summaryJson.length;

        fs.writeFileSync(path.join(__dirname, summaryFileName), summaryJson, 'utf-8');

        // summary는 웹사이트 목록에 직접 영향을 주므로, 개별 data 파일보다 먼저 즉시 업로드
        try {
            await r2.send(new PutObjectCommand({
                Bucket: process.env.R2_BUCKET_NAME,
                Key: summaryFileName,
                Body: summaryJson,
                ContentType: 'application/json',
            }));
        } catch (e) {
            writeLog(` [경고] summary 업로드 실패: ${e.message}`);
        }
    }

    let totalDataSize = 0;

    for (const streamer of finalOutput.streamers) {
        uploadTasks.push(async () => {
            // Load existing data to preserve deleted VODs in the list
            const dataFilePath = path.join(dataDir, `${streamer.id}.json`);
            let oldVods = [];
            if (fs.existsSync(dataFilePath)) {
                try {
                    const oldData = JSON.parse(fs.readFileSync(dataFilePath, 'utf-8'));
                    if (oldData && oldData.streamer && oldData.streamer.vods) {
                        oldVods = oldData.streamer.vods;
                    }
                } catch (e) {
                    writeLog(` [경고] 기존 파일 로드 실패 (${streamer.id}): ${e.message}`);
                }
            }

            if (oldVods.length > 0) {
                const newVodIds = new Set((streamer.vods || []).map(v => v.titleNo));
                const newSafeVodIds = new Set((streamer.safeVods || []).map(v => v.titleNo));
                
                // Find old VODs that are no longer in active endangered or safe lists
                const deletedVods = oldVods.filter(v => !newVodIds.has(v.titleNo) && !newSafeVodIds.has(v.titleNo));
                
                if (deletedVods.length > 0) {
                    streamer.vods = [...(streamer.vods || []), ...deletedVods];
                }
            }

            const streamerData = { streamer };
            const streamerJson = JSON.stringify(streamerData);
            totalDataSize += streamerJson.length;

            fs.writeFileSync(dataFilePath, streamerJson, 'utf-8');

            const snapshotDir = path.join(__dirname, 'data_snapshot');
            if (!fs.existsSync(snapshotDir)) fs.mkdirSync(snapshotDir);
            const snapshotFilePath = path.join(snapshotDir, `${streamer.id}.json`);
            if (!fs.existsSync(snapshotFilePath)) {
                fs.writeFileSync(snapshotFilePath, streamerJson, 'utf-8');
            }

            await r2.send(new PutObjectCommand({
                Bucket: process.env.R2_BUCKET_NAME,
                Key: `data/${streamer.id}.json`,
                Body: streamerJson,
                ContentType: 'application/json',
            }));
        });
    }

    let sheetUpdatePromise = null;
    if (!isUpdatingSheets) {
        isUpdatingSheets = true;
        sheetUpdatePromise = updateGoogleSheets(finalOutput.streamers).finally(() => { isUpdatingSheets = false; });
    } else {
        writeLog(" [!] 이전 구글 시트 업데이트가 아직 진행 중이라 이번 시트 업데이트는 건너뜁니다.");
    }

    try {
        // R2 업로드를 동시에 최대 20개씩 끊어서 처리하여 메모리 및 소켓 병목 방지
        await runWithConcurrencyLimit(uploadTasks, 20);
        writeLog(`\n R2 갱신 완료! (data chunk total: ${(totalDataSize / 1024 / 1024).toFixed(1)}MB, summary: ${(summarySize / 1024).toFixed(1)}KB)`);
    } catch (error) {
        console.error(`\n R2 업로드 실패: ${error.message}`);
    }

    if (RUN_ONCE && sheetUpdatePromise) {
        await sheetUpdatePromise;
    }
}

const RUN_ONCE = process.argv.includes('--once');

const UPDATE_INTERVAL_MINUTES = 3;
async function startAutoCrawler() {
    writeLog(" SOOP VOD 크롤러 가동 시작...");

    if (RUN_ONCE) {
        writeLog(" [옵션] --once 모드가 활성화되어 1회만 실행하고 종료합니다.");
        try {
            await main();
        } catch (error) {
            writeLog(`[치명적 에러] 크롤링 중 에러 발생: ${error.message}`);
        }
        writeLog(" ✅ 1회 단독 실행이 완료되어 프로세스를 종료합니다.");
        process.exit(0);
        return;
    }

    while (true) {
        const startTime = Date.now();
        try {
            await main();
        } catch (error) {
            writeLog(`[치명적 에러] 크롤링 사이클 중 에러 발생: ${error.message}`);
        }

        const endTime = Date.now();

        const elapsedMs = endTime - startTime;
        const targetCycleMs = UPDATE_INTERVAL_MINUTES * 60 * 1000;

        const waitMs = Math.max(10000, targetCycleMs - elapsedMs);
        const waitMinutes = (waitMs / 1000 / 60).toFixed(1);

        writeLog(`\n [자동 갱신] 1회전 소요 시간: ${(elapsedMs / 1000 / 60).toFixed(1)}분`);
        writeLog(` [자동 갱신] 정확한 ${UPDATE_INTERVAL_MINUTES}분 주기를 맞추기 위해 ${waitMinutes}분 동안 대기합니다...`);

        await delay(waitMs);
    }
}

startAutoCrawler();