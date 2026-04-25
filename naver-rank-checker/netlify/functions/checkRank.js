const axios = require('axios');
const cheerio = require('cheerio');

exports.handler = async function(event, context) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    try {
        const { keyword, targetUrl } = JSON.parse(event.body);
        
        // PC 통합검색 URL
        const searchUrl = `https://search.naver.com/search.naver?where=nexearch&query=${encodeURIComponent(keyword)}`;

        const response = await axios.get(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'ko-KR,ko;q=0.9',
                'Referer': 'https://www.naver.com/',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'same-origin'
            },
            timeout: 10000
        });

        const html = response.data;
        const $ = cheerio.load(html);

        // 캡차/차단 확인
        if (html.includes('자동 입력 방지') || $('title').text().includes('캡차')) {
            return { statusCode: 200, body: JSON.stringify({ rank: -1, errorMsg: '🚨 네이버 캡차(IP 차단) 발생' }) };
        }

        // URL 극단적 정규화 (모든 프로토콜, www, m. 제거 및 도메인 핵심만 추출)
        // 예: https://cukiz.co.kr/product/1 -> cukiz.co.kr
        const cleanTargetUrl = targetUrl.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/^m\./, '').split('/')[0].toLowerCase();

        let rank = -1;
        let currentRank = 1;
        let debugDetectedUrls =[]; // 봇이 실제로 읽은 상위 5개 사이트 수집용

        // 1. 네이버 통합검색의 모든 검색결과 블록 추출 (스마트블록, 웹, 뷰 모두 포함)
        const items = $('#main_pack li.bx, #main_pack div.total_wrap');

        items.each((i, el) => {
            // 파워링크(광고) 제외
            if ($(el).find('.sp_powerlink').length > 0 || $(el).hasClass('powerlink_group')) return;

            const blockHtml = $(el).html().toLowerCase();
            const blockText = $(el).text().toLowerCase();
            
            // 디버깅용: 봇이 현재 읽고 있는 사이트들의 실제 링크를 5개까지만 수집해봄
            if (debugDetectedUrls.length < 5) {
                const link = $(el).find('a.title_link, a.link_tit, a.name').attr('href');
                if (link && !link.includes('naver.com')) { // 네이버 내부 링크 제외
                    debugDetectedUrls.push(link.replace(/^https?:\/\//, '').split('/')[0]);
                }
            }

            // 블록 내에 핵심 도메인이 텍스트나 링크로 존재하는가?
            if (blockHtml.includes(cleanTargetUrl) || blockText.includes(cleanTargetUrl)) {
                if (rank === -1) rank = currentRank;
            }
            currentRank++;
        });

        // 2. [최후의 보루] 만약 블록 검사에서 -1이 나왔다면, 페이지 전체 HTML 소스코드에 도메인이 존재하는지 확인
        // (쇼핑 동적 로딩 데이터나 숨겨진 태그에라도 들어있는지 검사)
        let isAnywhereOnPage = false;
        if (rank === -1 && html.toLowerCase().includes(cleanTargetUrl)) {
            isAnywhereOnPage = true;
        }

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                rank: rank, 
                isAnywhere: isAnywhereOnPage,
                debugInfo: debugDetectedUrls.join(', ') // 프론트엔드로 봇이 본 사이트들 전송
            })
        };

    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ errorMsg: `서버 통신 에러: ${error.message}` }) };
    }
};