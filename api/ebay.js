module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');

  const { term, site, type } = req.query;
  if (!term) return res.status(400).json({ error: 'term required' });

  const appId = process.env.EBAY_APP_ID;
  if (!appId) return res.status(500).json({ error: 'eBay API not configured' });

  const isPsa     = type === 'psa10';
  const isUK      = site !== 'us';
  const siteId    = isUK ? 3 : 0;
  const keywords  = isPsa ? `${term} PSA 10` : term;
  const currency  = isUK ? 'GBP' : 'USD';
  const minPrice  = isPsa ? (isUK ? 20 : 25) : null;

  const params = new URLSearchParams({
    'OPERATION-NAME':              'findCompletedItems',
    'SERVICE-VERSION':             '1.0.0',
    'SECURITY-APPNAME':            appId,
    'RESPONSE-DATA-FORMAT':        'JSON',
    'keywords':                    keywords,
    'itemFilter(0).name':          'SoldItemsOnly',
    'itemFilter(0).value':         'true',
    'sortOrder':                   'EndTimeSoonest',
    'paginationInput.entriesPerPage': '50',
    'siteid':                      String(siteId),
  });

  if (minPrice) {
    params.set('itemFilter(1).name',       'MinPrice');
    params.set('itemFilter(1).value',      String(minPrice));
    params.set('itemFilter(1).paramName',  'Currency');
    params.set('itemFilter(1).paramValue', currency);
  }

  const url = `https://svcs.ebay.com/services/search/FindingService/v1?${params}`;

  try {
    const resp = await fetch(url);
    const data = await resp.json();

    const items = data?.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item || [];

    const prices = items
      .filter(item => item?.sellingStatus?.[0]?.sellingState?.[0] === 'EndedWithSales')
      .map(item => parseFloat(item?.sellingStatus?.[0]?.currentPrice?.[0]?.__value__))
      .filter(p => !isNaN(p) && p > 0);

    if (prices.length === 0) {
      return res.json({ market: null, low: null, high: null, count: 0 });
    }

    const clean = removeOutliers(prices).sort((a, b) => a - b);
    return res.json({
      market:   round(median(clean)),
      low:      round(clean[0]),
      high:     round(clean[clean.length - 1]),
      count:    clean.length,
      currency,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

function removeOutliers(arr) {
  if (arr.length < 4) return arr;
  const s   = [...arr].sort((a, b) => a - b);
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
