// Vercel Serverless Function - /api/audio

const SAAVN_BASE_URL = 'https://saavn.sumit.co';

const INVIDIOUS_INSTANCES = [
  'invidious.darkness.services',
  'yt.omada.cafe',
  'invidious.reallyaweso.me',
  'invidious.f5.si',
  'inv-veltrix-2.zeabur.app',
  'inv-veltrix.zeabur.app',
  'inv-veltrix-3.zeabur.app',
  'inv.vern.cc',
  'invidious.materialio.us',
  'y.com.sb'
];

const STREMIO_INSTANCES = [
  'https://ubiquitous-rugelach-b30b3f.netlify.app',
  'https://super-duper-system.netlify.app',
  'https://ubiquitous-rugelach-b30b3f.netlify.app'
];

// Helper function to make fetch requests with timeout
async function fetchWithTimeout(url, options = {}, timeout = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

// JioSaavn API handler
async function searchJioSaavn(title, author, duration) {
  try {
    const query = author ? `${title} ${author}` : title;
    const searchUrl = `${SAAVN_BASE_URL}/api/search/songs?query=${encodeURIComponent(query)}`;
    
    const response = await fetchWithTimeout(searchUrl);
    if (!response.ok) throw new Error('JioSaavn search failed');
    
    const data = await response.json();
    
    if (!data.success || !data.data.results || data.data.results.length === 0) {
      throw new Error('No results found');
    }
    
    // Find best match based on duration if provided
    let bestMatch = data.data.results[0];
    
    if (duration && data.data.results.length > 1) {
      const targetDuration = parseInt(duration);
      bestMatch = data.data.results.reduce((best, current) => {
        if (!current.duration || !best.duration) return best;
        const currentDiff = Math.abs(current.duration - targetDuration);
        const bestDiff = Math.abs(best.duration - targetDuration);
        return currentDiff < bestDiff ? current : best;
      });
    }
    
    // Find highest quality download URL
    const downloadUrl = bestMatch.downloadUrl && bestMatch.downloadUrl.length > 0
      ? bestMatch.downloadUrl[bestMatch.downloadUrl.length - 1].url
      : null;
    
    // Find highest quality thumbnail
    const thumbnail = bestMatch.image && bestMatch.image.length > 0
      ? bestMatch.image[bestMatch.image.length - 1].url
      : null;
    
    // Extract artist names
    const artists = bestMatch.artists?.primary?.map(a => a.name).join(', ') || 
                   bestMatch.artists?.all?.map(a => a.name).join(', ') || 
                   'Unknown';
    
    return {
      source: 'saavn',
      title: bestMatch.name,
      artist: artists,
      duration: bestMatch.duration,
      thumbnail: thumbnail,
      downloadUrl: downloadUrl,
      url: bestMatch.url
    };
  } catch (error) {
    console.error('JioSaavn error:', error.message);
    throw error;
  }
}

// Stremio API handler
async function fetchFromStremio(videoId) {
  for (const instance of STREMIO_INSTANCES) {
    try {
      const url = `${instance}/api/v1/videos/${videoId}`;
      const response = await fetchWithTimeout(url, {}, 8000);
      
      if (!response.ok) continue;
      
      const data = await response.json();
      
      return {
        source: 'stremio',
        instance: instance,
        data: data
      };
    } catch (error) {
      console.error(`Stremio instance ${instance} failed:`, error.message);
      continue;
    }
  }
  
  throw new Error('All Stremio instances failed');
}

// Invidious API handler
async function fetchFromInvidious(videoId) {
  for (const instance of INVIDIOUS_INSTANCES) {
    try {
      const url = `https://${instance}/api/v1/videos/${videoId}`;
      const response = await fetchWithTimeout(url, {}, 8000);
      
      if (!response.ok) continue;
      
      const data = await response.json();
      
      return {
        source: 'invidious',
        instance: `https://${instance}`,
        data: data
      };
    } catch (error) {
      console.error(`Invidious instance ${instance} failed:`, error.message);
      continue;
    }
  }
  
  throw new Error('All Invidious instances failed');
}

// Main handler
export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const { id, title, author, duration } = req.query;
  
  if (!id) {
    return res.status(400).json({ 
      error: 'Missing required parameter: id' 
    });
  }
  
  try {
    // Strategy 1: If title is provided, try JioSaavn first
    if (title) {
      try {
        console.log('Trying JioSaavn...');
        const saavnResult = await searchJioSaavn(title, author, duration);
        return res.status(200).json({
          success: true,
          ...saavnResult
        });
      } catch (error) {
        console.log('JioSaavn failed, falling back to Stremio...');
      }
    }
    
    // Strategy 2: Try Stremio
    try {
      console.log('Trying Stremio...');
      const stremioResult = await fetchFromStremio(id);
      return res.status(200).json({
        success: true,
        ...stremioResult
      });
    } catch (error) {
      console.log('Stremio failed, falling back to Invidious...');
    }
    
    // Strategy 3: Try Invidious
    try {
      console.log('Trying Invidious...');
      const invidiousResult = await fetchFromInvidious(id);
      return res.status(200).json({
        success: true,
        ...invidiousResult
      });
    } catch (error) {
      console.log('Invidious failed');
    }
    
    // All strategies failed
    return res.status(404).json({
      success: false,
      error: 'Could not fetch audio from any source',
      attempts: {
        saavn: title ? 'failed' : 'skipped',
        stremio: 'failed',
        invidious: 'failed'
      }
    });
    
  } catch (error) {
    console.error('Unexpected error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
}
