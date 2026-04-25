const axios = require('axios');
const cheerio = require('cheerio');

exports.handler = async function(event, context) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    try {
        const { keyword, targetUrl } = JSON.parse(event.body);
        
        if (!keyword || !targetUrl) {
            return { statusCode: 400, body: JSON.stringify({ error: '키워드와 URL을 모두 입력해주세요.' }) };
        }

        const searchUrl = `https://m.search.naver.com/search.naver?sm=mtb_hty.top&where=m&query=${encodeURIComponent(keyword)}`;

        // 모바일 크롬 브라우저와 완벽하게 동일한 헤더를 전송하여 네이버의 차단을 우회합니다.
        const response = await axios.get(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-G991N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Upgrade-Insecure-Requests': '1'
            },
            timeout: 10000 // 10초 타임아웃
        });

        const $ = cheerio.load(response.data);
        
        // 1. 네이버 모바일 검색결과는 보통 li.bx, div.total_wrap, div.sp_website 등으로 하나의 "카드(블록)"를 구성합니다.
        const items = $('li.bx, div.total_wrap, div.sp_website');
        
        let rank = -1;
        let currentRank = 1;

        // 2. 타겟 URL 정규화 (http, https, www, m. 및 끝에 붙은 슬래시를 모두 제거하여 정확도 극대화)
        const cleanTargetUrl = targetUrl
            .replace(/^https?:\/\//, '')
            .replace(/^www\./, '')
            .replace(/^m\./, '')
            .replace(/\/$/, '')
            .toLowerCase();

        items.each((i, el) => {
            // 중복 카운트 방지: 자식 블록이 부모 블록에 속해 여러번 세어지는 것을 막습니다.
            const isNested = $(el).parent().closest('li.bx, div.total_wrap, div.sp_website').length > 0;
            if (isNested) return; 

            const html = $(el).html() || '';
            const text = $(el).text() || '';

            // 순수 SEO 랭크 측정을 위해 광고(파워링크 등) 또는 연관검색어 영역은 순위 카운트에서 제외합니다.
            if (html.includes('sp_powerlink') || $(el).hasClass('powerlink_group') || text.includes('연관검색어')) {
                return;
            }

            // 3. 획기적인 파싱: 블록 내의 모든 텍스트, href, data-url을 싹 다 긁어 모읍니다.
            // (네이버가 cr.naver.com 우회 링크를 쓰거나 실제 링크를 data-url에 숨기는 것을 원천 방어)
            const hrefs = $(el).find('a').map((_, a) => $(a).attr('href')).get().join(' ');
            const dataUrls = $(el).find('[data-url]').map((_, a) => $(a).attr('data-url')).get().join(' ');

            // 모든 정보를 하나로 뭉쳐서 검색합니다.
            const combinedData = (text + ' ' + hrefs + ' ' + dataUrls).toLowerCase();

            // 정규화된 타겟 URL이 뭉쳐진 데이터 안(텍스트, href, data-url 중 어디든)에 존재하면 내 순위로 기록!
            if (combinedData.includes(cleanTargetUrl)) {
                if (rank === -1) {
                    rank = currentRank;
                }
            }

            // 정상적인 유기적(Organic) 검색 결과 블록이므로 전체 순위를 1 증가시킵니다.
            currentRank++;
        });

        // 결과 반환
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rank: rank })
        };

    } catch (error) {
        console.error('Crawling Error:', error.message);
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: '네이버 검색결과를 가져오는 중 오류가 발생했습니다.', details: error.message })
        };
    }
};