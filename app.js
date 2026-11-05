let data = { streamers: [] };
let cachedStreamers = {};
let currentStreamerId = null;
let currentTab = 'endangered';

let currentNoticeIndex = 0;
let noticeInterval;
let totalNotices = 0;

function updateNoticeSlider() {
    const slider = document.getElementById('noticeSlider');
    const counter = document.getElementById('noticeCounter');
    if (slider && counter && totalNotices > 0) {
        slider.style.transform = `translateY(-${currentNoticeIndex * 20}px)`;
        counter.textContent = `${currentNoticeIndex + 1} / ${totalNotices}`;
    }
}

window.nextNotice = function () {
    if (totalNotices <= 1) return;
    currentNoticeIndex = (currentNoticeIndex + 1) % totalNotices;
    updateNoticeSlider();
};

window.prevNotice = function () {
    if (totalNotices <= 1) return;
    currentNoticeIndex = (currentNoticeIndex - 1 + totalNotices) % totalNotices;
    updateNoticeSlider();
};

window.resumeNotice = function () {
    if (totalNotices <= 1) return;
    if (noticeInterval) clearInterval(noticeInterval);
    noticeInterval = setInterval(window.nextNotice, 4000);
};

window.pauseNotice = function () {
    if (noticeInterval) clearInterval(noticeInterval);
};

window.addEventListener('DOMContentLoaded', () => {
    const slider = document.getElementById('noticeSlider');
    if (slider) {
        totalNotices = slider.children.length;
        updateNoticeSlider();

        if (totalNotices > 1) {
            window.resumeNotice();
        } else {
            document.querySelectorAll('.notice-nav').forEach(btn => btn.style.display = 'none');
        }
    }
});

window.toggleMobileSidebar = function () {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (!sidebar || !overlay) return;
    const isOpen = sidebar.classList.contains('open');
    sidebar.classList.toggle('open');
    overlay.classList.toggle('active');
    document.body.style.overflow = isOpen ? '' : 'hidden';
};

const streamerListEl = document.getElementById('streamerList');
const vodGridEl = document.getElementById('vodGrid');
const headerTitleEl = document.getElementById('headerTitle');
const headerStatsEl = document.getElementById('headerStats');

window.hideShortVods = false;
window.shortVodMinutes = 10;
window.hidePlusVods = false;

window.toggleHideShortVods = function () {
    const chk = document.getElementById('hideShortVods');
    window.hideShortVods = chk ? chk.checked : false;
    const activeItem = document.querySelector('.streamer-item.active');
    if (activeItem) {
        const id = activeItem.id.replace('item-', '');
        renderVods(id);
    }
};

window.onShortVodMinutesChange = function () {
    const input = document.getElementById('shortVodMinutes');
    window.shortVodMinutes = Math.max(1, Math.min(120, parseInt(input?.value) || 10));
    if (window.hideShortVods) {
        const activeItem = document.querySelector('.streamer-item.active');
        if (activeItem) {
            const id = activeItem.id.replace('item-', '');
            renderVods(id);
        }
    }
};

window.toggleHidePlusVods = function () {
    const chk = document.getElementById('hidePlusVods');
    window.hidePlusVods = chk ? chk.checked : false;
    const activeItem = document.querySelector('.streamer-item.active');
    if (activeItem) {
        const id = activeItem.id.replace('item-', '');
        renderVods(id);
    }
};

function formatDuration(minutes) {
    if (minutes === undefined || minutes === null) return '';
    if (minutes < 60) return `${minutes}분`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr.replace(' ', 'T'));
    return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
}

function calculateDDay(dateStr) {
    const now = new Date();
    const target = new Date(dateStr.replace(' ', 'T'));

    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const targetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate());

    const diff = targetDay - today;
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function getBadgeClass(dDay) {
    if (dDay <= 3) return 'badge-critical';
    if (dDay <= 10) return 'badge-warning';
    return 'badge-safe';
}

// 상단에 고정할 스트리머 ID를 배열에 추가하세요. 이 배열에 있는 순서대로 최상단에 노출됩니다.
const PINNED_STREAMERS = ['eldk22', 'mingturn97', 't730172', '2omong'];

function renderStreamers(filter = '') {
    if (!data.streamers || data.streamers.length === 0) {
        streamerListEl.innerHTML = `<div style="text-align:center; padding: 20px; color: var(--text-dim);">수집된 데이터가 없습니다.</div>`;
        return;
    }

    const searchInput = document.getElementById('streamerSearch');
    const keyword = (filter || (searchInput ? searchInput.value : '')).toLowerCase();

    const sortSelect = document.getElementById('streamerSort');
    const sortValue = sortSelect ? sortSelect.value : 'default';

    const filtered = data.streamers.filter(s =>
        s.nickname.toLowerCase().includes(keyword) || s.id.toLowerCase().includes(keyword)
    );

    filtered.sort((a, b) => {
        const aIndex = PINNED_STREAMERS.indexOf(a.id);
        const bIndex = PINNED_STREAMERS.indexOf(b.id);

        // 고정 스트리머는 무슨 정렬이든 무조건 최상단 유지
        if (aIndex !== -1 && bIndex === -1) return -1;
        if (aIndex === -1 && bIndex !== -1) return 1;
        if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;

        if (sortValue === 'nameAsc') {
            return a.nickname.localeCompare(b.nickname);
        } else if (sortValue === 'nameDesc') {
            return b.nickname.localeCompare(a.nickname);
        }

        // default (위험도/VOD 개수순)

        // VOD 개수 처리
        const aCount = a.vodCount || 0;
        const bCount = b.vodCount || 0;
        if (aCount === 0 && bCount > 0) return 1;
        if (aCount > 0 && bCount === 0) return -1;
        return 0;
    });

    if (filtered.length === 0) {
        streamerListEl.innerHTML = `<div style="text-align:center; padding: 20px; color: var(--text-dim);">검색 결과가 없습니다.</div>`;
        return;
    }

    streamerListEl.innerHTML = filtered.map(s => {
        const isPinned = PINNED_STREAMERS.includes(s.id);
        const pinnedStyle = isPinned ? 'border: 1px solid rgba(59, 130, 246, 0.7); box-shadow: 0 0 8px rgba(59, 130, 246, 0.2); background: rgba(59, 130, 246, 0.05);' : '';
        const pinIcon = isPinned ? '<span style="font-size: 11px; margin-right: 4px;" title="고정 스트리머">📌</span>' : '';

        const deletedCountHtml = s.deletedCount ? `<span class="count-deleted" style="font-size: 11px; color: var(--text-dim); background: rgba(255,255,255,0.05); padding: 2px 5px; border-radius: 4px; display: inline-block; font-weight: 500; margin-top: 2px;">${s.deletedCount}개 소멸 완료</span>` : '';

        return `
        <div class="streamer-item" onclick="selectStreamer('${s.id}')" id="item-${s.id}" style="${pinnedStyle}">
            <img src="${s.profileImg}" loading="lazy" class="streamer-img" onerror="this.src='https://res.sooplive.com/favicon.ico'">
            <div class="streamer-info">
                <span class="name" style="display:flex; align-items:center;">${pinIcon}${s.nickname}</span>
                <div style="display: flex; flex-wrap: wrap; gap: 4px; align-items: center; margin-top: 4px;">
                    <span class="count">${s.vodCount || 0}개 소멸 예정</span>
                    ${deletedCountHtml}
                </div>
            </div>
        </div>
        `;
    }).join('');
}

document.getElementById('streamerSearch').addEventListener('input', (e) => {
    renderStreamers(e.target.value);
});

window.currentVodSearchQuery = '';
window.onVodSearchInput = function () {
    const input = document.getElementById('vodSearchInput');
    window.currentVodSearchQuery = input ? input.value : '';
    if (currentStreamerId) {
        renderVods(currentStreamerId);
    }
};

window.currentSafeFilter = 'all';
window.onSafeFilterChange = function () {
    const select = document.getElementById('safeFilterSelect');
    window.currentSafeFilter = select ? select.value : 'all';
    if (currentStreamerId) {
        renderVods(currentStreamerId);
    }
};

window.currentVodSort = 'oldest';
window.onVodSortChange = function () {
    const select = document.getElementById('vodSortSelect');
    window.currentVodSort = select ? select.value : 'oldest';
    if (currentStreamerId) {
        renderVods(currentStreamerId);
    }
};

window.switchTab = function (tab) {
    currentTab = tab;
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

    let activeBtnId = 'tabEndangered';
    if (tab === 'deleted') activeBtnId = 'tabDeleted';
    else if (tab === 'safe') activeBtnId = 'tabSafe';
    else if (tab === 'supporter') activeBtnId = 'tabSupporter';

    document.getElementById(activeBtnId).classList.add('active');

    // 검색창 가시성 및 초기화
    const searchArea = document.getElementById('vodSearchArea');
    if (searchArea) {
        searchArea.style.display = (tab === 'endangered' || tab === 'deleted') ? 'flex' : 'none';
    }
    const searchInput = document.getElementById('vodSearchInput');
    if (searchInput) searchInput.value = '';
    window.currentVodSearchQuery = '';

    const sortSelect = document.getElementById('vodSortSelect');
    if (sortSelect) sortSelect.value = 'oldest';
    window.currentVodSort = 'oldest';

    // 영구보관 조건 필터 가시성 및 초기화
    const safeFilterArea = document.getElementById('safeFilterArea');
    if (safeFilterArea) {
        safeFilterArea.style.display = (tab === 'safe') ? 'flex' : 'none';
    }
    const safeFilterSelect = document.getElementById('safeFilterSelect');
    if (safeFilterSelect) safeFilterSelect.value = 'all';
    window.currentSafeFilter = 'all';

    const datePickerArea = document.getElementById('supporterDatePickerArea');
    const sheetLink = document.getElementById('googleSheetLink');
    if (datePickerArea) {
        datePickerArea.style.display = (tab === 'supporter') ? 'flex' : 'none';

        if (sheetLink && currentStreamerId) {
            const streamerSummary = data.streamers.find(s => s.id === currentStreamerId);
            if (tab === 'supporter' && streamerSummary && streamerSummary.spreadsheetId) {
                sheetLink.style.display = 'flex';
            } else {
                sheetLink.style.display = 'none';
            }
        }
    }

    const shortFilterArea = document.getElementById('shortVodFilterArea');
    if (shortFilterArea) {
        shortFilterArea.style.display = (tab === 'endangered' || tab === 'deleted') ? 'flex' : 'none';
    }
    const chk = document.getElementById('hideShortVods');
    if (chk) {
        chk.checked = window.hideShortVods;
    }
    const chkPlus = document.getElementById('hidePlusVods');
    if (chkPlus) {
        chkPlus.checked = window.hidePlusVods;
    }

    const activeItem = document.querySelector('.streamer-item.active');
    if (activeItem) {
        const id = activeItem.id.replace('item-', '');
        if (tab === 'supporter') {
            renderSupporters(id);
        } else {
            renderVods(id);
        }
    }
}

window.selectStreamer = async function (id) {
    const streamerSummary = data.streamers.find(s => s.id === id);
    if (!streamerSummary) return;

    currentStreamerId = id;

    // 검색창 및 필터 초기화
    const searchInput = document.getElementById('vodSearchInput');
    if (searchInput) searchInput.value = '';
    window.currentVodSearchQuery = '';

    const sortSelect = document.getElementById('vodSortSelect');
    if (sortSelect) sortSelect.value = 'oldest';
    window.currentVodSort = 'oldest';

    const safeFilterSelect = document.getElementById('safeFilterSelect');
    if (safeFilterSelect) safeFilterSelect.value = 'all';
    window.currentSafeFilter = 'all';

    // 가시성 제어
    const searchArea = document.getElementById('vodSearchArea');
    if (searchArea) {
        searchArea.style.display = (currentTab === 'endangered' || currentTab === 'deleted') ? 'flex' : 'none';
    }
    const safeFilterArea = document.getElementById('safeFilterArea');
    if (safeFilterArea) {
        safeFilterArea.style.display = (currentTab === 'safe') ? 'flex' : 'none';
    }

    if (window.innerWidth <= 800) {
        const sidebar = document.querySelector('.sidebar');
        const overlay = document.getElementById('sidebarOverlay');
        if (sidebar) sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('active');
        document.body.style.overflow = '';
    }

    document.querySelectorAll('.streamer-item').forEach(el => el.classList.remove('active'));
    const activeItem = document.getElementById(`item-${id}`);
    if (activeItem) activeItem.classList.add('active');

    const container = document.getElementById('tabsWithDatePickerContainer');
    if (container) container.style.display = 'flex';

    const datePickerArea = document.getElementById('supporterDatePickerArea');
    const sheetLink = document.getElementById('googleSheetLink');
    if (datePickerArea) {
        datePickerArea.style.display = (currentTab === 'supporter') ? 'flex' : 'none';

        if (sheetLink) {
            if (streamerSummary.spreadsheetId) {
                sheetLink.href = `https://docs.google.com/spreadsheets/d/${streamerSummary.spreadsheetId}/edit`;
                if (currentTab === 'supporter') sheetLink.style.display = 'flex';
            } else {
                sheetLink.style.display = 'none';
            }
        }
    }

    const shortFilterArea = document.getElementById('shortVodFilterArea');
    if (shortFilterArea) {
        shortFilterArea.style.display = (currentTab === 'endangered' || currentTab === 'deleted') ? 'flex' : 'none';
    }
    const chk = document.getElementById('hideShortVods');
    if (chk) {
        chk.checked = window.hideShortVods;
    }
    const chkPlus = document.getElementById('hidePlusVods');
    if (chkPlus) {
        chkPlus.checked = window.hidePlusVods;
    }

    // 데이터 지연 로딩 처리
    if (!cachedStreamers[id]) {
        vodGridEl.innerHTML = `
            <div class="empty-state">
                <div style="font-size: 32px; margin-bottom: 16px; animation: pulse 1s infinite;">⏳</div>
                <h3>상세 데이터를 불러오는 중...</h3>
                <p>잠시만 기다려주세요.</p>
            </div>
        `;
        try {
            let res;
            if (window.isLocalFallback) {
                res = await fetch(`./data/${id}.json?_=${Date.now()}`);
            } else {
                res = await fetch(`/api/data?streamerId=${id}`);
            }
            const detailData = await res.json();
            if (detailData.streamer) {
                cachedStreamers[id] = detailData.streamer;
            } else {
                throw new Error('스트리머 데이터를 찾을 수 없습니다.');
            }
        } catch (e) {
            vodGridEl.innerHTML = `
                <div class="empty-state">
                    <div style="font-size: 32px; margin-bottom: 16px;">⚠️</div>
                    <h3>데이터를 불러오지 못했습니다.</h3>
                    <p>네트워크 상태를 확인하고 다시 시도해주세요.</p>
                </div>
            `;
            return;
        }
    }

    if (currentStreamerId !== id) return;

    if (currentTab === 'supporter') {
        renderSupporters(id);
    } else {
        renderVods(id);
    }
}

function renderVods(id) {
    const streamer = cachedStreamers[id];
    if (!streamer) return;

    const isEndangered = currentTab === 'endangered';
    const isDeleted = currentTab === 'deleted';
    const isSafe = currentTab === 'safe';

    let vodList = [];
    if (isEndangered) {
        vodList = (streamer.vods || []).filter(v => {
            const targetTime = new Date(v.deleteDate.replace(' ', 'T')).getTime();
            return isNaN(targetTime) || targetTime >= Date.now();
        });
    } else if (isDeleted) {
        vodList = (streamer.vods || []).filter(v => {
            const targetTime = new Date(v.deleteDate.replace(' ', 'T')).getTime();
            return !isNaN(targetTime) && targetTime < Date.now();
        });
    } else {
        vodList = streamer.safeVods || [];
    }

    headerTitleEl.textContent = `${streamer.nickname}`;

    if ((isEndangered || isDeleted) && window.hideShortVods) {
        vodList = vodList.filter(v => v.duration === undefined || v.duration >= window.shortVodMinutes);
    }

    if (window.hidePlusVods) {
        vodList = vodList.filter(v => !v.isPlus);
    }

    // VOD 제목 검색 필터 (소멸예정 및 소멸 탭)
    if ((isEndangered || isDeleted) && window.currentVodSearchQuery) {
        const query = window.currentVodSearchQuery.toLowerCase();
        vodList = vodList.filter(v => v.title && v.title.toLowerCase().includes(query));
    }

    // 영구보관 조건 필터 (영구보관 탭)
    if (isSafe && window.currentSafeFilter && window.currentSafeFilter !== 'all') {
        const filter = window.currentSafeFilter;
        if (filter === 'balloons') {
            vodList = vodList.filter(v => (v.balloons || 0) >= 10);
        } else if (filter === 'views') {
            vodList = vodList.filter(v => v.viewCount >= 1001);
        } else if (filter === 'both') {
            vodList = vodList.filter(v => (v.balloons || 0) >= 10 && v.viewCount >= 1001);
        } else if (filter === 'unapplied') {
            vodList = vodList.filter(v => (v.balloons || 0) < 10 && v.viewCount < 1001);
        }
    }

    if (isEndangered) {
        headerStatsEl.innerHTML = `총 <strong style="color: var(--danger-red)">${vodList.length}개</strong>의 VOD가 소멸 예정 상태입니다.`;
    } else if (isDeleted) {
        headerStatsEl.innerHTML = `총 <strong style="color: var(--text-dim)">${vodList.length}개</strong>의 VOD가 소멸 완료되었습니다.`;
    } else {
        headerStatsEl.innerHTML = `총 <strong style="color: var(--success-green)">${vodList.length}개</strong>의 VOD가 영구 보관되었습니다.`;
    }

    if (vodList.length === 0) {
        if (isEndangered) {
            vodGridEl.innerHTML = `
                <div class="empty-state">
                    <div class="icon">✨</div>
                    <h3>소멸 예정인 VOD가 없습니다.</h3>
                    <p>조건을 충족하거나 필터에 의해 숨김 처리되었습니다.</p>
                </div>
            `;
        } else if (isDeleted) {
            vodGridEl.innerHTML = `
                <div class="empty-state">
                    <div class="icon">🗑️</div>
                    <h3>소멸 완료된 VOD가 없습니다.</h3>
                    <p>이 스트리머는 소멸 완료된 VOD가 없거나 필터에 의해 숨김 처리되었습니다.</p>
                </div>
            `;
        } else {
            vodGridEl.innerHTML = `
                <div class="empty-state">
                    <div class="icon">📦</div>
                    <h3>영구 보관된 VOD가 없습니다.</h3>
                    <p>조건을 충족하거나 영구 보관 설정된 VOD가 없습니다.</p>
                </div>
            `;
        }
        return;
    }

    let sortedVods;
    if (isEndangered || isDeleted) {
        if (window.currentVodSort === 'newest') {
            sortedVods = [...vodList].sort((a, b) => {
                return new Date(b.deleteDate.replace(' ', 'T')) - new Date(a.deleteDate.replace(' ', 'T'));
            });
        } else {
            sortedVods = [...vodList].sort((a, b) => {
                return new Date(a.deleteDate.replace(' ', 'T')) - new Date(b.deleteDate.replace(' ', 'T'));
            });
        }
    } else {
        sortedVods = [...vodList].sort((a, b) => b.titleNo - a.titleNo);
    }

    vodGridEl.innerHTML = sortedVods.map(v => {
        let dDayText, badgeClass;
        if (isEndangered || isDeleted) {
            const dDay = calculateDDay(v.deleteDate);
            if (isDeleted || dDay < 0) {
                badgeClass = 'badge-deleted';
                dDayText = '소멸됨';
            } else if (isNaN(dDay)) {
                badgeClass = 'badge-warning';
                dDayText = '확인불가';
            } else {
                badgeClass = getBadgeClass(dDay);
                dDayText = dDay === 0 ? 'D-Day' : `D-${dDay}`;
            }
        } else {
            if ((v.balloons || 0) >= 10 && v.viewCount >= 1001) {
                badgeClass = 'badge-both';
                dDayText = '별풍선+조회수';
            } else if ((v.balloons || 0) >= 10) {
                badgeClass = 'badge-balloons';
                dDayText = '별풍선 충족';
            } else if (v.viewCount >= 1001) {
                badgeClass = 'badge-views';
                dDayText = '조회수 충족';
            } else {
                badgeClass = 'badge-unapplied';
                dDayText = '미적용';
            }
        }

        const balloonsVal = typeof v.balloons === 'number' ? v.balloons : 0;
        const balloonPercent = Math.min((balloonsVal / 10) * 100, 100);
        const viewPercent = Math.min((v.viewCount / 1001) * 100, 100);

        return `
            <div class="vod-card">
                <div class="thumb-area">
                    <div class="d-day-badge ${badgeClass}">${dDayText}</div>
                    ${v.isPlus ? '<div class="d-day-badge" style="top: 8px; right: 8px; left: auto; background: #6366f1;">구독플러스</div>' : ''}
                    <img src="${v.thumbnail}" loading="lazy" onerror="this.src='https://res.sooplive.com/favicon.ico'">
                    <div class="thumb-overlay"></div>
                    <div class="delete-date">⏱ ${(isEndangered || isDeleted) ? formatDate(v.deleteDate) + (isDeleted ? ' 소멸됨' : ' 소멸 예정') : '영구 보관됨'}</div>
                </div>
                <div class="card-info">
                    <div class="vod-title" title="${v.title}">${v.title}</div>
                    
                    <div class="status-group">
                        <div class="status-row">
                            <span>별풍선/애드벌룬</span>
                            <span><strong>${v.balloons}</strong> / 10</span>
                        </div>
                        <div class="progress-container">
                            <div class="progress-bar bar-balloon" style="width: 0%" data-target="${balloonPercent}%"></div>
                        </div>
                    </div>

                    <div class="status-group">
                        <div class="status-row">
                            <span>순수 조회수</span>
                            <span><strong>${v.viewCount.toLocaleString()}</strong> / 1,001</span>
                        </div>
                        <div class="progress-container">
                            <div class="progress-bar bar-view" style="width: 0%" data-target="${viewPercent}%"></div>
                        </div>
                    </div>

                    ${(v.supporters && v.supporters.length > 0) ? `
                    <div style="margin-top: 12px; margin-bottom: 6px;">
                        <div class="supporter-toggle" onclick="toggleSupporters(this)" style="font-size: 13px; color: var(--warning-orange); cursor: pointer; display: flex; align-items: center; gap: 4px; user-select: none;">
                            <span>후원 상세 정보 (${v.supporters.length}명) ▾</span>
                        </div>
                        <div class="supporter-detail" style="display: none; margin-top: 8px; max-height: 120px; overflow-y: auto; background: rgba(0,0,0,0.25); border: 1px solid var(--border-color); border-radius: 6px; padding: 6px 10px;">
                            ${v.supporters.map(s => `
                                <div style="display: flex; justify-content: space-between; font-size: 12px; padding: 3px 0; border-bottom: 1px dashed rgba(255,255,255,0.03);">
                                    <span style="color: var(--text-dim);">${s.nick} (${s.id})</span>
                                    <span style="color: var(--warning-orange); font-weight: 600;">${s.cnt}개</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    ` : ''}

                    <a href="https://vod.sooplive.com/player/${v.titleNo}" target="_blank" rel="noopener noreferrer" class="action-btn" style="text-decoration: none;">
                        ▶ VOD 보러가기
                    </a>
                </div>
            </div>
        `;
    }).join('');

    setTimeout(() => {
        document.querySelectorAll('.progress-bar').forEach(bar => {
            bar.style.width = bar.getAttribute('data-target');
        });
    }, 50);
}

function initNoticeModal() {
    const noticeModal = document.getElementById('noticeModal');
    if (!noticeModal) return;

    const noticeBoxes = [
        { box: document.getElementById('noticeBox1'), btn: document.getElementById('closeNoticeBtn1'), chk: document.getElementById('hideTodayCheck1'), key: 'hideNoticeUntil1' },
        { box: document.getElementById('noticeBox2'), btn: document.getElementById('closeNoticeBtn2'), chk: document.getElementById('hideTodayCheck2'), key: 'hideNoticeUntil2' }
    ];

    const now = new Date().getTime();
    let visibleCount = 0;

    noticeBoxes.forEach((notice) => {
        if (!notice.box || !notice.btn || !notice.chk) return;

        const hideUntil = localStorage.getItem(notice.key);
        if (!hideUntil || now > parseInt(hideUntil, 10)) {
            notice.box.style.display = 'flex';
            visibleCount++;
        } else {
            notice.box.style.display = 'none';
        }

        notice.btn.addEventListener('click', () => {
            if (notice.chk.checked) {
                const tomorrow = new Date();
                tomorrow.setHours(24, 0, 0, 0);
                localStorage.setItem(notice.key, tomorrow.getTime().toString());
            }
            notice.box.style.display = 'none';
            checkAllClosed();
        });
    });

    if (visibleCount > 0) {
        noticeModal.style.display = 'flex';
        setTimeout(() => {
            noticeModal.classList.add('show');
        }, 10);
    }

    function checkAllClosed() {
        const anyVisible = noticeBoxes.some(n => n.box && n.box.style.display !== 'none');
        if (!anyVisible) {
            noticeModal.classList.remove('show');
            setTimeout(() => {
                noticeModal.style.display = 'none';
            }, 300);
        }
    }
}

function initEmergencyModal() {
    const emergencyModal = document.getElementById('emergencyModal');
    const closeBtn = document.getElementById('closeEmergencyBtn');
    if (!emergencyModal || !closeBtn) return;

    // 긴급 공지이므로 로컬 스토리지 필터링 없이 언제나 표시
    emergencyModal.style.display = 'flex';
    setTimeout(() => {
        emergencyModal.classList.add('show');
    }, 50);

    closeBtn.addEventListener('click', () => {
        emergencyModal.classList.remove('show');
        setTimeout(() => {
            emergencyModal.style.display = 'none';
        }, 300);
    });
}

async function loadDataAndRender() {
    initNoticeModal();
    initEmergencyModal();
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const adminInput = urlParams.get('admin');

        function getSecureKey(str) {
            if (!str) return '';
            let s = 0;
            for (let i = 0; i < str.length; i++) {
                s += str.charCodeAt(i) * (i + 1);
            }
            return (s * 7919).toString(36);
        }

        if (adminInput) {
            if (getSecureKey(adminInput) === '102m7h') {
                localStorage.setItem('soopkeeper_admin', '102m7h');
            } else if (adminInput === 'false') {
                localStorage.removeItem('soopkeeper_admin');
            }
        }

        const isAdmin = localStorage.getItem('soopkeeper_admin') === '102m7h';

        let isMaintenance = false;
        let maintApiSuccess = false;

        try {
            const maintRes = await fetch('/api/maintenance');
            if (maintRes.ok) {
                const maintData = await maintRes.json();
                isMaintenance = maintData.maintenance;
                maintApiSuccess = true;
            }
        } catch (e) {

        }

        let jsonData;
        let isLocalFallback = false;
        try {
            const response = await fetch('/api/data?type=summary');
            if (!response.ok) throw new Error('API 404');
            jsonData = await response.json();
        } catch (e) {
            isLocalFallback = true;
            const [res1, res2] = await Promise.all([
                fetch(`./summary_1.json?_=${Date.now()}`).catch(() => null),
                fetch(`./summary_2.json?_=${Date.now()}`).catch(() => null)
            ]);

            let streamers = [];
            if (res1 && res1.ok) {
                const data1 = await res1.json();
                streamers.push(...(data1.streamers || []));
            }
            if (res2 && res2.ok) {
                const data2 = await res2.json();
                streamers.push(...(data2.streamers || []));
            }

            if (streamers.length === 0) {
                const fallbackRes = await fetch(`./summary.json?_=${Date.now()}`);
                if (!fallbackRes.ok) throw new Error('데이터를 불러오지 못했습니다.');
                const fallbackData = await fallbackRes.json();
                streamers = fallbackData.streamers || [];
            }

            jsonData = { streamers, maintenance: false };
        }

        if (!maintApiSuccess && jsonData.maintenance === true) {
            isMaintenance = true;
        }

        if (isMaintenance && !isAdmin) {
            document.body.style.margin = '0';
            document.body.style.padding = '0';
            document.body.style.display = 'block';
            document.body.style.width = '100vw';
            document.body.style.height = '100vh';
            document.body.style.overflow = 'hidden';

            document.body.innerHTML = `
                <div style="position:fixed; top:0; left:0; width:100vw; height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; background:#0b0f19; color:#ffffff; font-family:'Inter',sans-serif; text-align:center; padding:20px; box-sizing:border-box; z-index:999999;">
                    <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:24px; padding:48px 32px; max-width:480px; width:100%; box-shadow:0 20px 50px rgba(0,0,0,0.4); backdrop-filter:blur(10px);">
                        <div style="font-size:64px; margin-bottom:24px; filter:drop-shadow(0 0 10px rgba(239, 68, 68, 0.3));">📢</div>
                        <h1 style="font-size:24px; font-weight:800; margin-bottom:12px; letter-spacing:-0.5px; color:#ffffff;">SoopKeeper 서비스 종료</h1>
                        <p style="color:#94a3b8; font-size:15px; line-height:1.6; margin-bottom:32px; word-break:keep-all;">
                            SoopKeeper 서비스 운영이 종료되었습니다.<br>
                            그동안 소중한 VOD를 보관하고 지키기 위해<br>
                            이용해 주신 모든 분들께 진심으로 감사드립니다.
                        </p>
                        <div style="font-size:13px; color:#64748b; border-top:1px solid rgba(255,255,255,0.06); padding-top:20px;">
                            운영 종료일: 2026년 6월 3일
                        </div>
                    </div>
                </div>
            `;
            return;
        }

        data.streamers = jsonData.streamers || [];
        window.isLocalFallback = isLocalFallback;

        try {
            let delRes;
            if (isLocalFallback) {
                delRes = await fetch(`./deletion_report.json?_=${Date.now()}`).catch(() => null);
            } else {
                delRes = await fetch('/api/data?type=deletions').catch(() => null);
            }
            if (delRes && delRes.ok) {
                const deletionData = await delRes.json();
                if (deletionData && deletionData.streamers) {
                    const delMap = {};
                    deletionData.streamers.forEach(ds => {
                        delMap[ds.id.toLowerCase()] = ds.deleted;
                    });
                    data.streamers.forEach(s => {
                        s.deletedCount = delMap[s.id.toLowerCase()] || 0;
                    });
                }
            }
        } catch (e) {
            console.error('Failed to load deletion report:', e);
        }

        renderStreamers();
        if (data.streamers.length > 0) selectStreamer(data.streamers[0].id);

        if (isAdmin) {
            const adminIndicator = document.createElement('div');
            adminIndicator.style.padding = '8px 12px';
            adminIndicator.style.marginTop = '8px';
            adminIndicator.style.background = 'rgba(239, 68, 68, 0.15)';
            adminIndicator.style.border = '1px solid rgba(239, 68, 68, 0.3)';
            adminIndicator.style.borderRadius = '8px';
            adminIndicator.style.fontSize = '12px';
            adminIndicator.style.color = '#f87171';
            adminIndicator.style.textAlign = 'center';
            adminIndicator.style.cursor = 'pointer';
            adminIndicator.textContent = '관리자 우회 중 (일반 시점 복귀)';
            adminIndicator.onclick = () => {
                localStorage.removeItem('soopkeeper_admin');
                window.location.reload();
            };
            document.getElementById('requestBtn').parentNode.appendChild(adminIndicator);
        }

    } catch (error) {
        console.error(error);
        streamerListEl.innerHTML = `
            <div style="text-align:center; padding: 20px; color: var(--danger-red);">
                데이터 오류 발생<br>
                <small style="color:var(--text-dim)">data.json 파일을 확인해주세요.</small>
            </div>`;
    }
}

loadDataAndRender();

const REQUEST_COOLDOWN_MS = 60 * 60 * 1000;
const CONTACT_COOLDOWN_MS = 10 * 60 * 1000;

const requestModal = document.getElementById('requestModal');
const requestBtn = document.getElementById('requestBtn');
const requestCancel = document.getElementById('requestCancel');
const requestSubmit = document.getElementById('requestSubmit');
const requestInput = document.getElementById('requestInput');
const requestReason = document.getElementById('requestReason');

const contactModal = document.getElementById('contactModal');
const contactBtn = document.getElementById('contactBtn');
const contactCancel = document.getElementById('contactCancel');
const contactSubmit = document.getElementById('contactSubmit');
const contactContent = document.getElementById('contactContent');

function getCooldownRemaining() {
    const last = localStorage.getItem('lastRequestTime');
    if (!last) return 0;
    const elapsed = Date.now() - parseInt(last, 10);
    return Math.max(0, REQUEST_COOLDOWN_MS - elapsed);
}

function getContactCooldownRemaining() {
    const last = localStorage.getItem('lastContactTime');
    if (!last) return 0;
    const elapsed = Date.now() - parseInt(last, 10);
    return Math.max(0, CONTACT_COOLDOWN_MS - elapsed);
}

requestBtn.addEventListener('click', () => {
    const remaining = getCooldownRemaining();
    if (remaining > 0) {
        const minutes = Math.ceil(remaining / 60000);
        alert(`신청은 60분에 1회만 가능합니다.\n(약 ${minutes}분 후 다시 신청 가능)`);
        return;
    }
    requestModal.style.display = 'flex';
    requestInput.value = '';
    requestReason.value = '';
    requestInput.style.borderColor = 'var(--border-color)';
    requestInput.focus();
});

requestCancel.addEventListener('click', () => {
    requestModal.style.display = 'none';
});

requestModal.addEventListener('click', (e) => {
    if (e.target === requestModal) requestModal.style.display = 'none';
});

requestSubmit.addEventListener('click', async () => {
    const streamerId = requestInput.value.trim();
    if (!streamerId || streamerId.length > 30) {
        requestInput.style.borderColor = 'var(--danger-red)';
        return;
    }

    requestSubmit.textContent = '전송 중...';
    requestSubmit.disabled = true;

    try {
        const reason = requestReason.value.trim() || '(없음)';

        const res = await fetch('/api/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ streamerId, reason })
        });

        if (res.ok || res.status === 204) {
            localStorage.setItem('lastRequestTime', Date.now().toString());
            requestModal.style.display = 'none';
            alert('신청이 완료되었습니다.\n관리자 확인 후 반영됩니다.');
        } else {
            alert('신청에 실패했습니다. 잠시 후 다시 시도해주세요.');
        }
    } catch (error) {
        alert('네트워크 오류가 발생했습니다.\n잠시 후 다시 시도해주세요.');
    } finally {
        requestSubmit.textContent = '신청하기';
        requestSubmit.disabled = false;
    }
});

contactBtn.addEventListener('click', () => {
    const remaining = getContactCooldownRemaining();
    if (remaining > 0) {
        const minutes = Math.ceil(remaining / 60000);
        alert(`문의는 10분에 1회만 가능합니다.\n(약 ${minutes}분 후 다시 문의 가능)`);
        return;
    }
    contactModal.style.display = 'flex';
    contactContent.value = '';
    contactContent.style.borderColor = 'var(--border-color)';
    contactContent.focus();
});

contactCancel.addEventListener('click', () => {
    contactModal.style.display = 'none';
});

contactModal.addEventListener('click', (e) => {
    if (e.target === contactModal) contactModal.style.display = 'none';
});

contactSubmit.addEventListener('click', async () => {
    const content = contactContent.value.trim();
    if (!content) {
        contactContent.style.borderColor = 'var(--danger-red)';
        return;
    }

    contactSubmit.textContent = '전송 중...';
    contactSubmit.disabled = true;

    try {
        const res = await fetch('/api/contact', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        });

        if (res.ok || res.status === 204) {
            localStorage.setItem('lastContactTime', Date.now().toString());
            contactModal.style.display = 'none';
            alert('문의사항이 전송되었습니다.\n검토 후 조치하겠습니다.');
        } else {
            alert('전송에 실패했습니다. 잠시 후 다시 시도해주세요.');
        }
    } catch (error) {
        alert('네트워크 오류가 발생했습니다.\n잠시 후 다시 시도해주세요.');
    } finally {
        contactSubmit.textContent = '보내기';
        contactSubmit.disabled = false;
    }
});

window.toggleSupporters = function (el) {
    const detail = el.nextElementSibling;
    const isHidden = detail.style.display === 'none';
    detail.style.display = isHidden ? 'block' : 'none';
    el.querySelector('span').textContent = isHidden ? `후원 상세 정보 ▴` : `후원 상세 정보 (${detail.children.length}명) ▾`;
}

window.toggleSupporterVods = function (el) {
    const listEl = el.nextElementSibling;
    const arrowEl = el.querySelector('.toggle-arrow');
    const isHidden = listEl.style.display === 'none';

    listEl.style.display = isHidden ? 'flex' : 'none';
    arrowEl.textContent = isHidden ? '▴' : '▾';
}

window.supporterStartDate = '';
window.supporterEndDate = '';
window.tempStartDate = '';
window.tempEndDate = '';
window.currentViewingYear = new Date().getFullYear();
window.currentViewingMonth = new Date().getMonth();

window.toggleDatePickerPopup = function (event) {
    event.stopPropagation();
    const popup = document.getElementById('datepicker-popup');
    if (!popup) return;
    const isHidden = popup.style.display === 'none';

    if (isHidden) {
        popup.style.display = 'flex';
        window.tempStartDate = window.supporterStartDate;
        window.tempEndDate = window.supporterEndDate;

        let baseDate = new Date();
        if (window.supporterStartDate) {
            baseDate = new Date(window.supporterStartDate);
        }
        window.currentViewingYear = baseDate.getFullYear();
        window.currentViewingMonth = baseDate.getMonth();

        window.initDatePickerOptions();
        window.updateDatePickerGrid();
    } else {
        popup.style.display = 'none';
    }
}

window.initDatePickerOptions = function () {
    const yearSelect = document.getElementById('datepicker-year-select');
    const monthSelect = document.getElementById('datepicker-month-select');
    if (!yearSelect || !monthSelect) return;

    yearSelect.innerHTML = '';
    const currentYear = new Date().getFullYear();
    for (let y = currentYear - 5; y <= currentYear + 5; y++) {
        const opt = document.createElement('option');
        opt.value = y;
        opt.textContent = `${y}년`;
        if (y === window.currentViewingYear) opt.selected = true;
        yearSelect.appendChild(opt);
    }

    monthSelect.innerHTML = '';
    for (let m = 0; m < 12; m++) {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = `${m + 1}월`;
        if (m === window.currentViewingMonth) opt.selected = true;
        monthSelect.appendChild(opt);
    }
}

window.changeDatePickerMonth = function (delta) {
    let year = window.currentViewingYear;
    let month = window.currentViewingMonth + delta;

    if (month < 0) {
        month = 11;
        year -= 1;
    } else if (month > 11) {
        month = 0;
        year += 1;
    }

    window.currentViewingYear = year;
    window.currentViewingMonth = month;

    const yearSelect = document.getElementById('datepicker-year-select');
    const monthSelect = document.getElementById('datepicker-month-select');
    if (yearSelect) yearSelect.value = year;
    if (monthSelect) monthSelect.value = month;

    window.updateDatePickerGrid();
}

window.updateDatePickerGrid = function () {
    const yearSelect = document.getElementById('datepicker-year-select');
    const monthSelect = document.getElementById('datepicker-month-select');
    if (yearSelect) window.currentViewingYear = parseInt(yearSelect.value, 10);
    if (monthSelect) window.currentViewingMonth = parseInt(monthSelect.value, 10);

    const grid = document.getElementById('datepicker-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const firstDay = new Date(window.currentViewingYear, window.currentViewingMonth, 1).getDay();
    const lastDate = new Date(window.currentViewingYear, window.currentViewingMonth + 1, 0).getDate();
    const prevLastDate = new Date(window.currentViewingYear, window.currentViewingMonth, 0).getDate();

    for (let i = firstDay - 1; i >= 0; i--) {
        const dateVal = prevLastDate - i;
        const dayEl = document.createElement('div');
        dayEl.className = 'datepicker-day other-month';
        dayEl.textContent = dateVal;

        let prevM = window.currentViewingMonth - 1;
        let prevY = window.currentViewingYear;
        if (prevM < 0) {
            prevM = 11;
            prevY -= 1;
        }
        const fullDateStr = `${prevY}-${String(prevM + 1).padStart(2, '0')}-${String(dateVal).padStart(2, '0')}`;
        dayEl.onclick = () => window.selectDatePickerDate(fullDateStr);

        if (window.tempStartDate && fullDateStr === window.tempStartDate) {
            dayEl.classList.add('active', 'start-date');
        } else if (window.tempEndDate && fullDateStr === window.tempEndDate) {
            dayEl.classList.add('active', 'end-date');
        } else if (window.tempStartDate && window.tempEndDate && fullDateStr > window.tempStartDate && fullDateStr < window.tempEndDate) {
            dayEl.classList.add('in-range');
        }

        grid.appendChild(dayEl);
    }

    const todayStr = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];
    for (let d = 1; d <= lastDate; d++) {
        const dayEl = document.createElement('div');
        const fullDateStr = `${window.currentViewingYear}-${String(window.currentViewingMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

        dayEl.className = 'datepicker-day';
        dayEl.textContent = d;

        if (fullDateStr === todayStr) {
            dayEl.classList.add('today');
        }
        if (window.tempStartDate && fullDateStr === window.tempStartDate) {
            dayEl.classList.add('active', 'start-date');
        } else if (window.tempEndDate && fullDateStr === window.tempEndDate) {
            dayEl.classList.add('active', 'end-date');
        } else if (window.tempStartDate && window.tempEndDate && fullDateStr > window.tempStartDate && fullDateStr < window.tempEndDate) {
            dayEl.classList.add('in-range');
        }

        dayEl.onclick = () => window.selectDatePickerDate(fullDateStr);
        grid.appendChild(dayEl);
    }

    const totalCells = grid.children.length;
    const remaining = 42 - totalCells;
    for (let d = 1; d <= remaining; d++) {
        const dayEl = document.createElement('div');
        dayEl.className = 'datepicker-day other-month';
        dayEl.textContent = d;

        let nextM = window.currentViewingMonth + 1;
        let nextY = window.currentViewingYear;
        if (nextM > 11) {
            nextM = 0;
            nextY += 1;
        }
        const fullDateStr = `${nextY}-${String(nextM + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        dayEl.onclick = () => window.selectDatePickerDate(fullDateStr);

        if (window.tempStartDate && fullDateStr === window.tempStartDate) {
            dayEl.classList.add('active', 'start-date');
        } else if (window.tempEndDate && fullDateStr === window.tempEndDate) {
            dayEl.classList.add('active', 'end-date');
        } else if (window.tempStartDate && window.tempEndDate && fullDateStr > window.tempStartDate && fullDateStr < window.tempEndDate) {
            dayEl.classList.add('in-range');
        }

        grid.appendChild(dayEl);
    }
}

window.selectDatePickerDate = function (dateStr) {
    console.log("selectDatePickerDate clicked:", dateStr);
    console.log("Before: start =", window.tempStartDate, ", end =", window.tempEndDate);
    if (!window.tempStartDate || (window.tempStartDate && window.tempEndDate)) {
        window.tempStartDate = dateStr;
        window.tempEndDate = '';
    } else {
        if (dateStr < window.tempStartDate) {
            window.tempStartDate = dateStr;
            window.tempEndDate = '';
        } else {
            window.tempEndDate = dateStr;
        }
    }
    console.log("After: start =", window.tempStartDate, ", end =", window.tempEndDate);
    window.updateDatePickerGrid();
}

window.applyDatePickerDate = function () {
    window.supporterStartDate = window.tempStartDate;
    window.supporterEndDate = window.tempEndDate;
    if (window.supporterStartDate && !window.supporterEndDate) {
        window.supporterEndDate = window.supporterStartDate;
    }

    const popup = document.getElementById('datepicker-popup');
    if (popup) popup.style.display = 'none';

    const activeItem = document.querySelector('.streamer-item.active');
    if (activeItem) {
        const id = activeItem.id.replace('item-', '');
        renderSupporters(id);
    }
}

window.clearSupporterDateFilter = function () {
    window.supporterStartDate = '';
    window.supporterEndDate = '';
    window.tempStartDate = '';
    window.tempEndDate = '';
    const textEl = document.getElementById('selected-date-text');
    if (textEl) textEl.textContent = '날짜를 선택해 주세요.';

    const activeItem = document.querySelector('.streamer-item.active');
    if (activeItem) {
        const id = activeItem.id.replace('item-', '');
        renderSupporters(id);
    }
}

document.addEventListener('click', function (e) {
    const container = document.getElementById('datepicker-container');
    const popup = document.getElementById('datepicker-popup');
    if (container && popup && !container.contains(e.target)) {
        popup.style.display = 'none';
    }
});

function renderSupporters(id) {
    const streamer = cachedStreamers[id];
    if (!streamer) return;

    headerTitleEl.textContent = `${streamer.nickname}`;

    headerStatsEl.innerHTML = `
        <div>시청자 후원 내역 및 통계 정보입니다.</div>
    `;

    const textEl = document.getElementById('selected-date-text');
    if (textEl) {
        textEl.textContent = (window.supporterStartDate && window.supporterEndDate)
            ? `${window.supporterStartDate} ~ ${window.supporterEndDate}`
            : '날짜를 선택해 주세요.';
    }

    const rankingMap = {};
    const allVods = [...(streamer.vods || []), ...(streamer.safeVods || [])];

    allVods.forEach(v => {
        if (v.supporters) {
            v.supporters.forEach(sup => {
                const key = sup.id;

                let activeCount = 0;
                let isFiltered = false;

                if (window.supporterStartDate && window.supporterEndDate) {
                    isFiltered = true;
                    if (sup.history && sup.history.length > 0) {
                        sup.history.forEach(h => {
                            if (h.date >= window.supporterStartDate && h.date <= window.supporterEndDate) {
                                activeCount += h.cnt;
                            }
                        });
                    }
                } else {
                    activeCount = sup.cnt;
                }

                if (activeCount <= 0) return;

                if (!rankingMap[key]) {
                    rankingMap[key] = {
                        id: sup.id,
                        nick: sup.nick,
                        total: 0,
                        details: []
                    };
                }
                rankingMap[key].total += activeCount;
                rankingMap[key].details.push({
                    title: v.title,
                    titleNo: v.titleNo,
                    cnt: activeCount,
                    isFiltered: isFiltered
                });
            });
        }
    });

    const sortedList = Object.values(rankingMap).sort((a, b) => b.total - a.total);

    if (sortedList.length === 0) {
        vodGridEl.innerHTML = `
            <div class="empty-state">
                <div class="icon">🎁</div>
                <h3>해당 기간의 후원 데이터가 없습니다.</h3>
                <p>지정한 날짜 이후에 후원(선물)된 내역이 존재하지 않거나 데이터 수집 전입니다.</p>
            </div>
        `;
        return;
    }

    vodGridEl.innerHTML = `
        <div style="grid-column: 1 / -1; display: flex; flex-direction: column; gap: 16px; width: 100%;">
            ${sortedList.map((r, idx) => `
                <div style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 16px; padding: 20px 24px; display: flex; flex-direction: column; gap: 12px; max-width: 800px; width: 100%; margin: 0 auto;">
                    <div onclick="toggleSupporterVods(this)" style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; user-select: none;">
                        <span style="font-weight: 700; font-size: 16px; display: flex; align-items: center; gap: 8px;">
                            <span style="background: ${idx < 3 ? 'var(--warning-orange)' : '#475569'}; color: ${idx < 3 ? '#000' : '#fff'}; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 800;">${idx + 1}</span>
                            ${r.nick} <span style="font-size: 13px; color: var(--text-dim); font-weight: normal;">(${r.id})</span>
                        </span>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="color: var(--warning-orange); font-weight: 800; font-size: 16px;">총 ${r.total.toLocaleString()}개</span>
                            <span class="toggle-arrow" style="color: var(--text-dim); font-size: 12px;">▾</span>
                        </div>
                    </div>
                    <div class="supporter-vod-list" style="display: none; flex-direction: column; gap: 8px; border-top: 1px dashed var(--border-color); padding-top: 12px; margin-top: 4px;">
                        ${r.details.map(d => `
                            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 13px; color: var(--text-dim);">
                                <a href="https://vod.sooplive.com/player/${d.titleNo}" target="_blank" rel="noopener noreferrer" style="color: var(--text-main); text-decoration: none; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 75%;" onmouseover="this.style.color='var(--accent-primary)'" onmouseout="this.style.color='var(--text-main)'">
                                    🎬 ${d.title}
                                </a>
                                <span style="font-weight: 600; color: var(--warning-orange);">${d.cnt}개</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

