const axios = require('axios');
const cheerio = require('cheerio');

exports.handler = async function(event, context) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    try {
        const { keyword, targetUrl } = JSON.parse(event.body);
        
        // 1. 순위 파악에 가장 정확한 '네이버 모바일 통합검색' 사용
        const searchUrl = `https://m.search.naver.com/search.naver?where=m&query=${encodeURIComponent(keyword)}`;

        // 2. 완벽한 모바일 크롬 브라우저 위장 (스마트폰에서 직접 검색하는 것과 100% 동일한 헤더)
        const response = await axios.get(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none'
            },
            timeout: 12000
        });

        const html = response.data;
        const $ = cheerio.load(html);

        // 네이버 IP 차단(캡차) 확인
        if (html.includes('자동 입력 방지') || $('title').text().includes('캡차')) {
            return { statusCode: 200, body: JSON.stringify({ rank: -1, errorMsg: '🚨 네이버 캡차(IP 차단) 발생' }) };
        }

        // [중요] 정확한 순위 계산을 위해 파워링크(광고) 블록을 HTML에서 아예 삭제해버림
        $('.sp_powerlink, .powerlink_group, .sp_ntotal_ad').remove();

        // 도메인 핵심만 추출 (예: https://www.cukiz.co.kr/123 -> cukiz.co.kr)
        const cleanTargetUrl = targetUrl
            .replace(/^https?:\/\//, '')
            .replace(/^www\./, '')
            .replace(/^m\./, '')
            .split('/')[0]
            .toLowerCase();

        let rank = -1;
        let currentRank = 1;
        let blockType = ''; // 어떤 영역(스마트블록 등)에서 발견되었는지 확인용

        // 3. 스마트블록을 포함한 모바일 네이버의 모든 '검색 결과 카드' 선택자
        // .total_wrap (일반웹/뷰) / .api_bx (스마트블록 내부 카드) / li.bx (기타 리스트)
        const items = $('#main_pack .total_wrap, #main_pack .api_bx, #main_pack li.bx');

        items.each((i, el) => {
            // 부모/자식 중복 카운트 방지 (스마트블록 안의 카드를 셀 때, 껍데기 박스는 순위에서 제외)
            if ($(el).hasClass('api_bx') && $(el).parents('.api_bx').length > 0) return;
            if ($(el).hasClass('bx') && $(el).parents('.bx, .total_wrap, .api_bx').length > 0) return;

            // 카드 안의 모든 텍스트, HTML 속성, 링크 주소(href, data-url) 싹쓸이
            const blockHtml = $(el).html() || '';
            const blockText = $(el).text() || '';
            const links = $(el).find('a').map((_, a) => $(a).attr('href') + ' ' + $(a).attr('data-url')).get().join(' ').toLowerCase();

            const combinedData = (blockHtml + ' ' + blockText + ' ' + links).toLowerCase();

            // 이 거대한 데이터 뭉치 안에 내 도메인이 있는가?
            if (combinedData.includes(cleanTargetUrl)) {
                if (rank === -1) {
                    rank = currentRank;
                    
                    // 어떤 영역에서 찾았는지 분석
                    if ($(el).closest('.api_subject_bx').length > 0) {
                        blockType = '스마트블록(에어서치)';
                    } else if ($(el).closest('.sp_nreview').length > 0) {
                        blockType = '리뷰 영역';
                    } else {
                        blockType = '일반 통합검색';
                    }
                }
            }
            // 광고가 아닌 순수 오가닉 결과이므로 순위 카운트 1 증가
            currentRank++;
        });

        // 결과 반환 (찾은 영역 정보 포함)
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rank: rank, blockType: blockType })
        };

    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ errorMsg: `서버 통신 에러: ${error.message}` }) };
    }
};