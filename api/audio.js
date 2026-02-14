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
  'https://super-duper-system.netlify.app'
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

// JioSaavn API handler with improved matching
async function searchJioSaavn(title, author, duration) {
  try {
    // Build search query - combine title and author for better results
    const query = author ? `${title} ${author}` : title;
    const searchUrl = `${SAAVN_BASE_URL}/api/search/songs?query=${encodeURIComponent(query)}`;
    
    console.log('Searching JioSaavn:', searchUrl);
    
    const response = await fetchWithTimeout(searchUrl, {}, 10000);
    if (!response.ok) {
      throw new Error(`JioSaavn HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.success || !data.data || !data.data.results || data.data.results.length === 0) {
      throw new Error('No results found in JioSaavn');
    }
    
    console.log(`Found ${data.data.results.length} results on JioSaavn`);
    
    // Find best match
    let bestMatch = data.data.results[0];
    
    // If author and duration provided, try to find better match
    if (author && duration && data.data.results.length > 1) {
      const targetDuration = parseInt(duration);
      const authorLower = author.toLowerCase();
      
      // Split author by common separators to handle multiple artists
      const authorNames = authorLower.split(/[,&]/).map(a => a.trim());
      
      bestMatch = data.data.results.reduce((best, current) => {
        // Get all artist names from current song
        const currentArtists = [
          ...(current.artists?.primary?.map(a => a.name.toLowerCase()) || []),
          ...(current.artists?.featured?.map(a => a.name.toLowerCase()) || [])
        ];
        
        // Check if any provided author matches
        const artistMatch = authorNames.some(authName => 
          currentArtists.some(artist => 
            artist.includes(authName) || authName.includes(artist)
          )
        );
        
        // Calculate duration difference
        const currentDiff = current.duration ? Math.abs(current.duration - targetDuration) : 99999;
        const bestDiff = best.duration ? Math.abs(best.duration - targetDuration) : 99999;
        
        // Prefer artist match, then duration match
        if (artistMatch && currentDiff < 30) return current; // Within 30 seconds
        if (currentDiff < bestDiff) return current;
        
        return best;
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
    
    // Extract all artist names (primary + featured)
    const primaryArtists = bestMatch.artists?.primary?.map(a => a.name) || [];
    const featuredArtists = bestMatch.artists?.featured?.map(a => a.name) || [];
    const allArtistNames = [...primaryArtists, ...featuredArtists];
    const artists = allArtistNames.length > 0 ? allArtistNames.join(', ') : 'Unknown';
    
    console.log('JioSaavn match:', bestMatch.name, 'by', artists);
    
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
      console.log('Trying Stremio:', url);
      
      const response = await fetchWithTimeout(url, {}, 8000);
      
      if (!response.ok) {
        console.log(`Stremio ${instance} returned ${response.status}`);
        continue;
      }
      
      const data = await response.json();
      
      console.log('Stremio success:', instance);
      
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
      console.log('Trying Invidious:', url);
      
      const response = await fetchWithTimeout(url, {}, 8000);
      
      if (!response.ok) {
        console.log(`Invidious ${instance} returned ${response.status}`);
        continue;
      }
      
      const data = await response.json();
      
      console.log('Invidious success:', instance);
      
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
  
  console.log('Request params:', { id, title, author, duration });
  
  try {
    // Strategy 1: If title is provided, try JioSaavn first
    if (title) {
      try {
        console.log('=== Trying JioSaavn ===');
        const saavnResult = await searchJioSaavn(title, author, duration);
        console.log('✅ JioSaavn succeeded');
        return res.status(200).json({
          success: true,
          ...saavnResult
        });
      } catch (error) {
        console.log('❌ JioSaavn failed:', error.message);
        // Continue to next strategy
      }
    } else {
      console.log('⏭️  Skipping JioSaavn (no title provided)');
    }
    
    // Strategy 2: Try Stremio
    try {
      console.log('=== Trying Stremio ===');
      const stremioResult = await fetchFromStremio(id);
      console.log('✅ Stremio succeeded');
      return res.status(200).json({
        success: true,
        ...stremioResult
      });
    } catch (error) {
      console.log('❌ Stremio failed:', error.message);
      // Continue to next strategy
    }
    
    // Strategy 3: Try Invidious
    try {
      console.log('=== Trying Invidious ===');
      const invidiousResult = await fetchFromInvidious(id);
      console.log('✅ Invidious succeeded');
      return res.status(200).json({
        success: true,
        ...invidiousResult
      });
    } catch (error) {
      console.log('❌ Invidious failed:', error.message);
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
