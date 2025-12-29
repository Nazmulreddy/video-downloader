const ytdlCore = require('ytdl-core');
const youtubedl = require('youtube-dl-exec');
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

    // Handle YouTube
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
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
              const aQuality = parseInt(a.qualityLabel) || 0;
              const bQuality = parseInt(b.qualityLabel) || 0;
              if (aQuality !== bQuality) return bQuality - aQuality;
              return (b.fps || 0) - (a.fps || 0);
            })[0];
        }

        if (!format) {
          throw new Error('No suitable format found');
        }

        return res.json({
          title: videoDetails.title.replace(/[<>:"/\\|?*]+/g, ''),
          format: type === 'audio' ? 'MP3' : format.container.toUpperCase(),
          filesize: format.contentLength ? 
            `${Math.round(format.contentLength / (1024 * 1024) * 10) / 10} MB` : 'Unknown',
          download_url: format.url
        });
      } catch (error) {
        return res.status(500).json({ error: 'YouTube: ' + error.message });
      }
    }

    // Handle other sites
    try {
      const options = {
        dumpJson: true,
        noCheckCertificates: true,
        preferFreeFormats: true,
      };

      if (type === 'audio') {
        options.extractAudio = true;
        options.audioFormat = 'mp3';
        options.audioQuality = '0';
      } else {
        options.format = 'best[ext=mp4]/best';
      }

      const info = await youtubedl(url, options);
      
      if (!info) {
        throw new Error('No video information found');
      }

      let downloadUrl;
      let format = type === 'audio' ? 'MP3' : 'MP4';
      
      if (info.url) {
        downloadUrl = info.url;
      } else if (info.formats && info.formats.length > 0) {
        const bestFormat = info.formats[0];
        downloadUrl = bestFormat.url;
        format = bestFormat.ext ? bestFormat.ext.toUpperCase() : format;
      } else {
        throw new Error('No download link available');
      }

      return res.json({
        title: (info.title || 'video').replace(/[<>:"/\\|?*]+/g, ''),
        format: format,
        filesize: info.filesize ? 
          `${Math.round(info.filesize / (1024 * 1024) * 10) / 10} MB` : 'Unknown',
        download_url: downloadUrl
      });
    } catch (error) {
      return res.status(500).json({ error: 'Generic: ' + error.message });
    }

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: 'Failed to process request: ' + error.message });
  }
};
