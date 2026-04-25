// Local Storage 키
const STORAGE_KEY = 'naver_seo_rank_data';

// 데이터 상태 관리
let rankData = JSON.parse(localStorage.getItem(STORAGE_KEY)) ||[];

// DOM 요소
const addForm = document.getElementById('addForm');
const dataTable = document.getElementById('dataTable');
const updateAllBtn = document.getElementById('updateAllBtn');
const loadingOverlay = document.getElementById('loadingOverlay');
const loadingText = document.getElementById('loadingText');

// 오늘 날짜 구하기 (YYYY-MM-DD 형식)
function getTodayDate() {
    const today = new Date();
    // 한국 시간대(KST)로 맞추기 위한 간단한 처리
    const offset = today.getTimezoneOffset() * 60000;
    const dateOffset = new Date(today.getTime() - offset);
    return dateOffset.toISOString().split('T')[0];
}

// 데이터 저장
function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rankData));
}

// 아이템 추가
addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const urlInput = document.getElementById('siteUrl').value.trim();
    const keywordInput = document.getElementById('targetKeyword').value.trim();

    if (urlInput && keywordInput) {
        const newItem = {
            id: Date.now().toString(),
            url: urlInput,
            keyword: keywordInput,
            history:[] // { date: 'YYYY-MM-DD', rank: number }
        };
        rankData.push(newItem);
        saveData();
        renderTable();
        addForm.reset();
    }
});

// 아이템 삭제
function deleteItem(id) {
    if (confirm('이 항목을 삭제하시겠습니까?')) {
        rankData = rankData.filter(item => item.id !== id);
        saveData();
        renderTable();
    }
}

// 단일 순위 업데이트
async function updateRank(id, showLoading = true) {
    const item = rankData.find(i => i.id === id);
    if (!item) return;

    if (showLoading) {
        document.getElementById(`btn-${id}`).innerHTML = '<span class="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full"></span>';
        document.getElementById(`btn-${id}`).disabled = true;
    }

    try {
        // Netlify Function API 호출
        const response = await fetch('/.netlify/functions/checkRank', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keyword: item.keyword, targetUrl: item.url })
        });

        const data = await response.json();
        const today = getTodayDate();
        
        // 히스토리 업데이트 로직
        const existingDateIndex = item.history.findIndex(h => h.date === today);
        if (existingDateIndex >= 0) {
            item.history[existingDateIndex].rank = data.rank; // 오늘 데이터가 있으면 덮어쓰기
        } else {
            item.history.push({ date: today, rank: data.rank }); // 없으면 추가
        }

        // 최대 7일 치만 유지
        if (item.history.length > 7) {
            item.history.shift(); // 가장 오래된 데이터 삭제
        }

        saveData();
        
    } catch (error) {
        console.error('업데이트 실패:', error);
        alert(`${item.keyword} 업데이트 중 오류가 발생했습니다.`);
    } finally {
        if (showLoading) renderTable();
    }
}

// 전체 업데이트 (IP 차단 방지를 위해 3초 딜레이 적용)
updateAllBtn.addEventListener('click', async () => {
    if (rankData.length === 0) {
        alert('등록된 키워드가 없습니다.');
        return;
    }

    loadingOverlay.classList.remove('hidden');
    updateAllBtn.disabled = true;

    for (let i = 0; i < rankData.length; i++) {
        loadingText.innerText = `전체 순위 업데이트 중... (${i + 1}/${rankData.length})`;
        await updateRank(rankData[i].id, false);
        
        // 마지막 항목이 아니면 3초 대기 (네이버 IP 차단 방지)
        if (i < rankData.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }

    loadingOverlay.classList.add('hidden');
    updateAllBtn.disabled = false;
    renderTable();
});

// 전일 대비 순위 변동 계산 함수
function getRankChangeHtml(history) {
    if (history.length < 2) return `<span class="text-gray-400 text-sm">-</span>`;
    
    const todayRank = history[history.length - 1].rank;
    const yesterdayRank = history[history.length - 2].rank;

    // 둘 다 순위 밖인 경우
    if (todayRank === -1 && yesterdayRank === -1) return `<span class="text-gray-400">-</span>`;
    
    // 어제는 순위 밖이었는데 오늘 진입한 경우
    if (yesterdayRank === -1 && todayRank !== -1) return `<span class="text-red-500 font-semibold">▲ NEW</span>`;
    
    // 어제는 순위권이었는데 오늘 밖으로 나간 경우
    if (yesterdayRank !== -1 && todayRank === -1) return `<span class="text-blue-500 font-semibold">▼ OUT</span>`;

    const diff = yesterdayRank - todayRank; // 양수면 순위 상승(좋은 것), 음수면 하락

    if (diff > 0) return `<span class="text-red-500 font-bold">▲ ${diff}</span>`; // 상승은 빨간색
    if (diff < 0) return `<span class="text-blue-500 font-bold">▼ ${Math.abs(diff)}</span>`; // 하락은 파란색
    return `<span class="text-gray-500 font-semibold">-</span>`; // 변동 없음
}

// 테이블 렌더링
function renderTable() {
    dataTable.innerHTML = '';

    if (rankData.length === 0) {
        dataTable.innerHTML = `<tr><td colspan="6" class="px-6 py-12 text-center text-gray-500">등록된 사이트와 키워드가 없습니다.</td></tr>`;
        return;
    }

    rankData.forEach(item => {
        const latestRank = item.history.length > 0 ? item.history[item.history.length - 1].rank : null;
        const rankText = latestRank === null 
    ? '미확인' 
    : (latestRank === -1 ? '순위 밖 (150위권 외)' : `<span class="text-blue-600 font-bold">${latestRank}위</span>`);
        
        // 7일 추이 텍스트 생성 (예: 12위 → 10위 → 5위)
        const trendText = item.history.map(h => h.rank === -1 ? 'OUT' : h.rank).join(' <span class="text-gray-300">→</span> ');

        const tr = document.createElement('tr');
        tr.className = 'hover:bg-gray-50 transition-colors';
        tr.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${item.url}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-700">${item.keyword}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-center font-bold ${latestRank && latestRank !== -1 ? 'text-blue-600' : 'text-gray-400'}">${rankText}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-center">${getRankChangeHtml(item.history)}</td>
            <td class="px-6 py-4 whitespace-nowrap text-xs text-gray-500 text-center">${trendText || '-'}</td>
            <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                <button id="btn-${item.id}" onclick="updateRank('${item.id}')" class="bg-indigo-50 hover:bg-indigo-100 text-indigo-600 px-3 py-1 rounded border border-indigo-200 transition-colors mr-2">업데이트</button>
                <button onclick="deleteItem('${item.id}')" class="bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1 rounded border border-red-200 transition-colors">삭제</button>
            </td>
        `;
        dataTable.appendChild(tr);
    });
}

// 초기 렌더링
renderTable();