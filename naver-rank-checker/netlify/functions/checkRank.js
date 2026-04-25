const axios = require('axios');
const cheerio = require('cheerio');

// IP 차단 방지를 위한 딜레이 함수
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

exports.handler = async function(event, context) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    try {
        const { keyword, targetUrl } = JSON.parse(event.body);
        
        if (!keyword || !targetUrl) {
            return { statusCode: 400, body: JSON.stringify({ error: '키워드와 URL을 모두 입력해주세요.' }) };
        }

        // URL 정규화 (http, https, www, m. 제거 및 끝 슬래시 제거)
        const cleanTargetUrl = targetUrl
            .replace(/^https?:\/\//, '')
            .replace(/^www\./, '')
            .replace(/^m\./, '')
            .replace(/\/$/, '')
            .toLowerCase();

        let rank = -1;
        let currentRank = 1;
        const maxPages = 10; // 최대 탐색할 페이지 수 (10페이지 = 약 150개)
        const resultsPerPage = 15; // 네이버 웹검색 1페이지당 노출 개수

        // 1페이지부터 10페이지까지 반복하면서 찾기
        for (let page = 1; page <= maxPages; page++) {
            // start 값: 1, 16, 31, 46 ... (페이지별 시작 번호)
            const startIdx = (page - 1) * resultsPerPage + 1;
            
            // '통합검색'이 아닌 '웹검색(where=web)' 탭 사용 (순위 딥서치용)
            const searchUrl = `https://search.naver.com/search.naver?where=web&query=${encodeURIComponent(keyword)}&start=${startIdx}`;

            const response = await axios.get(searchUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                    'Referer': 'https://search.naver.com/',
                },
                timeout: 8000 // 각 페이지당 타임아웃 8초
            });

            const html = response.data;
            const $ = cheerio.load(html);

            // 캡차(차단) 감지
            if (html.includes('자동 입력 방지') || $('title').text().includes('캡차')) {
                return {
                    statusCode: 200,
                    body: JSON.stringify({ rank: -1, errorMsg: `🚨 Netlify IP가 네이버에 의해 차단되었습니다. (페이지 ${page} 탐색 중)` })
                };
            }

            // 웹검색 결과 블록
            const items = $('li.bx, div.total_wrap');

            // 검색 결과가 더 이상 없으면 반복문 종료 (예: 총 검색결과가 3페이지밖에 없는 경우)
            if (items.length === 0) {
                break;
            }

            let foundOnThisPage = false;

            // 현재 페이지의 블록들 검사
            items.each((i, el) => {
                // 파워링크(광고) 제외
                if ($(el).find('.sp_powerlink').length > 0 || $(el).closest('.sp_powerlink').length > 0) return;

                const text = $(el).text().toLowerCase();
                const htmlContent = $(el).html().toLowerCase();
                const hrefs = $(el).find('a').map((_, a) => $(a).attr('href')).get().join(' ').toLowerCase();

                // 모든 텍스트, html 요소, 링크 주소 뭉치기
                const combinedData = text + ' ' + htmlContent + ' ' + hrefs;

                // 내 URL이 포함되어 있는지 확인
                if (combinedData.includes(cleanTargetUrl)) {
                    rank = currentRank;
                    foundOnThisPage = true;
                    return false; // 찾았으면 each 반복문 즉시 탈출
                }
                
                currentRank++; // 못 찾았으면 다음 블록이므로 순위 +1
            });

            // 내 사이트를 찾았다면 더 이상 다음 페이지를 긁을 필요 없이 종료
            if (foundOnThisPage) {
                break;
            }

            // 서버 과부하 및 봇 차단 방지를 위해 다음 페이지로 넘어가기 전 0.3초 대기
            if (page < maxPages) {
                await sleep(300);
            }
        }

        // 10페이지까지 다 돌았는데 결과 반환
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rank: rank })
        };

    } catch (error) {
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ errorMsg: `서버 통신 에러 (TimeOut 또는 구조 변경): ${error.message}` })
        };
    }
};