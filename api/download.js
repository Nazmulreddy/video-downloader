const ytdlCore = require('ytdl-core');
const validUrl = require('valid-url');

module.exports = async (req, res) => {
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

  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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
    if (!validUrl.isUri(url)) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    // Check if it's a YouTube URL
    const isYouTube = url.includes('youtube.com') || url.includes('youtu.be');
    if (!isYouTube) {
      return res.status(400).json({
        error: 'Currently, only YouTube videos are supported. Support for other sites coming soon.'
      });
    }

    // Handle YouTube
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
          const aQuality = parseInt(a.qualityLabel) || 0;
          const bQuality = parseInt(b.qualityLabel) || 0;
          if (aQuality !== bQuality) return bQuality - aQuality;
          return (b.fps || 0) - (a.fps || 0);
        })[0];
    }

    if (!format) {
      throw new Error('No suitable format found for the selected type');
    }

    // Calculate file size if available
    let filesize = 'Unknown';
    if (format.contentLength) {
      const sizeInMB = format.contentLength / (1024 * 1024);
      filesize = sizeInMB < 1 ? 
        `${Math.round(sizeInMB * 1024)} KB` : 
        `${Math.round(sizeInMB * 10) / 10} MB`;
    }

    // Clean title for filename
    const cleanTitle = videoDetails.title.replace(/[<>:"/\\|?*]+/g, '');

    res.json({
      title: cleanTitle,
      format: type === 'audio' ? 'MP3' : format.container.toUpperCase(),
      filesize: filesize,
      download_url: format.url
    });

  } catch (error) {
    console.error('Error:', error.message);
    
    // User-friendly error messages
    let errorMessage = 'Failed to process the video URL';
    if (error.message.includes('private') || error.message.includes('unavailable')) {
      errorMessage = 'Video is private or unavailable';
    } else if (error.message.includes('copyright') || error.message.includes('restricted')) {
      errorMessage = 'Video is restricted by copyright';
    } else if (error.message.includes('Invalid URL')) {
      errorMessage = 'Invalid YouTube URL';
    } else if (error.message.includes('No suitable format')) {
      errorMessage = 'Could not find a suitable format for this video';
    }
    
    res.status(500).json({ error: errorMessage });
  }
};
