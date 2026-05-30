const fetch = require('node-fetch');
const cheerio = require('cheerio');

const BASE_URL = 'https://collections.dyhu.edu.tw';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.7',
};

// type: lend (借閱排行) | newest (新書)
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const { type = 'lend', collection = 'webpac.dataType.book', pageSize = 20 } = req.query;

  try {
    const url = `${BASE_URL}/web2.0_list.do?type=${encodeURIComponent(type)}&pageSize=${pageSize}&collection=${encodeURIComponent(collection)}&nowPage=1`;
    const resp = await fetch(url, { headers: HEADERS });
    const html = await resp.text();

    if (req.query.debug === '1') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    }

    const $ = cheerio.load(html);
    const books = [];

    // web2.0_list rows: rank | title link | author
    $('table tr').each((_, tr) => {
      const $tr = $(tr);
      const $link = $tr.find('a[href*="bookDetail.do"]').first();
      if (!$link.length) return;

      const title = $link.text().trim();
      if (!title) return;

      const href = $link.attr('href') || '';
      const idMatch = href.match(/[?&;]id=(\d+)/);
      const marcid = idMatch ? idMatch[1] : '';

      // author is in adjacent td
      const tds = $tr.find('td');
      let author = '';
      tds.each((i, td) => {
        const text = $(td).text().trim();
        if (text && !text.match(/^\d+$/) && !$(td).find('a').length) {
          author = text;
        }
      });

      if (marcid) {
        books.push({ title, author, marcid, cover: '', type: 'book' });
      }
    });

    res.json({ books, total: books.length });
  } catch (err) {
    console.error('Ranking proxy error:', err);
    res.status(500).json({ error: '查詢失敗', detail: err.message });
  }
};
