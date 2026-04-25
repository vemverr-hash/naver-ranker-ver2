const axios = require('axios');
const cheerio = require('cheerio');

exports.handler = async function(event, context) {
    // POST 요청만 허용
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    try {
        const { keyword, targetUrl } = JSON.parse(event.body);
        
        if (!keyword || !targetUrl) {
            return { statusCode: 400, body: JSON.stringify({ error: '키워드와 URL을 모두 입력해주세요.' }) };
        }

        // 네이버 모바일 통합검색 URL
        const searchUrl = `https://m.search.naver.com/search.naver?sm=mtb_hty.top&where=m&query=${encodeURIComponent(keyword)}`;

        // 모바일 브라우저인 것처럼 User-Agent 설정
        const response = await axios.get(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
            }
        });

        const $ = cheerio.load(response.data);
        let rank = -1; // -1은 순위 밖(또는 100위 밖)을 의미함
        let currentRank = 1;

        // URL 정제 (http, https, www 등 제거하여 정확도 향상)
        const cleanTargetUrl = targetUrl.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');

        // 네이버 모바일 검색결과 주요 링크 요소 탐색 (웹사이트, 블로그, 스마트스토어 등)
        // ※ 주의: 네이버의 UI 개편에 따라 클래스명이 변경될 수 있습니다.
        const links = $('a.api_txt_lines, a.total_tit, a.name, div.total_wrap a.link_ext, a.title_link');

        links.each((i, el) => {
            const href = $(el).attr('href') || '';
            const text = $(el).text() || '';

            // href(링크)나 text(제목/도메인 텍스트)에 타겟 URL이 포함되어 있는지 확인
            if (href.includes(cleanTargetUrl) || text.includes(cleanTargetUrl)) {
                rank = currentRank;
                return false; // 찾으면 반복문 종료
            }
            currentRank++;
        });

        return {
            statusCode: 200,
            body: JSON.stringify({ rank: rank })
        };

    } catch (error) {
        console.error('Crawling Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: '네이버 검색결과를 가져오는 중 오류가 발생했습니다.' })
        };
    }
};