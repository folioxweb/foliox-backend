export enum Intent {
  // Asset Specific
  GET_CURRENT_PRICE = 'GET_CURRENT_PRICE',
  GET_AVG_BUY_PRICE = 'GET_AVG_BUY_PRICE',
  GET_QUANTITY = 'GET_QUANTITY',
  GET_INVESTED_AMOUNT = 'GET_INVESTED_AMOUNT',
  GET_CURRENT_VALUE = 'GET_CURRENT_VALUE',
  GET_PROFIT_LOSS = 'GET_PROFIT_LOSS',
  GET_DAY_CHANGE = 'GET_DAY_CHANGE',
  GET_SECTOR = 'GET_SECTOR',
  GET_CONVICTION = 'GET_CONVICTION',
  GET_CONSTITUENTS = 'GET_CONSTITUENTS',
  LATEST_NEWS = 'LATEST_NEWS',
  LATEST_REPORTS = 'LATEST_REPORTS',

  // Portfolio Wide & Analytics
  GET_TODAY_PERFORMANCE = 'GET_TODAY_PERFORMANCE',
  GET_TODAY_ETF_GAIN = 'GET_TODAY_ETF_GAIN',
  GET_TODAY_MF_GAIN = 'GET_TODAY_MF_GAIN',
  LIST_ETFS = 'LIST_ETFS',
  LIST_MFS = 'LIST_MFS',
  LIST_STOCKS = 'LIST_STOCKS',
  GET_TOP_STOCKS = 'GET_TOP_STOCKS',
  GET_TOP_SECTORS = 'GET_TOP_SECTORS',
  GET_WEIGHTAGE = 'GET_WEIGHTAGE',

  UNKNOWN = 'UNKNOWN',
}

export interface ParseResult {
  intent: Intent;
  entity: string | null;
}

// Simple string distance for fuzzy matching (Levenshtein)
export function levenshteinDistance(a: string, b: string): number {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1));
      }
    }
  }
  return matrix[b.length][a.length];
}

export function findBestMatch(entity: string, candidates: string[]): string | null {
  if (!entity || candidates.length === 0) return null;
  
  let bestMatch = null;
  let minDistance = Infinity;

  const entityLower = entity.toLowerCase();

  for (const candidate of candidates) {
    const candidateLower = candidate.toLowerCase();
    
    if (candidateLower.includes(entityLower) || entityLower.includes(candidateLower)) {
      return candidate;
    }

    const dist = levenshteinDistance(entityLower, candidateLower);
    if (dist < minDistance) {
      minDistance = dist;
      bestMatch = candidate;
    }
  }

  if (minDistance <= Math.max(3, Math.floor(entity.length * 0.4))) {
    return bestMatch;
  }

  return null;
}

// Extracts the best matching asset name from the query
export function extractEntity(query: string, assetNames: string[]): string | null {
  const normalizedQuery = query.toLowerCase().replace(/[^a-z0-9 ]/g, " ");
  
  let bestMatch = null;
  let highestScore = 0;

  for (const asset of assetNames) {
    // 1. Remove corporate suffixes and punctuation from the DB asset name
    const cleanAsset = asset.toLowerCase()
      .replace(/\\b(ltd|limited|inc|corp|llc|plc|trust|company)\\b/gi, "")
      .replace(/[^a-z0-9 ]/g, " ")
      .replace(/\\s+/g, " ")
      .trim();
      
    // 2. Exact substring match of the cleaned name (e.g. "hdfc bank" inside query)
    if (cleanAsset.length > 2 && normalizedQuery.includes(cleanAsset)) {
       return asset; // Perfect match
    }
    
    // 3. Word-level matching for partials (e.g. "hdfc" out of "hdfc bank")
    const assetWords = cleanAsset.split(" ").filter(w => w.length > 2); // ignore "50", "of"
    if (assetWords.length === 0) continue;
    
    let matchedWords = 0;
    for (const w of assetWords) {
      const regex = new RegExp('\\b' + w + '\\b', 'i');
      if (regex.test(normalizedQuery)) {
        matchedWords++;
      }
    }
    
    const score = matchedWords / assetWords.length;
    
    // If it matches at least half the words (e.g. HDFC out of HDFC Bank)
    if (score >= 0.5 && score > highestScore) {
      // Prevent generic words like "bank" or "etf" from falsely claiming an asset
      if (matchedWords === 1 && (normalizedQuery.includes(' etf ') || normalizedQuery.includes(' bank '))) {
        // If the only matched word was "bank" or "etf", skip it
        const matchedWord = assetWords.find(w => new RegExp('\\b' + w + '\\b', 'i').test(normalizedQuery));
        if (matchedWord === 'etf' || matchedWord === 'bank' || matchedWord === 'fund') {
          continue;
        }
      }
      highestScore = score;
      bestMatch = asset;
    }
  }

  return bestMatch;
}

export function determineIntent(query: string, hasEntity: boolean): Intent {
  const q = query.toLowerCase();

  // 1. Check for specific asset intents FIRST
  if (hasEntity) {
    if (q.includes('weight') || q.includes('weightage') || q.includes('allocation')) {
      return Intent.GET_WEIGHTAGE;
    }
    if (q.includes('average') || q.includes('avg') || (q.includes('buy') && q.includes('price'))) {
      return Intent.GET_AVG_BUY_PRICE;
    }
    if (q.includes('quantity') || q.includes('how many') || q.includes('shares') || q.includes('units')) {
      return Intent.GET_QUANTITY;
    }
    if (q.includes('invested') || q.includes('investment') || q.includes('put in')) {
      return Intent.GET_INVESTED_AMOUNT;
    }
    if (q.includes('profit') || q.includes('loss') || q.includes('return') || q.includes('pnl')) {
      return Intent.GET_PROFIT_LOSS;
    }
    if ((q.includes('today') || q.includes('day')) && (q.includes('change') || q.includes('gain') || q.includes('loss'))) {
      return Intent.GET_DAY_CHANGE;
    }
    if (q.includes('current value') || q.includes('worth') || q.includes('holding value')) {
      return Intent.GET_CURRENT_VALUE;
    }
    if (q.includes('price') || q.includes('current price') || q.includes('trading at')) {
      return Intent.GET_CURRENT_PRICE;
    }
    if (q.includes('sector') || q.includes('industry')) {
      return Intent.GET_SECTOR;
    }
    if (q.includes('conviction') || q.includes('confidence') || q.includes('rating')) {
      return Intent.GET_CONVICTION;
    }
    if (q.includes('constituent') || q.includes('holding') || q.includes('inside') || q.includes('top stock')) {
      return Intent.GET_CONSTITUENTS;
    }
    if (q.includes('news') || q.includes('article') || q.includes('headline')) {
      return Intent.LATEST_NEWS;
    }
    if (q.includes('report') || q.includes('filing') || q.includes('document')) {
      return Intent.LATEST_REPORTS;
    }
    
    // Default fallback if they just name an asset and ask "what about"
    return Intent.GET_CURRENT_PRICE;
  }

  // 2. Portfolio Wide & Analytics Intents
  if (q.includes('weight') || q.includes('weightage') || q.includes('allocation')) {
    // If they ask for weightage of a sector, it won't have an asset entity, so we handle it here
    return Intent.GET_WEIGHTAGE;
  }
  
  if (q.includes('top') || q.includes('biggest') || q.includes('largest')) {
    if (q.includes('sector') || q.includes('industry')) return Intent.GET_TOP_SECTORS;
    if (q.includes('stock') || q.includes('holding') || q.includes('company')) return Intent.GET_TOP_STOCKS;
  }

  if (q.includes('news')) return Intent.LATEST_NEWS; 
  if (q.includes('report')) return Intent.LATEST_REPORTS;

  if (q.includes('today') || q.includes('day')) {
    if (q.includes('etf')) return Intent.GET_TODAY_ETF_GAIN;
    if (q.includes('mutual fund') || q.includes('mf')) return Intent.GET_TODAY_MF_GAIN;
    return Intent.GET_TODAY_PERFORMANCE; 
  }
  
  if (q.includes('etf')) return Intent.LIST_ETFS;
  if (q.includes('mutual fund') || q.includes('mf')) return Intent.LIST_MFS;
  if (q.includes('stock')) return Intent.LIST_STOCKS;

  return Intent.UNKNOWN;
}

export function parseQuery(query: string, assetNames: string[]): ParseResult {
  const entity = extractEntity(query, assetNames);
  const intent = determineIntent(query, !!entity);
  
  return { intent, entity };
}
