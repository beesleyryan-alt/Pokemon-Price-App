module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');

  const { term, site, type } = req.query;
  if (!term) return res.status(400).json({ error: 'term required' });

  const isPsa   = type === 'psa10';
  const isUK    = site !== 'us';
  const search  = isPsa ? `${term} PSA 10` : term;
  const base    = isUK ? 'https://www.ebay.co.uk' : 'https://www.ebay.com';
  const minPrice = isPsa ? (isUK ? '&_udlo=20' : '&_udlo=25') : '';
  const url = `${base}/sch/i.html?_nkw=${encodeURIComponent(search)}&LH_Complete=1&LH_Sold=1&_sop=13${minPrice}&_ipg=60`;

  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept-Language': isUK ? 'en-GB,en;q=0.9' : 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      }
    });

    const html = await resp.text();
    const prices = extractPrices(html, isUK);

    if (prices.length === 0) {
      return res.json({ market: null, low: null, high: null, count: 0 });
    }

    const clean = removeOutliers(prices).sort((a, b) => a - b);
    return res.json({
      market: round(median(clean)),
      low:    round(clean[0]),
      high:   round(clean[clean.length - 1]),
      count:  clean.length,
      currency: isUK ? 'GBP' : 'USD'
    });

  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch eBay data' });
  }
};

function extractPrices(html, isUK) {
  const prices = [];
  const parts  = html.split('s-item__price');

  for (let i = 1; i < parts.length; i++) {
    const chunk = parts[i].slice(0, 300).replace(/<[^>]*>/g, ' ');
    if (/\bto\b/i.test(chunk.slice(0, 60))) continue; // skip price ranges

    const pattern = isUK
      ? /£\s*([\d,]+(?:\.\d{1,2})?)/
      : /\$\s*([\d,]+(?:\.\d{1,2})?)/;

    const m = chunk.match(pattern);
    if (m) {
      const val = parseFloat(m[1].replace(/,/g, ''));
      if (!isNaN(val) && val > 0.49 && val < 50000) prices.push(val);
    }
  }
  return prices;
}

function removeOutliers(arr) {
  if (arr.length < 4) return arr;
  const s = [...arr].sort((a, b) => a - b);
  const q1  = pct(s, 25);
  const q3  = pct(s, 75);
  const iqr = q3 - q1;
  return s.filter(p => p >= q1 - 1.5 * iqr && p <= q3 + 1.5 * iqr);
}

function pct(s, p) {
  const i = (p / 100) * (s.length - 1);
  const lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

function median(s) {
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function round(n) { return Math.round(n * 100) / 100; }
