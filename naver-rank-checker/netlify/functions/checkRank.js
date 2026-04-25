const cheerio = require('cheerio');

exports.handler = async function(event, context) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    try {
        const { keyword, targetUrl } = JSON.parse(event.body);
        
        // 1. 네이버 모바일 통합검색 (가장 구조가 직관적임)
        const searchUrl = `https://m.search.naver.com/search.naver?where=m&query=${encodeURIComponent(keyword)}`;

        // 2. Axios를 버리고 Native Fetch 사용 + Googlebot으로 완벽 위장
        // (네이버는 구글 봇에게 자바스크립트가 배제된 깔끔한 정적 HTML을 제공하며 차단하지 않습니다)
        const response = await fetch(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'ko-KR,ko;q=0.9'
            }
        });

        const html = await response.text();
        const $ = cheerio.load(html);

        // 광고 영역 완전히 삭제
        $('.sp_powerlink, .powerlink_group, .sp_ntotal_ad, #power_link_body').remove();

        // 3. 스마트한 타겟 URL 추출 (가장 중요한 부분)
        // 네이버가 링크를 'cr.naver.com'으로 숨기거나 텍스트를 'cukiz.c...' 처럼 잘라버리는 것을 방지
        const cleanUrl = targetUrl.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/^m\./, '').toLowerCase();
        let searchTarget = '';

        if (cleanUrl.includes('blog.naver.com') || cleanUrl.includes('smartstore.naver.com')) {
            // 네이버 블로그/스마트스토어인 경우 ID로 검색 (예: blog.naver.com/myid -> myid)
            searchTarget = cleanUrl.split('/')[1] || cleanUrl;
        } else {
            // 일반 웹사이트인 경우 도메인 핵심만 추출 (예: cukiz.co.kr -> cukiz)
            // 도메인이 너무 짧은 경우를 대비해 첫 번째 마디만 추출
            searchTarget = cleanUrl.split('.')[0]; 
        }

        let rank = -1;
        let currentRank = 1;
        let blockType = '오가닉 결과';

        // 네이버의 모든 주요 검색결과 카드 선택
        const items = $('#main_pack .total_wrap, #main_pack .api_bx, #main_pack li.bx');

        items.each((i, el) => {
            // 자식-부모 중복 카운트 방지
            if ($(el).hasClass('api_bx') && $(el).parents('.api_bx').length > 0) return;
            if ($(el).hasClass('bx') && $(el).parents('.bx, .total_wrap, .api_bx').length > 0) return;

            // HTML 소스, 텍스트, 안에 숨겨진 링크 주소 등 모든 텍스트를 하나의 문자열로 뭉침
            const blockHtml = $(el).html() || '';
            const blockText = $(el).text() || '';
            const links = $(el).find('a').map((_, a) => {
                return ($(a).attr('href') || '') + ' ' + ($(a).attr('data-url') || '');
            }).get().join(' ');

            const combinedData = (blockHtml + ' ' + blockText + ' ' + links).toLowerCase();

            // 뭉친 데이터 안에 우리의 핵심 타겟 키워드(예: cukiz)가 포함되어 있는지 검사
            if (combinedData.includes(searchTarget)) {
                if (rank === -1) {
                    rank = currentRank;
                    // 발견 위치 판별
                    if ($(el).closest('.api_subject_bx').length > 0) blockType = '스마트블록';
                }
            }
            currentRank++; // 못 찾았으면 다음 결과물이므로 순위 1 증가
        });

        // 응답 전송
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rank: rank, blockType: blockType })
        };

    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ errorMsg: `크롤링 에러: ${error.message}` }) };
    }
};