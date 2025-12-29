const express = require('express');
const cors = require('cors');
const ytdl = require('@distube/ytdl-core');
const ytdlCore = require('ytdl-core');
const youtubedl = require('youtube-dl-exec');
const validUrl = require('valid-url');
const { URL } = require('url');

const app = express();

// Middleware
app.use(cors({
  origin: '*',
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json());

// Helper function to get domain from URL
function getDomain(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace('www.', '');
  } catch {
    return null;
  }
}

// Helper function to validate and sanitize URL
function validateVideoUrl(url) {
  if (!validUrl.isUri(url)) {
    return { valid: false, error: 'Invalid URL format' };
  }

  const domain = getDomain(url);
  if (!domain) {
    return { valid: false, error: 'Invalid URL' };
  }

  // Check for common video platforms
  const allowedDomains = [
    'youtube.com', 'youtu.be', 'tiktok.com', 'instagram.com',
    'facebook.com', 'fb.watch', 'twitter.com', 'x.com',
    'reddit.com', 'vimeo.com', 'dailymotion.com', 'bilibili.com',
    'twitch.tv', 'vimeo.com', 'soundcloud.com', 'streamable.com'
  ];

  const isAllowed = allowedDomains.some(allowed => domain.includes(allowed));
  if (!isAllowed) {
    return { valid: false, error: 'Website not supported. Please check the URL.' };
  }

  return { valid: true, domain };
}

// Helper function to format file size
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Helper function to get YouTube video info
async function getYouTubeInfo(url, type) {
  try {
    const info = await ytdlCore.getInfo(url);
    const videoDetails = info.videoDetails;
    
    let format;
    if (type === 'audio') {
      format = info.formats
        .filter(f => f.hasAudio && !f.hasVideo)
        .sort((a, b) => b.bitrate - a.bitrate)[0];
    } else {
      format = info.formats
        .filter(f => f.hasVideo && f.hasAudio)
        .sort((a, b) => {
          // Sort by quality, then by fps
          const aQuality = parseInt(a.qualityLabel) || 0;
          const bQuality = parseInt(b.qualityLabel) || 0;
          if (aQuality !== bQuality) return bQuality - aQuality;
          return (b.fps || 0) - (a.fps || 0);
        })[0];
    }

    if (!format) {
      throw new Error('No suitable format found');
    }

    const downloadUrl = format.url;
    const contentLength = format.contentLength || 'Unknown';
    
    return {
      title: videoDetails.title.replace(/[<>:"/\\|?*]+/g, ''),
      format: type === 'audio' ? 'MP3' : format.container.toUpperCase(),
      filesize: formatFileSize(parseInt(contentLength) || 0),
      download_url: downloadUrl
    };
  } catch (error) {
    console.error('YouTube error:', error.message);
    throw new Error('Failed to fetch YouTube video. Make sure the video is public.');
  }
}

// Helper function to handle other sites using youtube-dl-exec
async function getGenericInfo(url, type) {
  try {
    const options = {
      dumpJson: true,
      noCheckCertificates: true,
      noWarnings: true,
      preferFreeFormats: true,
      addHeader: ['referer:youtube.com', 'user-agent:Mozilla/5.0']
    };

    if (type === 'audio') {
      options.extractAudio = true;
      options.audioFormat = 'mp3';
      options.audioQuality = '0';
    } else {
      options.format = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';
    }

    const info = await youtubedl(url, options);
    
    if (!info) {
      throw new Error('No video information found');
    }

    let downloadUrl;
    let filesize = 'Unknown';
    let format = type === 'audio' ? 'MP3' : 'MP4';

    if (type === 'audio' && info.url) {
      downloadUrl = info.url;
    } else if (info.url) {
      downloadUrl = info.url;
    } else if (info.formats && info.formats.length > 0) {
      const bestFormat = info.formats.sort((a, b) => {
        if (type === 'audio') {
          return (b.abr || 0) - (a.abr || 0);
        }
        return (b.height || 0) - (a.height || 0);
      })[0];
      downloadUrl = bestFormat.url;
      filesize = formatFileSize(bestFormat.filesize || 0);
      format = bestFormat.ext ? bestFormat.ext.toUpperCase() : format;
    } else {
      throw new Error('No download link available');
    }

    // If no direct URL, use the youtube-dl-exec as fallback
    if (!downloadUrl) {
      const execResult = await youtubedl(url, {
        getUrl: true,
        format: type === 'audio' ? 'bestaudio' : 'best'
      });
      downloadUrl = execResult;
    }

    return {
      title: (info.title || 'video').replace(/[<>:"/\\|?*]+/g, ''),
      format: format,
      filesize: filesize,
      download_url: downloadUrl
    };
  } catch (error) {
    console.error('Generic download error:', error.message);
    
    // Fallback for Instagram
    if (url.includes('instagram.com')) {
      try {
        const { getInstagram } = require('instagram-url-direct');
        const links = await getInstagram(url);
        if (links && links.url && links.url.length > 0) {
          return {
            title: 'Instagram Video',
            format: 'MP4',
            filesize: 'Unknown',
            download_url: links.url[0]
          };
        }
      } catch (igError) {
        console.error('Instagram fallback failed:', igError.message);
      }
    }
    
    throw new Error(`Failed to download video: ${error.message}`);
  }
}

// Main download endpoint
app.post('/api/download', async (req, res) => {
  try {
    const { url, type = 'video' } = req.body;

    // Validate request
    if (!url) {
      return res.status(400).json({ error: 'Video URL is required' });
    }

    if (!['video', 'audio'].includes(type)) {
      return res.status(400).json({ error: 'Invalid download type' });
    }

    // Validate URL
    const validation = validateVideoUrl(url);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const domain = validation.domain;
    let result;

    // Handle different platforms
    if (domain.includes('youtube.com') || domain.includes('youtu.be')) {
      result = await getYouTubeInfo(url, type);
    } else {
      result = await getGenericInfo(url, type);
    }

    // Validate result
    if (!result || !result.download_url) {
      throw new Error('No download link available');
    }

    // Return success response
    res.json({
      title: result.title || 'Video Download',
      format: result.format || (type === 'audio' ? 'MP3' : 'MP4'),
      filesize: result.filesize || 'Unknown',
      download_url: result.download_url
    });

  } catch (error) {
    console.error('Download endpoint error:', error);
    
    // User-friendly error messages
    let errorMessage = 'Failed to download video';
    
    if (error.message.includes('private') || error.message.includes('unavailable')) {
      errorMessage = 'Video is private or unavailable';
    } else if (error.message.includes('copyright') || error.message.includes('restricted')) {
      errorMessage = 'Video is copyright restricted';
    } else if (error.message.includes('not found') || error.message.includes('404')) {
      errorMessage = 'Video not found. Please check the URL';
    } else if (error.message.includes('format') || error.message.includes('No suitable')) {
      errorMessage = 'No suitable video format available';
    } else if (error.message.includes('rate limit') || error.message.includes('too many')) {
      errorMessage = 'Rate limit exceeded. Please try again later';
    } else if (error.message.includes('timeout') || error.message.includes('time out')) {
      errorMessage = 'Request timeout. Please try again';
    } else {
      errorMessage = error.message || 'An error occurred while processing your request';
    }

    res.status(500).json({ error: errorMessage });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// For Vercel serverless
module.exports = (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Handle OPTIONS preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Route to appropriate handler
  if (req.url === '/api/download' && req.method === 'POST') {
    return app(req, res);
  }
  
  if (req.url === '/api/health' && req.method === 'GET') {
    return res.json({ status: 'ok' });
  }

  res.status(404).json({ error: 'Not found' });
};
